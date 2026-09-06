import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// Tests freeze for #491, against `cli/SPEC.md` §§1-12 only. The later `embed`
// database verb joins the shared config/JSON matrix; application verbs remain
// covered at their own boundaries.
//
// Every command is a real child process pointed at the package manifest's actual bin target.
// There is deliberately no `dist` reference: `zmdb` publishes TypeScript sources and its bin is
// `./src/cli/bin.ts`. A per-temp-project hook maps repository-owned relative `.js` specifiers to
// their `.ts` siblings, but refuses to rewrite imports made by the consumer fixture. That keeps
// config/SPEC.md §4's native-Node limitation observable instead of hiding it behind the repo hook.
//
// `generate` and `export` are implemented by #493. The other seven database
// verbs are recognized, load the same config, and then report their scoped
// implementation gap; `up` is recognized only to name `migrate` and `upgrade`.

const ROOT = process.env.ZMDB_REPOSITORY_ROOT ?? process.cwd();
const BIN = join(ROOT, 'packages', 'zmdb', 'src', 'cli', 'bin.ts');
const DEFAULT_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'project');
const FIXTURE = process.env.ZMDB_CLI_E2E_FIXTURE ?? DEFAULT_FIXTURE;
const COMMANDS = [
  'generate',
  'embed',
  'migrate',
  'rollback',
  'status',
  'push',
  'check',
  'upgrade',
  'export',
  'pull',
] as const;
const CLI_PROCESS_TEST_TIMEOUT = 30_000;
const directories: string[] = [];

interface Project {
  readonly root: string;
  readonly config: string;
  readonly database: string;
  readonly hook: string;
  readonly migrations: string;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function sourceHook(path: string): void {
  const packageRoot = pathToFileURL(`${join(ROOT, 'packages')}${sep}`).href;
  write(
    path,
    `import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = ${JSON.stringify(packageRoot)};
const relativeJs = /^\\.{1,2}\\/.*\\.js$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(packageRoot) && relativeJs.test(specifier)) {
      const asJs = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(asJs))) {
        const asTs = new URL(\`\${specifier.slice(0, -3)}.ts\`, context.parentURL);
        if (existsSync(fileURLToPath(asTs))) return { url: asTs.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
`,
  );
}

function copyProject(): Project {
  const base = mkdtempSync(join(tmpdir(), 'zmdb-cli-e2e-'));
  directories.push(base);
  const root = join(base, 'project');
  cpSync(FIXTURE, root, { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');

  const tsconfig = join(root, 'tsconfig.json');
  writeFileSync(tsconfig, readFileSync(tsconfig, 'utf8').replaceAll('__ROOT__', ROOT));

  const hook = join(base, 'repository-source-hook.mjs');
  sourceHook(hook);
  return {
    root,
    config: join(root, 'zmdb.config.ts'),
    database: join(root, 'database.sqlite'),
    hook,
    migrations: join(root, 'migrations'),
  };
}

function run(project: Project, ...argv: readonly string[]): Run {
  const result = spawnSync(process.execPath, ['--import', project.hook, BIN, ...argv], {
    cwd: project.root,
    encoding: 'utf8',
    env: { ...process.env, ZMDB_TEST_DATABASE: project.database },
    input: '',
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    // TypeScript 7's sync client spawns tsgo with inherited stderr and kills it
    // during API.close(); under full-suite load that dependency sometimes writes
    // this exact shutdown line. Keep every other byte so CLI stream assertions
    // still fail on output owned by zmdb.
    stderr: withoutCompilerShutdownNoise(result.stderr ?? ''),
  };
}

function withoutCompilerShutdownNoise(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter(
      line =>
        line !== 'context canceled' &&
        !line.includes('ExperimentalWarning: SQLite is an experimental feature') &&
        !line.includes('Use `node --trace-warnings'),
    )
    .join('\n');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function list(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function json(result: Run): Record<string, unknown> {
  expect(result.stdout.trim().split('\n')).toHaveLength(1);
  const parsed: unknown = JSON.parse(result.stdout);
  return record(parsed, 'CLI JSON');
}

function resultOf(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return record(body.result, 'CLI result');
}

function writeMigration(project: Project, version: number, name: string, up: string, down: string): string {
  const path = join(project.migrations, `${version}_${name}.sql`);
  write(path, `-- zmdb:up\n${up.trim()}\n-- zmdb:down\n${down.trim()}\n`);
  return path;
}

async function checksum(source: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function usersSnapshot(): Record<string, unknown> {
  return {
    version: 1,
    extensions: [],
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'email', type: 'text', nullable: false, primaryKey: false },
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        ],
      },
    ],
  };
}

function writeSnapshot(project: Project, snapshot: Readonly<Record<string, unknown>>): string {
  const path = join(project.migrations, 'snapshot.json');
  write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}

function withDatabase<T>(project: Project, use: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(project.database);
  try {
    return use(database);
  } finally {
    database.close();
  }
}

function tableNames(project: Project): string[] {
  return withDatabase(project, database =>
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(row => String(Reflect.get(row, 'name'))),
  );
}

function ledgerVersions(project: Project): number[] {
  return withDatabase(project, database => {
    const ledger = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_zmdb_migrations'")
      .get();
    if (ledger === undefined) return [];
    return database
      .prepare('SELECT version FROM _zmdb_migrations ORDER BY version')
      .all()
      .map(row => Number(Reflect.get(row, 'version')));
  });
}

function columns(project: Project, table: string): string[] {
  return withDatabase(project, database =>
    database
      .prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`)
      .all()
      .map(row => String(Reflect.get(row, 'name'))),
  );
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('the zmdb database CLI in a temporary consumer project', { timeout: CLI_PROCESS_TEST_TIMEOUT }, () => {
  // Every recognized database verb reaches the shared config boundary before its
  // command implementation, so even future verbs keep the machine API stable.
  // This exact title carries MikroORM's `cli` API-coverage row.
  it('emits machine-readable output under --json for every command', () => {
    for (const command of COMMANDS) {
      const project = copyProject();
      const missing = join(project.root, 'missing.config.ts');
      const invocation = run(project, command, '--config', missing, '--json');
      expect(invocation.status, command).toBe(2);

      const body = json(invocation);
      expect(body.ok, command).toBe(false);
      expect(body.command, command).toBe(command);
      expect(body.config, command).toBe(missing);
      expect(list(body.errors, `${command} errors`).length, command).toBeGreaterThan(0);
    }
  });

  // A bad invocation is exit 2, names the attempted config, and never writes a
  // human progress line to stdout.
  it('exits non-zero on failure for every command', () => {
    for (const command of COMMANDS) {
      const project = copyProject();
      const missing = join(project.root, 'missing.config.ts');
      const invocation = run(project, command, '--config', missing);
      expect(invocation.status, command).toBe(2);
      expect(invocation.stdout, command).toBe('');
      expect(invocation.stderr, command).toContain(missing);
    }
  });

  it('generates a migration and a snapshot from declarations', () => {
    const project = copyProject();
    const invocation = run(project, 'generate', '--name', 'initial');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');
    expect(invocation.stdout.split('\n')[0]).toContain(project.config);

    const files = readdirSync(project.migrations).toSorted();
    const migration = files.find(file => /^\d{14}_initial\.sql$/.test(file));
    expect(migration).toBeDefined();
    if (migration === undefined) throw new Error('generate wrote no migration');

    const sql = readFileSync(join(project.migrations, migration), 'utf8');
    expect(sql).toMatch(/-- zmdb:up[\s\S]*CREATE TABLE "users"/);
    expect(sql).toContain('-- zmdb:down');
    expect(JSON.parse(readFileSync(join(project.migrations, 'snapshot.json'), 'utf8'))).toMatchObject({
      version: 1,
      extensions: [],
      tables: [{ name: 'users' }],
    });
  });

  it('applies the configured naming strategy before migration reflection', () => {
    const project = copyProject();
    write(
      join(project.root, 'src', 'schema.ts'),
      `import type { PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface UserAccount extends Table<'userAccount'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
}
`,
    );
    write(
      project.config,
      `import { sqlite } from '@zmdb/sqlite';

export default {
  schema: 'src/**/*.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  out: './migrations',
  naming: 'snake_case_plural',
};
`,
    );

    const invocation = run(project, 'generate', '--name', 'named');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');
    const migration = readdirSync(project.migrations).find(file => /^\d{14}_named\.sql$/.test(file));
    expect(migration).toBeDefined();
    if (migration === undefined) throw new Error('generate wrote no named migration');

    const sql = readFileSync(join(project.migrations, migration), 'utf8');
    expect(sql).toContain('CREATE TABLE "user_accounts"');
    expect(sql).toContain('"created_at" TEXT NOT NULL');
    expect(JSON.parse(readFileSync(join(project.migrations, 'snapshot.json'), 'utf8'))).toMatchObject({
      tables: [{ name: 'user_accounts', columns: [{ name: 'created_at' }, { name: 'id' }] }],
    });
  });

  it('generates extension DDL before its table without an automatic extension drop', () => {
    const project = copyProject();
    write(
      join(project.root, 'src', 'schema.ts'),
      `import type { Ext, PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface Item extends Table<'items'> {
  id: number & Sql<'integer'> & PrimaryKey;
  embedding: readonly number[] & Ext<'vector', 'vector', [3]>;
}
`,
    );
    write(
      project.config,
      `import { postgres } from '@zmdb/postgres';

export default {
  schema: 'src/**/*.ts',
  dialect: postgres,
  project: './tsconfig.json',
  out: './migrations',
};
`,
    );

    const invocation = run(project, 'generate', '--name', 'vector_items');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');

    const migration = readdirSync(project.migrations).find(file => /^\d{14}_vector_items\.sql$/.test(file));
    expect(migration).toBeDefined();
    if (migration === undefined) throw new Error('generate wrote no extension migration');

    const sql = readFileSync(join(project.migrations, migration), 'utf8');
    const extension = sql.indexOf('CREATE EXTENSION IF NOT EXISTS "vector"');
    const table = sql.indexOf('CREATE TABLE "items"');
    expect(extension).toBeGreaterThanOrEqual(0);
    expect(table).toBeGreaterThan(extension);
    expect(sql).toContain('DROP TABLE "items"');
    expect(sql).not.toContain('DROP EXTENSION');
    expect(JSON.parse(readFileSync(join(project.migrations, 'snapshot.json'), 'utf8'))).toMatchObject({
      version: 1,
      extensions: [{ name: 'vector' }],
      tables: [{ name: 'items' }],
    });
  });

  it('generates nothing and exits zero when the schema has not changed', () => {
    const project = copyProject();
    expect(run(project, 'generate', '--name', 'initial').status).toBe(0);
    const before = readdirSync(project.migrations)
      .toSorted()
      .map(file => [file, readFileSync(join(project.migrations, file), 'utf8')]);

    const again = run(project, 'generate', '--name', 'ignored');
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/no (?:changes|migration)/i);
    expect(
      readdirSync(project.migrations)
        .toSorted()
        .map(file => [file, readFileSync(join(project.migrations, file), 'utf8')]),
    ).toEqual(before);
  });

  it('embeds migrations as a deterministic formatter-clean TypeScript module', async () => {
    const project = copyProject();
    const createUp =
      'CREATE TABLE widgets (id INTEGER PRIMARY KEY);\n' +
      "SELECT '// Includes down sections for development tooling.';\n";
    const alterUp = 'ALTER TABLE widgets ADD COLUMN name TEXT;\n';
    writeMigration(project, 20260905090200, 'add_name', alterUp, 'ALTER TABLE widgets DROP COLUMN name;');
    writeMigration(project, 20260905090100, 'create_widgets', createUp, 'DROP TABLE widgets;');

    const first = run(project, 'embed', '--json');
    expect(first.status).toBe(0);
    const result = resultOf(json(first));
    const output = join(project.migrations, 'embedded.ts');
    expect(result.file).toBe(output);
    expect(result.migrations).toEqual([
      {
        version: 20260905090100,
        name: 'create_widgets',
        checksum: await checksum(createUp),
      },
      {
        version: 20260905090200,
        name: 'add_name',
        checksum: await checksum(alterUp),
      },
    ]);

    const source = readFileSync(output, 'utf8');
    expect(source).toContain('// Generated by `zmdb embed`. Do not edit.');
    expect(source).toContain("from '@zmdb/migrations/embedded'");
    expect(source.indexOf('20260905090100')).toBeLessThan(source.indexOf('20260905090200'));
    expect(source).not.toContain('down:');

    const second = run(project, 'embed');
    expect(second.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(source);

    const checked = run(project, 'check', '--json');
    const findings = list(resultOf(json(checked)).findings, 'check findings').map(value =>
      record(value, 'check finding'),
    );
    expect(findings).not.toContainEqual(expect.objectContaining({ kind: 'stale-embedded' }));

    const formatted = spawnSync(join(ROOT, 'node_modules', '.bin', 'oxfmt'), ['--check', output], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(formatted.status, formatted.stderr).toBe(0);
  });

  it('includes down sections only when requested and honours an explicit output path', () => {
    const project = copyProject();
    writeMigration(
      project,
      20260905090300,
      'create_notes',
      'CREATE TABLE notes (id INTEGER PRIMARY KEY);',
      'DROP TABLE notes;',
    );

    const invocation = run(project, 'embed', '--out', 'src/generated/migrations.ts', '--with-down');
    expect(invocation.status).toBe(0);
    const output = join(project.root, 'src', 'generated', 'migrations.ts');
    const source = readFileSync(output, 'utf8');
    expect(source).toContain('Includes down sections for development tooling.');
    expect(source).toContain("down: 'DROP TABLE notes;\\n'");
    expect(existsSync(join(project.migrations, 'embedded.ts'))).toBe(false);
  });

  it('refuses to embed migrations configured for a non-SQLite dialect', () => {
    const project = copyProject();
    writeFileSync(
      project.config,
      readFileSync(project.config, 'utf8')
        .replace(
          "import { sqlite } from '@zmdb/sqlite';",
          "import { postgres } from '@zmdb/postgres';\nimport { sqlite } from '@zmdb/sqlite';",
        )
        .replace('dialect: sqlite', 'dialect: postgres'),
    );
    writeMigration(project, 20260905090400, 'postgres_only', 'SELECT 1;', 'SELECT 1;');

    const invocation = run(project, 'embed');
    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toContain('embedded migrations are not supported');
    expect(invocation.stderr).toContain('postgres');
    expect(existsSync(join(project.migrations, 'embedded.ts'))).toBe(false);
  });

  it('reports a stale embedded module after a migration file changes', () => {
    const project = copyProject();
    const migration = writeMigration(
      project,
      20260905090500,
      'create_tasks',
      'CREATE TABLE tasks (id INTEGER PRIMARY KEY);',
      'DROP TABLE tasks;',
    );
    expect(run(project, 'embed').status).toBe(0);
    writeFileSync(
      migration,
      '-- zmdb:up\nCREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);\n-- zmdb:down\nDROP TABLE tasks;\n',
    );

    const invocation = run(project, 'check', '--json');
    expect(invocation.status).toBe(1);
    const findings = list(resultOf(json(invocation)).findings, 'check findings').map(value =>
      record(value, 'check finding'),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: 'stale-embedded',
        subject: join(project.migrations, 'embedded.ts'),
      }),
    );
  });

  it('treats a migration name with no slug characters as an invocation error', () => {
    const project = copyProject();
    const invocation = run(project, 'generate', '--name', '!!!', '--json');

    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toMatch(/migration name.*letters or digits/i);
    expect(json(invocation)).toMatchObject({
      ok: false,
      command: 'generate',
      config: project.config,
    });
    expect(existsSync(project.migrations)).toBe(false);
  });

  it('applies migrations to a real sqlite database and records them in the ledger', () => {
    const project = copyProject();
    const version = 20260904010101;
    writeMigration(
      project,
      version,
      'create_widgets',
      'CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      'DROP TABLE widgets;',
    );

    const first = run(project, 'migrate');
    expect(first.status).toBe(0);
    expect(tableNames(project)).toContain('widgets');
    expect(ledgerVersions(project)).toEqual([version]);

    const second = run(project, 'migrate');
    expect(second.status).toBe(0);
    expect(ledgerVersions(project)).toEqual([version]);
    expect(second.stdout).toMatch(/(?:none|nothing|0)/i);
  });

  it('stops and reports when a migration fails, leaving the ledger honest', () => {
    const project = copyProject();
    const version = 20260904010202;
    writeMigration(
      project,
      version,
      'broken',
      `
CREATE TABLE partial (id INTEGER PRIMARY KEY);
INSERT INTO partial (id) VALUES (1);
THIS IS NOT SQL;
`,
      'DROP TABLE partial;',
    );

    const invocation = run(project, 'migrate');
    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain(String(version));
    expect(tableNames(project)).not.toContain('partial');
    expect(ledgerVersions(project)).toEqual([]);
  });

  it('refuses a destructive push without --force, printing what it would drop', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, legacy TEXT);');
    });

    const invocation = run(project, 'push');
    expect(invocation.status).not.toBe(0);
    expect(`${invocation.stdout}\n${invocation.stderr}`).toMatch(/DROP COLUMN.*legacy/i);
    expect(invocation.stderr).toMatch(/--force/);
    expect(columns(project, 'users')).toContain('legacy');
  });

  it('applies a destructive push with --force', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, legacy TEXT);');
    });

    const invocation = run(project, 'push', '--force', '--yes');
    expect(invocation.status).toBe(0);
    expect(columns(project, 'users')).toEqual(['id', 'email']);
  });

  it('does not prompt when stdin is not a TTY', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, legacy TEXT);');
    });

    const invocation = run(project, 'push', '--force');
    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toMatch(/--yes/);
    expect(`${invocation.stdout}\n${invocation.stderr}`).not.toMatch(/\[y\/N\]|\?\s*$/m);
    expect(columns(project, 'users')).toContain('legacy');
  });

  it('detects a snapshot that does not match its migration history', () => {
    const project = copyProject();
    writeSnapshot(project, { version: 1, tables: [], extensions: [] });

    const invocation = run(project, 'check', '--json');
    expect(invocation.status).toBe(1);
    const body = json(invocation);
    expect(body.errors, JSON.stringify(body)).toBeUndefined();
    const findings = list(resultOf(body).findings, 'check findings').map(value => record(value, 'check finding'));
    expect(findings.map(finding => finding.kind)).toContain('uncommitted-schema');
  });

  // The issue body said “same parent”, but the frozen SPEC has no lineage field:
  // its exact check is duplicate-version.
  it('detects two migrations generated from the same parent', () => {
    const project = copyProject();
    writeSnapshot(project, usersSnapshot());
    writeMigration(project, 20260904010505, 'left', 'SELECT 1;', 'SELECT 1;');
    writeMigration(project, 20260904010505, 'right', 'SELECT 1;', 'SELECT 1;');

    const invocation = run(project, 'check', '--json');
    expect(invocation.status).toBe(1);
    const body = json(invocation);
    expect(body.errors, JSON.stringify(body)).toBeUndefined();
    const findings = list(resultOf(body).findings, 'check findings').map(value => record(value, 'check finding'));
    expect(findings.map(finding => finding.kind)).toContain('duplicate-version');
  });

  it('distinguishes check findings by exit code', () => {
    const findingProject = copyProject();
    writeSnapshot(findingProject, { version: 1, tables: [], extensions: [] });
    const finding = run(findingProject, 'check', '--json');

    const invalidProject = copyProject();
    const missing = join(invalidProject.root, 'missing.config.ts');
    const invalid = run(invalidProject, 'check', '--config', missing, '--json');

    expect([finding.status, invalid.status]).toEqual([1, 2]);
    expect(list(resultOf(json(finding)).findings, 'check findings')).not.toHaveLength(0);
    expect(list(json(invalid).errors, 'check errors')).not.toHaveLength(0);
  });

  // No prior snapshot shape is frozen, so this asserts the implementable half of §8:
  // current-version idempotence and no mtime write.
  it('upgrades a stored snapshot format idempotently', () => {
    const project = copyProject();
    const snapshot = writeSnapshot(project, usersSnapshot());
    const beforeText = readFileSync(snapshot, 'utf8');
    const beforeMtime = statSync(snapshot, { bigint: true }).mtimeNs;

    const invocation = run(project, 'upgrade', '--json');
    expect(invocation.status).toBe(0);
    expect(resultOf(json(invocation))).toMatchObject({ from: 1, to: 1, changed: false });
    expect(readFileSync(snapshot, 'utf8')).toBe(beforeText);
    expect(statSync(snapshot, { bigint: true }).mtimeNs).toBe(beforeMtime);
  });

  it('prints the full DDL to stdout in phase order', () => {
    const project = copyProject();
    const invocation = run(project, 'export');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');
    expect(invocation.stdout).toMatch(/CREATE TABLE "users"/);
    expect(existsSync(project.migrations)).toBe(false);
  });

  // The generated path is read from the JSON result rather than invented by the
  // test. Replacing its header then proves the next run protects human work.
  it('writes declarations from a live database and refuses to overwrite a hand-written file', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE legacy_orders (id INTEGER PRIMARY KEY, reference TEXT NOT NULL);');
    });

    const first = run(project, 'pull', '--json');
    expect(first.status).toBe(0);
    const files = list(resultOf(json(first)).files, 'pull files').map(value => record(value, 'pull file'));
    expect(files).toHaveLength(1);
    const generatedPath = resolve(project.root, String(files[0]?.path));
    expect(readFileSync(generatedPath, 'utf8')).toMatch(
      /Generated by zmdb introspection from a sqlite database[\s\S]*Table<'legacy_orders'>/,
    );

    writeFileSync(generatedPath, '// hand-written: keep me\n');
    const second = run(project, 'pull', '--json');
    expect(second.status).toBe(1);
    expect(readFileSync(generatedPath, 'utf8')).toBe('// hand-written: keep me\n');
    const skipped = list(resultOf(json(second)).skipped, 'pull skipped').map(value => record(value, 'skipped file'));
    expect(skipped.some(item => resolve(project.root, String(item.path)) === generatedPath)).toBe(true);
  });

  it('prints emitter warnings', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE binary_documents (id INTEGER PRIMARY KEY, payload BLOB NOT NULL);');
    });

    const invocation = run(project, 'pull', '--json');
    expect(invocation.status).toBe(0);
    expect(json(invocation)).toMatchObject({ ok: true, command: 'pull', config: project.config });
    expect(invocation.stderr).toMatch(/WARNING binary_documents\.payload:.*BLOB.*cannot be represented/i);
  });

  it('--dry-run writes nothing', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE preview_orders (id INTEGER PRIMARY KEY, reference TEXT NOT NULL);');
    });

    const invocation = run(project, 'pull', '--dry-run');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');
    expect(invocation.stdout).toMatch(/would write .*preview_orders\.ts/i);
    expect(invocation.stdout).toMatch(
      /Generated by zmdb introspection from a sqlite database[\s\S]*Table<'preview_orders'>/,
    );
    expect(existsSync(join(project.root, '.zmdb'))).toBe(false);
  });

  it('--check exits non-zero on drift', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE checked_orders (id INTEGER PRIMARY KEY, reference TEXT NOT NULL);');
    });
    expect(run(project, 'pull').status).toBe(0);
    const clean = run(project, 'pull', '--check', '--json');
    expect(clean.status).toBe(0);
    expect(resultOf(json(clean)).skipped).toEqual([]);

    withDatabase(project, database => {
      database.exec('CREATE TABLE checked_lines (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL);');
    });
    const check = run(project, 'pull', '--check', '--json');
    expect(check.status).toBe(1);
    const body = json(check);
    expect(body).toMatchObject({ ok: false, command: 'pull', config: project.config });
    const skipped = list(resultOf(body).skipped, 'pull skipped').map(value => record(value, 'skipped file'));
    const missing = skipped.find(file => String(file.path).endsWith('checked_lines.ts'));
    expect(missing?.reason).toMatch(/missing/i);
    expect(existsSync(join(project.root, '.zmdb', 'introspected', 'checked_lines.ts'))).toBe(false);
  });

  it('refuses up and names migrate and upgrade', () => {
    const project = copyProject();
    const invocation = run(project, 'up');
    expect(invocation.status).toBe(2);
    expect(invocation.stdout).toBe('');
    expect(invocation.stderr).toMatch(/migrate/);
    expect(invocation.stderr).toMatch(/upgrade/);
  });

  it('keeps stdout parseable under --json when the command fails', () => {
    const project = copyProject();
    const missing = join(project.root, 'missing.config.ts');
    const invocation = run(project, 'generate', '--config', missing, '--json');

    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toContain(missing);
    const body = json(invocation);
    expect(body).toMatchObject({
      ok: false,
      command: 'generate',
      config: missing,
    });
    expect(list(body.errors, 'generate errors')).toHaveLength(1);
  });

  it('prints global and per-command help from the parser definitions', () => {
    const project = copyProject();
    const global = run(project, '--help');
    const generate = run(project, 'generate', '--help');
    const generateJson = run(project, 'generate', '--help', '--json');

    expect([global.status, generate.status, generateJson.status]).toEqual([0, 0, 0]);
    expect(global.stderr).toBe('');
    expect(global.stdout).toContain('generate');
    expect(global.stdout).toContain('export');
    expect(generate.stderr).toBe('');
    expect(generate.stdout).toContain('zmdb generate [--name <slug>]');
    expect(generate.stdout).toContain('--name <slug>');
    expect(generateJson.stderr).toBe('');
    const help = record(json(generateJson).result, 'generate help result');
    expect(help.help).toContain('zmdb generate [--name <slug>]');
  });
});
