#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const projects = [
  ...readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(root, 'packages', e.name, 'tsconfig.json')),
  join(root, 'benchmarks', 'tsconfig.json'),
  join(root, 'benchmarks', 'harness', 'validation', 'tsconfig.json'),
  join(root, 'benchmarks', 'harness', 'framework', 'tsconfig.json'),
  join(root, 'examples', 'tsconfig.json'),
  join(root, 'docs-site', 'tsconfig.json'),
  ...readdirSync(join(root, 'fixtures'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(root, 'fixtures', e.name, 'tsconfig.json')),
].filter(existsSync);

let failed = 0;
for (const project of projects) {
  const rel = relative(root, project);
  process.stdout.write(`typecheck ${rel}\n`);
  const res = spawnSync('yarn', ['tsc', '--noEmit', '-p', project], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) failed++;
}

if (failed > 0) {
  process.stderr.write(`\n${failed} of ${projects.length} project(s) failed typecheck\n`);
  process.exit(1);
}
process.stdout.write(`\nall ${projects.length} project(s) typecheck clean\n`);
