#!/usr/bin/env node
// Checks the benchmark numbers that are *already committed*. It never measures.
//
// Benchmarks are run locally (`yarn bench`), which writes benchmarks/RESULTS.md
// and the dashboard JSON under benchmarks/site/; those files are committed and
// the Pages workflow renders them. A shared GitHub runner cannot produce a
// number worth committing — it is a multi-tenant VM with no isolation and no
// stated hardware — so CI's only useful role is to check that what a human
// committed is complete, self-describing, and measured against the upstream
// commits this repo currently pins.
//
// This script fails when:
//   - benchmarks/RESULTS.md is missing, unparseable, or omits an in-scope case
//   - a dashboard JSON is missing or unparseable
//   - a dashboard JSON has no provenance (which machine, when, against what)
//   - a dashboard JSON carries no rows, or no zmdb row among them
//   - a dashboard JSON's upstreamCommit no longer matches the pinned submodule
//
// The last one is the interesting one: bumping an upstream submodule silently
// invalidates every number measured against the old one. Reading the gitlink
// out of the tree catches that without checking the submodules out.
//
// Usage: node .github/scripts/verify-bench-results.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BENCH = join(ROOT, 'benchmarks');

const { parseResultsFile } = await import(join(BENCH, 'src', 'guardrail.ts'));
const { assertNoSilentSkips } = await import(join(BENCH, 'src', 'report.ts'));

// Each dashboard panel, the submodule it is measured against, and the array the
// panel plots. docs-site/benchmarks.mjs reads exactly these three files.
const PANELS = [
  { name: 'validation', submodule: 'typescript-runtime-type-benchmarks', rows: 'libraries' },
  { name: 'orm', submodule: 'drizzle-benchmarks', rows: 'targets' },
  { name: 'framework', submodule: 'web-frameworks', rows: 'rows' },
];

const errors = [];
const fail = msg => errors.push(msg);

// --- the pinned upstream commits, straight out of the tree -------------------

const pinned = new Map();
for (const line of execFileSync('git', ['ls-tree', 'HEAD', 'benchmarks/upstream/'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)) {
  // `160000 commit <sha>\t<path>` — mode 160000 is a gitlink.
  const [meta, path] = line.split('\t');
  const parts = meta.split(/\s+/);
  if (parts[0] === '160000' && path) pinned.set(path.split('/').pop(), parts[2]);
}

// --- RESULTS.md: the in-process validation + ORM matrix ----------------------

const resultsMd = join(BENCH, 'RESULTS.md');
if (!existsSync(resultsMd)) {
  fail('benchmarks/RESULTS.md is missing — run `yarn bench` locally and commit it');
} else {
  try {
    const rows = parseResultsFile(resultsMd);
    if (rows.length === 0) fail('benchmarks/RESULTS.md parsed to zero results');
    // The honesty policy: every in-scope case is present as ok or dnf, never
    // dropped. This is the same guard the local generator applies on write.
    assertNoSilentSkips(rows);
    console.log(`benchmarks/RESULTS.md: ${rows.length} results, every in-scope case accounted for`);
  } catch (err) {
    fail(`benchmarks/RESULTS.md: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- the dashboard JSON -----------------------------------------------------

for (const panel of PANELS) {
  const path = join(BENCH, 'site', `${panel.name}.json`);
  const rel = `benchmarks/site/${panel.name}.json`;
  if (!existsSync(path)) {
    fail(`${rel} is missing — run \`yarn bench\` locally and commit it`);
    continue;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  // Provenance. The dashboard prints these, and a number without them is not a
  // measurement anyone can reproduce or argue with.
  if (!data.suite) fail(`${rel} has no "suite" label`);
  if (!data.methodology) fail(`${rel} has no "methodology" — the dashboard states it verbatim`);
  if (!(data.measuredAt ?? data.generatedAt)) fail(`${rel} has no measuredAt/generatedAt timestamp`);
  if (!(data.rig ?? data.machine)) fail(`${rel} does not say which machine produced it`);

  const rows = data[panel.rows];
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${rel} has no "${panel.rows}" rows — the panel would render empty`);
  } else if (!rows.some(r => r?.isZmdb)) {
    fail(`${rel} has ${rows.length} ${panel.rows} but none marked isZmdb — zmdb did not run`);
  }

  const expected = pinned.get(panel.submodule);
  if (!expected) {
    fail(`benchmarks/upstream/${panel.submodule} is not a pinned submodule, but ${rel} claims to measure it`);
  } else if (!data.upstreamCommit) {
    fail(`${rel} has no "upstreamCommit" — cannot tell which upstream it measured`);
  } else if (data.upstreamCommit !== expected) {
    fail(
      `${rel} was measured against ${panel.submodule}@${String(data.upstreamCommit).slice(0, 10)}, ` +
        `but the submodule is pinned at ${expected.slice(0, 10)} — re-run \`yarn bench\` locally and commit the results`,
    );
  } else {
    const n = Array.isArray(rows) ? rows.length : 0;
    console.log(`${rel}: ${n} ${panel.rows} against ${panel.submodule}@${expected.slice(0, 10)}`);
  }
}

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) with the committed benchmark results:`);
  for (const e of errors) console.error(`  ✖ ${e}`);
  console.error(
    '\nBenchmarks are measured locally, not in CI:\n' +
      '  git submodule update --init --depth 1\n' +
      '  yarn bench            # measure + normalise into benchmarks/site/\n' +
      '  git add benchmarks/site benchmarks/RESULTS.md\n',
  );
  process.exit(1);
}

console.log('\ncommitted benchmark results are complete and match the pinned upstreams');
