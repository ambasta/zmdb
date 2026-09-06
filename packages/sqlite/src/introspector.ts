import type { ColumnSnapshot, SchemaSnapshot } from '@zmdb/migrations';
import {
  action,
  CatalogRowError,
  deterministicForeignKeyName,
  flagField,
  integerField,
  nullableTextField,
  query,
  sortByName,
  sortWarnings,
  splitSqlList,
  tableSelected,
  textField,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
  normalizeDriftSnapshot,
  type IntrospectionDriver,
  type Introspector,
  type IntrospectOptions,
} from '@zmdb/migrations/introspect/runtime';

interface SqliteTable {
  readonly schema: string;
  readonly name: string;
  readonly withoutRowid: boolean;
}

interface SqliteColumn {
  readonly ordinal: number;
  readonly name: string;
  readonly catalogType: string;
  readonly notNull: boolean;
  readonly default: string | null;
  readonly primaryKeyOrdinal: number;
  readonly hidden: number;
}

interface SqliteForeignKeyRow {
  readonly id: number;
  readonly sequence: number;
  readonly targetTable: string;
  readonly column: string;
  readonly targetColumn: string | null;
  readonly onUpdate: string;
  readonly onDelete: string;
}

interface SqliteIndexRow {
  readonly name: string;
  readonly unique: boolean;
  readonly origin: string;
  readonly partial: boolean;
}

interface SqliteIndexColumnRow {
  readonly sequence: number;
  readonly columnId: number;
  readonly name: string | null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function sqliteSchemas(options: IntrospectOptions): readonly string[] {
  const schemas = options.schemas ?? ['main'];
  if (schemas.length === 0) return ['main'];
  return [...new Set(schemas)].toSorted();
}

function parseTable(row: Readonly<Record<string, unknown>>, index: number): SqliteTable {
  const catalog = 'sqlite pragma_table_list';
  const type = textField(row, 'type', catalog, index);
  if (type !== 'table') throw new CatalogRowError(catalog, index, 'type', '"table"', type);
  return {
    schema: textField(row, 'schema', catalog, index),
    name: textField(row, 'name', catalog, index),
    withoutRowid: flagField(row, 'wr', catalog, index),
  };
}

function parseColumn(row: Readonly<Record<string, unknown>>, index: number): SqliteColumn {
  const catalog = 'sqlite pragma_table_xinfo';
  const hidden = integerField(row, 'hidden', catalog, index);
  if (hidden !== 0 && hidden !== 2 && hidden !== 3) {
    throw new CatalogRowError(catalog, index, 'hidden', '0, 2 or 3 for an ordinary table', hidden);
  }
  return {
    ordinal: integerField(row, 'cid', catalog, index),
    name: textField(row, 'name', catalog, index),
    catalogType: textField(row, 'type', catalog, index),
    notNull: flagField(row, 'notnull', catalog, index),
    default: nullableTextField(row, 'dflt_value', catalog, index),
    primaryKeyOrdinal: integerField(row, 'pk', catalog, index),
    hidden,
  };
}

function parseForeignKey(row: Readonly<Record<string, unknown>>, index: number): SqliteForeignKeyRow {
  const catalog = 'sqlite pragma_foreign_key_list';
  return {
    id: integerField(row, 'id', catalog, index),
    sequence: integerField(row, 'seq', catalog, index),
    targetTable: textField(row, 'table', catalog, index),
    column: textField(row, 'from', catalog, index),
    targetColumn: nullableTextField(row, 'to', catalog, index),
    onUpdate: textField(row, 'on_update', catalog, index),
    onDelete: textField(row, 'on_delete', catalog, index),
  };
}

function parseIndex(row: Readonly<Record<string, unknown>>, index: number): SqliteIndexRow {
  const catalog = 'sqlite pragma_index_list';
  const origin = textField(row, 'origin', catalog, index);
  if (origin !== 'c' && origin !== 'u' && origin !== 'pk') {
    throw new CatalogRowError(catalog, index, 'origin', '"c", "u" or "pk"', origin);
  }
  return {
    name: textField(row, 'name', catalog, index),
    unique: flagField(row, 'unique', catalog, index),
    origin,
    partial: flagField(row, 'partial', catalog, index),
  };
}

function parseIndexColumn(row: Readonly<Record<string, unknown>>, index: number): SqliteIndexColumnRow {
  const catalog = 'sqlite pragma_index_info';
  return {
    sequence: integerField(row, 'seqno', catalog, index),
    columnId: integerField(row, 'cid', catalog, index),
    name: nullableTextField(row, 'name', catalog, index),
  };
}

function sqliteType(
  declared: string,
  serial: boolean,
): { readonly type: string; readonly length?: number; readonly warning?: string } {
  const normalized = declared.trim().toUpperCase();
  if (serial) return { type: 'serial' };
  if (normalized === 'INTEGER') return { type: 'integer' };
  if (normalized === 'INT') return { type: 'integer' };
  if (normalized === 'TEXT') return { type: 'text' };

  const varchar = /^VARCHAR\s*\(\s*(\d+)\s*\)$/.exec(normalized);
  if (varchar) {
    const lengthText = varchar[1];
    if (lengthText !== undefined) {
      return {
        type: 'varchar',
        length: Number(lengthText),
        warning: `SQLite does not enforce the declared length ${declared}; the generated declaration will`,
      };
    }
  }
  if (
    normalized === 'REAL' ||
    normalized === 'NUMERIC' ||
    /^DECIMAL(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/.test(normalized)
  ) {
    return { type: 'numeric' };
  }
  if (normalized === 'BLOB' || normalized.length === 0) {
    return {
      type: declared,
      warning:
        normalized.length === 0
          ? 'SQLite column has no declared type; BLOB affinity cannot be represented by the current declared SQL type vocabulary'
          : `SQLite type ${declared} cannot be represented by the current declared SQL type vocabulary`,
    };
  }

  // SQLite's declared type is open text. These are SQLite's own affinity rules,
  // not guesses at application semantics; catalogType preserves the lossy source.
  if (normalized.includes('INT')) {
    return { type: 'integer', warning: `SQLite declared type ${declared} was normalized by INTEGER affinity` };
  }
  if (normalized.includes('CHAR') || normalized.includes('CLOB') || normalized.includes('TEXT')) {
    return { type: 'text', warning: `SQLite declared type ${declared} was normalized by TEXT affinity` };
  }
  if (normalized.includes('BLOB')) {
    return {
      type: declared,
      warning: `SQLite declared type ${declared} has BLOB affinity and cannot be represented by the current declared SQL type vocabulary`,
    };
  }
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) {
    return { type: 'numeric', warning: `SQLite declared type ${declared} was normalized by REAL affinity` };
  }
  return { type: 'numeric', warning: `SQLite declared type ${declared} was normalized by NUMERIC affinity` };
}

function snapshotColumns(
  table: SqliteTable,
  rows: readonly SqliteColumn[],
  primaryKeyIndexed: boolean,
  warnings: CatalogWarning[],
): readonly CatalogColumnSnapshot[] {
  const primaryKey = rows
    .filter(row => row.primaryKeyOrdinal > 0)
    .toSorted((left, right) => left.primaryKeyOrdinal - right.primaryKeyOrdinal);
  const rowidAlias =
    !table.withoutRowid &&
    !primaryKeyIndexed &&
    primaryKey.length === 1 &&
    primaryKey[0]?.catalogType.trim().toUpperCase() === 'INTEGER';

  return rows
    .map(row => {
      const serial = rowidAlias && row.primaryKeyOrdinal === 1;
      const mapped = sqliteType(row.catalogType, serial);
      if (mapped.warning !== undefined) {
        warnings.push({ table: table.name, column: row.name, reason: mapped.warning });
      }
      return {
        name: row.name,
        type: mapped.type,
        catalogType: row.catalogType,
        nullable: !row.notNull && !serial,
        primaryKey: row.primaryKeyOrdinal > 0,
        ...(mapped.length === undefined ? {} : { length: mapped.length }),
        ...(row.default === null ? {} : { default: row.default }),
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function indexSqlSource(schema: string): string | undefined {
  if (schema === 'main') return 'sqlite_schema';
  if (schema === 'temp') return 'sqlite_temp_schema';
  return undefined;
}

function indexParts(sql: string): { readonly columns: readonly string[]; readonly where?: string } {
  const open = sql.indexOf('(');
  if (open === -1) return { columns: [] };
  let depth = 0;
  let quoteCharacter: "'" | '"' | '`' | undefined;
  let close = -1;
  for (let index = open; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoteCharacter !== undefined) {
      if (character === quoteCharacter) {
        if (sql[index + 1] === quoteCharacter) index += 1;
        else quoteCharacter = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quoteCharacter = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return { columns: [] };
  const tail = sql.slice(close + 1).trim();
  const where = /^WHERE\s+(.+)$/is.exec(tail)?.[1]?.trim();
  return {
    columns: splitSqlList(sql.slice(open + 1, close)),
    ...(where === undefined ? {} : { where }),
  };
}

async function readIndexSql(driver: IntrospectionDriver, schema: string, name: string): Promise<string | undefined> {
  const source = indexSqlSource(schema);
  if (source === undefined) return undefined;
  const rows = await driver.execute(query(`SELECT sql FROM ${source} WHERE type = 'index' AND name = ?`, [name]));
  if (rows.length === 0) return undefined;
  if (rows.length !== 1) {
    throw new TypeError(`sqlite catalog returned ${String(rows.length)} definitions for index "${name}"`);
  }
  return nullableTextField(rows[0] ?? {}, 'sql', `sqlite ${source}`, 0) ?? undefined;
}

async function readIndexes(
  driver: IntrospectionDriver,
  table: SqliteTable,
  warnings: CatalogWarning[],
): Promise<{
  readonly indexes: readonly CatalogIndexSnapshot[];
  readonly primaryKeyIndexed: boolean;
}> {
  const rows = await driver.execute(
    query('SELECT seq, name, "unique", origin, partial FROM pragma_index_list(?, ?)', [table.name, table.schema]),
  );
  const indexes: CatalogIndexSnapshot[] = [];
  let primaryKeyIndexed = false;
  for (const [rowIndex, raw] of rows.entries()) {
    const index = parseIndex(raw, rowIndex);
    if (index.origin === 'pk') {
      primaryKeyIndexed = true;
      continue;
    }
    const columnRows = await driver.execute(
      query('SELECT seqno, cid, name FROM pragma_index_info(?, ?) ORDER BY seqno', [index.name, table.schema]),
    );
    const parsedColumns = columnRows.map(parseIndexColumn).toSorted((left, right) => left.sequence - right.sequence);
    const sql = await readIndexSql(driver, table.schema, index.name);
    const parts = sql === undefined ? { columns: [] } : indexParts(sql);
    if (index.partial !== (parts.where !== undefined)) {
      throw new TypeError(
        `sqlite index "${index.name}" reports partial=${String(index.partial)} but its CREATE INDEX text ` +
          `${parts.where === undefined ? 'has no WHERE clause' : 'has a WHERE clause'}`,
      );
    }
    const columns: CatalogIndexColumn[] = parsedColumns.map(column => {
      if (column.name !== null && column.columnId >= 0) return column.name;
      const expression = parts.columns[column.sequence];
      if (expression === undefined) {
        throw new TypeError(
          `sqlite index "${index.name}" contains an expression but its CREATE INDEX text is unavailable`,
        );
      }
      warnings.push({
        table: table.name,
        reason: `SQLite index "${index.name}" expression was parsed from sqlite_schema SQL because PRAGMA index_info reports only cid = -2`,
      });
      return { expr: expression };
    });
    indexes.push({
      name: index.name,
      columns,
      unique: index.unique,
      ...(parts.where === undefined ? {} : { where: parts.where }),
    });
  }
  return { indexes: sortByName(indexes), primaryKeyIndexed };
}

async function readForeignKeys(
  driver: IntrospectionDriver,
  table: SqliteTable,
  primaryKeys: ReadonlyMap<string, readonly string[]>,
): Promise<readonly CatalogForeignKeySnapshot[]> {
  const rows = await driver.execute(
    query(
      'SELECT id, seq, "table", "from", "to", on_update, on_delete ' +
        'FROM pragma_foreign_key_list(?, ?) ORDER BY id, seq',
      [table.name, table.schema],
    ),
  );
  const grouped = new Map<number, SqliteForeignKeyRow[]>();
  for (const [index, row] of rows.entries()) {
    const parsed = parseForeignKey(row, index);
    const values = grouped.get(parsed.id);
    if (values) values.push(parsed);
    else grouped.set(parsed.id, [parsed]);
  }

  const foreignKeys: CatalogForeignKeySnapshot[] = [];
  for (const values of grouped.values()) {
    values.sort((left, right) => left.sequence - right.sequence);
    const first = values[0];
    if (!first) continue;
    const columns = values.map(value => value.column);
    const inferredTarget = primaryKeys.get(first.targetTable) ?? [];
    const targetColumns = values.map((value, index) => value.targetColumn ?? inferredTarget[index]);
    if (targetColumns.some(column => column === undefined)) {
      throw new TypeError(
        `sqlite foreign key on "${table.name}" omits target columns and "${first.targetTable}" has no matching primary key`,
      );
    }
    foreignKeys.push({
      name: deterministicForeignKeyName(table.name, columns),
      columns,
      targetTable: first.targetTable,
      targetColumns: targetColumns.filter(column => column !== undefined),
      onDelete: action(first.onDelete, 'sqlite pragma_foreign_key_list', first.id, 'on_delete'),
      onUpdate: action(first.onUpdate, 'sqlite pragma_foreign_key_list', first.id, 'on_update'),
    });
  }
  return sortByName(foreignKeys);
}

async function sqliteSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
): Promise<CatalogSchemaSnapshot> {
  const schemas = sqliteSchemas(options);
  const rawTables = await driver.execute(
    query(
      `SELECT schema, name, type, wr FROM pragma_table_list ` +
        `WHERE schema IN (${placeholders(schemas.length)}) AND type = 'table' ORDER BY schema, name`,
      schemas,
    ),
  );
  const tables = rawTables
    .map(parseTable)
    .filter(table => !table.name.startsWith('sqlite_') && tableSelected(table.name, options));
  const duplicate = tables.find(
    (table, index) => tables.findIndex(candidate => candidate.name === table.name) !== index,
  );
  if (duplicate !== undefined) {
    throw new TypeError(
      `sqlite introspection cannot represent table "${duplicate.name}" from more than one schema in a schema-neutral snapshot`,
    );
  }

  const warnings: CatalogWarning[] = [];
  const columns = new Map<string, readonly SqliteColumn[]>();
  const primaryKeys = new Map<string, readonly string[]>();
  for (const table of tables) {
    const rawColumns = await driver.execute(
      query('SELECT cid, name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?, ?) ORDER BY cid', [
        table.name,
        table.schema,
      ]),
    );
    const parsed = rawColumns.map(parseColumn).toSorted((left, right) => left.ordinal - right.ordinal);
    for (const column of parsed) {
      if (column.hidden === 0) continue;
      warnings.push({
        table: table.name,
        column: column.name,
        reason:
          `SQLite ${column.hidden === 3 ? 'stored' : 'virtual'} generated column is omitted because ` +
          'the portable schema snapshot does not carry generated expressions',
      });
    }
    const ordinary = parsed.filter(column => column.hidden === 0);
    columns.set(`${table.schema}\0${table.name}`, ordinary);
    primaryKeys.set(
      table.name,
      ordinary
        .filter(column => column.primaryKeyOrdinal > 0)
        .toSorted((left, right) => left.primaryKeyOrdinal - right.primaryKeyOrdinal)
        .map(column => column.name),
    );
  }

  const snapshots: CatalogTableSnapshot[] = [];
  const foreignKeyMode = await driver.execute(query('PRAGMA foreign_keys'));
  const mode = foreignKeyMode[0];
  if (mode === undefined) throw new TypeError('sqlite PRAGMA foreign_keys returned no row');
  if (!flagField(mode, 'foreign_keys', 'sqlite PRAGMA foreign_keys', 0)) {
    warnings.push({
      table: '*',
      reason: 'SQLite foreign key enforcement is disabled on this connection (PRAGMA foreign_keys = 0)',
    });
  }
  for (const table of tables) {
    const tableColumns = columns.get(`${table.schema}\0${table.name}`) ?? [];
    const indexResult = await readIndexes(driver, table, warnings);
    snapshots.push({
      name: table.name,
      columns: snapshotColumns(table, tableColumns, indexResult.primaryKeyIndexed, warnings),
      primaryKey: primaryKeys.get(table.name) ?? [],
      foreignKeys: await readForeignKeys(driver, table, primaryKeys),
      indexes: indexResult.indexes,
    });
  }
  return {
    version: 1,
    tables: sortByName(snapshots),
    extensions: [],
    warnings: sortWarnings(warnings),
  };
}

const databaseName = 'sqlite' as const;

const NORMALIZED_DECLARED_TYPES = Object.freeze({
  serial: 'serial',
  integer: 'integer',
  bigint: 'integer',
  numeric: 'numeric',
  text: 'text',
  varchar: 'text',
  boolean: 'integer',
  timestamp: 'text',
  json: 'text',
  jsonEnum: 'text',
} as const);

function normalizeDeclaredColumn(column: ColumnSnapshot): ColumnSnapshot {
  if (typeof column.type !== 'string') return column;
  const mapped: unknown = Reflect.get(NORMALIZED_DECLARED_TYPES, column.type);
  if (typeof mapped !== 'string') return column;
  if (column.type !== 'varchar') return { ...column, type: mapped };
  const { length: _length, ...withoutLength } = column;
  return { ...withoutLength, type: mapped };
}

function normalizeSqliteDriftSnapshot(snapshot: SchemaSnapshot, role: 'live' | 'declared'): SchemaSnapshot {
  const normalized = normalizeDriftSnapshot(snapshot, role);
  return {
    ...normalized,
    tables: normalized.tables.map(table => ({
      ...table,
      columns: role === 'declared' ? table.columns.map(normalizeDeclaredColumn) : table.columns,
      indexes: table.indexes ?? [],
    })),
  };
}

export const sqliteIntrospector: Introspector<typeof databaseName> = {
  name: databaseName,
  dialect: databaseName,
  snapshot: sqliteSnapshot,
  normalizeForDrift: normalizeSqliteDriftSnapshot,
};
