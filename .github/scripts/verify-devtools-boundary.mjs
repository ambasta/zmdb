#!/usr/bin/env node
// Keep the module inspector and REPL out of every production entry point.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createImportGraph } from './lib/import-graph.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PACKAGES_DIR = join(ROOT, 'packages');
const DEVTOOLS_DIR = join(PACKAGES_DIR, 'web', 'src', 'devtools');
const GUARDED_PACKAGES = ['@zmdb/web', 'zmdb'];
// These are the intended tool owners. `zmdb#./cli` is separately required to be
// build-time-only by verify-exports and its boundary spec.
const EXEMPT_ENTRIES = new Set(['@zmdb/web#./devtools', 'zmdb#./cli']);
const graph = createImportGraph(ROOT);
const problems = [];
let entriesChecked = 0;

const isViolation = ({ specifier, resolved }) => {
  if (specifier === 'node:repl' || specifier.startsWith('node:repl/')) return true;
  if (/^@zmdb\/web\/devtools(\/|$)/.test(specifier) || /^zmdb\/devtools(\/|$)/.test(specifier)) return true;
  return resolved !== null && !relative(DEVTOOLS_DIR, resolved).startsWith('..');
};

for (const packageName of GUARDED_PACKAGES) {
  const pkg = graph.packages.get(packageName);
  if (pkg === undefined) {
    problems.push(`${packageName} is not a workspace package`);
    continue;
  }
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'string') continue;
    const id = `${packageName}#${subpath}`;
    if (EXEMPT_ENTRIES.has(id)) continue;
    entriesChecked++;
    const path = graph.findImportPath(join(pkg.dir, target), isViolation);
    if (path !== null) {
      problems.push(`${id}: ${path.map(step => relative(ROOT, step) || step).join(' -> ')}`);
    }
  }
}

const webSources = [];
const collectTypeScript = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectTypeScript(path);
    else if (entry.name.endsWith('.ts')) webSources.push(path);
  }
};
collectTypeScript(join(PACKAGES_DIR, 'web', 'src'));
for (const file of webSources) {
  if (!existsSync(file)) continue;
  const imports = graph.importsOf(file, readFileSync(file, 'utf8'));
  if (imports.some(({ specifier }) => specifier === 'node:repl' || specifier.startsWith('node:repl/'))) {
    problems.push(`${relative(ROOT, file)} imports node:repl`);
  }
}

if (problems.length > 0) {
  console.error(`devtools boundary failed with ${String(problems.length)} violation(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `devtools boundary: ${String(entriesChecked)} production export(s) checked; ` +
    `${String(webSources.length)} @zmdb/web source file(s) contain no node:repl import.`,
);
