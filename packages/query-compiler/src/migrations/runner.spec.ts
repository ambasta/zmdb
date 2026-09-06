import { DatabaseSync } from 'node:sqlite';

import { sqlite, sqliteDriver } from '@zmdb/sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { postgresDriver as pgDriver, type PgQueryable } from '../../../postgres/src/index.js';
import {
  down,
  driverMigrationConnection,
  runCli,
  status,
  type Migration,
  ensureVersionTable,
  type MigrationConnection,
  type MigrationDriver,
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

  it('refuses to run when a previously applied migration file has changed', async () => {
    const database = new DatabaseSync(':memory:');
    const adapter = driverMigrationConnection(sqliteDriver(database), sqlite);
    const original: Migration = {
      version: 20260904010101,
      name: 'create_audit',
      up: 'CREATE TABLE audit (id INTEGER PRIMARY KEY)',
      down: 'DROP TABLE audit',
    };

    await expect(up(adapter, [original])).resolves.toEqual([original.version]);
    const ledger = database.prepare('SELECT version, checksum FROM _zmdb_migrations').get() as {
      version: number;
      checksum: string;
    };
    expect(ledger.version).toBe(original.version);
    expect(ledger.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

    await expect(
      up(adapter, [{ ...original, up: 'CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)' }]),
    ).rejects.toThrow(/edited after it was applied.*ledger has sha256:.*file has sha256:/);
  });

  it('warns before running on a dialect without transactional DDL', async () => {
    for (const dialect of ['mysql', 'singlestore'] as const) {
      const events: string[] = [];
      const connection: MigrationConnection = {
        dialect,
        transactionalDdl: false,
        exec: sql => {
          events.push(`exec:${sql}`);
        },
        appliedVersions: () => [],
        recordApplied: version => {
          events.push(`record:${String(version)}`);
        },
        recordReverted: () => undefined,
        ensureVersionTable: () => {
          events.push('ensure');
        },
      };

      await expect(
        up(connection, [migrations[0] as Migration], {
          onWarning: warning => events.push(`warning:${warning}`),
        }),
      ).resolves.toEqual([1]);
      expect(events[0], dialect).toBe('ensure');
      expect(events[1], dialect).toMatch(new RegExp(`^warning:${dialect} does not support transactional DDL`));
      expect(events[2], dialect).toMatch(/^exec:CREATE TABLE users/);
      expect(events[3], dialect).toBe('record:1');
    }
  });

  it('adds checksums to a ledger created by an older runner', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE _zmdb_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
    const adapter = driverMigrationConnection(sqliteDriver(database), sqlite);

    await ensureVersionTable(adapter);

    const columns = database
      .prepare("SELECT name FROM pragma_table_info('_zmdb_migrations')")
      .all()
      .map(row => Reflect.get(row, 'name'));
    expect(columns).toContain('checksum');
  });

  it('uses the configured ledger table for apply and rollback', async () => {
    const database = new DatabaseSync(':memory:');
    const adapter = driverMigrationConnection(sqliteDriver(database), sqlite, { table: 'migration_history' });
    const migration: Migration = {
      version: 20260905010101,
      name: 'create_notes',
      up: 'CREATE TABLE notes (id INTEGER PRIMARY KEY)',
      down: 'DROP TABLE notes',
    };

    await expect(up(adapter, [migration])).resolves.toEqual([migration.version]);
    expect(database.prepare('SELECT version FROM migration_history').all()).toEqual([{ version: migration.version }]);
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_zmdb_migrations'").get(),
    ).toBeUndefined();

    await expect(down(adapter, [migration])).resolves.toBe(migration.version);
    expect(database.prepare('SELECT version FROM migration_history').all()).toEqual([]);
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
    const migrationsTable: { version: number; name: string; applied_at: number; checksum: string | null }[] = [];

    const mockPgClient: PgQueryable = {
      async query(arg1: string | { text: string; values?: readonly unknown[] }, arg2?: readonly unknown[]) {
        const text = typeof arg1 === 'string' ? arg1 : arg1.text;
        const params = typeof arg1 === 'string' ? arg2 : arg1.values;
        if (params !== undefined) {
          executedQueries.push({ text, params });
        } else {
          executedQueries.push({ text });
        }

        if (/SELECT version, name, checksum FROM "_zmdb_migrations"/i.test(text)) {
          return { rows: migrationsTable.toSorted((a, b) => a.version - b.version) };
        }
        if (/INSERT INTO "_zmdb_migrations"/i.test(text) && params) {
          migrationsTable.push({
            version: params[0] as number,
            name: params[1] as string,
            applied_at: params[2] as number,
            checksum: params[3] as string | null,
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
    expect(executedQueries.findIndex(q => q.text === 'BEGIN')).toBeLessThan(
      executedQueries.findIndex(q => q.text.includes('CREATE TABLE users')),
    );
    expect(executedQueries.findIndex(q => q.text.includes('INSERT INTO "_zmdb_migrations"'))).toBeLessThan(
      executedQueries.findIndex(q => q.text === 'COMMIT'),
    );

    // Down
    const reverted = await down(adapterConn, migrations);
    expect(reverted).toBe(2);

    const deleteQuery = executedQueries.find(q => q.text.includes('DELETE FROM "_zmdb_migrations"'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery?.text).toContain('$1');
  });

  it('uses SQL Server ledger DDL and requires a transaction-pinning driver', async () => {
    const executed: string[] = [];
    const driver = {
      dialect: 'mssql' as const,
      async execute(query: { readonly text: string }): Promise<readonly Record<string, unknown>[]> {
        executed.push(query.text);
        return [];
      },
    };
    const adapter = driverMigrationConnection(driver, 'mssql', {
      schema: "audit's",
      table: 'migration]history',
    });

    await ensureVersionTable(adapter);

    expect(executed).toEqual([
      "IF OBJECT_ID(N'audit''s.migration]history', N'U') IS NULL " +
        "CREATE TABLE [audit's].[migration]]history] (" +
        '[version] BIGINT PRIMARY KEY, [name] NVARCHAR(MAX) NOT NULL, ' +
        '[applied_at] BIGINT NOT NULL, [checksum] NVARCHAR(MAX))',
      "SELECT [checksum] FROM [audit's].[migration]]history] WHERE 1 = 0",
    ]);
    await expect(adapter.transaction?.(async () => undefined)).rejects.toThrow(
      'mssql migrations require a transactional driver',
    );
    expect(executed).toHaveLength(2);
  });

  it('uses SQL Server syntax when adding checksum to an older ledger', async () => {
    const executed: string[] = [];
    const driver = {
      dialect: 'mssql' as const,
      async execute(query: { readonly text: string }): Promise<readonly Record<string, unknown>[]> {
        executed.push(query.text);
        if (query.text.startsWith('SELECT [checksum]')) throw new Error('invalid column');
        return [];
      },
    };

    await ensureVersionTable(driverMigrationConnection(driver, 'mssql'));

    expect(executed.at(-1)).toBe('ALTER TABLE [_zmdb_migrations] ADD [checksum] NVARCHAR(MAX)');
  });

  it('inherits migration ledger and transaction behavior for dialect variants', async () => {
    const singleStoreQueries: string[] = [];
    const singleStore = driverMigrationConnection(
      {
        dialect: 'singlestore',
        async execute(query): Promise<readonly Record<string, unknown>[]> {
          singleStoreQueries.push(query.text);
          return [];
        },
      },
      'singlestore',
    );

    await ensureVersionTable(singleStore);
    await expect(singleStore.transaction?.(async () => 'direct')).resolves.toBe('direct');
    expect(singleStore.transactionalDdl).toBe(false);
    expect(singleStoreQueries).toEqual([
      'CREATE TABLE IF NOT EXISTS `_zmdb_migrations` (' +
        'version BIGINT PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT)',
      'ALTER TABLE `_zmdb_migrations` MODIFY COLUMN version BIGINT NOT NULL',
      'SELECT checksum FROM `_zmdb_migrations` WHERE 1 = 0',
    ]);

    const cockroachQueries: string[] = [];
    let transactionCalls = 0;
    const cockroachDriver: MigrationDriver = {
      dialect: 'cockroach' as const,
      async execute(query: { readonly text: string }): Promise<readonly Record<string, unknown>[]> {
        cockroachQueries.push(query.text);
        return [];
      },
      async transaction<T>(run: (driver: MigrationDriver) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        return run(cockroachDriver);
      },
    };
    const cockroach = driverMigrationConnection(cockroachDriver, 'cockroach');

    await ensureVersionTable(cockroach);
    await expect(cockroach.transaction?.(async () => 'direct')).resolves.toBe('direct');
    expect(cockroach.transactionalDdl).toBe(false);
    expect(transactionCalls).toBe(0);
    expect(cockroachQueries).toEqual([
      'CREATE TABLE IF NOT EXISTS "_zmdb_migrations" (' +
        'version BIGINT PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT)',
      'ALTER TABLE "_zmdb_migrations" ALTER COLUMN version TYPE BIGINT',
      'SELECT checksum FROM "_zmdb_migrations" WHERE 1 = 0',
    ]);
  });
});
