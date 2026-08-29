import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { up, down, status, runCli, type Migration, type MigrationConnection } from './runner.ts';

// #44: migration runner + CLI + version tracking + E2E (real SQLite).

function sqliteMigrationConn(db: DatabaseSync): MigrationConnection {
  return {
    exec: (sql) => db.exec(sql),
    appliedVersions: () =>
      (db.prepare('SELECT version FROM _zmdb_migrations ORDER BY version').all() as { version: number }[]).map(
        (r) => r.version,
      ),
    recordApplied: (version, name) =>
      db.prepare('INSERT INTO _zmdb_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(version, name, Date.now()),
    recordReverted: (version) => db.prepare('DELETE FROM _zmdb_migrations WHERE version = ?').run(version),
  };
}

const migrations: Migration[] = [
  { version: 1, name: 'create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)', down: 'DROP TABLE users' },
  { version: 2, name: 'add_email', up: 'ALTER TABLE users ADD COLUMN email TEXT', down: 'ALTER TABLE users DROP COLUMN email' },
];

let db: DatabaseSync;
let conn: MigrationConnection;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  conn = sqliteMigrationConn(db);
});

function tableInfo(): string[] {
  return (db.prepare("PRAGMA table_info('users')").all() as { name: string }[]).map((r) => r.name);
}

describe('migration runner E2E (real SQLite)', () => {
  it('up applies all pending migrations and records versions', () => {
    expect(up(conn, migrations)).toEqual([1, 2]);
    expect(conn.appliedVersions()).toEqual([1, 2]);
    expect(tableInfo()).toEqual(['id', 'email']);
  });

  it('up is idempotent (re-running applies nothing)', () => {
    up(conn, migrations);
    expect(up(conn, migrations)).toEqual([]);
  });

  it('down rolls back the latest migration', () => {
    up(conn, migrations);
    expect(down(conn, migrations)).toBe(2);
    expect(conn.appliedVersions()).toEqual([1]);
    expect(tableInfo()).toEqual(['id']);
  });

  it('status reflects applied vs pending', () => {
    up(conn, [migrations[0]!]); // only v1
    const s = status(conn, migrations);
    expect(s).toEqual([
      { version: 1, name: 'create_users', applied: true },
      { version: 2, name: 'add_email', applied: false },
    ]);
  });

  it('CLI dispatch: up → status → down', () => {
    expect(runCli('up', conn, migrations)).toBe('applied: 1, 2');
    expect(runCli('status', conn, migrations)).toContain('[x] 1 create_users');
    expect(runCli('down', conn, migrations)).toBe('reverted: 2');
  });
});
