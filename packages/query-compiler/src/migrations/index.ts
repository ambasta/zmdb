// Migrations (#41–#44): snapshot a set of schemas, diff two snapshots into
// change ops, and emit up/down DDL per dialect. Deterministic throughout —
// tables and columns are sorted by name so a snapshot is byte-stable.
export { down, downTo, driverMigrationConnection, ensureVersionTable, runCli, status, up } from './runner.js';
export type { Migration, MigrationRunOptions, MigrationStatus } from './runner.js';
import {
  TRAITS,
  type Dialect,
  type DialectSqlType,
  type DialectTypeMap,
  type MigrationDialect,
  type SchemaObjectOperation,
} from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
import { quoteIdentifier } from '../quoting.js';
import { createExtensionDdl } from '../schema-objects/extensions.js';
import { actionName, CHANGE_PHASES, diff, snapshot, type DiffOptions, type SnapshotableSchema } from './runner.js';
import type { ChangeOp, ColumnSnapshot, ExtensionType, ForeignKeySnapshot, ReferentialAction } from './types.js';

export { CHANGE_PHASES, diff, snapshot };
export type { DiffOptions, SnapshotableSchema };
export type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
  TableOptions,
  TableSnapshot,
} from './types.js';
export type {
  MigrationConnection,
  MigrationDialect,
  MigrationDriver,
  MigrationPlan,
  MigrationTableOptions,
  SchemaObjectOperation,
} from '../dialects/index.js';

function isMigrationDialect(value: unknown): value is MigrationDialect {
  if (value === null || typeof value !== 'object') return false;
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'ddlType') === 'function' &&
    typeof Reflect.get(value, 'emitUp') === 'function' &&
    typeof Reflect.get(value, 'emitDown') === 'function'
  );
}

export function emitSchemaObject(migrations: MigrationDialect, operation: SchemaObjectOperation): readonly string[] {
  return migrations.emitSchemaObject(operation);
}

// ---------------------------------------------------------------------------
// The DDL type map.
// ---------------------------------------------------------------------------
//
// Until this existed, `columnDdl` interpolated the abstract type verbatim, so a
// `timestamp` reached all three databases as the literal word `timestamp`. Postgres
// reads that as `timestamp without time zone` and silently drops the offset of every
// `Date` written to it, MySQL rejects a `VARCHAR` with no length outright, and only the
// *identifiers* were ever dialect-aware. One column, three wrong answers.
//
// So each dialect renders the type it owns, and the abstract name stays abstract
// everywhere above this function. The root maps are checked against the dependency-free
// `DialectSqlType` vocabulary; repository's type-test proves that union stays equal to
// `@zmdb/schema-core`'s `SqlType`. A type not named there — a hand-written snapshot — is
// passed through unchanged, which is the only option that does not turn an unknown into
// a wrong guess.

/** Backward-compatible view of the type maps now owned by the resolved traits registry. */
export const DDL_TYPES: Readonly<Record<Dialect, DialectTypeMap>> = Object.freeze({
  postgres: TRAITS.postgres.types,
  mysql: TRAITS.mysql.types,
  sqlite: TRAITS.sqlite.types,
  mssql: TRAITS.mssql.types,
  cockroach: TRAITS.cockroach.types,
  singlestore: TRAITS.singlestore.types,
});

export type DdlSqlType = DialectSqlType;

function ddlScalarType(dialect: Dialect, type: string): string {
  const types: Readonly<Record<string, string>> = TRAITS[dialect].types;
  return types[type] ?? type;
}

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function extensionTypeDdl(type: ExtensionType): string {
  if (!EXTENSION_IDENTIFIER.test(type.name)) {
    throw new TypeError(`extension type name ${JSON.stringify(type.name)} is not a SQL identifier`);
  }
  const args = type.args ?? [];
  const rendered = args.map(argument => {
    if (typeof argument === 'number' && Number.isFinite(argument)) return String(argument);
    if (typeof argument === 'string' && EXTENSION_IDENTIFIER.test(argument)) return argument;
    throw new TypeError(
      `extension type ${type.name} argument ${JSON.stringify(argument)} must be a finite number or SQL identifier`,
    );
  });
  return `${type.name}${rendered.length === 0 ? '' : `(${rendered.join(',')})`}`;
}

function unsupportedExtensionType(
  dialect: Dialect,
  type: ExtensionType,
  column: string,
  table?: string,
): UnsupportedFeatureError {
  const rendered = extensionTypeDdl(type);
  const location = table === undefined ? `column "${column}"` : `"${table}"."${column}"`;
  return new UnsupportedFeatureError(
    `extension type ${rendered}`,
    dialect,
    `${dialect} does not support the extension type ${rendered} on ${location} (extension \`${type.extension}\`); ` +
      'there is no equivalent, and storing it as TEXT would produce a value the database cannot use',
  );
}

/**
 * The dialect's spelling of an abstract type or one column's complete type.
 *
 * A bare type is for a routine signature. `serial` then means its underlying
 * integer type, because auto-generation is a column property. A column snapshot
 * additionally carries length, key and auto-increment semantics.
 *
 * Exported because a migration written by hand is still a migration, and the answer to
 * "what does this dialect call a `timestamp`" should have exactly one implementation.
 */
export function ddlType(migrations: MigrationDialect, column: ColumnSnapshot): string;
export function ddlType(dialect: Dialect, type: string): string;
export function ddlType(dialect: Dialect, column: ColumnSnapshot): string;
export function ddlType(
  dialectOrMigrations: Dialect | MigrationDialect,
  typeOrColumn: string | ColumnSnapshot,
): string {
  if (isMigrationDialect(dialectOrMigrations)) {
    if (typeof typeOrColumn === 'string') {
      throw new TypeError('an injected migration dialect requires a complete ColumnSnapshot');
    }
    return dialectOrMigrations.ddlType(typeOrColumn);
  }
  const dialect = dialectOrMigrations;
  const isColumn = typeof typeOrColumn !== 'string';
  const column = isColumn ? typeOrColumn : undefined;
  const type = isColumn ? typeOrColumn.type : typeOrColumn === 'serial' ? 'integer' : typeOrColumn;
  if (typeof type !== 'string') {
    if (dialect !== 'postgres') throw unsupportedExtensionType(dialect, type, column?.name ?? 'unknown');
    return extensionTypeDdl(type);
  }
  const mapped = ddlScalarType(dialect, type);

  // A length belongs to the type, not to the column: `VARCHAR(255)`, not `VARCHAR 255`.
  // Only where the dialect has a parameterised type to put it in — SQLite maps `varchar`
  // to `TEXT`, which takes none. A Postgres `VARCHAR` with no length is unlimited and
  // legal; a MySQL one is a syntax error, so it degrades to `TEXT` rather than emitting
  // DDL that cannot run.
  if (type === 'varchar') {
    if (column?.length !== undefined && (mapped === 'VARCHAR' || mapped === 'NVARCHAR')) {
      return `${mapped}(${column.length})`;
    }
    if (TRAITS[dialect].family === 'mysql') return 'TEXT';
    if (dialect === 'mssql') return 'NVARCHAR(MAX)';
    return mapped;
  }

  // A dialect can put auto-generation directly in its serial mapping. MySQL requires
  // AUTO_INCREMENT columns to be keyed, so the one non-primary shape stays unique.
  if (column?.type === 'serial') {
    return !column.primaryKey && mapped.endsWith('AUTO_INCREMENT') ? `${mapped} UNIQUE` : mapped;
  }

  return mapped;
}

function columnDdl(
  d: Dialect,
  col: ColumnSnapshot,
  table: string,
  key: { readonly inline: boolean; readonly tableLevel: boolean } = {
    inline: col.primaryKey,
    tableLevel: false,
  },
): string {
  // PRIMARY KEY implies NOT NULL, so we don't emit both.
  const pk = key.inline ? ' PRIMARY KEY' : '';
  const nn = !key.inline && (!col.nullable || key.tableLevel) ? ' NOT NULL' : '';
  const type =
    typeof col.type === 'string'
      ? ddlType(d, col)
      : d === 'postgres'
        ? extensionTypeDdl(col.type)
        : (() => {
            throw unsupportedExtensionType(d, col.type, col.name, table);
          })();
  return `${quoteIdentifier(d, col.name)} ${type}${pk}${nn}`;
}

function primaryKeyDdl(dialect: Dialect, columns: readonly string[]): string {
  return `PRIMARY KEY (${columns.map(column => quoteIdentifier(dialect, column)).join(', ')})`;
}

function referentialActionDdl(dialect: Dialect, action: ReferentialAction): string {
  return dialect === 'mssql' && action === 'restrict' ? 'NO ACTION' : actionName(action);
}

function foreignKeyDdl(dialect: Dialect, foreignKey: ForeignKeySnapshot): string {
  const columns = foreignKey.columns.map(column => quoteIdentifier(dialect, column)).join(', ');
  const targetColumns = foreignKey.targetColumns.map(column => quoteIdentifier(dialect, column)).join(', ');
  return (
    `FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(dialect, foreignKey.targetTable)} (${targetColumns}) ` +
    `ON DELETE ${referentialActionDdl(dialect, foreignKey.onDelete)} ` +
    `ON UPDATE ${referentialActionDdl(dialect, foreignKey.onUpdate)}`
  );
}

function requireColumns(
  table: string,
  label: 'shard key' | 'sort key',
  columns: readonly string[] | undefined,
  available: ReadonlySet<string>,
): void {
  if (columns === undefined) return;
  if (columns.length === 0) {
    throw new TypeError(`${label} on "${table}" must name at least one column`);
  }
  for (const column of columns) {
    if (!available.has(column)) {
      throw new TypeError(`${label} on "${table}" names unknown column "${column}"`);
    }
  }
}

function singlestoreTableDefinitions(
  op: Extract<ChangeOp, { kind: 'create_table' }>,
  available: ReadonlySet<string>,
): readonly string[] {
  if (op.foreignKeys.length > 0) {
    throw new UnsupportedFeatureError(
      'foreign keys',
      'singlestore',
      `singlestore does not enforce foreign keys; remove the ${op.foreignKeys.length === 1 ? 'constraint' : 'constraints'} ` +
        `from "${op.table}" and enforce referential integrity in the application`,
    );
  }

  const options = op.tableOptions;
  const shardKey = options?.shardKey;
  const sortKey = options?.sortKey;
  if (shardKey === undefined && options?.rowstore !== true) {
    throw new UnsupportedFeatureError(
      'table options',
      'singlestore',
      `singlestore table "${op.table}" must declare ShardKey<…> or Rowstore; ` +
        'leaving both absent makes storage and distribution an accidental default',
    );
  }

  requireColumns(op.table, 'shard key', shardKey, available);
  requireColumns(op.table, 'sort key', sortKey, available);

  const definitions: string[] = [];
  for (const column of op.columns) {
    if (column.unique !== true) continue;
    if (shardKey === undefined || shardKey.some(shard => shard !== column.name)) {
      throw new UnsupportedFeatureError(
        `unique column "${column.name}" outside the shard key`,
        'singlestore',
        `singlestore cannot enforce UNIQUE on "${op.table}"."${column.name}" unless that index includes the ` +
          `whole shard key (${shardKey?.join(', ') ?? 'none'}); change the shard key or enforce uniqueness in the application`,
      );
    }
    definitions.push(`UNIQUE (${quoteIdentifier('singlestore', column.name)})`);
  }
  if (shardKey !== undefined) {
    definitions.push(`SHARD KEY (${shardKey.map(column => quoteIdentifier('singlestore', column)).join(', ')})`);
  }
  if (sortKey !== undefined) {
    definitions.push(`SORT KEY (${sortKey.map(column => quoteIdentifier('singlestore', column)).join(', ')})`);
  }
  return definitions;
}

function createTableDdl(op: Extract<ChangeOp, { kind: 'create_table' }>, dialect: Dialect): string {
  const inline = op.primaryKey.length === 1 ? op.primaryKey[0] : undefined;
  const tableLevel = op.primaryKey.length > 1 ? new Set(op.primaryKey) : undefined;
  const definitions = op.columns.map(column =>
    columnDdl(dialect, column, op.table, {
      inline: column.name === inline,
      tableLevel: tableLevel?.has(column.name) === true,
    }),
  );
  if (op.primaryKey.length > 1) definitions.push(primaryKeyDdl(dialect, op.primaryKey));
  if (dialect === 'sqlite') {
    for (const foreignKey of op.foreignKeys) definitions.push(foreignKeyDdl(dialect, foreignKey));
  }
  if (dialect === 'singlestore') {
    const available = new Set(op.columns.map(column => column.name));
    definitions.push(...singlestoreTableDefinitions(op, available));
  }
  const create =
    dialect === 'singlestore' && op.tableOptions?.rowstore === true ? 'CREATE ROWSTORE TABLE' : 'CREATE TABLE';
  return `${create} ${quoteIdentifier(dialect, op.table)} (${definitions.join(', ')})`;
}

function addForeignKeyDdl(table: string, foreignKey: ForeignKeySnapshot, dialect: Dialect): string {
  if (!TRAITS[dialect].features.foreignKeys) {
    throw new UnsupportedFeatureError(
      `foreign key "${foreignKey.name}" on "${table}"`,
      dialect,
      `${dialect} does not enforce foreign keys; remove the constraint and enforce referential integrity in the application`,
    );
  }
  if (dialect === 'sqlite') {
    throw new UnsupportedFeatureError(
      `adding foreign key "${foreignKey.name}" on "${table}"`,
      dialect,
      `sqlite cannot add the foreign key "${foreignKey.name}" on "${table}"; ` +
        'SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — ' +
        'see the migration guide',
    );
  }
  if (
    TRAITS[dialect].family === 'mysql' &&
    (foreignKey.onDelete === 'set default' || foreignKey.onUpdate === 'set default')
  ) {
    throw new UnsupportedFeatureError(
      `SET DEFAULT on foreign key "${foreignKey.name}"`,
      dialect,
      `SET DEFAULT on foreign key "${foreignKey.name}" is not supported by mysql; ` +
        'InnoDB accepts the syntax but refuses the constraint',
    );
  }

  const constraint =
    `ALTER TABLE ${quoteIdentifier(dialect, table)} ADD CONSTRAINT ${quoteIdentifier(dialect, foreignKey.name)} ` +
    foreignKeyDdl(dialect, foreignKey);
  if (TRAITS[dialect].family !== 'mysql') return constraint;

  const indexName = `${foreignKey.name}_idx`;
  if (indexName.length > 64) {
    throw new UnsupportedFeatureError(
      `supporting index "${indexName}"`,
      dialect,
      `the mysql supporting index "${indexName}" is ${indexName.length} characters long; mysql's limit is 64`,
    );
  }
  const columns = foreignKey.columns.map(column => quoteIdentifier(dialect, column)).join(', ');
  const index = `CREATE INDEX ${quoteIdentifier(dialect, indexName)} ON ${quoteIdentifier(dialect, table)} (${columns})`;
  return `${index}; ${constraint}`;
}

function dropForeignKeyDdl(table: string, name: string, dialect: Dialect): string {
  if (dialect === 'sqlite') {
    throw new UnsupportedFeatureError(
      `dropping foreign key "${name}" on "${table}"`,
      dialect,
      `sqlite cannot drop the foreign key "${name}" on "${table}"; ` +
        'SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — ' +
        'see the migration guide',
    );
  }
  if (!TRAITS[dialect].features.foreignKeys) {
    throw new UnsupportedFeatureError(`dropping foreign key "${name}" on "${table}"`, dialect);
  }
  const keyword = TRAITS[dialect].family === 'mysql' ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT';
  return `ALTER TABLE ${quoteIdentifier(dialect, table)} ${keyword} ${quoteIdentifier(dialect, name)}`;
}

function keyList(columns: readonly string[]): string {
  return `(${columns.join(', ')})`;
}

function alterPrimaryKeyDdl(table: string, from: readonly string[], to: readonly string[], dialect: Dialect): string {
  if (dialect === 'sqlite') {
    throw new UnsupportedFeatureError(
      `altering the primary key of "${table}"`,
      dialect,
      `sqlite cannot alter the primary key of "${table}" (${keyList(from)} → ${keyList(to)}); ` +
        'SQLite has no ALTER TABLE form for a key, so this needs a hand-written table rebuild — ' +
        'see the migration guide',
    );
  }
  if (dialect === 'mssql') {
    throw new UnsupportedFeatureError(
      `altering the primary key of "${table}"`,
      dialect,
      `mssql cannot safely alter the primary key of "${table}" (${keyList(from)} → ${keyList(to)}) because ` +
        'the snapshot does not carry the existing SQL Server constraint name; use a hand-written migration',
    );
  }

  const clauses: string[] = [];
  if (from.length > 0) {
    clauses.push(
      TRAITS[dialect].family === 'postgres'
        ? `DROP CONSTRAINT ${quoteIdentifier(dialect, `${table}_pkey`)}`
        : 'DROP PRIMARY KEY',
    );
  }
  if (to.length > 0) clauses.push(`ADD ${primaryKeyDdl(dialect, to)}`);
  if (clauses.length === 0) throw new Error(`primary key change for "${table}" has no before or after columns`);
  return `ALTER TABLE ${quoteIdentifier(dialect, table)} ${clauses.join(', ')}`;
}

/**
 * The dialect's spelling of a type named by an `alter_column_type` op.
 *
 * The op carries the two type names and nullability in both directions. Two facts remain
 * unavailable here and are not guessed at: a `varchar`'s length (which `diff` cannot see
 * either — it compares types, so `varchar(60)` → `varchar(120)` produces no op at all),
 * and whether the column is a key, which only matters for MySQL's `AUTO_INCREMENT`.
 * Neither is reachable by an `ALTER`: a change *to* `serial` is not something the diff
 * can express.
 */
function alteredType(dialect: Dialect, table: string, column: string, type: string | ExtensionType): string {
  if (typeof type !== 'string' && dialect !== 'postgres') {
    throw unsupportedExtensionType(dialect, type, column, table);
  }
  return ddlType(dialect, { name: column, type, nullable: true, primaryKey: false });
}

function mssqlAlterNullability(
  op: Extract<ChangeOp, { readonly kind: 'alter_column_type' }>,
  direction: 'up' | 'down',
): string {
  const nullable = direction === 'up' ? op.toNullable : op.fromNullable;
  if (nullable === undefined) {
    throw new UnsupportedFeatureError(
      `altering the type of "${op.table}"."${op.column}" without nullability metadata`,
      'mssql',
      'mssql ALTER COLUMN must restate NULL or NOT NULL; generate this operation from snapshots or provide ' +
        `${direction === 'up' ? 'toNullable' : 'fromNullable'} explicitly`,
    );
  }
  return nullable ? ' NULL' : ' NOT NULL';
}

export function emitUp(migrations: MigrationDialect, operation: ChangeOp): string;
export function emitUp(operation: ChangeOp, dialect: Dialect): string;
export function emitUp(
  operationOrMigrations: ChangeOp | MigrationDialect,
  dialectOrOperation: Dialect | ChangeOp,
): string {
  if (isMigrationDialect(operationOrMigrations)) {
    if (typeof dialectOrOperation === 'string') {
      throw new TypeError('an injected migration dialect requires a ChangeOp');
    }
    return operationOrMigrations.emitUp(dialectOrOperation);
  }
  if (typeof dialectOrOperation !== 'string') {
    throw new TypeError('legacy migration emission requires a dialect name');
  }
  const op = operationOrMigrations;
  const dialect = dialectOrOperation;
  switch (op.kind) {
    case 'create_extension':
      return createExtensionDdl(op, dialect);
    case 'create_table':
      return createTableDdl(op, dialect);
    case 'drop_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'add_column':
      return (
        `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ` +
        `${dialect === 'mssql' ? 'ADD' : 'ADD COLUMN'} ${columnDdl(dialect, op.column, op.table)}`
      );
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      if (dialect === 'sqlite') {
        throw new UnsupportedFeatureError(
          'alter column type',
          dialect,
          'sqlite cannot alter a column type in place; use a hand-written table rebuild',
        );
      }
      return TRAITS[dialect].family === 'mysql'
        ? `ALTER TABLE ${quoteIdentifier(dialect, op.table)} MODIFY COLUMN ${quoteIdentifier(dialect, op.column)} ${alteredType(dialect, op.table, op.column, op.to)}`
        : `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)}${dialect === 'mssql' ? '' : ' TYPE'} ${alteredType(dialect, op.table, op.column, op.to)}${dialect === 'mssql' ? mssqlAlterNullability(op, 'up') : ''}`;
    case 'alter_primary_key':
      return alterPrimaryKeyDdl(op.table, op.from, op.to, dialect);
    case 'add_foreign_key':
      return addForeignKeyDdl(op.table, op.fk, dialect);
    case 'drop_foreign_key':
      return dropForeignKeyDdl(op.table, op.name, dialect);
  }
}

export function emitDown(migrations: MigrationDialect, operation: ChangeOp): string;
export function emitDown(operation: ChangeOp, dialect: Dialect): string;
export function emitDown(
  operationOrMigrations: ChangeOp | MigrationDialect,
  dialectOrOperation: Dialect | ChangeOp,
): string {
  if (isMigrationDialect(operationOrMigrations)) {
    if (typeof dialectOrOperation === 'string') {
      throw new TypeError('an injected migration dialect requires a ChangeOp');
    }
    return operationOrMigrations.emitDown(dialectOrOperation);
  }
  if (typeof dialectOrOperation !== 'string') {
    throw new TypeError('legacy migration emission requires a dialect name');
  }
  const op = operationOrMigrations;
  const dialect = dialectOrOperation;
  switch (op.kind) {
    case 'create_extension':
      throw new Error(
        `extension "${op.name}" is not dropped automatically; write a hand-authored migration after checking dependants`,
      );
    case 'create_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'drop_table':
      if (dialect === 'mssql') {
        throw new UnsupportedFeatureError(
          `recreating dropped table "${op.table}"`,
          dialect,
          `mssql cannot recreate dropped table "${op.table}" because the drop operation carries no columns; ` +
            'write the down migration by hand',
        );
      }
      return `CREATE TABLE ${quoteIdentifier(dialect, op.table)} ()`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column.name)}`;
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ADD COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      if (dialect === 'sqlite') {
        throw new UnsupportedFeatureError(
          'alter column type',
          dialect,
          'sqlite cannot alter a column type in place; use a hand-written table rebuild',
        );
      }
      return TRAITS[dialect].family === 'mysql'
        ? `ALTER TABLE ${quoteIdentifier(dialect, op.table)} MODIFY COLUMN ${quoteIdentifier(dialect, op.column)} ${alteredType(dialect, op.table, op.column, op.from)}`
        : `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)}${dialect === 'mssql' ? '' : ' TYPE'} ${alteredType(dialect, op.table, op.column, op.from)}${dialect === 'mssql' ? mssqlAlterNullability(op, 'down') : ''}`;
    case 'alter_primary_key':
      return alterPrimaryKeyDdl(op.table, op.to, op.from, dialect);
    case 'add_foreign_key':
      return dropForeignKeyDdl(op.table, op.fk.name, dialect);
    case 'drop_foreign_key':
      throw new Error(
        `foreign key "${op.name}" on "${op.table}" cannot be recreated automatically because the drop operation ` +
          'does not carry its columns or referential actions; write the down migration by hand',
      );
  }
}
