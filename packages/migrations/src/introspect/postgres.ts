import type { ExtensionType } from '@zmdb/query-compiler';

import {
  action,
  booleanField,
  CatalogRowError,
  integerField,
  nullableIntegerField,
  nullableTextField,
  query,
  sortByName,
  sortWarnings,
  tableSelected,
  textField,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
} from './common.js';
import { normalizeDriftSnapshot } from './drift.js';
import type { IntrospectionDriver, IntrospectOptions, LegacyIntrospector } from './index.js';

interface PostgresColumn {
  readonly table: string;
  readonly ordinal: number;
  readonly name: string;
  readonly nullable: boolean;
  readonly dataType: string;
  readonly udtName: string;
  readonly length: number | null;
  readonly default: string | null;
  readonly identity: string;
  readonly typeModifier: number;
  readonly typeKind: string;
  readonly domainName: string | null;
  readonly domainBaseType: string | null;
  readonly extension: string | null;
}

interface PostgresPrimaryKey {
  readonly table: string;
  readonly ordinal: number;
  readonly column: string;
}

interface PostgresForeignKey {
  readonly table: string;
  readonly constraint: string;
  readonly ordinal: number;
  readonly column: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly onUpdate: string;
  readonly onDelete: string;
}

interface PostgresIndexRow {
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly primary: boolean;
  readonly method: string;
  readonly where: string | null;
  readonly position: number;
  readonly definition: string;
  readonly opclass: string | null;
}

function postgresSchemas(options: IntrospectOptions): readonly string[] {
  const schemas = options.schemas ?? ['public'];
  if (schemas.length === 0) return ['public'];
  return [...new Set(schemas)].toSorted();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `$${String(index + 1)}`).join(', ');
}

function parseColumn(row: Readonly<Record<string, unknown>>, index: number): PostgresColumn {
  const catalog = 'postgres information_schema.columns';
  const nullable = textField(row, 'is_nullable', catalog, index);
  if (nullable !== 'YES' && nullable !== 'NO') {
    throw new CatalogRowError(catalog, index, 'is_nullable', '"YES" or "NO"', nullable);
  }
  const identity = textField(row, 'attidentity', catalog, index);
  if (identity !== '' && identity !== 'a' && identity !== 'd') {
    throw new CatalogRowError(catalog, index, 'attidentity', '"", "a" or "d"', identity);
  }
  return {
    table: textField(row, 'table_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    name: textField(row, 'column_name', catalog, index),
    nullable: nullable === 'YES',
    dataType: textField(row, 'data_type', catalog, index),
    udtName: textField(row, 'udt_name', catalog, index),
    length: nullableIntegerField(row, 'character_maximum_length', catalog, index),
    default: nullableTextField(row, 'column_default', catalog, index),
    identity,
    typeModifier: integerField(row, 'atttypmod', catalog, index),
    typeKind: textField(row, 'typtype', catalog, index),
    domainName: nullableTextField(row, 'domain_name', catalog, index),
    domainBaseType: nullableTextField(row, 'domain_base_type', catalog, index),
    extension: nullableTextField(row, 'extension_name', catalog, index),
  };
}

function parsePrimaryKey(row: Readonly<Record<string, unknown>>, index: number): PostgresPrimaryKey {
  const catalog = 'postgres information_schema primary keys';
  return {
    table: textField(row, 'table_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    column: textField(row, 'column_name', catalog, index),
  };
}

function parseForeignKey(row: Readonly<Record<string, unknown>>, index: number): PostgresForeignKey {
  const catalog = 'postgres information_schema foreign keys';
  return {
    table: textField(row, 'table_name', catalog, index),
    constraint: textField(row, 'constraint_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    column: textField(row, 'column_name', catalog, index),
    targetTable: textField(row, 'target_table', catalog, index),
    targetColumn: textField(row, 'target_column', catalog, index),
    onUpdate: textField(row, 'update_rule', catalog, index),
    onDelete: textField(row, 'delete_rule', catalog, index),
  };
}

function parseIndex(row: Readonly<Record<string, unknown>>, index: number): PostgresIndexRow {
  const catalog = 'postgres pg_catalog indexes';
  return {
    table: textField(row, 'table_name', catalog, index),
    name: textField(row, 'index_name', catalog, index),
    unique: booleanField(row, 'is_unique', catalog, index),
    primary: booleanField(row, 'is_primary', catalog, index),
    method: textField(row, 'method', catalog, index),
    where: nullableTextField(row, 'predicate', catalog, index),
    position: integerField(row, 'position', catalog, index),
    definition: textField(row, 'definition', catalog, index),
    opclass: nullableTextField(row, 'operator_class', catalog, index),
  };
}

function catalogType(column: PostgresColumn): string {
  if (column.typeKind === 'd') return column.domainName ?? column.udtName;
  if (column.dataType === 'USER-DEFINED') return column.udtName;
  if (column.dataType === 'ARRAY') {
    return column.udtName.startsWith('_') ? `${column.udtName.slice(1)}[]` : column.dataType;
  }
  return column.dataType;
}

function postgresType(column: PostgresColumn): {
  readonly type: string | ExtensionType;
  readonly length?: number;
  readonly warning?: string;
} {
  const source = (column.typeKind === 'd' ? column.domainBaseType : null) ?? column.dataType;
  const normalized = source.toLowerCase();

  // Postgres has two different generation mechanisms here: the historical
  // sequence-backed serial spelling and SQL identity attributes. SchemaSnapshot
  // currently has one `serial` representation, so both intentionally collapse.
  if (
    column.identity === 'a' ||
    column.identity === 'd' ||
    (column.default?.toLowerCase().startsWith('nextval(') ?? false)
  ) {
    return column.identity === 'a' || column.identity === 'd'
      ? {
          type: 'serial',
          warning:
            'Postgres identity was normalized to serial; regenerating uses a sequence default rather than an identity attribute',
        }
      : { type: 'serial' };
  }
  if (column.typeKind === 'e') return { type: 'jsonEnum' };
  if (column.extension === 'citext' || column.udtName === 'citext') {
    return { type: { extension: 'citext', name: 'citext' } };
  }
  if (column.extension === 'vector' || column.udtName === 'vector') {
    return {
      type: {
        extension: 'vector',
        name: 'vector',
        ...(column.typeModifier > 0 ? { args: [column.typeModifier] } : {}),
      },
    };
  }
  if (normalized === 'integer' || normalized === 'int4') return { type: 'integer' };
  if (normalized === 'bigint' || normalized === 'int8') return { type: 'bigint' };
  if (normalized === 'smallint' || normalized === 'int2') {
    return { type: 'integer', warning: `Postgres type ${catalogType(column)} was widened to integer` };
  }
  if (normalized === 'numeric' || normalized === 'decimal') return { type: 'numeric' };
  if (normalized === 'character varying' || normalized === 'varchar') {
    return column.length === null ? { type: 'text' } : { type: 'varchar', length: column.length };
  }
  if (normalized === 'text') return { type: 'text' };
  if (normalized === 'character' || normalized === 'bpchar') {
    return {
      type: 'varchar',
      ...(column.length === null ? {} : { length: column.length }),
      warning: `Postgres blank-padding semantics of ${catalogType(column)} are not represented`,
    };
  }
  if (normalized === 'boolean' || normalized === 'bool') return { type: 'boolean' };
  if (normalized === 'timestamp with time zone') return { type: 'timestamp' };
  if (normalized === 'timestamp without time zone') {
    return {
      type: 'timestamp',
      warning: 'Postgres timestamp without time zone was normalized to timestamp; forward DDL emits TIMESTAMPTZ',
    };
  }
  if (normalized === 'json' || normalized === 'jsonb') return { type: 'json' };
  return {
    type: catalogType(column),
    warning: `Postgres type ${catalogType(column)} cannot be represented by the current declared SQL type vocabulary`,
  };
}

function primaryKeys(rows: readonly PostgresPrimaryKey[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, PostgresPrimaryKey[]>();
  for (const row of rows) {
    const values = grouped.get(row.table);
    if (values) values.push(row);
    else grouped.set(row.table, [row]);
  }
  return new Map(
    [...grouped].map(([table, values]) => [
      table,
      values.toSorted((left, right) => left.ordinal - right.ordinal).map(value => value.column),
    ]),
  );
}

function foreignKeys(rows: readonly PostgresForeignKey[]): ReadonlyMap<string, readonly CatalogForeignKeySnapshot[]> {
  const grouped = new Map<string, PostgresForeignKey[]>();
  for (const row of rows) {
    const id = `${row.table}\0${row.constraint}`;
    const values = grouped.get(id);
    if (values) values.push(row);
    else grouped.set(id, [row]);
  }
  const byTable = new Map<string, CatalogForeignKeySnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.ordinal - right.ordinal);
    const first = values[0];
    if (!first) continue;
    const snapshot: CatalogForeignKeySnapshot = {
      name: first.constraint,
      columns: values.map(value => value.column),
      targetTable: first.targetTable,
      targetColumns: values.map(value => value.targetColumn),
      onDelete: action(first.onDelete, 'postgres information_schema foreign keys', 0, 'delete_rule'),
      onUpdate: action(first.onUpdate, 'postgres information_schema foreign keys', 0, 'update_rule'),
    };
    const tableValues = byTable.get(first.table);
    if (tableValues) tableValues.push(snapshot);
    else byTable.set(first.table, [snapshot]);
  }
  return new Map([...byTable].map(([table, values]) => [table, sortByName(values)]));
}

function unquoteIdentifier(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  return value;
}

function indexColumn(
  definition: string,
  tableColumns: ReadonlySet<string>,
  opclass: string | null,
): CatalogIndexColumn {
  const match = /^("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)$/.exec(definition.trim());
  const named = match?.[1];
  if (named !== undefined) {
    const column = unquoteIdentifier(named);
    if (tableColumns.has(column)) {
      return opclass === null ? column : { column, opclass };
    }
  }
  return { expr: definition.trim(), ...(opclass === null ? {} : { opclass }) };
}

function indexes(
  rows: readonly PostgresIndexRow[],
  columns: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, readonly CatalogIndexSnapshot[]> {
  const grouped = new Map<string, PostgresIndexRow[]>();
  for (const row of rows) {
    if (row.primary) continue;
    const id = `${row.table}\0${row.name}`;
    const values = grouped.get(id);
    if (values) values.push(row);
    else grouped.set(id, [row]);
  }
  const byTable = new Map<string, CatalogIndexSnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.position - right.position);
    const first = values[0];
    if (!first) continue;
    const method = first.method.toLowerCase();
    const snapshot: CatalogIndexSnapshot = {
      name: first.name,
      columns: values.map(value => indexColumn(value.definition, columns.get(first.table) ?? new Set(), value.opclass)),
      unique: first.unique,
      ...(method === 'btree' ? {} : { method }),
      ...(first.where === null ? {} : { where: first.where }),
    };
    const tableValues = byTable.get(first.table);
    if (tableValues) tableValues.push(snapshot);
    else byTable.set(first.table, [snapshot]);
  }
  return new Map([...byTable].map(([table, values]) => [table, sortByName(values)]));
}

async function postgresSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
): Promise<CatalogSchemaSnapshot> {
  const schemas = postgresSchemas(options);
  const schemaSlots = placeholders(schemas.length);
  const [tableRows, columnRows, primaryKeyRows, foreignKeyRows, indexRows, extensionRows] = await Promise.all([
    driver.execute(
      query(
        `SELECT table_schema, table_name FROM information_schema.tables ` +
          `WHERE table_type = 'BASE TABLE' AND table_schema IN (${schemaSlots}) ` +
          `ORDER BY table_schema, table_name`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT c.table_schema, c.table_name, c.ordinal_position, c.column_name, c.is_nullable, ` +
          `c.data_type, c.udt_name, c.domain_name, c.character_maximum_length, c.numeric_precision, c.numeric_scale, ` +
          `c.column_default, a.attidentity, a.atttypmod, t.typtype, bt.typname AS domain_base_type, ` +
          `ext.extname AS extension_name FROM information_schema.columns c ` +
          `JOIN pg_catalog.pg_namespace ns ON ns.nspname = c.table_schema ` +
          `JOIN pg_catalog.pg_class cls ON cls.relnamespace = ns.oid AND cls.relname = c.table_name ` +
          `JOIN pg_catalog.pg_attribute a ON a.attrelid = cls.oid AND a.attname = c.column_name ` +
          `JOIN pg_catalog.pg_type t ON t.oid = a.atttypid ` +
          `LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype ` +
          `LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_type'::regclass AND dep.objid = t.oid ` +
          `AND dep.deptype = 'e' ` +
          `LEFT JOIN pg_catalog.pg_extension ext ON ext.oid = dep.refobjid ` +
          `WHERE c.table_schema IN (${schemaSlots}) ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT tc.table_name, kcu.column_name, kcu.ordinal_position ` +
          `FROM information_schema.table_constraints tc ` +
          `JOIN information_schema.key_column_usage kcu ON kcu.constraint_catalog = tc.constraint_catalog ` +
          `AND kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name ` +
          `AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name ` +
          `WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema IN (${schemaSlots}) ` +
          `ORDER BY tc.table_name, kcu.ordinal_position`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position, ` +
          `ukcu.table_name AS target_table, ukcu.column_name AS target_column, ` +
          `rc.update_rule, rc.delete_rule FROM information_schema.table_constraints tc ` +
          `JOIN information_schema.key_column_usage kcu ON kcu.constraint_catalog = tc.constraint_catalog ` +
          `AND kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name ` +
          `AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name ` +
          `JOIN information_schema.referential_constraints rc ON rc.constraint_catalog = tc.constraint_catalog ` +
          `AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name ` +
          `JOIN information_schema.key_column_usage ukcu ON ukcu.constraint_catalog = rc.unique_constraint_catalog ` +
          `AND ukcu.constraint_schema = rc.unique_constraint_schema ` +
          `AND ukcu.constraint_name = rc.unique_constraint_name ` +
          `AND ukcu.ordinal_position = kcu.position_in_unique_constraint ` +
          `WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema IN (${schemaSlots}) ` +
          `ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT ns.nspname AS table_schema, tbl.relname AS table_name, idx.relname AS index_name, ` +
          `i.indisunique AS is_unique, i.indisprimary AS is_primary, am.amname AS method, ` +
          `pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate, positions.position, ` +
          `pg_catalog.pg_get_indexdef(i.indexrelid, positions.position, true) AS definition, ` +
          `CASE WHEN opc.opcdefault THEN NULL ELSE opc.opcname END AS operator_class ` +
          `FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid ` +
          `JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace ` +
          `JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid ` +
          `JOIN pg_catalog.pg_am am ON am.oid = idx.relam ` +
          `CROSS JOIN LATERAL generate_series(1, i.indnkeyatts) AS positions(position) ` +
          `JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[positions.position - 1] ` +
          `WHERE ns.nspname IN (${schemaSlots}) ORDER BY tbl.relname, idx.relname, positions.position`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT ext.extname AS name, ns.nspname AS schema FROM pg_catalog.pg_extension ext ` +
          `JOIN pg_catalog.pg_namespace ns ON ns.oid = ext.extnamespace ` +
          `WHERE ext.extname <> 'plpgsql' ORDER BY ext.extname`,
      ),
    ),
  ]);

  const tableNames = tableRows.map((row, index) =>
    textField(row, 'table_name', 'postgres information_schema.tables', index),
  );
  const duplicate = tableNames.find((name, index) => tableNames.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new TypeError(
      `postgres introspection cannot represent table "${duplicate}" from more than one schema in a schema-neutral snapshot`,
    );
  }

  const parsedColumns = columnRows.map(parseColumn);
  const parsedPrimaryKeys = primaryKeyRows.map(parsePrimaryKey);
  const parsedForeignKeys = foreignKeyRows.map(parseForeignKey);
  const parsedIndexes = indexRows.map(parseIndex);
  const primaryKeyByTable = primaryKeys(parsedPrimaryKeys);
  const foreignKeyByTable = foreignKeys(parsedForeignKeys);
  const columnNames = new Map<string, ReadonlySet<string>>(
    tableNames.map(name => [
      name,
      new Set(parsedColumns.filter(column => column.table === name).map(column => column.name)),
    ]),
  );
  const indexByTable = indexes(parsedIndexes, columnNames);

  const tables: CatalogTableSnapshot[] = [];
  const warnings: CatalogWarning[] = [];
  for (const name of tableNames) {
    if (!tableSelected(name, options)) continue;
    const primaryKey = primaryKeyByTable.get(name) ?? [];
    const columns: CatalogColumnSnapshot[] = parsedColumns
      .filter(column => column.table === name)
      .map(column => {
        const mapped = postgresType(column);
        if (mapped.warning !== undefined) {
          warnings.push({ table: name, column: column.name, reason: mapped.warning });
        }
        if (column.typeKind === 'd') {
          warnings.push({
            table: name,
            column: column.name,
            reason: `Postgres domain ${catalogType(column)} was normalized to its base type and its constraints are not represented`,
          });
        }
        const generated =
          column.identity === 'a' ||
          column.identity === 'd' ||
          (column.default?.toLowerCase().startsWith('nextval(') ?? false);
        return {
          name: column.name,
          type: mapped.type,
          catalogType: catalogType(column),
          nullable: column.nullable,
          primaryKey: primaryKey.includes(column.name),
          ...(mapped.length === undefined ? {} : { length: mapped.length }),
          ...(column.default === null || generated ? {} : { default: column.default }),
        };
      })
      .toSorted((left, right) => left.name.localeCompare(right.name));
    tables.push({
      name,
      columns,
      primaryKey,
      foreignKeys: foreignKeyByTable.get(name) ?? [],
      indexes: indexByTable.get(name) ?? [],
    });
  }

  const extensions = extensionRows.map((row, index) => {
    const name = textField(row, 'name', 'postgres pg_catalog.pg_extension', index);
    const schema = textField(row, 'schema', 'postgres pg_catalog.pg_extension', index);
    return schema === 'public' ? { name } : { name, schema };
  });

  return {
    version: 1,
    tables: sortByName(tables),
    extensions: sortByName(extensions),
    warnings: sortWarnings(warnings),
  };
}

const databaseName = 'postgres' as const;

export const postgresIntrospector: LegacyIntrospector<typeof databaseName> = {
  name: databaseName,
  dialect: databaseName,
  snapshot: postgresSnapshot,
  normalizeForDrift: (snapshot, role) => normalizeDriftSnapshot(snapshot, role),
};
