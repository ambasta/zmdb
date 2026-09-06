import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EmbeddedMigrationError,
  runEmbedded,
  type EmbeddedConnection,
  type EmbeddedMigration,
} from '@zmdb/sqlite/embedded';
import { describe, expect, it } from 'vitest';

const PACKAGE = resolve(new URL('../', import.meta.url).pathname, 'package.json');
const MIGRATIONS_EMBEDDED = resolve(dirname(PACKAGE), '../migrations/src/embedded.ts');

function connection(db: DatabaseSync, events?: string[]): EmbeddedConnection {
  return {
    async exec(sql): Promise<void> {
      events?.push(sql);
      db.exec(sql);
    },
    async run(sql, params): Promise<void> {
      events?.push('ledger insert');
      db.prepare(sql).run(...params);
    },
    async rows(sql, params): Promise<readonly Record<string, unknown>[]> {
      return db.prepare(sql).all(...params) as Record<string, unknown>[];
    },
  };
}

const CREATE_USERS: EmbeddedMigration = {
  version: 20260905090000,
  name: 'create_users',
  up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
  checksum: 'sha256:create-users',
};

const ADD_EMAIL: EmbeddedMigration = {
  version: 20260905090100,
  name: 'add_email',
  up: 'ALTER TABLE users ADD COLUMN email TEXT',
  checksum: 'sha256:add-email',
};

async function rejection(promise: Promise<unknown>): Promise<EmbeddedMigrationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EmbeddedMigrationError) return error;
    throw error;
  }
  throw new Error('expected the embedded runner to reject');
}

describe('embedded migrations (real SQLite, no filesystem)', () => {
  it('applies embedded migrations in order and records them in the on-device ledger', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      expect(await runEmbedded(connection(db), [ADD_EMAIL, CREATE_USERS])).toEqual([
        CREATE_USERS.version,
        ADD_EMAIL.version,
      ]);
      expect(
        db
          .prepare("PRAGMA table_info('users')")
          .all()
          .map(column => column.name),
      ).toEqual(['id', 'email']);
      expect(
        db
          .prepare('SELECT version, name, checksum FROM _zmdb_migrations ORDER BY version')
          .all()
          .map(row => ({ ...row })),
      ).toEqual([
        {
          version: CREATE_USERS.version,
          name: CREATE_USERS.name,
          checksum: CREATE_USERS.checksum,
        },
        {
          version: ADD_EMAIL.version,
          name: ADD_EMAIL.name,
          checksum: ADD_EMAIL.checksum,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('applies each migration in a transaction on sqlite', async () => {
    const db = new DatabaseSync(':memory:');
    const events: string[] = [];
    try {
      await runEmbedded(connection(db, events), [CREATE_USERS, ADD_EMAIL]);
      expect(events.slice(events.indexOf('BEGIN'))).toEqual([
        'BEGIN',
        CREATE_USERS.up,
        'ledger insert',
        'COMMIT',
        'BEGIN',
        ADD_EMAIL.up,
        'ledger insert',
        'COMMIT',
      ]);
    } finally {
      db.close();
    }
  });

  it('rolls back a failed migration body and its ledger row', async () => {
    const db = new DatabaseSync(':memory:');
    const broken: EmbeddedMigration = {
      version: 20260905090200,
      name: 'broken',
      up: 'CREATE TABLE partial (id INTEGER PRIMARY KEY); THIS IS NOT SQL',
      checksum: 'sha256:broken',
    };
    try {
      await expect(runEmbedded(connection(db), [broken])).rejects.toThrow(
        `failed to apply embedded migration ${String(broken.version)} ${broken.name}`,
      );
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial'").get(),
      ).toBeUndefined();
      expect(db.prepare('SELECT version FROM _zmdb_migrations').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('refuses to apply an embedded migration whose checksum changed', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      await runEmbedded(connection(db), [CREATE_USERS]);
      const changed = { ...CREATE_USERS, checksum: 'sha256:edited-after-release' };
      const error = await rejection(runEmbedded(connection(db), [changed]));
      expect(error).toBeInstanceOf(EmbeddedMigrationError);
      expect(error).toMatchObject({ kind: 'checksum' });
      expect(error.message).toContain(String(CREATE_USERS.version));
      expect(error.message).toContain(CREATE_USERS.name);
      expect(error.message).toContain(CREATE_USERS.checksum);
      expect(error.message).toContain(changed.checksum);
    } finally {
      db.close();
    }
  });

  it('accepts legacy ledger rows with no checksum and adds the checksum column', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY);
        CREATE TABLE _zmdb_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
        INSERT INTO _zmdb_migrations(version, name, applied_at)
        VALUES (${String(CREATE_USERS.version)}, '${CREATE_USERS.name}', 0);
      `);
      await expect(runEmbedded(connection(db), [CREATE_USERS, ADD_EMAIL])).resolves.toEqual([ADD_EMAIL.version]);
      expect(
        db
          .prepare("SELECT name FROM pragma_table_info('_zmdb_migrations') ORDER BY cid")
          .all()
          .map(row => row.name),
      ).toEqual(['version', 'name', 'applied_at', 'checksum']);
      expect(db.prepare('SELECT version, checksum FROM _zmdb_migrations ORDER BY version').all()).toEqual([
        { version: CREATE_USERS.version, checksum: null },
        { version: ADD_EMAIL.version, checksum: ADD_EMAIL.checksum },
      ]);
    } finally {
      db.close();
    }
  });

  it('refuses duplicate bundled versions before touching the database', async () => {
    let calls = 0;
    const unused: EmbeddedConnection = {
      async exec(): Promise<void> {
        calls += 1;
      },
      async run(): Promise<void> {
        calls += 1;
      },
      async rows(): Promise<readonly Record<string, unknown>[]> {
        calls += 1;
        return [];
      },
    };
    const duplicate = { ...CREATE_USERS, name: 'same_version_again' };
    const error = await rejection(runEmbedded(unused, [CREATE_USERS, duplicate]));
    expect(error).toMatchObject({ kind: 'duplicate' });
    expect(error.message).toContain(String(CREATE_USERS.version));
    expect(calls).toBe(0);
  });

  it('reports an incompatible ledger shape before applying a migration', async () => {
    const events: string[] = [];
    const malformed: EmbeddedConnection = {
      async exec(sql): Promise<void> {
        events.push(sql);
      },
      async run(): Promise<void> {
        events.push('run');
      },
      async rows(sql): Promise<readonly Record<string, unknown>[]> {
        events.push(sql);
        return [{ name: 'version' }, { name: 'name' }];
      },
    };
    const error = await rejection(runEmbedded(malformed, [CREATE_USERS]));
    expect(error).toMatchObject({ kind: 'ledger-shape' });
    expect(error.message).toContain('applied_at');
    expect(events).toHaveLength(1);
  });

  it('errors when the ledger contains an id the bundle does not have', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE _zmdb_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL,
          checksum TEXT
        );
        INSERT INTO _zmdb_migrations(version, name, applied_at, checksum)
        VALUES (20260905090200, 'from_the_future', 0, 'sha256:future');
      `);
      const error = await rejection(runEmbedded(connection(db), [CREATE_USERS]));
      expect(error).toBeInstanceOf(EmbeddedMigrationError);
      expect(error).toMatchObject({ kind: 'ledger-ahead' });
      expect(error.message).toContain('20260905090200');
      expect(error.message).toContain(String(CREATE_USERS.version));
      expect(error.message).toContain('older than the database');
    } finally {
      db.close();
    }
  });

  it('runs through a browser-SQLite async driver shape without Node APIs', async () => {
    const columns = ['version', 'name', 'applied_at', 'checksum'];
    const ledger: Record<string, unknown>[] = [];
    const events: string[] = [];
    const browser = {
      async execAsync(sql: string): Promise<void> {
        events.push(sql);
      },
      async runAsync(sql: string, ...params: readonly (string | number | null)[]): Promise<void> {
        events.push(sql);
        ledger.push({
          version: params[0],
          name: params[1],
          applied_at: params[2],
          checksum: params[3],
        });
      },
      async getAllAsync(sql: string): Promise<readonly Record<string, unknown>[]> {
        events.push(sql);
        return sql.includes('pragma_table_info') ? columns.map(name => ({ name })) : ledger;
      },
    };
    const browserConnection: EmbeddedConnection = {
      exec: sql => browser.execAsync(sql),
      run: (sql, params) => browser.runAsync(sql, ...params),
      rows: sql => browser.getAllAsync(sql),
    };

    await expect(runEmbedded(browserConnection, [CREATE_USERS])).resolves.toEqual([CREATE_USERS.version]);
    expect(ledger).toEqual([
      {
        version: CREATE_USERS.version,
        name: CREATE_USERS.name,
        applied_at: expect.any(Number),
        checksum: CREATE_USERS.checksum,
      },
    ]);
    expect(events).toContain(CREATE_USERS.up);
  });

  it("delegates to the migrations package's filesystem-free embedded leaf", () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
      exports: Readonly<Record<string, string>>;
    };
    const exported = packageJson.exports['./embedded'];
    expect(exported).toBe('./src/embedded.ts');
    if (exported === undefined) throw new Error('missing embedded migration export');
    const entry = resolve(dirname(PACKAGE), exported);
    expect(moduleGraph(entry)).toEqual([entry, MIGRATIONS_EMBEDDED].toSorted());
  });
});

function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (specifier === '@zmdb/migrations/embedded') {
        pending.push(MIGRATIONS_EMBEDDED);
        continue;
      }
      if (!specifier.startsWith('.')) {
        throw new Error(`embedded runner imports non-relative module "${specifier}"`);
      }
      pending.push(resolveModule(file, specifier));
    }
  }
  return [...seen].toSorted();
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    if (specifier !== undefined) specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (specifier !== undefined) specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return [...new Set(specifiers)];
}

function resolveModule(from: string, specifier: string): string {
  const raw = resolve(dirname(from), specifier);
  const candidates = [raw, raw.endsWith('.js') ? `${raw.slice(0, -3)}.ts` : `${raw}.ts`, resolve(raw, 'index.ts')];
  const found = candidates.find(candidate => existsSync(candidate));
  if (found === undefined) throw new Error(`cannot resolve "${specifier}" from ${from}`);
  return found;
}
