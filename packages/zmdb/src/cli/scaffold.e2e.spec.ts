import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from 'zmdb/cli';

// Tests freeze for zmdb CLI SPEC §13 (#499, epic #497).
//
// RED ON PURPOSE. At HEAD 83cb5c25 every `zmdb new …` call below returns:
//
//   code 2
//   stderr: zmdb: unknown command "new"
//
// Each assertion uses the real exported `runCli`; there is no scaffold stub. Temporary projects
// live below the isolated checkout and are removed after every test. That location lets generated
// source resolve the checkout's already-installed dependencies by normal ancestor lookup. The gate
// invokes the checkout's exact tsc, oxlint and oxfmt binaries directly: no install and no dependency
// symlink are part of this test.

const ROOT = process.cwd();
const temporaryDirectories: string[] = [];

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(ROOT, `.zmdb-499-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function cli(cwd: string, ...argv: readonly string[]): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    cwd,
    stdinIsTTY: false,
    stdout: text => {
      stdout += text;
    },
    stderr: text => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

function filesUnder(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        files.push(relative(root, path));
      }
    }
  };
  visit(root);
  return files.toSorted();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

function packageFixture(label: string): string {
  const root = temporaryDirectory(label);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeJson(join(root, 'package.json'), { name: `fixture-${label}`, private: true, type: 'module' });
  writeFileSync(
    join(root, 'src', 'app.module.ts'),
    "export class AppModule { readonly name = 'existing app module'; }\n",
  );
  return root;
}

function workspaceFixture(kind: 'package-json' | 'pnpm' = 'package-json'): string {
  const root = temporaryDirectory(`workspace-${kind}`);
  mkdirSync(join(root, 'apps', 'api', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'worker', 'src'), { recursive: true });
  writeJson(join(root, 'package.json'), {
    private: true,
    ...(kind === 'package-json' ? { workspaces: ['apps/*'] } : {}),
  });
  if (kind === 'pnpm') {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  }
  for (const name of ['api', 'worker']) {
    writeJson(join(root, 'apps', name, 'package.json'), {
      name: `@fixture/${name}`,
      private: true,
      type: 'module',
    });
    writeFileSync(
      join(root, 'apps', name, 'src', 'app.module.ts'),
      `export class AppModule { readonly name = '${name}'; }\n`,
    );
  }
  return root;
}

async function generatedProject(): Promise<{
  readonly parent: string;
  readonly project: string;
  readonly run: CliRun;
}> {
  const parent = temporaryDirectory('project');
  // Stop workspace discovery at the fixture. The generated child still resolves dependencies by
  // walking to ROOT/node_modules, while the CLI cannot mistake the repository root for its package.
  writeJson(join(parent, 'package.json'), { private: true });
  const run = await cli(parent, 'new', 'project', 'blog');
  return { parent, project: join(parent, 'blog'), run };
}

function runGate(command: 'tsc' | 'oxlint' | 'oxfmt', args: readonly string[], cwd: string): void {
  execFileSync(join(ROOT, 'node_modules', '.bin', command), args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });
}

describe('zmdb new scaffolds (frozen: zmdb CLI SPEC §13)', () => {
  it.fails('generates a project that typechecks, lints and formats clean', async () => {
    const { project, run } = await generatedProject();
    expect(run).toMatchObject({ code: 0, stderr: '' });

    runGate('tsc', ['--noEmit', '--project', join(project, 'tsconfig.json')], project);
    runGate('oxlint', ['.'], project);
    runGate('oxfmt', ['--check', '.'], project);
  });

  it.fails('generates the complete project file set and nothing else', async () => {
    const { project, run } = await generatedProject();
    expect(run.code).toBe(0);
    expect(filesUnder(project)).toEqual(
      [
        '.gitignore',
        'package.json',
        'src/app.module.ts',
        'src/health.controller.spec.ts',
        'src/health.controller.ts',
        'src/main.ts',
        'tsconfig.json',
        'zmdb.config.ts',
      ].toSorted(),
    );
  });

  it.fails('generates a schema and its behavioural spec', async () => {
    const root = packageFixture('schema');
    const run = await cli(root, 'new', 'schema', 'account');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('account'))).toEqual(
      ['src/account.spec.ts', 'src/account.ts'].toSorted(),
    );
  });

  it.fails('generates a controller with a test file', async () => {
    const root = packageFixture('controller');
    const run = await cli(root, 'new', 'controller', 'posts');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('posts'))).toEqual(
      ['src/posts.controller.spec.ts', 'src/posts.controller.ts'].toSorted(),
    );
  });

  it.fails('generates a module and its behavioural spec', async () => {
    const root = packageFixture('module');
    const run = await cli(root, 'new', 'module', 'billing');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('billing'))).toEqual(
      ['src/billing.module.spec.ts', 'src/billing.module.ts'].toSorted(),
    );
  });

  it.fails('generates a repository provider and its behavioural spec', async () => {
    const root = packageFixture('repository');
    const run = await cli(root, 'new', 'repository', 'users');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('users'))).toEqual(
      ['src/users.repository.spec.ts', 'src/users.repository.ts'].toSorted(),
    );
  });

  it.fails('generates a command and its behavioural spec', async () => {
    const root = packageFixture('command');
    const run = await cli(root, 'new', 'command', 'import-users');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('import-users'))).toEqual(
      ['src/import-users.command.spec.ts', 'src/import-users.command.ts'].toSorted(),
    );
  });

  it.fails('writes behavioural generated specs rather than existence assertions', async () => {
    const cases = [
      ['schema', 'account', 'src/account.spec.ts'],
      ['controller', 'posts', 'src/posts.controller.spec.ts'],
      ['module', 'billing', 'src/billing.module.spec.ts'],
      ['repository', 'users', 'src/users.repository.spec.ts'],
      ['command', 'import-users', 'src/import-users.command.spec.ts'],
    ] as const;

    for (const [kind, name, spec] of cases) {
      const root = packageFixture(`behaviour-${kind}`);
      expect((await cli(root, 'new', kind, name)).code).toBe(0);
      const source = readFileSync(join(root, spec), 'utf8');
      expect(source).toContain('createTestApp');
      expect(source).toMatch(/\bexpect\(/);
      expect(source).not.toMatch(/toBeDefined|toBeTruthy|it\.todo|it\.skip/);
    }
  });

  it.fails('puts a transformer canary in the generated schema spec', async () => {
    const root = packageFixture('canary');
    expect((await cli(root, 'new', 'schema', 'account')).code).toBe(0);
    const source = readFileSync(join(root, 'src', 'account.spec.ts'), 'utf8');
    expect(source).toContain('is<{ id: number }>');
    expect(source).toContain("({ id: 'x' })");
    expect(source).toContain('toBe(false)');
  });

  it.fails('never writes or appends to a barrel file', async () => {
    const root = packageFixture('barrel');
    const barrel = join(root, 'src', 'index.ts');
    writeFileSync(barrel, "export const untouched = 'sentinel';\n");
    const before = readFileSync(barrel, 'utf8');

    expect((await cli(root, 'new', 'controller', 'posts')).code).toBe(0);

    expect(readFileSync(barrel, 'utf8')).toBe(before);
    expect(filesUnder(root).filter(path => path.endsWith('/index.ts') || path === 'index.ts')).toEqual([
      'src/index.ts',
    ]);
  });

  it.fails('prints module wiring without editing the existing app module', async () => {
    const root = packageFixture('wiring');
    const modulePath = join(root, 'src', 'app.module.ts');
    const before = readFileSync(modulePath, 'utf8');

    const run = await cli(root, 'new', 'controller', 'posts');

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('add to src/app.module.ts');
    expect(run.stdout).toContain('PostsController');
    expect(readFileSync(modulePath, 'utf8')).toBe(before);
  });

  it.fails('refuses to guess when the package is ambiguous', async () => {
    const root = workspaceFixture();
    const run = await cli(root, 'new', 'controller', 'posts');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--package');
    expect(run.stderr).toContain('@fixture/api');
    expect(run.stderr).toContain('@fixture/worker');
    expect(existsSync(join(root, 'src', 'posts.controller.ts'))).toBe(false);
  });

  it.fails('writes into the package named by --package in a monorepo', async () => {
    const root = workspaceFixture();
    const run = await cli(root, 'new', 'controller', 'posts', '--package', '@fixture/api');
    expect(run.code).toBe(0);
    expect(existsSync(join(root, 'apps', 'api', 'src', 'posts.controller.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'worker', 'src', 'posts.controller.ts'))).toBe(false);
  });

  it.fails('infers the one enclosing package when invoked inside it', async () => {
    const root = workspaceFixture();
    const cwd = join(root, 'apps', 'worker', 'src');
    const run = await cli(cwd, 'new', 'module', 'jobs');
    expect(run.code).toBe(0);
    expect(existsSync(join(root, 'apps', 'worker', 'src', 'jobs.module.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'api', 'src', 'jobs.module.ts'))).toBe(false);
  });

  it.fails('detects packages declared by pnpm-workspace.yaml', async () => {
    const root = workspaceFixture('pnpm');
    const run = await cli(root, 'new', 'module', 'jobs');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--package');
    expect(run.stderr).toContain('@fixture/api');
    expect(run.stderr).toContain('@fixture/worker');
  });

  it.fails('refuses to overwrite an existing file even with --force', async () => {
    const root = packageFixture('overwrite');
    const target = join(root, 'src', 'posts.controller.ts');
    writeFileSync(target, "export const sentinel = 'keep me';\n");

    const run = await cli(root, 'new', 'controller', 'posts', '--force');

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('src/posts.controller.ts');
    expect(readFileSync(target, 'utf8')).toBe("export const sentinel = 'keep me';\n");
  });

  it.fails('refuses a name that cannot become a TypeScript identifier', async () => {
    const root = packageFixture('identifier');
    const run = await cli(root, 'new', 'controller', '123-???');
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/identifier|name/i);
    expect(filesUnder(root).filter(path => path.includes('123'))).toEqual([]);
  });

  it.fails('prints every file and its complete contents under --dry-run without writing', async () => {
    const root = packageFixture('dry-run');
    const before = filesUnder(root);
    const run = await cli(root, 'new', 'controller', 'posts', '--dry-run');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('src/posts.controller.ts');
    expect(run.stdout).toContain('src/posts.controller.spec.ts');
    expect(run.stdout).toContain('@Controller');
    expect(run.stdout).toContain('createTestApp');
    expect(filesUnder(root)).toEqual(before);
    expect(existsSync(join(root, 'src', 'posts.controller.ts'))).toBe(false);
    expect(lstatSync(root).isDirectory()).toBe(true);
  });
});
