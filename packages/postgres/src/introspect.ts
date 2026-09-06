import type { CompiledQuery, IntrospectionDriver, Introspector, IntrospectOptions } from '@zmdb/query-compiler';
import type {
  CatalogColumnSnapshot,
  CatalogForeignKeySnapshot,
  CatalogIndexColumn,
  CatalogIndexSnapshot,
  CatalogSchemaSnapshot,
  CatalogTableSnapshot,
  CatalogWarning,
  ReferentialAction,
} from '@zmdb/query-compiler/introspect/runtime';
import type { ExtensionType, SchemaSnapshot } from '@zmdb/query-compiler/migrations';

export interface PostgresCatalogOverrides {
  readonly snapshot?: (
    parent: (driver: IntrospectionDriver, options?: IntrospectOptions) => Promise<CatalogSchemaSnapshot>,
    driver: IntrospectionDriver,
    options?: IntrospectOptions,
  ) => Promise<CatalogSchemaSnapshot>;
  readonly normalizeForDrift?: (
    parent: (snapshot: CatalogSchemaSnapshot, role: 'live' | 'declared') => SchemaSnapshot,
    snapshot: CatalogSchemaSnapshot,
    role: 'live' | 'declared',
  ) => SchemaSnapshot;
}

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
  readonly generated: string;
  readonly generationExpression: string | null;
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

type PostgresColumnSnapshot = CatalogColumnSnapshot & {
  readonly generated?: {
    readonly expression: string;
    readonly stored: boolean;
  };
};

class CatalogRowError extends TypeError {
  constructor(catalog: string, row: number, field: string, expected: string, value: unknown) {
    const received = value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
    super(`${catalog} row ${String(row)} field "${field}" must be ${expected}; received ${received}`);
    this.name = 'CatalogRowError';
  }
}

function valueAt(row: Readonly<Record<string, unknown>>, field: string): unknown {
  return Reflect.get(row, field);
}

function textField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): string {
  const value = valueAt(row, field);
  if (typeof value !== 'string') throw new CatalogRowError(catalog, index, field, 'a string', value);
  return value;
}

function nullableTextField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): string | null {
  const value = valueAt(row, field);
  if (value === null) return null;
  if (typeof value !== 'string') throw new CatalogRowError(catalog, index, field, 'a string or null', value);
  return value;
}

function integerField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): number {
  const value = valueAt(row, field);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new CatalogRowError(catalog, index, field, 'a safe integer or decimal integer string', value);
}

function nullableIntegerField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): number | null {
  return valueAt(row, field) === null ? null : integerField(row, field, catalog, index);
}

function booleanField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): boolean {
  const value = valueAt(row, field);
  if (typeof value !== 'boolean') throw new CatalogRowError(catalog, index, field, 'a boolean', value);
  return value;
}

function query(text: string, parameters: readonly unknown[] = []): CompiledQuery {
  return { text, parameters };
}

function postgresSchemas(options: IntrospectOptions): readonly string[] {
  const schemas = options.schemas ?? ['public'];
  return schemas.length === 0 ? ['public'] : [...new Set(schemas)].toSorted();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `$${String(index + 1)}`).join(', ');
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

function tableSelected(name: string, options: IntrospectOptions): boolean {
  const include = options.include;
  if (include !== undefined && include.length > 0 && !include.some(glob => globExpression(glob).test(name))) {
    return false;
  }
  const exclude = options.exclude ?? ['_zmdb_migrations'];
  return !exclude.some(glob => globExpression(glob).test(name));
}

function action(value: string, catalog: string, row: number, field: string): ReferentialAction {
  const normalized = value.toLowerCase().replaceAll('_', ' ');
  switch (normalized) {
    case 'no action':
    case 'restrict':
    case 'cascade':
    case 'set null':
    case 'set default':
      return normalized;
    default:
      throw new CatalogRowError(catalog, row, field, 'a referential action', value);
  }
}

function sortByName<Value extends { readonly name: string }>(values: readonly Value[]): readonly Value[] {
  return values.toSorted((left, right) => left.name.localeCompare(right.name));
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
  const generated = textField(row, 'is_generated', catalog, index);
  if (generated !== 'NEVER' && generated !== 'ALWAYS') {
    throw new CatalogRowError(catalog, index, 'is_generated', '"NEVER" or "ALWAYS"', generated);
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
    generated,
    generationExpression: nullableTextField(row, 'generation_expression', catalog, index),
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
  if (column.dataType === 'ARRAY')
    return column.udtName.startsWith('_') ? `${column.udtName.slice(1)}[]` : column.dataType;
  return column.dataType;
}

function postgresType(column: PostgresColumn): {
  readonly type: string | ExtensionType;
  readonly length?: number;
  readonly warning?: string;
} {
  const source = (column.typeKind === 'd' ? column.domainBaseType : null) ?? column.dataType;
  const normalized = source.toLowerCase();
  if (
    column.identity === 'a' ||
    column.identity === 'd' ||
    (column.default?.toLowerCase().startsWith('nextval(') ?? false)
  ) {
    return column.identity === ''
      ? { type: 'serial' }
      : {
          type: 'serial',
          warning:
            'Postgres identity was normalized to serial; forward DDL uses a sequence default rather than an identity attribute',
        };
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
    warning: `Postgres type ${catalogType(column)} cannot be represented by the declared SQL type vocabulary`,
  };
}

function primaryKeys(rows: readonly PostgresPrimaryKey[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, PostgresPrimaryKey[]>();
  for (const row of rows) {
    const values = grouped.get(row.table);
    if (values === undefined) grouped.set(row.table, [row]);
    else values.push(row);
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
    if (values === undefined) grouped.set(id, [row]);
    else values.push(row);
  }
  const byTable = new Map<string, CatalogForeignKeySnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.ordinal - right.ordinal);
    const first = values[0];
    if (first === undefined) continue;
    const snapshot: CatalogForeignKeySnapshot = {
      name: first.constraint,
      columns: values.map(value => value.column),
      targetTable: first.targetTable,
      targetColumns: values.map(value => value.targetColumn),
      onDelete: action(first.onDelete, 'postgres information_schema foreign keys', 0, 'delete_rule'),
      onUpdate: action(first.onUpdate, 'postgres information_schema foreign keys', 0, 'update_rule'),
    };
    const tableValues = byTable.get(first.table);
    if (tableValues === undefined) byTable.set(first.table, [snapshot]);
    else tableValues.push(snapshot);
  }
  return new Map([...byTable].map(([table, values]) => [table, sortByName(values)]));
}

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
}

function indexColumn(
  definition: string,
  tableColumns: ReadonlySet<string>,
  opclass: string | null,
): CatalogIndexColumn {
  const named = /^("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)$/.exec(definition.trim())?.[1];
  if (named !== undefined) {
    const column = unquoteIdentifier(named);
    if (tableColumns.has(column)) return opclass === null ? column : { column, opclass };
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
    if (values === undefined) grouped.set(id, [row]);
    else values.push(row);
  }
  const byTable = new Map<string, CatalogIndexSnapshot[]>();
  for (const values of grouped.values()) {
    values.sort((left, right) => left.position - right.position);
    const first = values[0];
    if (first === undefined) continue;
    const method = first.method.toLowerCase();
    const snapshot: CatalogIndexSnapshot = {
      name: first.name,
      columns: values.map(value => indexColumn(value.definition, columns.get(first.table) ?? new Set(), value.opclass)),
      unique: first.unique,
      ...(method === 'btree' ? {} : { method }),
      ...(first.where === null ? {} : { where: first.where }),
    };
    const tableValues = byTable.get(first.table);
    if (tableValues === undefined) byTable.set(first.table, [snapshot]);
    else tableValues.push(snapshot);
  }
  return new Map([...byTable].map(([table, values]) => [table, sortByName(values)]));
}

async function postgresSnapshot(
  driver: IntrospectionDriver,
  options: IntrospectOptions = {},
): Promise<CatalogSchemaSnapshot> {
  const schemas = postgresSchemas(options);
  const slots = placeholders(schemas.length);
  const [tableRows, columnRows, primaryKeyRows, foreignKeyRows, indexRows, extensionRows] = await Promise.all([
    driver.execute(
      query(
        `SELECT table_schema, table_name FROM information_schema.tables ` +
          `WHERE table_type = 'BASE TABLE' AND table_schema IN (${slots}) ORDER BY table_schema, table_name`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT c.table_schema, c.table_name, c.ordinal_position, c.column_name, c.is_nullable, ` +
          `c.data_type, c.udt_name, c.domain_name, c.character_maximum_length, c.column_default, ` +
          `c.is_generated, c.generation_expression, a.attidentity, a.atttypmod, t.typtype, ` +
          `bt.typname AS domain_base_type, ext.extname AS extension_name ` +
          `FROM information_schema.columns c ` +
          `JOIN pg_catalog.pg_namespace ns ON ns.nspname = c.table_schema ` +
          `JOIN pg_catalog.pg_class cls ON cls.relnamespace = ns.oid AND cls.relname = c.table_name ` +
          `JOIN pg_catalog.pg_attribute a ON a.attrelid = cls.oid AND a.attname = c.column_name ` +
          `JOIN pg_catalog.pg_type t ON t.oid = a.atttypid ` +
          `LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype ` +
          `LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_type'::regclass AND dep.objid = t.oid ` +
          `AND dep.deptype = 'e' ` +
          `LEFT JOIN pg_catalog.pg_extension ext ON ext.oid = dep.refobjid ` +
          `WHERE c.table_schema IN (${slots}) ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
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
          `WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema IN (${slots}) ` +
          `ORDER BY tc.table_name, kcu.ordinal_position`,
        schemas,
      ),
    ),
    driver.execute(
      query(
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position, ` +
          `ukcu.table_name AS target_table, ukcu.column_name AS target_column, rc.update_rule, rc.delete_rule ` +
          `FROM information_schema.table_constraints tc ` +
          `JOIN information_schema.key_column_usage kcu ON kcu.constraint_catalog = tc.constraint_catalog ` +
          `AND kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name ` +
          `AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name ` +
          `JOIN information_schema.referential_constraints rc ON rc.constraint_catalog = tc.constraint_catalog ` +
          `AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name ` +
          `JOIN information_schema.key_column_usage ukcu ON ukcu.constraint_catalog = rc.unique_constraint_catalog ` +
          `AND ukcu.constraint_schema = rc.unique_constraint_schema ` +
          `AND ukcu.constraint_name = rc.unique_constraint_name ` +
          `AND ukcu.ordinal_position = kcu.position_in_unique_constraint ` +
          `WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema IN (${slots}) ` +
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
          `WHERE ns.nspname IN (${slots}) ORDER BY tbl.relname, idx.relname, positions.position`,
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
  const primaryKeyByTable = primaryKeys(primaryKeyRows.map(parsePrimaryKey));
  const foreignKeyByTable = foreignKeys(foreignKeyRows.map(parseForeignKey));
  const columnNames = new Map<string, ReadonlySet<string>>(
    tableNames.map(name => [
      name,
      new Set(parsedColumns.filter(column => column.table === name).map(column => column.name)),
    ]),
  );
  const indexByTable = indexes(indexRows.map(parseIndex), columnNames);
  const warnings: CatalogWarning[] = [];

  const tables: CatalogTableSnapshot[] = tableNames
    .filter(name => tableSelected(name, options))
    .map(name => {
      const primaryKey = primaryKeyByTable.get(name) ?? [];
      const columns: PostgresColumnSnapshot[] = parsedColumns
        .filter(column => column.table === name)
        .map(column => {
          const mapped = postgresType(column);
          if (mapped.warning !== undefined) warnings.push({ table: name, column: column.name, reason: mapped.warning });
          if (column.typeKind === 'd') {
            warnings.push({
              table: name,
              column: column.name,
              reason: `Postgres domain ${catalogType(column)} was normalized to its base type and its constraints are not represented`,
            });
          }
          const generatedBySequence =
            column.identity !== '' || (column.default?.toLowerCase().startsWith('nextval(') ?? false);
          return {
            name: column.name,
            type: mapped.type,
            catalogType: catalogType(column),
            nullable: column.nullable,
            primaryKey: primaryKey.includes(column.name),
            ...(mapped.length === undefined ? {} : { length: mapped.length }),
            ...(column.default === null || generatedBySequence ? {} : { default: column.default }),
            ...(column.generated === 'ALWAYS' && column.generationExpression !== null
              ? { generated: { expression: column.generationExpression, stored: true } }
              : {}),
          };
        })
        .toSorted((left, right) => left.name.localeCompare(right.name));
      return {
        name,
        columns,
        primaryKey,
        foreignKeys: foreignKeyByTable.get(name) ?? [],
        indexes: indexByTable.get(name) ?? [],
      };
    });

  const extensions = extensionRows.map((row, index) => {
    const name = textField(row, 'name', 'postgres pg_catalog.pg_extension', index);
    const schema = textField(row, 'schema', 'postgres pg_catalog.pg_extension', index);
    return schema === 'public' ? { name } : { name, schema };
  });

  return {
    version: 1,
    tables: sortByName(tables),
    extensions: sortByName(extensions),
    warnings: warnings.toSorted(
      (left, right) =>
        left.table.localeCompare(right.table) ||
        (left.column ?? '').localeCompare(right.column ?? '') ||
        left.reason.localeCompare(right.reason),
    ),
  };
}

function normalizeForDrift(snapshot: CatalogSchemaSnapshot): SchemaSnapshot {
  return {
    version: 1,
    tables: snapshot.tables
      .filter(table => table.name !== '_zmdb_migrations')
      .map(table => ({
        name: table.name,
        columns: table.columns.map(column => ({
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          ...(column.length === undefined ? {} : { length: column.length }),
          ...(column.unique === undefined ? {} : { unique: column.unique }),
        })),
        primaryKey: table.primaryKey,
        foreignKeys: table.foreignKeys,
        indexes: table.indexes,
        ...(table.tableOptions === undefined ? {} : { tableOptions: table.tableOptions }),
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    extensions: snapshot.extensions.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export function postgresFamilyIntrospector<Name extends string>(
  name: Name,
  overrides: PostgresCatalogOverrides = {},
): Introspector<Name> {
  const parentSnapshot = (driver: IntrospectionDriver, options?: IntrospectOptions): Promise<CatalogSchemaSnapshot> =>
    postgresSnapshot(driver, options);
  const parentNormalize = (snapshot: CatalogSchemaSnapshot, _role: 'live' | 'declared'): SchemaSnapshot =>
    normalizeForDrift(snapshot);

  return Object.freeze({
    name,
    dialect: name,
    snapshot: (driver: IntrospectionDriver, options?: IntrospectOptions) =>
      overrides.snapshot === undefined
        ? parentSnapshot(driver, options)
        : overrides.snapshot(parentSnapshot, driver, options),
    normalizeForDrift: (snapshot: CatalogSchemaSnapshot, role: 'live' | 'declared') =>
      overrides.normalizeForDrift === undefined
        ? parentNormalize(snapshot, role)
        : overrides.normalizeForDrift(parentNormalize, snapshot, role),
  });
}
