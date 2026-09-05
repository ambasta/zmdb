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
//   - the shallow-validation result is missing, unstable, measured from changed
//     input bytes, semantically incomplete, or inconsistent with RESULTS.md
//   - --strict-deferred is used while benchmarks/DEFERRED.json still records a
//     benchmark slice intentionally postponed until its parent EPIC closes
//
// The last two are the interesting ones: bumping an upstream submodule silently
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
const STRICT_DEFERRED = process.argv.includes('--strict-deferred');

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
  'packages/app/package.json',
  'packages/app/src/index.ts',
  'packages/app/src/application.ts',
  'packages/app/src/di/index.ts',
  'packages/app/src/lifecycle.ts',
  'packages/app/src/modules/index.ts',
  'packages/app/src/modules/lifecycle-instances.ts',
  'packages/app/src/modules/runtime.ts',
  'packages/app/src/observability/index.ts',
  'packages/app/src/observability/propagation.ts',
  'packages/app/src/observability/types.ts',
  'packages/app/src/polyfill.ts',
  'packages/otel/package.json',
  'packages/otel/src/index.ts',
  'packages/web/package.json',
  'packages/web/src/app/bridge.ts',
  'packages/web/src/app/index.ts',
  'packages/web/src/bench/index.ts',
  'packages/web/src/context/index.ts',
  'packages/web/src/pipeline/guards.ts',
  'packages/web/src/pipeline/index.ts',
  'packages/web/src/routing/index.ts',
];
const OBSERVABILITY_PUBLICATIONS = ['benchmarks/RESULTS.md', 'docs-site/content/web-benchmarks.md'];
const APP_STARTUP_ORDERS = [
  ['before', 'after'],
  ['after', 'before'],
  ['before', 'after'],
  ['after', 'before'],
  ['before', 'after'],
  ['after', 'before'],
  ['before', 'after'],
];
const SHALLOW_VALIDATION_MODES = ['full', 'shallow-depth-1'];
const SHALLOW_VALIDATION_PERMUTATIONS = [
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
];
const SHALLOW_VALIDATION_INPUTS = [
  'benchmarks/harness/validation/run-shallow.sh',
  'benchmarks/harness/validation/shallow-source.ts',
  'benchmarks/harness/validation/shallow.generated.ts',
  'benchmarks/harness/validation/shallow.bench.ts',
  'benchmarks/harness/validation/tsconfig.json',
  'benchmarks/scripts/generate-validation-model.mjs',
  'scripts/ts-specifier-hook.mjs',
];

const errors = [];
const fail = msg => errors.push(msg);
const deferred = readDeferredBenchmarks();
const deferredSuites = new Set(deferred?.suites ?? []);
if (deferred !== undefined && STRICT_DEFERRED) {
  fail(
    `benchmarks/DEFERRED.json still defers ${deferred.suites.join(', ')} to #${String(deferred.issue)}; ` +
      `EPIC #${String(deferred.epic)} cannot close`,
  );
}

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
if (deferredSuites.has('observability')) {
  console.log(
    `benchmarks/site/observability.json: re-measurement deferred to #${String(deferred?.issue)} after #${String(deferred?.blockedBy)}`,
  );
} else if (!existsSync(observabilityPath)) {
  console.log('benchmarks/site/observability.json: not published yet');
} else {
  await verifyObservabilityResult(observabilityPath);
}

const appStartupPath = join(BENCH, 'site', 'app-startup-647.json');
if (deferredSuites.has('app-startup')) {
  console.log(
    `benchmarks/site/app-startup-647.json: measurement deferred to #${String(deferred?.issue)} after #${String(deferred?.blockedBy)}`,
  );
} else if (!existsSync(appStartupPath)) {
  fail('benchmarks/site/app-startup-647.json is missing — retain the #647 interleaved before/after samples');
} else {
  verifyAppStartupResult(appStartupPath);
}

const shallowValidationPath = join(BENCH, 'site', 'shallow-validation.json');
if (!existsSync(shallowValidationPath)) {
  fail('benchmarks/site/shallow-validation.json is missing — run the focused benchmark with --write-final');
} else {
  await verifyShallowValidationResult(shallowValidationPath);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) with the committed benchmark results:`);
  for (const e of errors) console.error(`  ✖ ${e}`);
  console.error(
    '\nBenchmarks are measured locally, not in CI:\n' +
      '  git submodule update --init --depth 1\n' +
      '  yarn bench            # measure + normalise into benchmarks/site/\n' +
      '  bash benchmarks/harness/validation/run-shallow.sh --write-final\n' +
      '  git add benchmarks/site benchmarks/RESULTS.md\n',
  );
  process.exit(1);
}

if (deferred === undefined) {
  console.log('\ncommitted benchmark results are complete and match the pinned upstreams');
} else {
  console.log(
    `\nall non-deferred benchmark results are complete; #${String(deferred.issue)} remains the EPIC-only measurement gate`,
  );
}

function readDeferredBenchmarks() {
  const path = join(BENCH, 'DEFERRED.json');
  if (!existsSync(path)) return undefined;

  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`benchmarks/DEFERRED.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  if (
    data.schemaVersion !== 1 ||
    !positive(data.epic) ||
    !positive(data.issue) ||
    !positive(data.blockedBy) ||
    typeof data.reason !== 'string' ||
    data.reason.length === 0
  ) {
    fail('benchmarks/DEFERRED.json has incomplete EPIC, issue, blocker, or reason metadata');
  }

  const allowed = new Set(['app-startup', 'framework', 'observability']);
  if (
    !Array.isArray(data.suites) ||
    data.suites.length === 0 ||
    new Set(data.suites).size !== data.suites.length ||
    data.suites.some(suite => typeof suite !== 'string' || !allowed.has(suite))
  ) {
    fail('benchmarks/DEFERRED.json suites must be unique app-startup, framework, or observability names');
    return undefined;
  }

  return data;
}

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

function verifyAppStartupResult(path) {
  const rel = 'benchmarks/site/app-startup-647.json';
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (data.schemaVersion !== 1 || data.issue !== 647) fail(`${rel} must identify the #647 schema`);
  if (data.suite !== '@zmdb/app extraction startup comparison') fail(`${rel} has the wrong suite label`);
  if (typeof data.measuredAt !== 'string' || !Number.isFinite(Date.parse(data.measuredAt))) {
    fail(`${rel} has no valid measuredAt timestamp`);
  }
  if (
    typeof data.beforeCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(data.beforeCommit) ||
    typeof data.afterCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(data.afterCommit) ||
    data.beforeCommit === data.afterCommit
  ) {
    fail(`${rel} must record distinct full beforeCommit and afterCommit revisions`);
  }
  if (
    typeof data.runtime?.node !== 'string' ||
    typeof data.runtime?.platform !== 'string' ||
    typeof data.runtime?.cpu !== 'string'
  ) {
    fail(`${rel} has incomplete runtime provenance`);
  }

  const methodology = data.methodology;
  if (
    methodology?.surface !== 'packages/web/src/bench/index.ts#benchmarkAppStartup' ||
    methodology?.warmupIterationsPerProcess !== 2000 ||
    methodology?.measuredIterationsPerSample !== 20000 ||
    methodology?.rounds !== APP_STARTUP_ORDERS.length ||
    JSON.stringify(methodology?.order) !== JSON.stringify(APP_STARTUP_ORDERS)
  ) {
    fail(`${rel} does not record the required seven-round interleaved methodology`);
  }

  const samples = data.samples;
  if (!Array.isArray(samples) || samples.length !== APP_STARTUP_ORDERS.length * 2) {
    fail(`${rel} must contain 14 raw samples`);
    return;
  }
  for (let round = 1; round <= APP_STARTUP_ORDERS.length; round += 1) {
    const order = samples.filter(sample => sample.round === round).map(sample => sample.variant);
    if (JSON.stringify(order) !== JSON.stringify(APP_STARTUP_ORDERS[round - 1])) {
      fail(`${rel} round ${round} does not match the declared interleaved order`);
    }
  }
  for (const sample of samples) {
    if (!positive(sample.round) || !['before', 'after'].includes(sample.variant) || !positive(sample.totalMs)) {
      fail(`${rel} has an invalid raw sample`);
      continue;
    }
    const expectedOps = (methodology.measuredIterationsPerSample / sample.totalMs) * 1000;
    if (!approximately(sample.opsPerSec, expectedOps)) {
      fail(`${rel} ${sample.variant} round ${String(sample.round)} opsPerSec does not match totalMs`);
    }
  }

  const before = samples.filter(sample => sample.variant === 'before').map(sample => sample.totalMs);
  const after = samples.filter(sample => sample.variant === 'after').map(sample => sample.totalMs);
  if (before.length !== 7 || after.length !== 7) fail(`${rel} must contain seven samples per variant`);
  const beforeMedian = median(before);
  const afterMedian = median(after);
  const regression = (afterMedian / beforeMedian - 1) * 100;
  if (!approximately(data.summary?.beforeMedianMs, beforeMedian)) {
    fail(`${rel} before median does not match the raw samples`);
  }
  if (!approximately(data.summary?.afterMedianMs, afterMedian)) {
    fail(`${rel} after median does not match the raw samples`);
  }
  if (!approximately(data.summary?.regressionPercent, regression)) {
    fail(`${rel} regression does not match the raw medians`);
  }
  if (data.summary?.thresholdPercent !== 5 || data.summary?.withinThreshold !== regression <= 5) {
    fail(`${rel} does not apply the frozen 5% regression threshold`);
  }
  if (regression > 5) fail(`${rel} median startup regression ${regression.toFixed(2)}% exceeds 5%`);

  if (!errors.some(error => error.startsWith(rel))) {
    console.log(
      `${rel}: 14 interleaved raw samples, ${beforeMedian.toFixed(3)}ms before / ` +
        `${afterMedian.toFixed(3)}ms after (${regression.toFixed(2)}%), threshold verified`,
    );
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

async function verifyShallowValidationResult(path) {
  const rel = 'benchmarks/site/shallow-validation.json';
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (data.schemaVersion !== 1) fail(`${rel} schemaVersion must be 1`);
  if (data.suite !== '@zmdb/aot-validator populated-row shallow validation') {
    fail(`${rel} has the wrong suite label`);
  }
  if (data.publicationStatus !== 'final') fail(`${rel} must have publicationStatus "final"`);
  if (typeof data.dirty !== 'boolean') fail(`${rel} must record whether the worktree was dirty`);
  if (typeof data.measuredAt !== 'string' || !Number.isFinite(Date.parse(data.measuredAt))) {
    fail(`${rel} has no valid measuredAt timestamp`);
  }
  if (typeof data.baseHead !== 'string' || !/^[0-9a-f]{40}$/.test(data.baseHead)) {
    fail(`${rel} has no full baseHead`);
  }
  await verifyShallowValidationInputs(rel, data.inputs);

  if (
    typeof data.runtime?.node !== 'string' ||
    typeof data.runtime?.platform !== 'string' ||
    typeof data.runtime?.host !== 'string' ||
    typeof data.runtime?.cpu !== 'string' ||
    !positive(data.runtime?.logicalCpus)
  ) {
    fail(`${rel} has incomplete runtime provenance`);
  }

  if (
    data.workload?.row !== 'PopulatedOrderRow' ||
    data.workload?.poolSize !== 8 ||
    JSON.stringify(data.workload?.relations) !== JSON.stringify(['customer', 'warehouse', 'carrier']) ||
    data.workload?.relationsPerRow !== 3 ||
    data.workload?.list !== 'items' ||
    data.workload?.listItemsPerRow !== 100
  ) {
    fail(`${rel} does not describe the required three-relation, 100-item populated row`);
  }

  if (
    data.methodology?.source !==
    'transformFile output in benchmarks/harness/validation/shallow.generated.ts via scripts/ts-specifier-hook.mjs'
  ) {
    fail(`${rel} was not measured from the generated transformer output`);
  }
  if (data.methodology?.comparison !== 'is<PopulatedOrderRow> versus isShallow<PopulatedOrderRow, 1>') {
    fail(`${rel} has the wrong comparison label`);
  }
  if (data.methodology?.rounds !== 6) fail(`${rel} must record six rounds`);
  if (data.methodology?.maxFinalSpread !== 1.25) fail(`${rel} must enforce the declared 1.25x spread ceiling`);
  if (JSON.stringify(data.methodology?.permutations) !== JSON.stringify(SHALLOW_VALIDATION_PERMUTATIONS)) {
    fail(`${rel} does not record the required balanced mode order`);
  }
  for (const key of ['warmupMs', 'warmupBatchIters', 'targetSampleMs', 'maxSampleIters']) {
    if (!positive(data.methodology?.[key])) fail(`${rel} methodology.${key} must be positive`);
  }

  verifyShallowSemantics(rel, data.semanticChecks);

  const samples = data.samples;
  if (!Array.isArray(samples) || samples.length !== 12) {
    fail(`${rel} must contain 12 raw samples (6 rounds × 2 modes)`);
  } else {
    for (let round = 1; round <= SHALLOW_VALIDATION_PERMUTATIONS.length; round += 1) {
      const expected = SHALLOW_VALIDATION_PERMUTATIONS[round - 1];
      const actual = samples
        .filter(sample => sample.round === round)
        .toSorted((left, right) => left.position - right.position)
        .map(sample => sample.mode);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`${rel} round ${round} does not match the declared balanced order`);
      }
    }
    for (const mode of SHALLOW_VALIDATION_MODES) {
      const selected = samples.filter(sample => sample.mode === mode);
      if (selected.length !== 6) {
        fail(`${rel} must contain six ${mode} samples`);
        continue;
      }
      for (const position of [1, 2]) {
        if (selected.filter(sample => sample.position === position).length !== 3) {
          fail(`${rel} ${mode} must appear three times at position ${position}`);
        }
      }
      for (const sample of selected) verifyShallowSample(rel, sample);
    }
  }

  const summary = data.summary;
  if (!Array.isArray(summary) || summary.length !== 2) {
    fail(`${rel} must contain one summary row per validation mode`);
  } else if (Array.isArray(samples) && samples.length === 12) {
    for (const mode of SHALLOW_VALIDATION_MODES) {
      const rows = summary.filter(row => row.mode === mode);
      if (rows.length !== 1) {
        fail(`${rel} must contain exactly one ${mode} summary row`);
        continue;
      }
      const row = rows[0];
      const selected = samples.filter(sample => sample.mode === mode);
      const values = selected.map(sample => sample.nsPerOp);
      for (const key of [
        'iterationsPerSample',
        'medianNsPerOp',
        'medianOpsPerSec',
        'minNsPerOp',
        'maxNsPerOp',
        'spreadMaxOverMin',
      ]) {
        if (!positive(row[key])) fail(`${rel} ${mode} summary.${key} must be positive`);
      }
      if (row.samples !== 6) fail(`${rel} ${mode} summary must aggregate six samples`);
      if (new Set(selected.map(sample => sample.iterations)).size !== 1) {
        fail(`${rel} ${mode} samples do not share one calibrated iteration count`);
      }
      if (row.iterationsPerSample !== selected[0]?.iterations) {
        fail(`${rel} ${mode} summary iteration count does not match its samples`);
      }
      if (!approximately(row.medianNsPerOp, median(values))) {
        fail(`${rel} ${mode} medianNsPerOp does not match the raw samples`);
      }
      if (!approximately(row.medianOpsPerSec, 1_000_000_000 / row.medianNsPerOp)) {
        fail(`${rel} ${mode} medianOpsPerSec does not match medianNsPerOp`);
      }
      if (!approximately(row.minNsPerOp, Math.min(...values))) {
        fail(`${rel} ${mode} minNsPerOp does not match the raw samples`);
      }
      if (!approximately(row.maxNsPerOp, Math.max(...values))) {
        fail(`${rel} ${mode} maxNsPerOp does not match the raw samples`);
      }
      if (!approximately(row.spreadMaxOverMin, row.maxNsPerOp / row.minNsPerOp)) {
        fail(`${rel} ${mode} spread does not match max/min`);
      }
      if (row.spreadMaxOverMin > data.methodology.maxFinalSpread) {
        fail(`${rel} ${mode} spread exceeds the publication ceiling`);
      }
    }
    verifyShallowComparison(rel, data, summary);
    verifyShallowPublication(rel, summary);
  }

  if (!Number.isSafeInteger(data.sink) || data.sink <= 0) {
    fail(`${rel} has no positive observed-result sink`);
  }

  if (!errors.some(error => error.startsWith(rel))) {
    console.log(`${rel}: 12 raw samples, six balanced orders, semantics and provenance verified`);
  }
}

function verifyShallowSemantics(rel, checks) {
  const expected = [
    ['valid populated row', true, true],
    ['invalid field inside a populated relation', false, true],
    ['invalid field inside a list item', false, true],
    ['invalid top-level scalar', false, false],
    ['invalid relation shape', false, false],
    ['invalid list shape', false, false],
  ];
  if (!Array.isArray(checks) || checks.length !== expected.length) {
    fail(`${rel} must record all six semantic preflight checks`);
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const [name, full, shallow] = expected[index];
    const check = checks[index];
    if (
      check?.name !== name ||
      check?.expected?.full !== full ||
      check?.expected?.shallow !== shallow ||
      check?.actual?.full !== full ||
      check?.actual?.shallow !== shallow
    ) {
      fail(`${rel} semantic check ${index + 1} does not match the required ${name} outcome`);
    }
  }
}

function verifyShallowSample(rel, sample) {
  for (const key of ['round', 'position', 'iterations', 'accepted', 'totalMs', 'opsPerSec', 'nsPerOp']) {
    if (!positive(sample[key])) fail(`${rel} sample ${sample.mode} has invalid ${key}`);
  }
  if (!Number.isSafeInteger(sample.iterations) || sample.accepted !== sample.iterations) {
    fail(`${rel} sample ${sample.mode} did not observe one accepted result per valid input`);
  }
  const expectedNs = (sample.totalMs * 1_000_000) / sample.iterations;
  if (!approximately(sample.nsPerOp, expectedNs)) {
    fail(`${rel} sample ${sample.mode} nsPerOp does not match totalMs/iterations`);
  }
  const expectedOps = (sample.iterations / sample.totalMs) * 1000;
  if (!approximately(sample.opsPerSec, expectedOps)) {
    fail(`${rel} sample ${sample.mode} opsPerSec does not match iterations/totalMs`);
  }
}

function verifyShallowComparison(rel, data, summary) {
  const full = summary.find(row => row.mode === 'full');
  const shallow = summary.find(row => row.mode === 'shallow-depth-1');
  if (full === undefined || shallow === undefined) return;
  const expectedSpeedup = full.medianNsPerOp / shallow.medianNsPerOp;
  const expectedReduction = (1 - shallow.medianNsPerOp / full.medianNsPerOp) * 100;
  if (!approximately(data.comparison?.shallowVsFullSpeedup, expectedSpeedup)) {
    fail(`${rel} shallowVsFullSpeedup does not match the two medians`);
  }
  if (!approximately(data.comparison?.shallowTimeReductionPercent, expectedReduction)) {
    fail(`${rel} shallowTimeReductionPercent does not match the two medians`);
  }
}

function verifyShallowPublication(rel, summary) {
  const labels = {
    full: 'full',
    'shallow-depth-1': 'shallow depth 1',
  };
  const expectedRows = new Set(
    summary.map(row =>
      [
        labels[row.mode],
        row.medianNsPerOp.toFixed(2),
        String(Math.round(row.medianOpsPerSec)),
        `${row.spreadMaxOverMin.toFixed(3)}x`,
      ].join('|'),
    ),
  );
  const source = readFileSync(join(ROOT, 'benchmarks', 'RESULTS.md'), 'utf8');
  const rows = new Set(
    source
      .split('\n')
      .filter(line => line.startsWith('|'))
      .map(line =>
        line
          .split('|')
          .slice(1, -1)
          .map(cell => cell.trim().replaceAll(',', ''))
          .join('|'),
      ),
  );
  for (const expected of expectedRows) {
    if (!rows.has(expected)) fail(`benchmarks/RESULTS.md does not publish shallow-validation row: ${expected}`);
  }
}

async function verifyShallowValidationInputs(rel, inputs) {
  if (inputs?.algorithm !== 'sha256') {
    fail(`${rel} inputs.algorithm must be "sha256"`);
    return;
  }
  if (!Array.isArray(inputs.files)) {
    fail(`${rel} inputs.files must be an array`);
    return;
  }
  const paths = inputs.files.map(entry => entry?.path);
  if (JSON.stringify(paths) !== JSON.stringify(SHALLOW_VALIDATION_INPUTS)) {
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

function median(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
