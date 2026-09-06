// #44 — async migration runner + version tracking + driver adapter.
// Applies/rolls back ordered migrations against an async connection or
// adapted database driver, recording applied versions in _zmdb_migrations.

import {
  dialectName,
  type CompiledQuery,
  type MigrationDriver as DialectMigrationDriver,
  type SqlDialect,
} from '@zmdb/query-compiler';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  /** `null` identifies a ledger row written before checksums were introduced. */
  readonly checksum: string | null;
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
  readonly dialect: SqlDialect;
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
  dialect: SqlDialect = driver.dialect,
  options: MigrationTableOptions = {},
): MigrationConnection {
  return dialect.migrations.connection(dialectMigrationDriver(dialect, driver), options);
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
  options: MigrationRunOptions = {},
): Promise<number[]> {
  assertUniqueVersions(migrations);
  await ensureVersionTable(conn);
  const ledger = await verifiedLedger(conn, migrations);
  const applied = new Set(ledger.map(row => row.version));
  const pending = [...migrations].filter(migration => !applied.has(migration.version)).toSorted(byVersion);
  if (pending.length > 0 && conn.transactionalDdl === false) {
    options.onWarning?.(nonTransactionalDdlWarning(conn.dialect));
  }

  const done: number[] = [];
  for (const migration of pending) {
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
export async function down(conn: MigrationConnection, migrations: readonly Migration[]): Promise<number | undefined> {
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

/** Public lifecycle name for reverting every applied migration above a target version. */
export const rollbackTo = downTo;

export async function status(conn: MigrationConnection, migrations: readonly Migration[]): Promise<MigrationStatus[]> {
  assertUniqueVersions(migrations);
  await ensureVersionTable(conn);
  const applied = new Set((await verifiedLedger(conn, migrations)).map(row => row.version));
  return [...migrations]
    .toSorted(byVersion)
    .map(migration => ({ version: migration.version, name: migration.name, applied: applied.has(migration.version) }));
}

// Thin CLI dispatch (verb → runner call). Returns a human-readable line.
export async function runCli(
  verb: 'up' | 'down' | 'status',
  conn: MigrationConnection,
  migrations: readonly Migration[],
): Promise<string> {
  switch (verb) {
    case 'up': {
      const done = await up(conn, migrations);
      return `applied: ${done.join(', ') || '(none)'}`;
    }
    case 'down': {
      const version = await down(conn, migrations);
      return version === undefined ? 'nothing to roll back' : `reverted: ${String(version)}`;
    }
    case 'status': {
      const migrationStatus = await status(conn, migrations);
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
