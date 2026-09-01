// #44 — async migration runner + version tracking + driver adapter.
// Applies/rolls back ordered migrations against an async connection or
// adapted database driver, recording applied versions in _zmdb_migrations.

import { SnapshotMismatchError } from '../errors.js';
import {
  createQueryCompiler,
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
import { diff, snapshot, type SchemaSnapshot, type SnapshotableSchema } from './index.js';

export { SnapshotMismatchError };

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
  const qb = createQueryCompiler(dialect);
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
      const query = qb.deleteFrom(qualifiedTableName).where('version', '=', version);
      await driver.execute(query.compile());
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
