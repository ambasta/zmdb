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
//   - an observability result, when present, is diagnostic, incomplete, measured
//     from changed input bytes, uses different dependencies, or is inconsistent
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
const OBSERVABILITY_MODES = ['off', 'noop', 'recording-exporter'];
const OBSERVABILITY_WORKLOADS = ['request', 'query'];
const OBSERVABILITY_PERMUTATIONS = [
  ['off', 'noop', 'recording-exporter'],
  ['noop', 'recording-exporter', 'off'],
  ['recording-exporter', 'off', 'noop'],
  ['recording-exporter', 'noop', 'off'],
  ['noop', 'off', 'recording-exporter'],
  ['off', 'recording-exporter', 'noop'],
];
const OBSERVABILITY_INPUTS = [
  'benchmarks/scripts/observability.mjs',
  'package.json',
  'yarn.lock',
  'scripts/ts-specifier-hook.mjs',
  'packages/query-compiler/package.json',
  'packages/query-compiler/src/index.ts',
  'packages/repository/package.json',
  'packages/repository/src/index.ts',
  'packages/web/package.json',
  'packages/web/src/bench/index.ts',
  'packages/web/src/context/index.ts',
  'packages/web/src/observability/index.ts',
  'packages/web/src/observability/otel.ts',
  'packages/web/src/observability/propagation.ts',
  'packages/web/src/observability/types.ts',
  'packages/web/src/pipeline/guards.ts',
  'packages/web/src/pipeline/index.ts',
  'packages/web/src/polyfill.ts',
  'packages/web/src/routing/index.ts',
];
const OBSERVABILITY_PUBLICATIONS = ['benchmarks/RESULTS.md', 'docs-site/content/web-benchmarks.md'];

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

// --- local observability overhead -------------------------------------------

const observabilityPath = join(BENCH, 'site', 'observability.json');
if (!existsSync(observabilityPath)) {
  console.log('benchmarks/site/observability.json: not published yet');
} else {
  await verifyObservabilityResult(observabilityPath);
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

async function verifyObservabilityResult(path) {
  const rel = 'benchmarks/site/observability.json';
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (data.schemaVersion !== 1) fail(`${rel} schemaVersion must be 1`);
  if (data.suite !== '@zmdb/web observability overhead') fail(`${rel} has the wrong suite label`);
  if (data.publicationStatus !== 'final') fail(`${rel} must have publicationStatus "final"`);
  if (typeof data.dirty !== 'boolean') fail(`${rel} must record whether the worktree was dirty`);
  if (typeof data.measuredAt !== 'string' || !Number.isFinite(Date.parse(data.measuredAt))) {
    fail(`${rel} has no valid measuredAt timestamp`);
  }
  if (typeof data.baseHead !== 'string' || !/^[0-9a-f]{40}$/.test(data.baseHead)) {
    fail(`${rel} has no full baseHead`);
  }
  await verifyObservabilityInputs(rel, data.inputs);

  const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const name of ['@opentelemetry/api', '@opentelemetry/sdk-trace-base']) {
    const expected = rootPackage.devDependencies?.[name];
    if (data.dependencies?.[name] !== expected) {
      fail(`${rel} measured ${name}@${String(data.dependencies?.[name])}, package.json pins ${String(expected)}`);
    }
  }

  if (data.methodology?.source !== 'packages/web/src/bench/index.ts via scripts/ts-specifier-hook.mjs') {
    fail(`${rel} was not measured from the source benchmark helper`);
  }
  if (data.methodology?.rounds !== 6) fail(`${rel} must record six rounds`);
  if (JSON.stringify(data.methodology?.permutations) !== JSON.stringify(OBSERVABILITY_PERMUTATIONS)) {
    fail(`${rel} does not record all six mode permutations in the required order`);
  }
  for (const key of ['warmupMs', 'warmupBatchIters', 'targetSampleMs', 'maxSampleIters']) {
    if (!positive(data.methodology?.[key])) fail(`${rel} methodology.${key} must be positive`);
  }

  const samples = data.samples;
  if (!Array.isArray(samples) || samples.length !== 36) {
    fail(`${rel} must contain 36 raw samples (2 workloads × 6 rounds × 3 modes)`);
  } else {
    for (const workload of OBSERVABILITY_WORKLOADS) {
      const baselineChecksums = new Set(
        samples.filter(sample => sample.workload === workload).map(sample => sample.checksum),
      );
      if (baselineChecksums.size !== 1) fail(`${rel} ${workload} workload checksums differ between modes or rounds`);

      for (const mode of OBSERVABILITY_MODES) {
        const selected = samples.filter(sample => sample.workload === workload && sample.mode === mode);
        if (selected.length !== 6) {
          fail(`${rel} must contain six ${workload}/${mode} samples`);
          continue;
        }
        for (const position of [1, 2, 3]) {
          if (selected.filter(sample => sample.position === position).length !== 2) {
            fail(`${rel} ${workload}/${mode} must appear twice at position ${position}`);
          }
        }
        for (const sample of selected) {
          verifyObservabilitySample(rel, sample);
        }
      }
    }
  }

  const summary = data.summary;
  if (!Array.isArray(summary) || summary.length !== 6) {
    fail(`${rel} must contain one summary row per workload/mode`);
  } else {
    for (const workload of OBSERVABILITY_WORKLOADS) {
      for (const mode of OBSERVABILITY_MODES) {
        const rows = summary.filter(row => row.workload === workload && row.mode === mode);
        if (rows.length !== 1) {
          fail(`${rel} must contain exactly one ${workload}/${mode} summary row`);
          continue;
        }
        const row = rows[0];
        for (const key of [
          'itersPerSample',
          'medianNsPerOp',
          'medianOpsPerSec',
          'minNsPerOp',
          'maxNsPerOp',
          'spreadMaxOverMin',
        ]) {
          if (!positive(row[key])) fail(`${rel} ${workload}/${mode} summary.${key} must be positive`);
        }
        if (!Number.isFinite(row.overheadVsOffPercent)) {
          fail(`${rel} ${workload}/${mode} summary overhead must be finite`);
        }
        if (row.samples !== 6) fail(`${rel} ${workload}/${mode} summary must aggregate six samples`);
      }
    }
    verifyObservabilityPublications(rel, summary);
  }

  if (
    typeof data.runtime?.node !== 'string' ||
    typeof data.runtime?.platform !== 'string' ||
    typeof data.runtime?.cpu !== 'string' ||
    !positive(data.runtime?.logicalCpus)
  ) {
    fail(`${rel} has incomplete runtime provenance`);
  }

  if (!errors.some(error => error.startsWith(rel))) {
    console.log(`${rel}: 36 raw samples, six balanced mode orders, provenance verified`);
  }
}

function verifyObservabilityPublications(rel, summary) {
  const labels = {
    off: 'off',
    noop: 'API no-op',
    'recording-exporter': 'recording exporter',
  };
  const expectedRows = new Set();
  for (const row of summary) {
    const spansPerOperation = row.exportedSpans / row.itersPerSample;
    if (!Number.isInteger(spansPerOperation)) {
      fail(`${rel} ${row.workload}/${row.mode} exported span count is not an integer per operation`);
      continue;
    }
    expectedRows.add(
      [
        row.workload,
        labels[row.mode],
        row.medianNsPerOp.toFixed(2),
        String(Math.round(row.medianOpsPerSec)),
        row.mode === 'off' ? 'baseline' : `+${row.overheadVsOffPercent.toFixed(1)}%`,
        String(spansPerOperation),
        `${row.spreadMaxOverMin.toFixed(3)}x`,
      ].join('|'),
    );
  }

  for (const publication of OBSERVABILITY_PUBLICATIONS) {
    const source = readFileSync(join(ROOT, publication), 'utf8');
    const rows = new Set(
      source
        .split('\n')
        .filter(line => line.startsWith('|'))
        .map(line =>
          line
            .split('|')
            .slice(1, -1)
            .map(cell => cell.trim())
            .join('|'),
        ),
    );
    for (const expected of expectedRows) {
      if (!rows.has(expected)) {
        fail(`${publication} does not publish observability row: ${expected}`);
      }
    }
  }
}

function verifyObservabilitySample(rel, sample) {
  for (const key of ['round', 'position', 'iters', 'totalMs', 'opsPerSec', 'nsPerOp', 'checksum']) {
    if (!positive(sample[key])) fail(`${rel} sample ${sample.workload}/${sample.mode} has invalid ${key}`);
  }
  const expectedSpans =
    sample.mode === 'recording-exporter' ? sample.iters * (sample.workload === 'request' ? 3 : 1) : 0;
  if (sample.exportedSpans !== expectedSpans) {
    fail(
      `${rel} sample ${sample.workload}/${sample.mode} exported ${String(sample.exportedSpans)} spans; ` +
        `expected ${expectedSpans}`,
    );
  }
  if (sample.mode === 'recording-exporter' ? !positive(sample.exporterChecksum) : sample.exporterChecksum !== 0) {
    fail(`${rel} sample ${sample.workload}/${sample.mode} has invalid exporter checksum`);
  }
  const expectedNs = (sample.totalMs * 1_000_000) / sample.iters;
  if (!approximately(sample.nsPerOp, expectedNs)) {
    fail(`${rel} sample ${sample.workload}/${sample.mode} nsPerOp does not match totalMs/iters`);
  }
  const expectedOps = (sample.iters / sample.totalMs) * 1000;
  if (!approximately(sample.opsPerSec, expectedOps)) {
    fail(`${rel} sample ${sample.workload}/${sample.mode} opsPerSec does not match iters/totalMs`);
  }
}

async function verifyObservabilityInputs(rel, inputs) {
  if (inputs?.algorithm !== 'sha256') {
    fail(`${rel} inputs.algorithm must be "sha256"`);
    return;
  }
  if (!Array.isArray(inputs.files)) {
    fail(`${rel} inputs.files must be an array`);
    return;
  }
  const paths = inputs.files.map(entry => entry?.path);
  if (JSON.stringify(paths) !== JSON.stringify(OBSERVABILITY_INPUTS)) {
    fail(`${rel} input path manifest does not match the verifier's closed list`);
    return;
  }
  for (const entry of inputs.files) {
    const path = join(ROOT, entry.path);
    if (!existsSync(path)) {
      fail(`${rel} input ${entry.path} is missing`);
      continue;
    }
    const actual = await sha256(readFileSync(path));
    if (entry.sha256 !== actual) {
      fail(`${rel} input ${entry.path} hash is stale: recorded ${String(entry.sha256)}, actual ${actual}`);
    }
  }
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function approximately(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-12);
}
