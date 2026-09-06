import type { SchemaSnapshot } from '@zmdb/migrations';
import {
  CatalogRowError,
  normalizeDriftSnapshot,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
  type ReferentialAction,
} from '@zmdb/migrations/introspect/runtime';
import type { CompiledQuery, IntrospectionDriver, Introspector, IntrospectOptions } from '@zmdb/query-compiler';

export interface MssqlIdentity {
  readonly seed: string;
  readonly increment: string;
}

export interface MssqlComputedColumn {
  readonly expression: string;
  readonly persisted: boolean;
}

export interface MssqlCatalogColumnSnapshot extends CatalogColumnSnapshot {
  readonly identity?: MssqlIdentity;
  readonly computed?: MssqlComputedColumn;
}

export interface MssqlCatalogForeignKeySnapshot extends CatalogForeignKeySnapshot {
  readonly disabled: boolean;
  readonly trusted: boolean;
}

export interface MssqlCatalogIndexSnapshot extends CatalogIndexSnapshot {
  readonly clustered: boolean;
  readonly includedColumns: readonly string[];
  readonly disabled: boolean;
}

export interface MssqlCatalogTableSnapshot extends Omit<CatalogTableSnapshot, 'columns' | 'foreignKeys' | 'indexes'> {
  readonly columns: readonly MssqlCatalogColumnSnapshot[];
  readonly foreignKeys: readonly MssqlCatalogForeignKeySnapshot[];
  readonly indexes: readonly MssqlCatalogIndexSnapshot[];
}

export interface MssqlCatalogSequenceSnapshot {
  readonly name: string;
  readonly schema?: string;
  readonly catalogType: string;
  readonly start: string;
  readonly increment: string;
}

export interface MssqlCatalogSchemaSnapshot extends Omit<CatalogSchemaSnapshot, 'tables'> {
  readonly tables: readonly MssqlCatalogTableSnapshot[];
  readonly sequences: readonly MssqlCatalogSequenceSnapshot[];
}

export interface MssqlIntrospector extends Introspector<'mssql'> {
  readonly dialect: 'mssql';
  snapshot(driver: IntrospectionDriver, options?: IntrospectOptions): Promise<MssqlCatalogSchemaSnapshot>;
}

interface MssqlTable {
  readonly schema: string;
  readonly name: string;
}

interface MssqlColumn {
  readonly schema: string;
  readonly table: string;
  readonly ordinal: number;
  readonly name: string;
  readonly nullable: boolean;
  readonly dataType: string;
  readonly maxLength: number;
  readonly precision: number;
  readonly scale: number;
  readonly default: string | null;
  readonly identity: boolean;
  readonly seed: string | null;
  readonly increment: string | null;
  readonly computed: boolean;
  readonly computedDefinition: string | null;
  readonly persisted: boolean;
}

interface MssqlPrimaryKey {
  readonly schema: string;
  readonly table: string;
  readonly ordinal: number;
  readonly column: string;
}

interface MssqlForeignKey {
  readonly schema: string;
  readonly table: string;
  readonly constraint: string;
  readonly ordinal: number;
  readonly column: string;
  readonly targetSchema: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly disabled: boolean;
  readonly trusted: boolean;
}

interface MssqlIndexRow {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly primary: boolean;
  readonly type: string;
  readonly filtered: boolean;
  readonly predicate: string | null;
  readonly ordinal: number;
  readonly included: boolean;
  readonly column: string;
  readonly disabled: boolean;
}

interface MssqlSequence {
  readonly schema: string;
  readonly name: string;
  readonly dataType: string;
  readonly precision: number;
  readonly scale: number;
  readonly start: string;
  readonly increment: string;
}

function valueAt(row: Readonly<Record<string, unknown>>, field: string): unknown {
  return Reflect.get(row, field);
}

function invalid(catalog: string, row: number, field: string, expected: string, value: unknown): never {
  throw new CatalogRowError(catalog, row, field, expected, value);
}

function textField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): string {
  const value = valueAt(row, field);
  return typeof value === 'string' ? value : invalid(catalog, index, field, 'a string', value);
}

function nullableTextField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): string | null {
  const value = valueAt(row, field);
  if (value === null) return null;
  return typeof value === 'string' ? value : invalid(catalog, index, field, 'a string or null', value);
}

function integerField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): number {
  const value = valueAt(row, field);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return invalid(catalog, index, field, 'a safe integer or decimal integer string', value);
}

function booleanField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): boolean {
  const value = valueAt(row, field);
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0') return false;
  if (value === 1 || value === '1') return true;
  return invalid(catalog, index, field, 'a boolean or 0/1 flag', value);
}

function scalarText(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): string {
  const value = valueAt(row, field);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);
  return invalid(catalog, index, field, 'a string or numeric scalar', value);
}

function nullableScalarText(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): string | null {
  return valueAt(row, field) === null ? null : scalarText(row, field, catalog, index);
}

function query(text: string, parameters: readonly unknown[] = []): CompiledQuery {
  return { text, parameters };
}

function globExpression(glob: string): RegExp {
  let source = '^';
  for (const character of glob) {
    if (character === '*') source += '.*';
    else if (character === '?') source += '.';
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function selected(name: string, options: IntrospectOptions): boolean {
  const include = options.include;
  if (include !== undefined && include.length > 0 && !include.some(glob => globExpression(glob).test(name))) {
    return false;
  }
  const exclude = options.exclude ?? ['_zmdb_migrations'];
  return !exclude.some(glob => globExpression(glob).test(name));
}

function schemas(options: IntrospectOptions): readonly string[] {
  const configured = options.schemas ?? ['dbo'];
  return [...new Set(configured.length === 0 ? ['dbo'] : configured)].toSorted();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `@p${String(index + 1)}`).join(', ');
}

function action(value: string, catalog: string, row: number, field: string): ReferentialAction {
  switch (value.toUpperCase()) {
    case 'NO_ACTION':
      return 'no action';
    case 'CASCADE':
      return 'cascade';
    case 'SET_NULL':
      return 'set null';
    case 'SET_DEFAULT':
      return 'set default';
    default:
      return invalid(catalog, row, field, 'a SQL Server referential action', value);
  }
}

function parseTable(row: Readonly<Record<string, unknown>>, index: number): MssqlTable {
  const catalog = 'mssql sys.tables';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    name: textField(row, 'table_name', catalog, index),
  };
}

function parseColumn(row: Readonly<Record<string, unknown>>, index: number): MssqlColumn {
  const catalog = 'mssql sys.columns';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    table: textField(row, 'table_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    name: textField(row, 'column_name', catalog, index),
    nullable: booleanField(row, 'is_nullable', catalog, index),
    dataType: textField(row, 'data_type', catalog, index),
    maxLength: integerField(row, 'max_length', catalog, index),
    precision: integerField(row, 'numeric_precision', catalog, index),
    scale: integerField(row, 'numeric_scale', catalog, index),
    default: nullableTextField(row, 'column_default', catalog, index),
    identity: booleanField(row, 'is_identity', catalog, index),
    seed: nullableScalarText(row, 'seed_value', catalog, index),
    increment: nullableScalarText(row, 'increment_value', catalog, index),
    computed: booleanField(row, 'is_computed', catalog, index),
    computedDefinition: nullableTextField(row, 'computed_definition', catalog, index),
    persisted: booleanField(row, 'is_persisted', catalog, index),
  };
}

function parsePrimaryKey(row: Readonly<Record<string, unknown>>, index: number): MssqlPrimaryKey {
  const catalog = 'mssql sys.key_constraints';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    table: textField(row, 'table_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    column: textField(row, 'column_name', catalog, index),
  };
}

function parseForeignKey(row: Readonly<Record<string, unknown>>, index: number): MssqlForeignKey {
  const catalog = 'mssql sys.foreign_keys';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    table: textField(row, 'table_name', catalog, index),
    constraint: textField(row, 'constraint_name', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    column: textField(row, 'column_name', catalog, index),
    targetSchema: textField(row, 'target_schema', catalog, index),
    targetTable: textField(row, 'target_table', catalog, index),
    targetColumn: textField(row, 'target_column', catalog, index),
    onUpdate: textField(row, 'update_action', catalog, index),
    onDelete: textField(row, 'delete_action', catalog, index),
    disabled: booleanField(row, 'is_disabled', catalog, index),
    trusted: !booleanField(row, 'is_not_trusted', catalog, index),
  };
}

function parseIndex(row: Readonly<Record<string, unknown>>, index: number): MssqlIndexRow {
  const catalog = 'mssql sys.indexes';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    table: textField(row, 'table_name', catalog, index),
    name: textField(row, 'index_name', catalog, index),
    unique: booleanField(row, 'is_unique', catalog, index),
    primary: booleanField(row, 'is_primary_key', catalog, index),
    type: textField(row, 'index_type', catalog, index),
    filtered: booleanField(row, 'has_filter', catalog, index),
    predicate: nullableTextField(row, 'filter_definition', catalog, index),
    ordinal: integerField(row, 'ordinal_position', catalog, index),
    included: booleanField(row, 'is_included_column', catalog, index),
    column: textField(row, 'column_name', catalog, index),
    disabled: booleanField(row, 'is_disabled', catalog, index),
  };
}

function parseSequence(row: Readonly<Record<string, unknown>>, index: number): MssqlSequence {
  const catalog = 'mssql sys.sequences';
  return {
    schema: textField(row, 'schema_name', catalog, index),
    name: textField(row, 'sequence_name', catalog, index),
    dataType: textField(row, 'data_type', catalog, index),
    precision: integerField(row, 'numeric_precision', catalog, index),
    scale: integerField(row, 'numeric_scale', catalog, index),
    start: scalarText(row, 'start_value', catalog, index),
    increment: scalarText(row, 'increment_value', catalog, index),
  };
}

function tableKey(schema: string, table: string): string {
  return `${schema}\0${table}`;
}

function catalogType(column: MssqlColumn): string {
  const type = column.dataType.toUpperCase();
  if (type === 'NVARCHAR' || type === 'NCHAR') {
    return column.maxLength === -1 ? `${type}(MAX)` : `${type}(${String(column.maxLength / 2)})`;
  }
  if (type === 'VARCHAR' || type === 'CHAR' || type === 'VARBINARY' || type === 'BINARY') {
    return column.maxLength === -1 ? `${type}(MAX)` : `${type}(${String(column.maxLength)})`;
  }
  if (type === 'DECIMAL' || type === 'NUMERIC') {
    return `${type}(${String(column.precision)},${String(column.scale)})`;
  }
  if (type === 'DATETIME2' || type === 'DATETIMEOFFSET' || type === 'TIME') {
    return `${type}(${String(column.scale)})`;
  }
  return type;
}

function mappedType(column: MssqlColumn): {
  readonly type: string;
  readonly length?: number;
  readonly warnings: readonly string[];
} {
  const type = column.dataType.toLowerCase();
  const source = catalogType(column);
  const warnings: string[] = [];

  if (column.identity) {
    if (column.seed === null || column.increment === null) {
      throw new TypeError(`mssql identity column "${column.table}"."${column.name}" has no seed or increment`);
    }
    if (type === 'int' && column.seed === '1' && column.increment === '1') {
      return { type: 'serial', warnings };
    }
    return {
      type: `${source} IDENTITY(${column.seed},${column.increment})`,
      warnings,
    };
  }

  if (type === 'int') return { type: 'integer', warnings };
  if (type === 'bigint') return { type: 'bigint', warnings };
  if (type === 'smallint' || type === 'tinyint') {
    warnings.push(`SQL Server type ${source} was widened to integer`);
    return { type: 'integer', warnings };
  }
  if (type === 'decimal' || type === 'numeric') return { type: source, warnings };
  if (type === 'float' || type === 'real' || type === 'money' || type === 'smallmoney') {
    return { type: source, warnings };
  }
  if (type === 'nvarchar') {
    return column.maxLength === -1
      ? { type: 'text', warnings }
      : { type: 'varchar', length: column.maxLength / 2, warnings };
  }
  if (type === 'varchar') {
    warnings.push(`SQL Server ${source} uses a database code page; forward zmdb DDL emits Unicode NVARCHAR`);
    return column.maxLength === -1
      ? { type: 'text', warnings }
      : { type: 'varchar', length: column.maxLength, warnings };
  }
  if (type === 'nchar' || type === 'char') {
    warnings.push(`SQL Server fixed-width type ${source} was normalized to varchar`);
    const length = type === 'nchar' ? column.maxLength / 2 : column.maxLength;
    return { type: 'varchar', length, warnings };
  }
  if (type === 'ntext' || type === 'text') {
    if (type === 'text') {
      warnings.push('SQL Server TEXT uses a database code page; forward zmdb DDL emits Unicode NVARCHAR(MAX)');
    }
    return { type: 'text', warnings };
  }
  if (type === 'bit') return { type: 'boolean', warnings };
  if (type === 'datetimeoffset') {
    if (column.scale !== 3) {
      warnings.push(`SQL Server ${source} was normalized to timestamp; forward zmdb DDL emits DATETIMEOFFSET(3)`);
    }
    return { type: 'timestamp', warnings };
  }
  if (type === 'datetime2' || type === 'datetime' || type === 'smalldatetime') {
    warnings.push(
      `SQL Server ${source} has no offset; it was preserved as a custom SQL type instead of being called timestamp`,
    );
    return { type: source, warnings };
  }
  if (type === 'uniqueidentifier') return { type: 'UNIQUEIDENTIFIER', warnings };
  if (type === 'xml') return { type: 'XML', warnings };
  if (type === 'varbinary' || type === 'binary' || type === 'image' || type === 'date' || type === 'time') {
    return { type: source, warnings };
  }

  warnings.push(`SQL Server type ${source} cannot be represented by the current declared SQL type vocabulary`);
  return { type: source, warnings };
}

function primaryKeys(rows: readonly MssqlPrimaryKey[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, MssqlPrimaryKey[]>();
  for (const row of rows) {
    const key = tableKey(row.schema, row.table);
    const values = grouped.get(key);
    if (values) values.push(row);
    else grouped.set(key, [row]);
  }
  return new Map(
    [...grouped].map(([key, values]) => [
      key,
      values.toSorted((left, right) => left.ordinal - right.ordinal).map(value => value.column),
    ]),
  );
}

function foreignKeys(
  rows: readonly MssqlForeignKey[],
  warnings: CatalogWarning[],
): ReadonlyMap<string, readonly MssqlCatalogForeignKeySnapshot[]> {
  const grouped = new Map<string, MssqlForeignKey[]>();
  for (const row of rows) {
    const key = `${tableKey(row.schema, row.table)}\0${row.constraint}`;
    const values = grouped.get(key);
    if (values) values.push(row);
    else grouped.set(key, [row]);
  }

  const byTable = new Map<string, MssqlCatalogForeignKeySnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.ordinal - right.ordinal);
    const first = values[0];
    if (first === undefined) continue;
    if (
      values.some(
        value =>
          value.targetSchema !== first.targetSchema ||
          value.targetTable !== first.targetTable ||
          value.disabled !== first.disabled ||
          value.trusted !== first.trusted,
      )
    ) {
      throw new TypeError(`mssql foreign key "${first.constraint}" has inconsistent catalog rows`);
    }
    if (first.targetSchema !== first.schema) {
      warnings.push({
        table: first.table,
        reason:
          `SQL Server foreign key "${first.constraint}" targets schema "${first.targetSchema}"; ` +
          'the schema-neutral drift model preserves the target table name but not its schema',
      });
    }
    if (first.disabled) {
      warnings.push({
        table: first.table,
        reason: `SQL Server foreign key "${first.constraint}" is disabled`,
      });
    }
    if (!first.trusted) {
      warnings.push({
        table: first.table,
        reason: `SQL Server foreign key "${first.constraint}" is not trusted`,
      });
    }
    const snapshot: MssqlCatalogForeignKeySnapshot = {
      name: first.constraint,
      columns: values.map(value => value.column),
      targetTable: first.targetTable,
      targetColumns: values.map(value => value.targetColumn),
      onDelete: action(first.onDelete, 'mssql sys.foreign_keys', 0, 'delete_action'),
      onUpdate: action(first.onUpdate, 'mssql sys.foreign_keys', 0, 'update_action'),
      disabled: first.disabled,
      trusted: first.trusted,
    };
    const key = tableKey(first.schema, first.table);
    const tableValues = byTable.get(key);
    if (tableValues) tableValues.push(snapshot);
    else byTable.set(key, [snapshot]);
  }
  return new Map(
    [...byTable].map(([key, values]) => [key, values.toSorted((left, right) => left.name.localeCompare(right.name))]),
  );
}

function indexes(
  rows: readonly MssqlIndexRow[],
  warnings: CatalogWarning[],
): ReadonlyMap<string, readonly MssqlCatalogIndexSnapshot[]> {
  const grouped = new Map<string, MssqlIndexRow[]>();
  for (const row of rows) {
    if (row.primary) continue;
    const key = `${tableKey(row.schema, row.table)}\0${row.name}`;
    const values = grouped.get(key);
    if (values) values.push(row);
    else grouped.set(key, [row]);
  }

  const byTable = new Map<string, MssqlCatalogIndexSnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.ordinal - right.ordinal);
    const first = values[0];
    if (first === undefined) continue;
    if (
      values.some(
        value =>
          value.unique !== first.unique ||
          value.type !== first.type ||
          value.filtered !== first.filtered ||
          value.predicate !== first.predicate ||
          value.disabled !== first.disabled,
      )
    ) {
      throw new TypeError(`mssql index "${first.name}" has inconsistent catalog rows`);
    }
    if (first.filtered !== (first.predicate !== null)) {
      throw new TypeError(
        `mssql index "${first.name}" reports has_filter=${String(first.filtered)} with ` +
          `${first.predicate === null ? 'no' : 'a'} filter definition`,
      );
    }
    const type = first.type.toUpperCase();
    const clustered = type === 'CLUSTERED';
    if (type !== 'CLUSTERED' && type !== 'NONCLUSTERED') {
      warnings.push({
        table: first.table,
        reason: `SQL Server index "${first.name}" uses ${first.type}, which the current DDL vocabulary cannot recreate`,
      });
    } else if (clustered) {
      warnings.push({
        table: first.table,
        reason: `SQL Server index "${first.name}" is clustered; clustering is preserved as catalog evidence but not emitted by the current DDL vocabulary`,
      });
    }
    const includedColumns = values.filter(value => value.included).map(value => value.column);
    if (includedColumns.length > 0) {
      warnings.push({
        table: first.table,
        reason:
          `SQL Server index "${first.name}" includes ${includedColumns.join(', ')}; ` +
          'included columns are preserved as catalog evidence but not emitted by the current DDL vocabulary',
      });
    }
    if (first.disabled) {
      warnings.push({ table: first.table, reason: `SQL Server index "${first.name}" is disabled` });
    }
    const columns: CatalogIndexColumn[] = values.filter(value => !value.included).map(value => value.column);
    const snapshot: MssqlCatalogIndexSnapshot = {
      name: first.name,
      columns,
      unique: first.unique,
      ...(type === 'NONCLUSTERED' ? {} : { method: first.type.toLowerCase() }),
      ...(first.predicate === null ? {} : { where: first.predicate }),
      clustered,
      includedColumns,
      disabled: first.disabled,
    };
    const key = tableKey(first.schema, first.table);
    const tableValues = byTable.get(key);
    if (tableValues) tableValues.push(snapshot);
    else byTable.set(key, [snapshot]);
  }
  return new Map(
    [...byTable].map(([key, values]) => [key, values.toSorted((left, right) => left.name.localeCompare(right.name))]),
  );
}

function sequenceType(sequence: MssqlSequence): string {
  const type = sequence.dataType.toUpperCase();
  return type === 'DECIMAL' || type === 'NUMERIC'
    ? `${type}(${String(sequence.precision)},${String(sequence.scale)})`
    : type;
}

async function mssqlSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
): Promise<MssqlCatalogSchemaSnapshot> {
  const selectedSchemas = schemas(options);
  const slots = placeholders(selectedSchemas.length);
  const [tableRows, columnRows, primaryKeyRows, foreignKeyRows, indexRows, sequenceRows] = await Promise.all([
    driver.execute(
      query(
        `SELECT s.name AS schema_name, t.name AS table_name ` +
          `FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id ` +
          `WHERE t.is_ms_shipped = 0 AND s.name IN (${slots}) ORDER BY s.name, t.name`,
        selectedSchemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT s.name AS schema_name, t.name AS table_name, c.column_id AS ordinal_position, ` +
          `c.name AS column_name, c.is_nullable, ty.name AS data_type, c.max_length, ` +
          `c.precision AS numeric_precision, c.scale AS numeric_scale, dc.definition AS column_default, ` +
          `c.is_identity, ic.seed_value, ic.increment_value, c.is_computed, ` +
          `cc.definition AS computed_definition, COALESCE(cc.is_persisted, 0) AS is_persisted ` +
          `FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id ` +
          `JOIN sys.columns c ON c.object_id = t.object_id ` +
          `JOIN sys.types ty ON ty.user_type_id = c.user_type_id ` +
          `LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id ` +
          `LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id ` +
          `LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id ` +
          `WHERE t.is_ms_shipped = 0 AND s.name IN (${slots}) ` +
          `ORDER BY s.name, t.name, c.column_id`,
        selectedSchemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT s.name AS schema_name, t.name AS table_name, ic.key_ordinal AS ordinal_position, ` +
          `c.name AS column_name FROM sys.key_constraints kc ` +
          `JOIN sys.tables t ON t.object_id = kc.parent_object_id ` +
          `JOIN sys.schemas s ON s.schema_id = t.schema_id ` +
          `JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id ` +
          `JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id ` +
          `WHERE kc.type = 'PK' AND s.name IN (${slots}) ORDER BY s.name, t.name, ic.key_ordinal`,
        selectedSchemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT s.name AS schema_name, t.name AS table_name, fk.name AS constraint_name, ` +
          `fkc.constraint_column_id AS ordinal_position, pc.name AS column_name, ` +
          `rs.name AS target_schema, rt.name AS target_table, rc.name AS target_column, ` +
          `fk.update_referential_action_desc AS update_action, ` +
          `fk.delete_referential_action_desc AS delete_action, fk.is_disabled, fk.is_not_trusted ` +
          `FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id ` +
          `JOIN sys.tables t ON t.object_id = fk.parent_object_id ` +
          `JOIN sys.schemas s ON s.schema_id = t.schema_id ` +
          `JOIN sys.columns pc ON pc.object_id = t.object_id AND pc.column_id = fkc.parent_column_id ` +
          `JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id ` +
          `JOIN sys.schemas rs ON rs.schema_id = rt.schema_id ` +
          `JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id ` +
          `WHERE s.name IN (${slots}) ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id`,
        selectedSchemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name, i.is_unique, ` +
          `i.is_primary_key, i.type_desc AS index_type, i.has_filter, i.filter_definition, ` +
          `CASE WHEN ic.is_included_column = 1 THEN ic.index_column_id ELSE ic.key_ordinal END AS ordinal_position, ` +
          `ic.is_included_column, c.name AS column_name, i.is_disabled ` +
          `FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id ` +
          `JOIN sys.schemas s ON s.schema_id = t.schema_id ` +
          `JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id ` +
          `JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id ` +
          `WHERE i.name IS NOT NULL AND i.is_hypothetical = 0 AND s.name IN (${slots}) ` +
          `ORDER BY s.name, t.name, i.name, ic.is_included_column, ordinal_position`,
        selectedSchemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT s.name AS schema_name, seq.name AS sequence_name, ty.name AS data_type, ` +
          `seq.precision AS numeric_precision, seq.scale AS numeric_scale, seq.start_value, seq.increment AS increment_value ` +
          `FROM sys.sequences seq JOIN sys.schemas s ON s.schema_id = seq.schema_id ` +
          `JOIN sys.types ty ON ty.user_type_id = seq.user_type_id ` +
          `WHERE s.name IN (${slots}) ORDER BY s.name, seq.name`,
        selectedSchemas,
      ),
    ),
  ]);

  const tables = tableRows.map(parseTable).filter(table => selected(table.name, options));
  const duplicate = tables.find(
    (table, index) => tables.findIndex(candidate => candidate.name === table.name) !== index,
  );
  if (duplicate !== undefined) {
    throw new TypeError(
      `mssql introspection cannot represent table "${duplicate.name}" from more than one schema in a schema-neutral snapshot`,
    );
  }

  const parsedColumns = columnRows.map(parseColumn);
  const parsedPrimaryKeys = primaryKeyRows.map(parsePrimaryKey);
  const parsedForeignKeys = foreignKeyRows.map(parseForeignKey);
  const parsedIndexes = indexRows.map(parseIndex);
  const parsedSequences = sequenceRows.map(parseSequence);
  const primaryKeyByTable = primaryKeys(parsedPrimaryKeys);
  const warnings: CatalogWarning[] = [];
  const foreignKeyByTable = foreignKeys(parsedForeignKeys, warnings);
  const indexByTable = indexes(parsedIndexes, warnings);
  const snapshots: MssqlCatalogTableSnapshot[] = [];

  for (const table of tables) {
    const key = tableKey(table.schema, table.name);
    const primaryKey = primaryKeyByTable.get(key) ?? [];
    const columns: MssqlCatalogColumnSnapshot[] = parsedColumns
      .filter(column => column.schema === table.schema && column.table === table.name)
      .map(column => {
        const mapped = mappedType(column);
        for (const reason of mapped.warnings) warnings.push({ table: table.name, column: column.name, reason });
        if (column.computed && column.computedDefinition === null) {
          throw new TypeError(`mssql computed column "${table.name}"."${column.name}" has no definition`);
        }
        return {
          name: column.name,
          type: mapped.type,
          catalogType: catalogType(column),
          nullable: column.nullable,
          primaryKey: primaryKey.includes(column.name),
          ...(mapped.length === undefined ? {} : { length: mapped.length }),
          ...(column.default === null ? {} : { default: column.default }),
          ...(column.identity
            ? {
                identity: {
                  seed: column.seed ?? '',
                  increment: column.increment ?? '',
                },
              }
            : {}),
          ...(column.computed && column.computedDefinition !== null
            ? {
                computed: {
                  expression: column.computedDefinition,
                  persisted: column.persisted,
                },
              }
            : {}),
        };
      })
      .toSorted((left, right) => left.name.localeCompare(right.name));

    snapshots.push({
      name: table.name,
      columns,
      primaryKey,
      foreignKeys: foreignKeyByTable.get(key) ?? [],
      indexes: indexByTable.get(key) ?? [],
    });
  }

  const sequences: MssqlCatalogSequenceSnapshot[] = parsedSequences
    .filter(sequence => selected(sequence.name, options))
    .map(sequence => ({
      name: sequence.name,
      ...(sequence.schema === 'dbo' ? {} : { schema: sequence.schema }),
      catalogType: sequenceType(sequence),
      start: sequence.start,
      increment: sequence.increment,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return {
    version: 1,
    tables: snapshots.toSorted((left, right) => left.name.localeCompare(right.name)),
    extensions: [],
    warnings: warnings.toSorted(
      (left, right) =>
        left.table.localeCompare(right.table) ||
        (left.column ?? '').localeCompare(right.column ?? '') ||
        left.reason.localeCompare(right.reason),
    ),
    sequences,
  };
}

export const mssqlIntrospector: MssqlIntrospector = Object.freeze({
  name: 'mssql',
  dialect: 'mssql',
  snapshot: mssqlSnapshot,
  normalizeForDrift: (snapshot: SchemaSnapshot, role: 'live' | 'declared') => normalizeDriftSnapshot(snapshot, role),
});
