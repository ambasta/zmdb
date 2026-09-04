import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { pgDriver, type PgQueryable } from '../../../repository/src/drivers/pg.js';
import { sqliteDriver } from '../../../repository/src/drivers/sqlite.js';
import {
  down,
  driverMigrationConnection,
  runCli,
  status,
  type Migration,
  ensureVersionTable,
  type MigrationConnection,
  up,
} from './runner.js';

// #44: async migration runner + CLI + version tracking + E2E (real SQLite & PG adapter).

function sqliteMigrationConn(db: DatabaseSync): MigrationConnection {
  return {
    exec: sql => db.exec(sql),
    appliedVersions: () =>
      (db.prepare('SELECT version FROM _zmdb_migrations ORDER BY version').all() as { version: number }[]).map(
        r => r.version,
      ),
    recordApplied: (version, name) => {
      db.prepare('INSERT INTO _zmdb_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        name,
        Date.now(),
      );
    },
    recordReverted: version => {
      db.prepare('DELETE FROM _zmdb_migrations WHERE version = ?').run(version);
    },
  };
}

const migrations: Migration[] = [
  { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
  {
    version: 2,
    name: 'add_email',
    up: 'ALTER TABLE users ADD COLUMN email TEXT',
    down: 'ALTER TABLE users DROP COLUMN email',
  },
];

let db: DatabaseSync;
let conn: MigrationConnection;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  conn = sqliteMigrationConn(db);
});

function tableInfo(): string[] {
  return (db.prepare("PRAGMA table_info('users')").all() as { name: string }[]).map(r => r.name);
}

describe('migration runner E2E (real SQLite connection)', () => {
  it('creates the version table, and creating it again is not an error', async () => {
    // Kysely tests this because every one of its migrate* entry points calls it first and
    // one of them running against a fresh database is the normal case, not the edge one.
    // The same is true here — `up`, `down` and `status` each begin with this call, so it
    // has to be safe to make a second time or the second deploy fails.
    await ensureVersionTable(conn);
    expect(await conn.appliedVersions()).toEqual([]);
    await ensureVersionTable(conn);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_zmdb_migrations'").all(),
    ).toHaveLength(1);
  });

  it('up applies all pending migrations and records versions asynchronously', async () => {
    expect(await up(conn, migrations)).toEqual([1, 2]);
    expect(await conn.appliedVersions()).toEqual([1, 2]);
    expect(tableInfo()).toEqual(['id', 'email']);
  });

  it('up is idempotent (re-running applies nothing)', async () => {
    await up(conn, migrations);
    expect(await up(conn, migrations)).toEqual([]);
  });

  it('down rolls back the latest migration asynchronously', async () => {
    await up(conn, migrations);
    expect(await down(conn, migrations)).toBe(2);
    expect(await conn.appliedVersions()).toEqual([1]);
    expect(tableInfo()).toEqual(['id']);
  });

  it('status reflects applied vs pending asynchronously', async () => {
    const first = migrations[0];
    if (!first) throw new Error('Expected first migration');
    await up(conn, [first]); // only v1
    const s = await status(conn, migrations);
    expect(s).toEqual([
      { version: 1, name: 'create_users', applied: true },
      { version: 2, name: 'add_email', applied: false },
    ]);
  });

  it('executes migrations in ascending version order regardless of input array ordering', async () => {
    const unorderedMigrations: Migration[] = [
      {
        version: 2,
        name: 'add_email',
        up: 'ALTER TABLE users ADD COLUMN email TEXT',
        down: 'ALTER TABLE users DROP COLUMN email',
      },
      { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
    ];

    const applied = await up(conn, unorderedMigrations);
    expect(applied).toEqual([1, 2]);

    const st = await status(conn, unorderedMigrations);
    expect(st.map(s => s.version)).toEqual([1, 2]);

    const reverted = await down(conn, unorderedMigrations);
    expect(reverted).toBe(2);
  });

  it('handles failure partway through a batch: records completed migrations, halts remaining, and resumes after fix', async () => {
    const batchMigrations: Migration[] = [
      { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
      { version: 2, name: 'bad_sql', up: 'INVALID SQL STATEMENT', down: 'SELECT 1' },
      { version: 3, name: 'add_posts', up: 'CREATE TABLE posts (id INTEGER PRIMARY KEY)', down: 'DROP TABLE posts' },
    ];

    await expect(up(conn, batchMigrations)).rejects.toThrow();

    // v1 succeeded and is recorded; v2 failed and is not recorded; v3 was not executed
    expect(await conn.appliedVersions()).toEqual([1]);
    expect(tableInfo()).toEqual(['id']);

    // Fix v2 and re-run up
    const fixedMigrations: Migration[] = [
      { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
      {
        version: 2,
        name: 'add_email',
        up: 'ALTER TABLE users ADD COLUMN email TEXT',
        down: 'ALTER TABLE users DROP COLUMN email',
      },
      { version: 3, name: 'add_posts', up: 'CREATE TABLE posts (id INTEGER PRIMARY KEY)', down: 'DROP TABLE posts' },
    ];

    const resumedApplied = await up(conn, fixedMigrations);
    expect(resumedApplied).toEqual([2, 3]);
    expect(await conn.appliedVersions()).toEqual([1, 2, 3]);
    expect(tableInfo()).toEqual(['id', 'email']);
  });

  it('handles failure during down rollback: does not revert recorded version if execution fails', async () => {
    await up(conn, migrations);

    const badDownMigrations: Migration[] = [
      { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
      { version: 2, name: 'add_email', up: 'ALTER TABLE users ADD COLUMN email TEXT', down: 'INVALID ROLLBACK SQL' },
    ];

    await expect(down(conn, badDownMigrations)).rejects.toThrow();
    expect(await conn.appliedVersions()).toEqual([1, 2]);
  });

  it('CLI dispatch: up → status → down', async () => {
    expect(await runCli('up', conn, migrations)).toBe('applied: 1, 2');
    expect(await runCli('status', conn, migrations)).toContain('[x] 1 create_users');
    expect(await runCli('down', conn, migrations)).toBe('reverted: 2');
  });
});

describe('Native Driver Adapter (driverMigrationConnection)', () => {
  it('executes schema migrations asynchronously using SQLite driver instance', async () => {
    const sqliteDb = new DatabaseSync(':memory:');
    const driver = sqliteDriver(sqliteDb);
    const adapterConn = driverMigrationConnection(driver);

    // Apply migrations asynchronously
    const applied = await up(adapterConn, migrations);
    expect(applied).toEqual([1, 2]);

    // Query applied versions asynchronously
    const versions = await adapterConn.appliedVersions();
    expect(versions).toEqual([1, 2]);

    // Check status asynchronously
    const st = await status(adapterConn, migrations);
    expect(st).toEqual([
      { version: 1, name: 'create_users', applied: true },
      { version: 2, name: 'add_email', applied: true },
    ]);

    // Revert migration asynchronously
    const reverted = await down(adapterConn, migrations);
    expect(reverted).toBe(2);
    expect(await adapterConn.appliedVersions()).toEqual([1]);
  });

  it('executes schema migrations asynchronously using PostgreSQL driver instance', async () => {
    const executedQueries: { text: string; params?: readonly unknown[] }[] = [];
    const migrationsTable: { version: number; name: string; applied_at: number }[] = [];

    const mockPgClient: PgQueryable = {
      async query(arg1: string | { text: string; values?: readonly unknown[] }, arg2?: readonly unknown[]) {
        const text = typeof arg1 === 'string' ? arg1 : arg1.text;
        const params = typeof arg1 === 'string' ? arg2 : arg1.values;
        if (params !== undefined) {
          executedQueries.push({ text, params });
        } else {
          executedQueries.push({ text });
        }

        if (/SELECT "version" FROM "_zmdb_migrations"/i.test(text)) {
          return { rows: migrationsTable.toSorted((a, b) => a.version - b.version) };
        }
        if (/INSERT INTO "_zmdb_migrations"/i.test(text) && params) {
          migrationsTable.push({
            version: params[0] as number,
            name: params[1] as string,
            applied_at: params[2] as number,
          });
          return { rows: [] };
        }
        if (/DELETE FROM "_zmdb_migrations"/i.test(text) && params) {
          const idx = migrationsTable.findIndex(r => r.version === params[0]);
          if (idx !== -1) migrationsTable.splice(idx, 1);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const driver = pgDriver(mockPgClient);
    const adapterConn = driverMigrationConnection(driver);

    // Up
    const applied = await up(adapterConn, migrations);
    expect(applied).toEqual([1, 2]);

    // Verify DDL execution against wrapped PG driver
    const createTableQuery = executedQueries.find(q => q.text.includes('CREATE TABLE users'));
    const alterTableQuery = executedQueries.find(q => q.text.includes('ALTER TABLE users ADD COLUMN email'));
    expect(createTableQuery).toBeDefined();
    expect(alterTableQuery).toBeDefined();

    // Verify PostgreSQL placeholders ($1, $2, $3) were used for version records
    const insertQuery = executedQueries.find(q => q.text.includes('INSERT INTO "_zmdb_migrations"'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.text).toContain('$1');
    expect(insertQuery?.text).toContain('$2');
    expect(insertQuery?.text).toContain('$3');

    // Down
    const reverted = await down(adapterConn, migrations);
    expect(reverted).toBe(2);

    const deleteQuery = executedQueries.find(q => q.text.includes('DELETE FROM "_zmdb_migrations"'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery?.text).toContain('$1');
  });
});
