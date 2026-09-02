#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// Typecheck every project in the monorepo.
//
// `tsc --build` cannot do this job here: project references require `composite`,
// which requires declaration emit, and every package is `noEmit` (tsup owns
// emission). So we invoke tsc once per tsconfig and fail on the first error —
// which is what the root `typecheck` script used to *claim* to do while actually
// erroring out with TS6053 (no root tsconfig.json exists).
//
// Adding a package to packages/* puts it in the gate automatically; there is no
// hand-maintained list to forget to update (which is how `web` and `zmdb` were
// silently outside CI's typecheck).
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const projects = [
  ...readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(root, 'packages', e.name, 'tsconfig.json')),
  join(root, 'benchmarks', 'tsconfig.json'),
  // The validation benchmark's model, as its own project: it is what the generator reflects
  // over, and the generator refuses to run on a file with a semantic error. Without this the
  // refusal surfaces when someone runs the benchmark, which is much later and much further
  // from the edit that caused it.
  join(root, 'benchmarks', 'harness', 'validation', 'tsconfig.json'),
  // The quickstart. It is the first zmdb code anyone runs and it was the only TypeScript in
  // the repository that nothing compiled.
  join(root, 'examples', 'tsconfig.json'),
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
