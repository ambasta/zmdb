import type { SchemaSnapshot } from '@zmdb/migrations';
import {
  query,
  sortByName,
  textField,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
} from '@zmdb/migrations/introspect/runtime';
import { mysql, mysqlFamilyIntrospector } from '@zmdb/mysql';
import {
  quoteIdentifier,
  type CompiledQuery,
  type IntrospectionDriver,
  type Introspector,
  type IntrospectOptions,
} from '@zmdb/query-compiler';

interface StorageRow {
  readonly schema: string;
  readonly table: string;
  readonly storage: string;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function schemaFilter(options: IntrospectOptions): {
  readonly sql: string;
  readonly parameters: readonly unknown[];
} {
  const schemas = options.schemas;
  if (schemas === undefined || schemas.length === 0) return { sql: 'TABLE_SCHEMA = DATABASE()', parameters: [] };
  const distinct = [...new Set(schemas)].toSorted();
  return {
    sql: `TABLE_SCHEMA IN (${placeholders(distinct.length)})`,
    parameters: distinct,
  };
}

function mysqlCompatibleCatalog(driver: IntrospectionDriver): IntrospectionDriver {
  return {
    execute(compiled: CompiledQuery): Promise<readonly Record<string, unknown>[]> {
      if (!compiled.text.includes('FROM information_schema.STATISTICS')) return driver.execute(compiled);
      const text = compiled.text.replace(
        'COLUMN_NAME, EXPRESSION, INDEX_TYPE',
        'COLUMN_NAME, NULL AS EXPRESSION, INDEX_TYPE',
      );
      return driver.execute({ ...compiled, text });
    },
  };
}

function identifierList(clause: string): readonly string[] {
  const identifiers: string[] = [];
  for (const match of clause.matchAll(/`((?:``|[^`])+)`/gu)) {
    const identifier = match[1];
    if (identifier !== undefined) identifiers.push(identifier.replaceAll('``', '`'));
  }
  return identifiers;
}

function tableOptions(createTable: string, storage: string): TableSnapshotOptions {
  const shard = /\bSHARD\s+KEY(?:\s+`(?:``|[^`])+`)?\s*\(([^)]*)\)/iu.exec(createTable);
  const sort = /\bSORT\s+KEY(?:\s+`(?:``|[^`])+`)?\s*\(([^)]*)\)/iu.exec(createTable);
  const rowstore = storage === 'INMEMORY_ROWSTORE' || storage === 'ROWSTORE';
  if (!rowstore && storage !== 'COLUMNSTORE') {
    throw new TypeError(
      `singlestore information_schema.TABLES returned unknown STORAGE_TYPE ${JSON.stringify(storage)}`,
    );
  }
  return {
    ...(shard?.[1] === undefined ? {} : { shardKey: identifierList(shard[1]) }),
    ...(sort?.[1] === undefined ? {} : { sortKey: identifierList(sort[1]) }),
    ...(rowstore ? { rowstore: true as const } : {}),
  };
}

type TableSnapshotOptions = NonNullable<CatalogTableSnapshot['tableOptions']>;

function showCreateText(row: Readonly<Record<string, unknown>>, index: number): string {
  const direct = Reflect.get(row, 'Create Table');
  if (typeof direct === 'string') return direct;
  return textField(row, 'CREATE_TABLE', 'singlestore SHOW CREATE TABLE', index);
}

function physicalIndexes(table: CatalogTableSnapshot): CatalogTableSnapshot['indexes'] {
  return table.indexes.filter(index => index.method !== 'shard' && index.method !== 'clustered columnstore');
}

function computedColumns(table: CatalogTableSnapshot): CatalogTableSnapshot['columns'] {
  return table.columns.map(column =>
    column.generated === undefined
      ? column
      : {
          ...column,
          generated: {
            ...column.generated,
            stored: /\bPERSISTED\b/iu.test(column.catalogType),
          },
        },
  );
}

function exactTimestampWarnings(base: CatalogSchemaSnapshot): CatalogSchemaSnapshot['warnings'] {
  const exact = new Set(
    base.tables.flatMap(table =>
      table.columns
        .filter(column => column.catalogType.toLowerCase() === 'datetime(6)')
        .map(column => `${table.name}\0${column.name}`),
    ),
  );
  return base.warnings.filter(
    warning =>
      warning.column === undefined ||
      !exact.has(`${warning.table}\0${warning.column}`) ||
      !warning.reason.includes('forward DDL emits DATETIME(3)'),
  );
}

export async function singlestoreSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
  parent: (driver: IntrospectionDriver, options?: IntrospectOptions) => Promise<CatalogSchemaSnapshot>,
): Promise<CatalogSchemaSnapshot> {
  const base = await parent(mysqlCompatibleCatalog(driver), options);
  const filter = schemaFilter(options);
  const storageRows = await driver.execute(
    query(
      `SELECT TABLE_SCHEMA, TABLE_NAME, STORAGE_TYPE FROM information_schema.TABLES ` +
        `WHERE ${filter.sql} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`,
      filter.parameters,
    ),
  );
  const storage = storageRows.map((row, index): StorageRow => ({
    schema: textField(row, 'TABLE_SCHEMA', 'singlestore information_schema.TABLES', index),
    table: textField(row, 'TABLE_NAME', 'singlestore information_schema.TABLES', index),
    storage: textField(row, 'STORAGE_TYPE', 'singlestore information_schema.TABLES', index),
  }));
  const byTable = new Map(storage.map(row => [row.table, row]));
  const tables: CatalogTableSnapshot[] = [];
  for (const table of base.tables) {
    const metadata = byTable.get(table.name);
    if (metadata === undefined) {
      throw new TypeError(`singlestore catalog has no storage metadata for table "${table.name}"`);
    }
    const rows = await driver.execute(
      query(
        `SHOW CREATE TABLE ${quoteIdentifier(mysql, metadata.schema)}.${quoteIdentifier(mysql, metadata.table)}`,
        [],
      ),
    );
    const row = rows[0];
    if (row === undefined) throw new TypeError(`singlestore SHOW CREATE TABLE returned no row for "${table.name}"`);
    tables.push({
      ...table,
      columns: computedColumns(table),
      indexes: physicalIndexes(table),
      tableOptions: tableOptions(showCreateText(row, 0), metadata.storage),
    });
  }
  return {
    ...base,
    tables: sortByName(tables),
    warnings: exactTimestampWarnings(base),
  };
}

const family = mysqlFamilyIntrospector('singlestore', {
  snapshot: singlestoreSnapshot,
});

export const singlestoreIntrospector: Introspector<'singlestore'> = Object.freeze({
  ...family,
  normalizeForDrift(snapshot: SchemaSnapshot, role: 'live' | 'declared'): SchemaSnapshot {
    return family.normalizeForDrift(snapshot, role);
  },
});
