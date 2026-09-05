// #44 — async migration runner + version tracking + driver adapter.
// Applies/rolls back ordered migrations against an async connection or
// adapted database driver, recording applied versions in _zmdb_migrations.

import { type Dialect } from '../dialects/index.js';
import { SnapshotMismatchError, UnsupportedFeatureError } from '../errors.js';
import {
  dialectCapabilities,
  dialectFamily,
  dialectName,
  formatPlaceholder,
  isSqlDialect,
  quoteIdentifier,
  quoteTable,
  type CompiledQuery,
  type DialectTarget,
  type MigrationDriver as DialectMigrationDriver,
  type SqlDialect,
} from '../index.js';
import type {
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

export { SnapshotMismatchError };
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

/**
 * The slice of a schema a snapshot reads.
 */
export interface SnapshotableSchema {
  readonly table: string;
  readonly primaryKey: readonly string[];
  readonly columns: Readonly<
    Record<
      string,
      {
        readonly type: string | ExtensionType;
        readonly flags: {
          readonly nullable: boolean;
          readonly primaryKey?: boolean | undefined;
          readonly length?: number | undefined;
          readonly unique?: boolean | undefined;
        };
        readonly references?: { readonly target: string };
      }
    >
  >;
  readonly ir?: {
    readonly table: string;
    readonly physicalTable?: string;
    readonly columns: readonly {
      readonly name: string;
      readonly physicalName?: string;
      readonly references?: string;
      readonly onDelete?: ReferentialAction;
      readonly onUpdate?: ReferentialAction;
    }[];
    readonly foreignKeys?: readonly {
      readonly columns: readonly string[];
      readonly targetTable: string;
      readonly targetColumns: readonly string[];
    }[];
    readonly tableOptions?: TableOptions;
  };
}

function generatedForeignKeyName(table: string, columns: readonly string[]): string {
  const name = `${table}_${columns.join('_')}_fkey`;
  if (name.length > 63) {
    throw new TypeError(
      `generated foreign key name "${name}" is ${name.length} characters long; PostgreSQL's limit is 63, ` +
        'so give the table or columns shorter names',
    );
  }
  return name;
}

function referencedTarget(target: string): { readonly table: string; readonly column: string } {
  const separator = target.indexOf('.');
  if (separator <= 0 || separator !== target.lastIndexOf('.') || separator === target.length - 1) {
    throw new TypeError(`foreign key target "${target}" must be written as "table.column"`);
  }
  return { table: target.slice(0, separator), column: target.slice(separator + 1) };
}

function physicalColumn(schema: SnapshotableSchema, declared: string): string {
  const column = schema.ir?.columns.find(candidate => candidate.name === declared);
  return column?.physicalName ?? declared;
}

function physicalTarget(
  target: string,
  schemasByDeclaredTable: ReadonlyMap<string, SnapshotableSchema>,
): { readonly table: string; readonly column: string } {
  const declared = referencedTarget(target);
  const schema = schemasByDeclaredTable.get(declared.table);
  return schema === undefined
    ? declared
    : {
        table: schema.table,
        column: physicalColumn(schema, declared.column),
      };
}

function physicalTableOptions(schema: SnapshotableSchema): TableOptions | undefined {
  const options = schema.ir?.tableOptions;
  if (options === undefined) return undefined;
  return {
    ...(options.shardKey === undefined
      ? {}
      : { shardKey: options.shardKey.map(column => physicalColumn(schema, column)) }),
    ...(options.sortKey === undefined
      ? {}
      : { sortKey: options.sortKey.map(column => physicalColumn(schema, column)) }),
    ...(options.rowstore === undefined ? {} : { rowstore: options.rowstore }),
  };
}

export function snapshot(schemas: readonly SnapshotableSchema[]): SchemaSnapshot {
  const schemasByDeclaredTable = new Map(schemas.map(schema => [schema.ir?.table ?? schema.table, schema] as const));
  const extensions = new Map<string, ExtensionSnapshot>();
  const tables: TableSnapshot[] = schemas
    .map(schema => {
      const irColumns = new Map(
        schema.ir?.columns.flatMap(column => [
          [column.name, column] as const,
          [column.physicalName ?? column.name, column] as const,
        ]) ?? [],
      );
      const columns: ColumnSnapshot[] = Object.entries(schema.columns)
        .map(([name, meta]) => {
          if (typeof meta.type !== 'string') {
            extensions.set(meta.type.extension, { name: meta.type.extension });
          }
          const ir = irColumns.get(name);
          return {
            name: ir?.physicalName ?? name,
            type: meta.type,
            nullable: meta.flags.nullable,
            primaryKey: meta.flags.primaryKey === true,
            ...(meta.flags.length === undefined ? {} : { length: meta.flags.length }),
            ...(meta.flags.unique === true ? { unique: true } : {}),
          };
        })
        .toSorted((a, b) => a.name.localeCompare(b.name));
      const foreignKeys: ForeignKeySnapshot[] = [];
      for (const [name, meta] of Object.entries(schema.columns)) {
        if (meta.references === undefined) continue;
        const target = physicalTarget(meta.references.target, schemasByDeclaredTable);
        const ir = irColumns.get(name);
        const localName = ir?.physicalName ?? name;
        foreignKeys.push({
          name: generatedForeignKeyName(schema.table, [localName]),
          columns: [localName],
          targetTable: target.table,
          targetColumns: [target.column],
          onDelete: ir?.onDelete ?? 'no action',
          onUpdate: ir?.onUpdate ?? 'no action',
        });
      }
      for (const foreignKey of schema.ir?.foreignKeys ?? []) {
        const localColumns = foreignKey.columns.map(column => physicalColumn(schema, column));
        const targetSchema = schemasByDeclaredTable.get(foreignKey.targetTable);
        foreignKeys.push({
          name: generatedForeignKeyName(schema.table, localColumns),
          columns: localColumns,
          targetTable: targetSchema?.table ?? foreignKey.targetTable,
          targetColumns:
            targetSchema === undefined
              ? foreignKey.targetColumns
              : foreignKey.targetColumns.map(column => physicalColumn(targetSchema, column)),
          onDelete: 'no action',
          onUpdate: 'no action',
        });
      }
      const tableOptions = physicalTableOptions(schema);
      return {
        name: schema.table,
        columns,
        primaryKey: schema.primaryKey.map(column => physicalColumn(schema, column)),
        foreignKeys: foreignKeys.toSorted((a, b) => a.name.localeCompare(b.name)),
        ...(tableOptions === undefined ? {} : { tableOptions }),
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    tables,
    extensions: [...extensions.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

export function sameType(previous: string | ExtensionType, next: string | ExtensionType): boolean {
  if (typeof previous === 'string' || typeof next === 'string') return previous === next;
  if (previous.extension !== next.extension || previous.name !== next.name) return false;
  const previousArgs = previous.args ?? [];
  const nextArgs = next.args ?? [];
  return previousArgs.length === nextArgs.length && previousArgs.every((value, index) => value === nextArgs[index]);
}

export const CHANGE_PHASES = [
  ['create_extension'],
  ['drop_foreign_key'],
  ['drop_table'],
  ['create_table', 'add_column'],
  ['alter_column_type', 'alter_primary_key'],
  ['drop_column'],
  ['add_foreign_key'],
] as const satisfies readonly (readonly ChangeOp['kind'][])[];

const CHANGE_PHASE = new Map<ChangeOp['kind'], number>(
  CHANGE_PHASES.flatMap((kinds, phase) => kinds.map(kind => [kind, phase] as const)),
);

export function orderChanges(ops: readonly ChangeOp[]): readonly ChangeOp[] {
  const phaseOf = (kind: ChangeOp['kind']): number => {
    const phase = CHANGE_PHASE.get(kind);
    if (phase === undefined) throw new Error(`change kind "${kind}" has no migration phase`);
    return phase;
  };
  return ops.toSorted((left, right) => phaseOf(left.kind) - phaseOf(right.kind));
}

function sameSequence(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameTableOptions(previous: TableOptions | undefined, next: TableOptions | undefined): boolean {
  if (previous?.rowstore !== next?.rowstore) return false;
  return (
    sameSequence(previous?.shardKey ?? [], next?.shardKey ?? []) &&
    sameSequence(previous?.sortKey ?? [], next?.sortKey ?? [])
  );
}

function foreignKeysOf(table: TableSnapshot): readonly ForeignKeySnapshot[] {
  return table.foreignKeys ?? [];
}

function foreignKeyIdentity(foreignKey: ForeignKeySnapshot): string {
  return JSON.stringify([foreignKey.columns, foreignKey.targetTable, foreignKey.targetColumns]);
}

function sameForeignKeyActions(previous: ForeignKeySnapshot, next: ForeignKeySnapshot): boolean {
  return previous.onDelete === next.onDelete && previous.onUpdate === next.onUpdate;
}

export function actionName(action: ReferentialAction): string {
  return action.toUpperCase();
}

function sqliteForeignKeyRefusal(
  table: string,
  kind: 'add' | 'drop' | 'change',
  previous: ForeignKeySnapshot | undefined,
  next: ForeignKeySnapshot | undefined,
): never {
  const foreignKey = next ?? previous;
  if (foreignKey === undefined) throw new Error(`foreign key ${kind} on "${table}" has no constraint`);
  const transition =
    previous !== undefined && next !== undefined
      ? ` (ON DELETE ${actionName(previous.onDelete)} → ${actionName(next.onDelete)}; ` +
        `ON UPDATE ${actionName(previous.onUpdate)} → ${actionName(next.onUpdate)})`
      : '';
  throw new UnsupportedFeatureError(
    `${kind} foreign key "${foreignKey.name}" on "${table}"`,
    'sqlite',
    `sqlite cannot ${kind} the foreign key "${foreignKey.name}" on "${table}"${transition}; ` +
      'SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — ' +
      'see the migration guide',
  );
}

function diffForeignKeys(
  table: string,
  previous: readonly ForeignKeySnapshot[],
  next: readonly ForeignKeySnapshot[],
  dialect: Dialect | undefined,
  ops: ChangeOp[],
): void {
  const unmatchedPrevious = new Map(previous.map(foreignKey => [foreignKeyIdentity(foreignKey), foreignKey]));

  for (const foreignKey of next) {
    const identity = foreignKeyIdentity(foreignKey);
    const before = unmatchedPrevious.get(identity);
    if (before === undefined) {
      if (dialect === 'sqlite') sqliteForeignKeyRefusal(table, 'add', undefined, foreignKey);
      ops.push({ kind: 'add_foreign_key', table, fk: foreignKey });
      continue;
    }
    unmatchedPrevious.delete(identity);
    if (sameForeignKeyActions(before, foreignKey)) continue;
    if (dialect === 'sqlite') sqliteForeignKeyRefusal(table, 'change', before, foreignKey);
    ops.push({ kind: 'drop_foreign_key', table, name: before.name });
    ops.push({ kind: 'add_foreign_key', table, fk: foreignKey });
  }

  for (const foreignKey of unmatchedPrevious.values()) {
    if (dialect === 'sqlite') sqliteForeignKeyRefusal(table, 'drop', foreignKey, undefined);
    ops.push({ kind: 'drop_foreign_key', table, name: foreignKey.name });
  }
}

function createdTablesInOrder(
  previous: ReadonlyMap<string, TableSnapshot>,
  next: readonly TableSnapshot[],
  dialect: Dialect | undefined,
): readonly TableSnapshot[] {
  const created = new Map(next.filter(table => !previous.has(table.name)).map(table => [table.name, table]));
  const dependencies = new Map<string, Set<string>>();
  const dependants = new Map<string, Set<string>>();

  for (const table of created.values()) {
    const targets = new Set(
      foreignKeysOf(table)
        .map(foreignKey => foreignKey.targetTable)
        .filter(target => target !== table.name && created.has(target)),
    );
    dependencies.set(table.name, targets);
    for (const target of targets) {
      const children = dependants.get(target) ?? new Set<string>();
      children.add(table.name);
      dependants.set(target, children);
    }
  }

  const ready = [...created.keys()]
    .filter(name => dependencies.get(name)?.size === 0)
    .toSorted((left, right) => left.localeCompare(right));
  const ordered: TableSnapshot[] = [];
  while (ready.length > 0) {
    const name = ready.shift();
    if (name === undefined) break;
    const table = created.get(name);
    if (table !== undefined) ordered.push(table);
    for (const child of dependants.get(name) ?? []) {
      const remaining = dependencies.get(child);
      remaining?.delete(name);
      if (remaining?.size === 0) {
        ready.push(child);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length === created.size) return ordered;
  const orderedNames = new Set(ordered.map(table => table.name));
  const cyclic = [...created.keys()]
    .filter(name => !orderedNames.has(name))
    .toSorted((left, right) => left.localeCompare(right));
  if (dialect === 'sqlite') {
    throw new UnsupportedFeatureError(
      `creating mutually-referencing tables ${cyclic.map(name => `"${name}"`).join(', ')}`,
      'sqlite',
      `sqlite cannot create the mutually-referencing tables ${cyclic.map(name => `"${name}"`).join(' and ')}; ` +
        'their foreign keys must be inline, so neither table can be created before the other — ' +
        'use a hand-written table rebuild or remove the cycle',
    );
  }
  return [...ordered, ...cyclic.map(name => created.get(name)).filter(table => table !== undefined)];
}

export interface DiffOptions {
  readonly dialect?: Dialect | undefined;
}

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot, options: DiffOptions = {}): readonly ChangeOp[] {
  const ops: ChangeOp[] = [];
  const prevTables = new Map(prev.tables.map(t => [t.name, t]));
  const nextTables = new Map(next.tables.map(t => [t.name, t]));
  const prevExtensions = new Set(prev.extensions.map(extension => extension.name));

  for (const extension of next.extensions) {
    if (!prevExtensions.has(extension.name)) {
      ops.push({
        kind: 'create_extension',
        name: extension.name,
        ...(extension.schema === undefined ? {} : { schema: extension.schema }),
      });
    }
  }

  for (const t of prev.tables) {
    if (!nextTables.has(t.name)) ops.push({ kind: 'drop_table', table: t.name });
  }
  for (const t of next.tables) {
    const before = prevTables.get(t.name);
    if (!before) continue;
    if (!sameTableOptions(before.tableOptions, t.tableOptions) && options.dialect === 'singlestore') {
      throw new UnsupportedFeatureError(
        'table options change',
        'singlestore',
        `singlestore cannot alter the shard key, sort key, or rowstore setting of "${t.name}"; ` +
          'create a replacement table and copy the data',
      );
    }
    const beforeCols = new Map(before.columns.map(c => [c.name, c]));
    const afterCols = new Map(t.columns.map(c => [c.name, c]));
    for (const c of before.columns) {
      if (!afterCols.has(c.name)) ops.push({ kind: 'drop_column', table: t.name, column: c.name });
    }
    for (const c of t.columns) {
      const bc = beforeCols.get(c.name);
      if (!bc) {
        ops.push({ kind: 'add_column', table: t.name, column: c });
      } else if (!sameType(bc.type, c.type)) {
        ops.push({
          kind: 'alter_column_type',
          table: t.name,
          column: c.name,
          from: bc.type,
          to: c.type,
          fromNullable: bc.nullable,
          toNullable: c.nullable,
        });
      }
    }
    if (!sameSequence(before.primaryKey, t.primaryKey)) {
      ops.push({ kind: 'alter_primary_key', table: t.name, from: before.primaryKey, to: t.primaryKey });
    }
    diffForeignKeys(t.name, foreignKeysOf(before), foreignKeysOf(t), options.dialect, ops);
  }

  for (const table of createdTablesInOrder(prevTables, next.tables, options.dialect)) {
    const foreignKeys = foreignKeysOf(table);
    ops.push({
      kind: 'create_table',
      table: table.name,
      columns: table.columns,
      primaryKey: table.primaryKey,
      foreignKeys,
      ...(table.tableOptions === undefined ? {} : { tableOptions: table.tableOptions }),
    });
    if (options.dialect !== 'sqlite') {
      for (const foreignKey of foreignKeys) {
        ops.push({ kind: 'add_foreign_key', table: table.name, fk: foreignKey });
      }
    }
  }
  return orderChanges(ops);
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly targetSnapshot?: SchemaSnapshot | undefined;
  readonly snapshot?: SchemaSnapshot | undefined;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  /** `null` identifies a ledger row written before checksums were introduced. */
  readonly checksum: string | null;
}

export interface MigrationRunnerOptions {
  readonly onWarning?: (message: string) => void;
  readonly targetSnapshot?: SchemaSnapshot | undefined;
  readonly targetSchemas?: readonly SnapshotableSchema[] | undefined;
  readonly validateSnapshot?: (
    migrationSnapshot: SchemaSnapshot,
    targetSnapshot?: SchemaSnapshot | undefined,
    migration?: Migration,
  ) => boolean | string | void;
}

// Minimal async-compatible connection the runner needs.
export interface MigrationConnection {
  readonly dialect?: string | SqlDialect;
  /** False when DDL commits independently of BEGIN/ROLLBACK, as it does on MySQL. */
  readonly transactionalDdl?: boolean;
  exec(sql: string): Promise<void> | void;
  appliedVersions(): Promise<readonly number[]> | readonly number[];
  appliedMigrations?(): Promise<readonly AppliedMigration[]> | readonly AppliedMigration[];
  recordApplied(version: number, name: string, checksum?: string): Promise<void> | void;
  recordReverted(version: number): Promise<void> | void;
  ensureVersionTable?(): Promise<void> | void;
  checksum?(sql: string): Promise<string> | string;
  transaction?<T>(run: (connection?: MigrationConnection) => Promise<T>): Promise<T>;
}

// Interface matching any runtime database driver (e.g. from @zmdb/repository).
export interface MigrationDriver {
  readonly dialect?: DialectTarget;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  transaction?<T>(run: (driver: MigrationDriver) => Promise<T>): Promise<T>;
}

export interface MigrationTableOptions {
  readonly table?: string;
  readonly schema?: string;
}

export interface MigrationRunOptions {
  readonly onWarning?: (message: string) => void;
}

export interface MigrationStatus {
  readonly version: number;
  readonly name: string;
  readonly applied: boolean;
  readonly snapshotBound?: boolean | undefined;
}

function isSchemaSnapshot(options: MigrationRunnerOptions | SchemaSnapshot): options is SchemaSnapshot {
  return 'version' in options && options.version === 1;
}

function normalizeOptions(options?: MigrationRunnerOptions | SchemaSnapshot): MigrationRunnerOptions | undefined {
  if (!options) return undefined;
  if (isSchemaSnapshot(options)) {
    return { targetSnapshot: options };
  }
  return options;
}

export function validateSnapshotCompatibility(
  m: Migration,
  optionsInput?: MigrationRunnerOptions | SchemaSnapshot,
): void {
  const mSnap = m.targetSnapshot ?? m.snapshot;
  if (!mSnap) {
    // Legacy migration lacking snapshot contracts: bypass snapshot validation.
    return;
  }

  if (typeof mSnap !== 'object' || mSnap === null || mSnap.version !== 1 || !Array.isArray(mSnap.tables)) {
    throw new SnapshotMismatchError({
      version: m.version,
      migrationName: m.name,
      actualSnapshot: mSnap,
      message: `Snapshot contract validation failed for migration ${m.version} ("${m.name}"): invalid or missing version 1 schema snapshot`,
    });
  }

  const options = normalizeOptions(optionsInput);
  const targetSnap = options?.targetSnapshot ?? (options?.targetSchemas ? snapshot(options.targetSchemas) : undefined);

  if (targetSnap) {
    const ops = diff(mSnap, targetSnap);
    if (ops.length > 0) {
      throw new SnapshotMismatchError({
        version: m.version,
        migrationName: m.name,
        expectedSnapshot: targetSnap,
        actualSnapshot: mSnap,
        diffs: ops,
        message: `Snapshot contract validation failed for migration ${m.version} ("${m.name}"): migration snapshot conflicts with target schema snapshot (${ops.length} change op(s) detected)`,
      });
    }
  }

  if (options?.validateSnapshot) {
    const result = options.validateSnapshot(mSnap, targetSnap, m);
    if (result === false) {
      throw new SnapshotMismatchError({
        version: m.version,
        migrationName: m.name,
        expectedSnapshot: targetSnap,
        actualSnapshot: mSnap,
        message: `Snapshot contract validation failed for migration ${m.version} ("${m.name}"): custom snapshot validator returned false`,
      });
    }
    if (typeof result === 'string') {
      throw new SnapshotMismatchError({
        version: m.version,
        migrationName: m.name,
        expectedSnapshot: targetSnap,
        actualSnapshot: mSnap,
        message: result,
      });
    }
  }
}

const DEFAULT_VERSION_TABLE = `CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT
)`;

function nonTransactionalDdlWarning(dialect: string | SqlDialect | undefined): string {
  const database =
    dialect === undefined ? 'the configured database' : typeof dialect === 'string' ? dialect : dialectName(dialect);
  return `${database} does not support transactional DDL; a failed migration may leave its schema changes partially applied even though its ledger row is absent`;
}

function dialectMigrationDriver<Name extends string>(
  dialect: SqlDialect<Name>,
  driver: MigrationDriver,
): DialectMigrationDriver<Name> {
  const transaction = driver.transaction;
  return {
    dialect,
    execute: query => driver.execute(query),
    ...(transaction === undefined
      ? {}
      : {
          transaction: <Result>(
            run: (transactionDriver: DialectMigrationDriver<Name>) => Promise<Result>,
          ): Promise<Result> => transaction(nested => run(dialectMigrationDriver(dialect, nested))),
        }),
  };
}

/**
 * Adapt any runtime database driver instance (e.g. PostgreSQL, SQLite)
 * into an asynchronous MigrationConnection.
 */
export function driverMigrationConnection(
  driver: MigrationDriver,
  dialect: DialectTarget = driver.dialect ?? 'postgres',
  options: MigrationTableOptions = {},
): MigrationConnection {
  if (isSqlDialect(dialect)) {
    return dialect.migrations.connection(dialectMigrationDriver(dialect, driver), options);
  }
  const capabilities = dialectCapabilities(dialect);
  const selectedName = dialectName(dialect);
  const tableName = options.table ?? '_zmdb_migrations';
  const qualifiedTableName = options.schema === undefined ? tableName : `${options.schema}.${tableName}`;
  const table = quoteTable(dialect, qualifiedTableName);
  const placeholder = (position: number): string => formatPlaceholder(dialect, position);

  async function execute(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly Record<string, unknown>[]> {
    return driver.execute({ text, parameters });
  }

  async function appliedMigrations(): Promise<readonly AppliedMigration[]> {
    const rows = await execute(`SELECT version, name, checksum FROM ${table} ORDER BY version`);
    return rows.map((row, index) => {
      const version = row.version;
      const migrationName = row.name;
      const checksum = row.checksum;
      if (
        (typeof version !== 'number' && typeof version !== 'bigint' && typeof version !== 'string') ||
        typeof migrationName !== 'string' ||
        (checksum !== null && typeof checksum !== 'string')
      ) {
        throw new TypeError(`migration ledger row ${String(index)} has an invalid version, name or checksum`);
      }
      const numericVersion = Number(version);
      if (!Number.isSafeInteger(numericVersion)) {
        throw new TypeError(`migration ledger row ${String(index)} version is not a safe integer`);
      }
      return { version: numericVersion, name: migrationName, checksum };
    });
  }

  async function transaction<T>(run: (connection?: MigrationConnection) => Promise<T>): Promise<T> {
    if (!capabilities.transactionalDdl) return run();
    if (driver.transaction !== undefined) {
      return driver.transaction(transactionDriver =>
        run(driverMigrationConnection(transactionDriver, dialect, options)),
      );
    }
    throw new Error(
      `${selectedName} migrations require a transactional driver; ` +
        'the driver must pin every callback query to one database transaction',
    );
  }

  return {
    dialect,
    transactionalDdl: capabilities.transactionalDdl,
    async exec(sql: string): Promise<void> {
      await execute(sql);
    },
    async appliedVersions(): Promise<readonly number[]> {
      return (await appliedMigrations()).map(row => row.version);
    },
    appliedMigrations,
    async recordApplied(version: number, migrationName: string, checksum?: string): Promise<void> {
      await execute(
        `INSERT INTO ${table} (version, name, applied_at, checksum) VALUES (` +
          `${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)}, ${placeholder(4)})`,
        [version, migrationName, Date.now(), checksum ?? null],
      );
    },
    async recordReverted(version: number): Promise<void> {
      await execute(`DELETE FROM ${table} WHERE ${quoteIdentifier(dialect, 'version')} = ${placeholder(1)}`, [version]);
    },
    async ensureVersionTable(): Promise<void> {
      if (selectedName === 'mssql') {
        const objectName = qualifiedTableName.replaceAll("'", "''");
        await execute(
          `IF OBJECT_ID(N'${objectName}', N'U') IS NULL ` +
            `CREATE TABLE ${table} (` +
            `${quoteIdentifier(dialect, 'version')} BIGINT PRIMARY KEY, ` +
            `${quoteIdentifier(dialect, 'name')} NVARCHAR(MAX) NOT NULL, ` +
            `${quoteIdentifier(dialect, 'applied_at')} BIGINT NOT NULL, ` +
            `${quoteIdentifier(dialect, 'checksum')} NVARCHAR(MAX))`,
        );
        try {
          await execute(`SELECT ${quoteIdentifier(dialect, 'checksum')} FROM ${table} WHERE 1 = 0`);
        } catch {
          await execute(`ALTER TABLE ${table} ADD ${quoteIdentifier(dialect, 'checksum')} NVARCHAR(MAX)`);
        }
        return;
      }
      const versionType = selectedName === 'sqlite' ? 'INTEGER' : 'BIGINT';
      await execute(
        `CREATE TABLE IF NOT EXISTS ${table} (` +
          `version ${versionType} PRIMARY KEY, ` +
          'name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT)',
      );
      if (dialectFamily(dialect) === 'postgres') {
        await execute(`ALTER TABLE ${table} ALTER COLUMN version TYPE BIGINT`);
      } else if (dialectFamily(dialect) === 'mysql') {
        await execute(`ALTER TABLE ${table} MODIFY COLUMN version BIGINT NOT NULL`);
      }
      try {
        await execute(`SELECT checksum FROM ${table} WHERE 1 = 0`);
      } catch {
        await execute(`ALTER TABLE ${table} ADD COLUMN checksum TEXT`);
      }
    },
    checksum: migrationChecksum,
    transaction,
  };
}

export async function ensureVersionTable(conn: MigrationConnection): Promise<void> {
  if (conn.ensureVersionTable !== undefined) {
    await conn.ensureVersionTable();
    return;
  }
  await conn.exec(DEFAULT_VERSION_TABLE);
}

/** Apply all pending migrations in ascending version order. */
export async function up(
  conn: MigrationConnection,
  migrations: readonly Migration[],
  options?: MigrationRunnerOptions | SchemaSnapshot,
): Promise<number[]> {
  assertUniqueVersions(migrations);
  await ensureVersionTable(conn);
  const ledger = await verifiedLedger(conn, migrations);
  const applied = new Set(ledger.map(row => row.version));
  const pending = [...migrations].filter(migration => !applied.has(migration.version)).toSorted(byVersion);
  const runnerOpts = normalizeOptions(options);
  if (pending.length > 0 && conn.transactionalDdl === false) {
    runnerOpts?.onWarning?.(nonTransactionalDdlWarning(conn.dialect));
  }

  const done: number[] = [];
  for (const migration of pending) {
    validateSnapshotCompatibility(migration, options);
    const checksum = conn.checksum === undefined ? undefined : await conn.checksum(migration.up);
    try {
      await inTransaction(conn, async transaction => {
        await transaction.exec(migration.up);
        await transaction.recordApplied(migration.version, migration.name, checksum);
      });
    } catch (error) {
      throw migrationFailure('apply', migration, error);
    }
    done.push(migration.version);
  }
  return done;
}

/** Roll back the single most-recently applied migration. */
export async function down(
  conn: MigrationConnection,
  migrations: readonly Migration[],
  _options?: MigrationRunnerOptions | SchemaSnapshot,
): Promise<number | undefined> {
  assertUniqueVersions(migrations);
  await ensureVersionTable(conn);
  const applied = [...(await verifiedLedger(conn, migrations))].toSorted((left, right) => right.version - left.version);
  const latest = applied[0];
  if (latest === undefined) return undefined;
  const migration = migrations.find(candidate => candidate.version === latest.version);
  if (migration === undefined) throw new Error(`no migration definition for applied version ${String(latest.version)}`);
  if (migration.down.trim().length === 0) {
    throw new Error(`migration ${String(migration.version)} ${migration.name} has no -- zmdb:down section`);
  }

  try {
    await inTransaction(conn, async transaction => {
      await transaction.exec(migration.down);
      await transaction.recordReverted(latest.version);
    });
  } catch (error) {
    throw migrationFailure('revert', migration, error);
  }
  return latest.version;
}

/** Roll back every applied migration newer than `target`, newest first. */
export async function downTo(
  conn: MigrationConnection,
  migrations: readonly Migration[],
  target: number,
): Promise<number[]> {
  const reverted: number[] = [];
  while (true) {
    const applied = (await status(conn, migrations)).filter(item => item.applied).map(item => item.version);
    const latest = applied.at(-1);
    if (latest === undefined || latest <= target) return reverted;
    const version = await down(conn, migrations);
    if (version === undefined) return reverted;
    reverted.push(version);
  }
}

export async function status(
  conn: MigrationConnection,
  migrations: readonly Migration[],
  _options?: MigrationRunnerOptions | SchemaSnapshot,
): Promise<MigrationStatus[]> {
  assertUniqueVersions(migrations);
  await ensureVersionTable(conn);
  const applied = new Set((await verifiedLedger(conn, migrations)).map(row => row.version));
  return [...migrations].toSorted(byVersion).map(migration => {
    const mSnap = migration.targetSnapshot ?? migration.snapshot;
    return {
      version: migration.version,
      name: migration.name,
      applied: applied.has(migration.version),
      ...(mSnap !== undefined ? { snapshotBound: true } : {}),
    };
  });
}

// Thin CLI dispatch (verb → runner call). Returns a human-readable line.
export async function runCli(
  verb: 'up' | 'down' | 'status',
  conn: MigrationConnection,
  migrations: readonly Migration[],
  options?: MigrationRunnerOptions | SchemaSnapshot,
): Promise<string> {
  switch (verb) {
    case 'up': {
      const done = await up(conn, migrations, options);
      return `applied: ${done.join(', ') || '(none)'}`;
    }
    case 'down': {
      const version = await down(conn, migrations, options);
      return version === undefined ? 'nothing to roll back' : `reverted: ${String(version)}`;
    }
    case 'status': {
      const migrationStatus = await status(conn, migrations, options);
      return migrationStatus
        .map(item => `${item.applied ? '[x]' : '[ ]'} ${String(item.version)} ${item.name}`)
        .join('\n');
    }
  }
}

async function verifiedLedger(
  conn: MigrationConnection,
  migrations: readonly Migration[],
): Promise<readonly AppliedMigration[]> {
  const rows =
    conn.appliedMigrations === undefined
      ? (await conn.appliedVersions()).map(version => ({ version, name: '', checksum: null }))
      : await conn.appliedMigrations();
  const byMigrationVersion = new Map(migrations.map(migration => [migration.version, migration]));

  for (const row of rows) {
    if (row.checksum === null) continue;
    const migration = byMigrationVersion.get(row.version);
    if (migration === undefined) continue;
    if (conn.checksum === undefined) {
      throw new Error(
        `migration ${String(row.version)} ${migration.name} has a checksum, but this connection cannot verify it`,
      );
    }
    const actual = await conn.checksum(migration.up);
    if (actual !== row.checksum) {
      throw new Error(
        `migration ${String(row.version)} ${migration.name} was edited after it was applied: ` +
          `ledger has ${row.checksum}, file has ${actual}`,
      );
    }
  }
  return rows;
}

async function migrationChecksum(sql: string): Promise<string> {
  const bytes = new TextEncoder().encode(sql);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function assertUniqueVersions(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version)) {
      throw new TypeError(`migration ${migration.name} version ${String(migration.version)} is not a safe integer`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${String(migration.version)}`);
    }
    seen.add(migration.version);
  }
}

async function inTransaction<T>(
  conn: MigrationConnection,
  run: (connection: MigrationConnection) => Promise<T>,
): Promise<T> {
  if (conn.transaction === undefined) return run(conn);
  return conn.transaction(transaction => run(transaction ?? conn));
}

function byVersion(left: Migration, right: Migration): number {
  return left.version - right.version;
}

function migrationFailure(action: 'apply' | 'revert', migration: Migration, error: unknown): Error {
  const sql = action === 'apply' ? migration.up : migration.down;
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `failed to ${action} migration ${String(migration.version)} ${migration.name}: ${reason}\nSQL:\n${sql}`,
    { cause: error },
  );
}
