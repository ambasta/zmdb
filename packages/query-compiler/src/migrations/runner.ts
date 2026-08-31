// #44 — async migration runner + version tracking + driver adapter.
// Applies/rolls back ordered migrations against an async connection or
// adapted database driver, recording applied versions in _zmdb_migrations table.

import { createQueryCompiler, type CompiledQuery, type Dialect } from '../index.ts';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string; // SQL
  readonly down: string; // SQL
}

// Minimal async-compatible connection the runner needs.
export interface MigrationConnection {
  exec(sql: string): Promise<void> | void;
  appliedVersions(): Promise<readonly number[]> | readonly number[];
  recordApplied(version: number, name: string): Promise<void> | void;
  recordReverted(version: number): Promise<void> | void;
}

// Interface matching any runtime database driver (e.g. from @zmdb/repository).
export interface MigrationDriver {
  readonly dialect?: Dialect;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

export interface MigrationStatus {
  readonly version: number;
  readonly name: string;
  readonly applied: boolean;
}

/**
 * Adapt any runtime database driver instance (e.g. PostgreSQL, SQLite)
 * into an asynchronous MigrationConnection.
 */
export function driverMigrationConnection(
  driver: MigrationDriver,
  dialect: Dialect = driver.dialect ?? 'postgres',
): MigrationConnection {
  const qb = createQueryCompiler(dialect);

  return {
    async exec(sql: string): Promise<void> {
      await driver.execute({ text: sql, parameters: [] });
    },
    async appliedVersions(): Promise<readonly number[]> {
      const q = qb.selectFrom('_zmdb_migrations').select(['version']).orderBy('version', 'asc').compile();
      const rows = await driver.execute(q);
      return rows.map(r => Number(r.version));
    },
    async recordApplied(version: number, name: string): Promise<void> {
      const q = qb.insertInto('_zmdb_migrations').values({ version, name, applied_at: Date.now() }).compile();
      await driver.execute(q);
    },
    async recordReverted(version: number): Promise<void> {
      const q = qb.deleteFrom('_zmdb_migrations').where('version', '=', version).compile();
      await driver.execute(q);
    },
  };
}

export async function ensureVersionTable(conn: MigrationConnection): Promise<void> {
  await conn.exec(VERSION_TABLE);
}

// Apply all pending migrations (version > max applied), in order.
export async function up(conn: MigrationConnection, migrations: readonly Migration[]): Promise<number[]> {
  await ensureVersionTable(conn);
  const applied = new Set(await conn.appliedVersions());
  const pending = [...migrations].filter(m => !applied.has(m.version)).toSorted((a, b) => a.version - b.version);
  const done: number[] = [];
  for (const m of pending) {
    await conn.exec(m.up);
    await conn.recordApplied(m.version, m.name);
    done.push(m.version);
  }
  return done;
}

// Roll back the single most-recently applied migration.
export async function down(conn: MigrationConnection, migrations: readonly Migration[]): Promise<number | undefined> {
  await ensureVersionTable(conn);
  const applied = [...(await conn.appliedVersions())].toSorted((a, b) => b - a);
  const latest = applied[0];
  if (latest === undefined) return undefined;
  const m = migrations.find(x => x.version === latest);
  if (!m) throw new Error(`no migration definition for applied version ${latest}`);
  await conn.exec(m.down);
  await conn.recordReverted(latest);
  return latest;
}

export async function status(conn: MigrationConnection, migrations: readonly Migration[]): Promise<MigrationStatus[]> {
  await ensureVersionTable(conn);
  const applied = new Set(await conn.appliedVersions());
  return [...migrations]
    .toSorted((a, b) => a.version - b.version)
    .map(m => ({ version: m.version, name: m.name, applied: applied.has(m.version) }));
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
      const v = await down(conn, migrations);
      return v === undefined ? 'nothing to roll back' : `reverted: ${v}`;
    }
    case 'status': {
      const st = await status(conn, migrations);
      return st.map(s => `${s.applied ? '[x]' : '[ ]'} ${s.version} ${s.name}`).join('\n');
    }
  }
}
