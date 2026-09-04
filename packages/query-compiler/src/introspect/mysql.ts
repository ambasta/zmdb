import {
  action,
  CatalogRowError,
  flagField,
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
import type { IntrospectionDriver, IntrospectOptions, Introspector } from './index.js';

interface MySqlColumn {
  readonly table: string;
  readonly ordinal: number;
  readonly name: string;
  readonly nullable: boolean;
  readonly dataType: string;
  readonly catalogType: string;
  readonly length: number | null;
  readonly default: string | null;
  readonly extra: string;
}

interface MySqlKeyColumn {
  readonly table: string;
  readonly constraint: string;
  readonly ordinal: number;
  readonly column: string;
  readonly targetTable: string | null;
  readonly targetColumn: string | null;
}

interface MySqlReference {
  readonly table: string;
  readonly constraint: string;
  readonly onUpdate: string;
  readonly onDelete: string;
}

interface MySqlStatistic {
  readonly table: string;
  readonly name: string;
  readonly nonUnique: boolean;
  readonly sequence: number;
  readonly column: string | null;
  readonly expression: string | null;
  readonly method: string;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function schemaFilter(
  field: string,
  options: IntrospectOptions,
): {
  readonly sql: string;
  readonly parameters: readonly unknown[];
} {
  const schemas = options.schemas;
  if (schemas === undefined || schemas.length === 0) return { sql: `${field} = DATABASE()`, parameters: [] };
  const distinct = [...new Set(schemas)].toSorted();
  return { sql: `${field} IN (${placeholders(distinct.length)})`, parameters: distinct };
}

function parseColumn(row: Readonly<Record<string, unknown>>, index: number): MySqlColumn {
  const catalog = 'mysql information_schema.COLUMNS';
  const nullable = textField(row, 'IS_NULLABLE', catalog, index);
  if (nullable !== 'YES' && nullable !== 'NO') {
    throw new CatalogRowError(catalog, index, 'IS_NULLABLE', '"YES" or "NO"', nullable);
  }
  return {
    table: textField(row, 'TABLE_NAME', catalog, index),
    ordinal: integerField(row, 'ORDINAL_POSITION', catalog, index),
    name: textField(row, 'COLUMN_NAME', catalog, index),
    nullable: nullable === 'YES',
    dataType: textField(row, 'DATA_TYPE', catalog, index),
    catalogType: textField(row, 'COLUMN_TYPE', catalog, index),
    length: nullableIntegerField(row, 'CHARACTER_MAXIMUM_LENGTH', catalog, index),
    default: nullableTextField(row, 'COLUMN_DEFAULT', catalog, index),
    extra: textField(row, 'EXTRA', catalog, index),
  };
}

function parseKeyColumn(row: Readonly<Record<string, unknown>>, index: number): MySqlKeyColumn {
  const catalog = 'mysql information_schema.KEY_COLUMN_USAGE';
  return {
    table: textField(row, 'TABLE_NAME', catalog, index),
    constraint: textField(row, 'CONSTRAINT_NAME', catalog, index),
    ordinal: integerField(row, 'ORDINAL_POSITION', catalog, index),
    column: textField(row, 'COLUMN_NAME', catalog, index),
    targetTable: nullableTextField(row, 'REFERENCED_TABLE_NAME', catalog, index),
    targetColumn: nullableTextField(row, 'REFERENCED_COLUMN_NAME', catalog, index),
  };
}

function parseReference(row: Readonly<Record<string, unknown>>, index: number): MySqlReference {
  const catalog = 'mysql information_schema.REFERENTIAL_CONSTRAINTS';
  return {
    table: textField(row, 'TABLE_NAME', catalog, index),
    constraint: textField(row, 'CONSTRAINT_NAME', catalog, index),
    onUpdate: textField(row, 'UPDATE_RULE', catalog, index),
    onDelete: textField(row, 'DELETE_RULE', catalog, index),
  };
}

function parseStatistic(row: Readonly<Record<string, unknown>>, index: number): MySqlStatistic {
  const catalog = 'mysql information_schema.STATISTICS';
  return {
    table: textField(row, 'TABLE_NAME', catalog, index),
    name: textField(row, 'INDEX_NAME', catalog, index),
    nonUnique: flagField(row, 'NON_UNIQUE', catalog, index),
    sequence: integerField(row, 'SEQ_IN_INDEX', catalog, index),
    column: nullableTextField(row, 'COLUMN_NAME', catalog, index),
    expression: nullableTextField(row, 'EXPRESSION', catalog, index),
    method: textField(row, 'INDEX_TYPE', catalog, index),
  };
}

function mysqlType(column: MySqlColumn): {
  readonly type: string;
  readonly length?: number;
  readonly warning?: string;
} {
  const dataType = column.dataType.toLowerCase();
  const catalogType = column.catalogType.toLowerCase();
  if (column.extra.toLowerCase().split(/\s+/).includes('auto_increment')) return { type: 'serial' };
  if (dataType === 'int' || dataType === 'integer' || dataType === 'mediumint') return { type: 'integer' };
  if (dataType === 'bigint') return { type: 'bigint' };
  if (dataType === 'tinyint' && /^tinyint\s*\(\s*1\s*\)/.test(catalogType)) return { type: 'boolean' };
  if (dataType === 'tinyint' || dataType === 'smallint') {
    return { type: 'integer', warning: `MySQL type ${column.catalogType} was widened to integer` };
  }
  if (dataType === 'decimal' || dataType === 'numeric') return { type: 'numeric' };
  if (dataType === 'varchar') {
    return column.length === null
      ? { type: 'varchar', warning: `MySQL varchar ${column.catalogType} reported no length` }
      : { type: 'varchar', length: column.length };
  }
  if (dataType === 'text' || dataType === 'tinytext' || dataType === 'mediumtext' || dataType === 'longtext') {
    return dataType === 'text'
      ? { type: 'text' }
      : { type: 'text', warning: `MySQL type ${column.catalogType} was widened to text` };
  }
  if (dataType === 'datetime') {
    return catalogType === 'datetime(3)'
      ? { type: 'timestamp' }
      : {
          type: 'timestamp',
          warning: `MySQL type ${column.catalogType} was normalized to timestamp; forward DDL emits DATETIME(3)`,
        };
  }
  if (dataType === 'timestamp') {
    return {
      type: 'timestamp',
      warning:
        'MySQL TIMESTAMP converts through the session time zone and has a 2038 limit; forward DDL emits DATETIME(3)',
    };
  }
  if (dataType === 'json') return { type: 'json' };
  if (dataType === 'enum') return { type: 'jsonEnum' };
  return {
    type: column.catalogType,
    warning: `MySQL type ${column.catalogType} cannot be represented by the current declared SQL type vocabulary`,
  };
}

function primaryKeys(keys: readonly MySqlKeyColumn[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, MySqlKeyColumn[]>();
  for (const key of keys) {
    if (key.constraint !== 'PRIMARY') continue;
    const values = grouped.get(key.table);
    if (values) values.push(key);
    else grouped.set(key.table, [key]);
  }
  return new Map(
    [...grouped].map(([table, values]) => [
      table,
      values.toSorted((left, right) => left.ordinal - right.ordinal).map(value => value.column),
    ]),
  );
}

function foreignKeys(
  keys: readonly MySqlKeyColumn[],
  references: readonly MySqlReference[],
): ReadonlyMap<string, readonly CatalogForeignKeySnapshot[]> {
  const referenceByName = new Map(
    references.map(reference => [`${reference.table}\0${reference.constraint}`, reference]),
  );
  const grouped = new Map<string, MySqlKeyColumn[]>();
  for (const key of keys) {
    if (key.targetTable === null || key.targetColumn === null) continue;
    const id = `${key.table}\0${key.constraint}`;
    const values = grouped.get(id);
    if (values) values.push(key);
    else grouped.set(id, [key]);
  }
  const result = new Map<string, CatalogForeignKeySnapshot[]>();
  for (const [id, values] of grouped) {
    values.sort((left, right) => left.ordinal - right.ordinal);
    const first = values[0];
    if (!first) continue;
    const reference = referenceByName.get(id);
    if (!reference) {
      throw new TypeError(
        `mysql catalog has key columns for foreign key "${first.constraint}" but no referential constraint row`,
      );
    }
    const targetTable = first.targetTable;
    if (
      targetTable === null ||
      values.some(value => value.targetTable !== targetTable || value.targetColumn === null)
    ) {
      throw new TypeError(`mysql foreign key "${first.constraint}" has inconsistent target columns`);
    }
    const snapshot: CatalogForeignKeySnapshot = {
      name: first.constraint,
      columns: values.map(value => value.column),
      targetTable,
      targetColumns: values.map(value => value.targetColumn).filter(value => value !== null),
      onDelete: action(reference.onDelete, 'mysql information_schema.REFERENTIAL_CONSTRAINTS', 0, 'DELETE_RULE'),
      onUpdate: action(reference.onUpdate, 'mysql information_schema.REFERENTIAL_CONSTRAINTS', 0, 'UPDATE_RULE'),
    };
    const tableValues = result.get(first.table);
    if (tableValues) tableValues.push(snapshot);
    else result.set(first.table, [snapshot]);
  }
  return new Map([...result].map(([table, values]) => [table, sortByName(values)]));
}

function indexes(statistics: readonly MySqlStatistic[]): ReadonlyMap<string, readonly CatalogIndexSnapshot[]> {
  const grouped = new Map<string, MySqlStatistic[]>();
  for (const statistic of statistics) {
    if (statistic.name === 'PRIMARY') continue;
    const id = `${statistic.table}\0${statistic.name}`;
    const values = grouped.get(id);
    if (values) values.push(statistic);
    else grouped.set(id, [statistic]);
  }
  const byTable = new Map<string, CatalogIndexSnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.sequence - right.sequence);
    const first = values[0];
    if (!first) continue;
    const columns: CatalogIndexColumn[] = values.map(value => {
      if (value.expression !== null) return { expr: value.expression };
      if (value.column !== null) return value.column;
      throw new TypeError(`mysql index "${first.name}" has neither COLUMN_NAME nor EXPRESSION`);
    });
    const method = first.method.toLowerCase();
    const snapshot: CatalogIndexSnapshot = {
      name: first.name,
      columns,
      unique: !first.nonUnique,
      ...(method === 'btree' ? {} : { method }),
    };
    const tableValues = byTable.get(first.table);
    if (tableValues) tableValues.push(snapshot);
    else byTable.set(first.table, [snapshot]);
  }
  return new Map([...byTable].map(([table, values]) => [table, sortByName(values)]));
}

async function mysqlSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
): Promise<CatalogSchemaSnapshot> {
  const tablesFilter = schemaFilter('TABLE_SCHEMA', options);
  const constraintFilter = schemaFilter('CONSTRAINT_SCHEMA', options);
  const [tableRows, columnRows, statisticRows, keyRows, referenceRows] = await Promise.all([
    driver.execute(
      query(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES ` +
          `WHERE ${tablesFilter.sql} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        tablesFilter.parameters,
      ),
    ),
    driver.execute(
      query(
        `SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, IS_NULLABLE, DATA_TYPE, COLUMN_TYPE, ` +
          `CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_DEFAULT, EXTRA, ` +
          `GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE ${tablesFilter.sql} ` +
          `ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        tablesFilter.parameters,
      ),
    ),
    driver.execute(
      query(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, EXPRESSION, INDEX_TYPE ` +
          `FROM information_schema.STATISTICS WHERE ${tablesFilter.sql} ` +
          `ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        tablesFilter.parameters,
      ),
    ),
    driver.execute(
      query(
        `SELECT TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION, POSITION_IN_UNIQUE_CONSTRAINT, ` +
          `COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ` +
          `FROM information_schema.KEY_COLUMN_USAGE WHERE ${constraintFilter.sql} ` +
          `ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
        constraintFilter.parameters,
      ),
    ),
    driver.execute(
      query(
        `SELECT TABLE_NAME, CONSTRAINT_NAME, UNIQUE_CONSTRAINT_NAME, MATCH_OPTION, UPDATE_RULE, DELETE_RULE ` +
          `FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE ${constraintFilter.sql} ` +
          `ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
        constraintFilter.parameters,
      ),
    ),
  ]);

  const tableNames = tableRows.map((row, index) =>
    textField(row, 'TABLE_NAME', 'mysql information_schema.TABLES', index),
  );
  const duplicate = tableNames.find((name, index) => tableNames.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new TypeError(
      `mysql introspection cannot represent table "${duplicate}" from more than one schema in a schema-neutral snapshot`,
    );
  }

  const parsedColumns = columnRows.map(parseColumn);
  const parsedKeys = keyRows.map(parseKeyColumn);
  const parsedReferences = referenceRows.map(parseReference);
  const parsedStatistics = statisticRows.map(parseStatistic);
  const keyByTable = primaryKeys(parsedKeys);
  const foreignKeyByTable = foreignKeys(parsedKeys, parsedReferences);
  const indexByTable = indexes(parsedStatistics);

  const tables: CatalogTableSnapshot[] = [];
  const warnings: CatalogWarning[] = [];
  for (const name of tableNames) {
    if (!tableSelected(name, options)) continue;
    const primaryKey = keyByTable.get(name) ?? [];
    const columns: CatalogColumnSnapshot[] = parsedColumns
      .filter(column => column.table === name)
      .map(column => {
        const mapped = mysqlType(column);
        if (mapped.warning !== undefined) {
          warnings.push({ table: name, column: column.name, reason: mapped.warning });
        }
        return {
          name: column.name,
          type: mapped.type,
          catalogType: column.catalogType,
          nullable: column.nullable,
          primaryKey: primaryKey.includes(column.name),
          ...(mapped.length === undefined ? {} : { length: mapped.length }),
          ...(column.default === null ? {} : { default: column.default }),
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

  return {
    version: 1,
    tables: sortByName(tables),
    extensions: [],
    warnings: sortWarnings(warnings),
  };
}

export const mysqlIntrospector: Introspector = {
  dialect: 'mysql',
  snapshot: mysqlSnapshot,
};
