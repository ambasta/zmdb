// Tests freeze for migrations/SPEC.md §5.
//
// The future module is loaded through the package subpath a device application
// will import. Today that real boundary throws ERR_PACKAGE_PATH_NOT_EXPORTED;
// there is no local runner stub that could make the SQLite assertions pass.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const PACKAGE = resolve(new URL('../../', import.meta.url).pathname, 'package.json');
const EMBEDDED = '@zmdb/query-compiler/migrations/embedded';

// FROZEN SURFACE — transcribed from SPEC.md §5.1 and §5.3 until the real
// package subpath exists. Values below are always real initialized objects.
interface EmbeddedMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly checksum: string;
}

interface EmbeddedConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}

interface EmbeddedMigrationError extends Error {
  readonly kind: 'duplicate' | 'checksum' | 'ledger-ahead' | 'ledger-shape';
}

interface EmbeddedModule {
  readonly EmbeddedMigrationError: new (...args: never[]) => EmbeddedMigrationError;
  runEmbedded(connection: EmbeddedConnection, migrations: readonly EmbeddedMigration[]): Promise<readonly number[]>;
}

async function embeddedModule(): Promise<EmbeddedModule> {
  return import(EMBEDDED) as Promise<EmbeddedModule>;
}

function connection(db: DatabaseSync): EmbeddedConnection {
  return {
    async exec(sql): Promise<void> {
      db.exec(sql);
    },
    async run(sql, params): Promise<void> {
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
    return error as EmbeddedMigrationError;
  }
  throw new Error('expected the embedded runner to reject');
}

describe('embedded migrations (real SQLite, no filesystem)', () => {
  // Measured 2026-09-05: importing the real package boundary throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED for `./migrations/embedded`.
  it.fails('applies embedded migrations in order and records them in the on-device ledger', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const { runEmbedded } = await embeddedModule();
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

  // Measured 2026-09-05: the package subpath is absent, so no current export
  // compares the stored and bundled checksums before applying a migration.
  it.fails('refuses to apply an embedded migration whose checksum changed', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const { EmbeddedMigrationError, runEmbedded } = await embeddedModule();
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

  // Measured 2026-09-05: no embedded runner is exported, so an older bundle
  // has no boundary that refuses a ledger version from a newer application.
  it.fails('errors when the ledger contains an id the bundle does not have', async () => {
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
      const { EmbeddedMigrationError, runEmbedded } = await embeddedModule();
      const error = await rejection(runEmbedded(connection(db), [CREATE_USERS]));
      expect(error).toBeInstanceOf(EmbeddedMigrationError);
      expect(error).toMatchObject({ kind: 'ledger-ahead' });
      expect(error.message).toContain('20260905090200');
      expect(error.message).toContain(String(CREATE_USERS.version));
    } finally {
      db.close();
    }
  });

  // Measured 2026-09-05: package.json has no `./migrations/embedded` export.
  // The existing `./migrations` and `./migrations/runner` graphs both reach the
  // compiler, so neither can satisfy this assertion.
  it.fails("does not pull the diff engine into the embedded runner's import graph", () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
      exports: Readonly<Record<string, string>>;
    };
    const exported = packageJson.exports['./migrations/embedded'];
    expect(exported).toBe('./src/migrations/embedded.ts');
    if (exported === undefined) throw new Error('missing embedded migration export');
    const entry = resolve(dirname(PACKAGE), exported);
    expect(moduleGraph(entry)).toEqual([entry]);
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
