#!/usr/bin/env node
// Reproducible full-vs-depth-1 AOT validation benchmark.
//
// The default run prints diagnostic JSON. `--write-final` is the only mode that writes the
// committed artifact. Every timed result is counted, inputs rotate through eight distinct
// populated rows, and semantic probes establish the deliberate difference in work before
// any timing starts.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg, platform, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { fullPopulatedRow, shallowPopulatedRow, type PopulatedOrderRow } from './shallow.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINAL_RESULT = join(ROOT, 'benchmarks', 'site', 'shallow-validation.json');
const POOL_SIZE = 8;
const POOL_MASK = POOL_SIZE - 1;
const RELATIONS_PER_ROW = 3;
const ITEMS_PER_ROW = 100;
const MAX_FINAL_SPREAD = 1.25;
const MODES = ['full', 'shallow-depth-1'] as const;
type Mode = (typeof MODES)[number];
const ORDERS: readonly (readonly Mode[])[] = [
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
  ['full', 'shallow-depth-1'],
  ['shallow-depth-1', 'full'],
];
const BENCHMARK_INPUTS = [
  'benchmarks/harness/validation/run-shallow.sh',
  'benchmarks/harness/validation/shallow-source.ts',
  'benchmarks/harness/validation/shallow.generated.ts',
  'benchmarks/harness/validation/shallow.bench.ts',
  'benchmarks/harness/validation/tsconfig.json',
  'benchmarks/scripts/generate-validation-model.mjs',
  'scripts/ts-specifier-hook.mjs',
];

const writeFinal = parseArgs(process.argv.slice(2));
const warmupMs = positiveNumber(process.env.ZMDB_SHALLOW_WARMUP_MS ?? '500', 'ZMDB_SHALLOW_WARMUP_MS');
const targetSampleMs = positiveNumber(process.env.ZMDB_SHALLOW_SAMPLE_MS ?? '300', 'ZMDB_SHALLOW_SAMPLE_MS');
const warmupBatchIters = positiveInteger(process.env.ZMDB_SHALLOW_WARMUP_BATCH ?? '10000', 'ZMDB_SHALLOW_WARMUP_BATCH');
const maxSampleIters = positiveInteger(process.env.ZMDB_SHALLOW_MAX_ITERS ?? '30000000', 'ZMDB_SHALLOW_MAX_ITERS');
const statusBefore = git(['status', '--porcelain=v1', '--untracked-files=all']);

const POOL: readonly PopulatedOrderRow[] = Array.from({ length: POOL_SIZE }, (_, row) => populatedOrder(row));
const CASES: Readonly<Record<Mode, (value: unknown) => boolean>> = {
  full: fullPopulatedRow,
  'shallow-depth-1': shallowPopulatedRow,
};

let cursor = 0;
let sink = 0;

const semanticChecks = verifySemantics();
const warmups = MODES.map(mode => warm(mode));
const iterationsByMode = new Map(
  warmups.map(result => [
    result.mode,
    Math.min(maxSampleIters, Math.max(1, Math.ceil((result.opsPerSec * targetSampleMs) / 1000))),
  ]),
);
const samples = [];
for (let round = 0; round < ORDERS.length; round += 1) {
  const order = ORDERS[round];
  if (order === undefined) throw new Error(`missing shallow-validation order for round ${String(round + 1)}`);
  for (let position = 0; position < order.length; position += 1) {
    const mode = order[position];
    if (mode === undefined)
      throw new Error(`missing mode at round ${String(round + 1)}, position ${String(position + 1)}`);
    const iters = iterationsByMode.get(mode);
    if (iters === undefined) throw new Error(`no calibrated iteration count for ${mode}`);
    samples.push({ round: round + 1, position: position + 1, mode, ...measure(mode, iters) });
  }
}

const summary = summarize(samples);
const full = summary.find(row => row.mode === 'full');
const shallow = summary.find(row => row.mode === 'shallow-depth-1');
if (full === undefined || shallow === undefined)
  throw new Error('the shallow benchmark did not produce both summaries');
const unstable = summary.filter(row => row.spreadMaxOverMin > MAX_FINAL_SPREAD);
if (writeFinal && unstable.length > 0) {
  throw new Error(
    `refusing to publish an unstable shallow benchmark: ${unstable
      .map(row => `${row.mode} spread ${row.spreadMaxOverMin.toFixed(3)}x`)
      .join(', ')}; rerun when the machine is quiet`,
  );
}

const output = {
  schemaVersion: 1,
  suite: '@zmdb/aot-validator populated-row shallow validation',
  publicationStatus: writeFinal ? 'final' : 'diagnostic',
  measuredAt: new Date().toISOString(),
  baseHead: git(['rev-parse', 'HEAD']),
  dirty: statusBefore.length > 0,
  inputs: {
    algorithm: 'sha256',
    files: await benchmarkInputManifest(),
  },
  runtime: {
    node: process.version,
    platform: `${platform()}/${process.arch}`,
    host: hostname(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    loadAverage: loadavg(),
    cpuGovernor: readOptional('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
  },
  workload: {
    row: 'PopulatedOrderRow',
    poolSize: POOL_SIZE,
    relations: ['customer', 'warehouse', 'carrier'],
    relationsPerRow: RELATIONS_PER_ROW,
    list: 'items',
    listItemsPerRow: ITEMS_PER_ROW,
  },
  methodology: {
    source:
      'transformFile output in benchmarks/harness/validation/shallow.generated.ts via scripts/ts-specifier-hook.mjs',
    comparison: 'is<PopulatedOrderRow> versus isShallow<PopulatedOrderRow, 1>',
    warmup: `each mode ran until ${String(warmupMs)} ms of timed hot-loop work had elapsed`,
    warmupMs,
    warmupBatchIters,
    targetSampleMs,
    maxSampleIters,
    maxFinalSpread: MAX_FINAL_SPREAD,
    rounds: ORDERS.length,
    order: 'six alternating orders; each mode appears three times in each ordinal position',
    permutations: ORDERS,
    inputRotation: 'every operation selects the next row from an eight-row power-of-two pool',
    resultObservation: 'every boolean result contributes to an accepted count checked after the timed interval',
  },
  semanticChecks,
  warmups,
  samples,
  summary,
  comparison: {
    shallowVsFullSpeedup: full.medianNsPerOp / shallow.medianNsPerOp,
    shallowTimeReductionPercent: (1 - shallow.medianNsPerOp / full.medianNsPerOp) * 100,
  },
  sink,
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (writeFinal) {
  writeFileSync(FINAL_RESULT, serialized);
  process.stderr.write(`wrote final shallow-validation benchmark: ${FINAL_RESULT}\n`);
} else {
  process.stdout.write(serialized);
}

function populatedOrder(seed: number): PopulatedOrderRow {
  return {
    id: `order-${String(seed)}`,
    status: seed % 3 === 0 ? 'open' : seed % 3 === 1 ? 'paid' : 'shipped',
    currency: seed % 2 === 0 ? 'INR' : 'USD',
    total: 10_000 + seed,
    placedAt: `2026-09-${String(seed + 1).padStart(2, '0')}T10:00:00.000Z`,
    customer: {
      id: `customer-${String(seed)}`,
      email: `customer-${String(seed)}@example.test`,
      loyaltyTier: seed % 2 === 0 ? 'standard' : 'priority',
    },
    warehouse: {
      id: `warehouse-${String(seed)}`,
      code: `WH-${String(seed).padStart(2, '0')}`,
      region: seed % 2 === 0 ? 'north' : 'south',
    },
    carrier: {
      id: `carrier-${String(seed)}`,
      service: seed % 2 === 0 ? 'ground' : 'air',
      trackingPrefix: `TRK${String(seed)}`,
    },
    items: Array.from({ length: ITEMS_PER_ROW }, (_, item) => ({
      id: `item-${String(seed)}-${String(item)}`,
      sku: `SKU-${String(item).padStart(4, '0')}`,
      quantity: (item % 5) + 1,
      unitPrice: 100 + item,
      lineTotal: (100 + item) * ((item % 5) + 1),
      taxRate: item % 2 === 0 ? 0.05 : 0.18,
      fulfilled: item % 3 !== 0,
    })),
  };
}

function verifySemantics() {
  const valid = POOL[0];
  if (valid === undefined) throw new Error('the shallow benchmark pool is empty');
  const firstItem = valid.items[0];
  if (firstItem === undefined) throw new Error('the populated row has no list item');

  const probes = [
    { name: 'valid populated row', value: valid, full: true, shallow: true },
    {
      name: 'invalid field inside a populated relation',
      value: { ...valid, customer: { ...valid.customer, id: 42 } },
      full: false,
      shallow: true,
    },
    {
      name: 'invalid field inside a list item',
      value: { ...valid, items: [{ ...firstItem, quantity: 'many' }, ...valid.items.slice(1)] },
      full: false,
      shallow: true,
    },
    { name: 'invalid top-level scalar', value: { ...valid, total: 'many' }, full: false, shallow: false },
    { name: 'invalid relation shape', value: { ...valid, warehouse: null }, full: false, shallow: false },
    { name: 'invalid list shape', value: { ...valid, items: { length: ITEMS_PER_ROW } }, full: false, shallow: false },
  ];

  return probes.map(probe => {
    const actual = {
      full: fullPopulatedRow(probe.value),
      shallow: shallowPopulatedRow(probe.value),
    };
    if (actual.full !== probe.full || actual.shallow !== probe.shallow) {
      throw new Error(
        `${probe.name}: expected full=${String(probe.full)}, shallow=${String(probe.shallow)}; ` +
          `got full=${String(actual.full)}, shallow=${String(actual.shallow)}`,
      );
    }
    return { name: probe.name, expected: { full: probe.full, shallow: probe.shallow }, actual };
  });
}

function warm(mode: Mode) {
  let iterations = 0;
  let hotLoopMs = 0;
  const wallStart = performance.now();
  while (hotLoopMs < warmupMs) {
    const result = measure(mode, warmupBatchIters);
    iterations += result.iterations;
    hotLoopMs += result.totalMs;
  }
  return {
    mode,
    iterations,
    hotLoopMs,
    wallMs: performance.now() - wallStart,
    opsPerSec: (iterations / hotLoopMs) * 1000,
  };
}

function measure(mode: Mode, iterations: number) {
  const check = CASES[mode];
  let accepted = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    if (check(POOL[(cursor + index) & POOL_MASK])) accepted += 1;
  }
  const totalMs = performance.now() - start;
  cursor = (cursor + iterations) & POOL_MASK;
  sink = (Math.imul(sink ^ accepted, 16_777_619) ^ (mode === 'full' ? 1 : 2)) >>> 0;
  if (accepted !== iterations) {
    throw new Error(`${mode} accepted ${String(accepted)} of ${String(iterations)} valid populated rows`);
  }
  return {
    iterations,
    accepted,
    totalMs,
    opsPerSec: (iterations / totalMs) * 1000,
    nsPerOp: (totalMs * 1_000_000) / iterations,
  };
}

function summarize(raw: readonly { readonly mode: Mode; readonly iterations: number; readonly nsPerOp: number }[]) {
  return MODES.map(mode => {
    const selected = raw.filter(sample => sample.mode === mode);
    const values = selected.map(sample => sample.nsPerOp);
    const medianNsPerOp = median(values);
    const iterationCounts = new Set(selected.map(sample => sample.iterations));
    if (iterationCounts.size !== 1) throw new Error(`${mode} iteration count changed between samples`);
    return {
      mode,
      samples: selected.length,
      iterationsPerSample: selected[0]?.iterations ?? 0,
      medianNsPerOp,
      medianOpsPerSec: 1_000_000_000 / medianNsPerOp,
      minNsPerOp: Math.min(...values),
      maxNsPerOp: Math.max(...values),
      spreadMaxOverMin: Math.max(...values) / Math.min(...values),
    };
  });
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot take the median of an empty sample');
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  if (high === undefined) throw new Error('median has no middle value');
  if (sorted.length % 2 === 1) return high;
  const low = sorted[middle - 1];
  if (low === undefined) throw new Error('median has no lower middle value');
  return (low + high) / 2;
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function positiveNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

function parseArgs(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg !== '--write-final') throw new Error(`unknown shallow benchmark argument: ${arg}`);
  }
  return args.includes('--write-final');
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function readOptional(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

async function benchmarkInputManifest() {
  return Promise.all(
    BENCHMARK_INPUTS.map(async path => ({
      path,
      sha256: await sha256(readFileSync(join(ROOT, path))),
    })),
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
