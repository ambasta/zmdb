// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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

import { runCli } from '@zmdb/core/cli';
import { afterEach, describe, expect, it } from 'vitest';

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

function workspaceFixture(): string {
  const root = temporaryDirectory('workspace');
  mkdirSync(join(root, 'apps', 'api', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'worker', 'src'), { recursive: true });
  writeJson(join(root, 'package.json'), {
    private: true,
    workspaces: ['apps/*'],
  });
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

function typecheck(project: string): void {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--noEmit', '--project', join(project, 'tsconfig.json')], {
    cwd: project,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });
}

describe('zmdb new scaffolds', () => {
  it('generates a project that typechecks', async () => {
    const { project, run } = await generatedProject();
    expect(run).toMatchObject({ code: 0, stderr: '' });

    typecheck(project);
  });

  it('generates a schema and its behavioural spec', async () => {
    const root = packageFixture('schema');
    const run = await cli(root, 'new', 'schema', 'account');
    expect(run.code).toBe(0);
    expect(filesUnder(root).filter(path => path.includes('account'))).toEqual(
      ['src/account.spec.ts', 'src/account.ts'].toSorted(),
    );
  });

  it('prints module wiring without editing the existing app module', async () => {
    const root = packageFixture('wiring');
    const modulePath = join(root, 'src', 'app.module.ts');
    const before = readFileSync(modulePath, 'utf8');

    const run = await cli(root, 'new', 'controller', 'posts');

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('add to src/app.module.ts');
    expect(run.stdout).toContain('PostsController');
    expect(readFileSync(modulePath, 'utf8')).toBe(before);
  });

  it('refuses to guess when the package is ambiguous', async () => {
    const root = workspaceFixture();
    const run = await cli(root, 'new', 'controller', 'posts');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--package');
    expect(run.stderr).toContain('@fixture/api');
    expect(run.stderr).toContain('@fixture/worker');
    expect(existsSync(join(root, 'src', 'posts.controller.ts'))).toBe(false);
  });

  it('writes into the package named by --package in a monorepo', async () => {
    const root = workspaceFixture();
    const run = await cli(root, 'new', 'controller', 'posts', '--package', '@fixture/api');
    expect(run.code).toBe(0);
    expect(existsSync(join(root, 'apps', 'api', 'src', 'posts.controller.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'worker', 'src', 'posts.controller.ts'))).toBe(false);
  });

  it('refuses to overwrite an existing file even with --force', async () => {
    const root = packageFixture('overwrite');
    const target = join(root, 'src', 'posts.controller.ts');
    writeFileSync(target, "export const sentinel = 'keep me';\n");

    const run = await cli(root, 'new', 'controller', 'posts', '--force');

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('src/posts.controller.ts');
    expect(readFileSync(target, 'utf8')).toBe("export const sentinel = 'keep me';\n");
  });

  it('refuses a name that cannot become a TypeScript identifier', async () => {
    const root = packageFixture('identifier');
    const run = await cli(root, 'new', 'controller', '123-???');
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/identifier|name/i);
    expect(filesUnder(root).filter(path => path.includes('123'))).toEqual([]);
  });

  it('prints every file and its complete contents under --dry-run without writing', async () => {
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
