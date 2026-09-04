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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// Tests freeze for #491, against `cli/SPEC.md` §§1-12 only. Later independent verbs
// (`embed`, `new`, `studio`, `modules`, `repl`) do not expand this issue's nine-command table.
//
// Every command is a real child process pointed at the package manifest's actual bin target.
// There is deliberately no `dist` reference: `zmdb` publishes TypeScript sources and its bin is
// `./src/cli/bin.ts`. A per-temp-project hook maps repository-owned relative `.js` specifiers to
// their `.ts` siblings, but refuses to rewrite imports made by the consumer fixture. That keeps
// config/SPEC.md §4's native-Node limitation observable instead of hiding it behind the repo hook.
//
// Current actual at 4c8fbfc552af38cafaa2a6d19d073bb898bac0ee for each
// database verb:
//   exit 2, stdout "", stderr `zmdb: unknown command "<verb>"`.

const ROOT = process.env.ZMDB_REPOSITORY_ROOT ?? process.cwd();
const BIN = join(ROOT, 'packages', 'zmdb', 'src', 'cli', 'bin.ts');
const DEFAULT_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'project');
const FIXTURE = process.env.ZMDB_CLI_E2E_FIXTURE ?? DEFAULT_FIXTURE;
const COMMANDS = ['generate', 'migrate', 'rollback', 'status', 'push', 'check', 'upgrade', 'export', 'pull'] as const;
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
    stderr: result.stderr ?? '',
  };
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

function usersSnapshot(): Record<string, unknown> {
  return {
    version: 1,
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'email', type: 'text', nullable: false, primaryKey: false },
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
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

describe('the zmdb database CLI in a temporary consumer project', () => {
  // Current actual: each row exits 2 with human stderr and empty stdout, so JSON.parse fails.
  // This exact title carries MikroORM's `cli` API-coverage row.
  it.fails('emits machine-readable output under --json for every command', () => {
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

  // Current actual: each row exits 2 for an unknown command. The missing config
  // path is never reached or reported.
  it.fails('exits non-zero on failure for every command', () => {
    for (const command of COMMANDS) {
      const project = copyProject();
      const missing = join(project.root, 'missing.config.ts');
      const invocation = run(project, command, '--config', missing);
      expect(invocation.status, command).toBe(2);
      expect(invocation.stdout, command).toBe('');
      expect(invocation.stderr, command).toContain(missing);
    }
  });

  // Current actual: exit 2, `zmdb: unknown command "generate"`.
  it.fails('generates a migration and a snapshot from declarations', () => {
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
      tables: [{ name: 'users' }],
    });
  });

  // Current actual: the first generate exits 2 before it can establish the no-change case.
  it.fails('generates nothing and exits zero when the schema has not changed', () => {
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

  // Current actual: exit 2, so neither the user table nor the ledger exists.
  it.fails('applies migrations to a real sqlite database and records them in the ledger', () => {
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

  // Current actual: exit 2 before any SQL; the assertions freeze the stronger transactional rule.
  it.fails('stops and reports when a migration fails, leaving the ledger honest', () => {
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

  // Current actual: exit 2 with no plan; the existing column is unchanged.
  it.fails('refuses a destructive push without --force, printing what it would drop', () => {
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

  // Current actual: exit 2, so `legacy` remains.
  it.fails('applies a destructive push with --force', () => {
    const project = copyProject();
    withDatabase(project, database => {
      database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, legacy TEXT);');
    });

    const invocation = run(project, 'push', '--force', '--yes');
    expect(invocation.status).toBe(0);
    expect(columns(project, 'users')).toEqual(['id', 'email']);
  });

  // Current actual: exit 2 for an unknown command rather than the frozen non-TTY refusal.
  it.fails('does not prompt when stdin is not a TTY', () => {
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

  // Current actual: exit 2 with no JSON finding.
  it.fails('detects a snapshot that does not match its migration history', () => {
    const project = copyProject();
    writeSnapshot(project, { version: 1, tables: [] });

    const invocation = run(project, 'check', '--json');
    expect(invocation.status).toBe(1);
    const findings = list(resultOf(json(invocation)).findings, 'check findings').map(value =>
      record(value, 'check finding'),
    );
    expect(findings.map(finding => finding.kind)).toContain('uncommitted-schema');
  });

  // The issue body said “same parent”, but the frozen SPEC has no lineage field: its exact
  // check is duplicate-version. Current actual is still the unknown-command exit.
  it.fails('detects two migrations generated from the same parent', () => {
    const project = copyProject();
    writeSnapshot(project, usersSnapshot());
    writeMigration(project, 20260904010505, 'left', 'SELECT 1;', 'SELECT 1;');
    writeMigration(project, 20260904010505, 'right', 'SELECT 1;', 'SELECT 1;');

    const invocation = run(project, 'check', '--json');
    expect(invocation.status).toBe(1);
    const findings = list(resultOf(json(invocation)).findings, 'check findings').map(value =>
      record(value, 'check finding'),
    );
    expect(findings.map(finding => finding.kind)).toContain('duplicate-version');
  });

  // No prior snapshot shape is frozen, so this asserts the implementable half of §8:
  // current-version idempotence and no mtime write. Current actual is exit 2.
  it.fails('upgrades a stored snapshot format idempotently', () => {
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

  // Current actual: exit 2 and empty stdout.
  it.fails('prints the full DDL to stdout in phase order', () => {
    const project = copyProject();
    const invocation = run(project, 'export');
    expect(invocation.status).toBe(0);
    expect(invocation.stderr).toBe('');
    expect(invocation.stdout).toMatch(/CREATE TABLE "users"/);
    expect(existsSync(project.migrations)).toBe(false);
  });

  // Current actual: exit 2 and no declarations. The generated path is read from the frozen
  // JSON result rather than invented by the test.
  it.fails('writes declarations from a live database and refuses to overwrite a hand-written file', () => {
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

  // Current actual says only “unknown command”; the frozen collision must name both safe choices.
  it.fails('refuses up and names migrate and upgrade', () => {
    const project = copyProject();
    const invocation = run(project, 'up');
    expect(invocation.status).toBe(2);
    expect(invocation.stdout).toBe('');
    expect(invocation.stderr).toMatch(/migrate/);
    expect(invocation.stderr).toMatch(/upgrade/);
  });
});
