#!/usr/bin/env node
// Reproducible @zmdb/web observability microbenchmark.
//
// The default command prints a diagnostic JSON document to stdout. It never
// overwrites the committed result. `--write-final` writes
// benchmarks/site/observability.json with a SHA-256 manifest of every declared
// benchmark input, so a pre-commit measurement remains exactly verifiable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, loadavg, platform, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { benchmarkObservability } from '../../packages/web/src/bench/index.js';
import { fromOpenTelemetry } from '../../packages/web/src/observability/otel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FINAL_RESULT = join(ROOT, 'benchmarks', 'site', 'observability.json');
const MODES = ['off', 'noop', 'recording-exporter'];
const WORKLOADS = ['request', 'query'];
const PERMUTATIONS = [
  ['off', 'noop', 'recording-exporter'],
  ['noop', 'recording-exporter', 'off'],
  ['recording-exporter', 'off', 'noop'],
  ['recording-exporter', 'noop', 'off'],
  ['noop', 'off', 'recording-exporter'],
  ['off', 'recording-exporter', 'noop'],
];
const BENCHMARK_INPUTS = [
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

const writeFinal = parseArgs(process.argv.slice(2));
const warmupMs = positiveNumber(process.env.ZMDB_OBSERVABILITY_WARMUP_MS ?? '750', 'ZMDB_OBSERVABILITY_WARMUP_MS');
const targetSampleMs = positiveNumber(
  process.env.ZMDB_OBSERVABILITY_SAMPLE_MS ?? '250',
  'ZMDB_OBSERVABILITY_SAMPLE_MS',
);
const warmupBatchIters = positiveInteger(
  process.env.ZMDB_OBSERVABILITY_WARMUP_BATCH ?? '50000',
  'ZMDB_OBSERVABILITY_WARMUP_BATCH',
);
const maxSampleIters = positiveInteger(
  process.env.ZMDB_OBSERVABILITY_MAX_ITERS ?? '10000000',
  'ZMDB_OBSERVABILITY_MAX_ITERS',
);
const explicitIters =
  process.env.ZMDB_OBSERVABILITY_ITERS === undefined
    ? undefined
    : positiveInteger(process.env.ZMDB_OBSERVABILITY_ITERS, 'ZMDB_OBSERVABILITY_ITERS');

const statusBefore = git(['status', '--porcelain=v1', '--untracked-files=all']);

const require = createRequire(import.meta.url);
const dependencyVersions = {
  '@opentelemetry/api': packageVersion('@opentelemetry/api'),
  '@opentelemetry/sdk-trace-base': packageVersion('@opentelemetry/sdk-trace-base'),
};

async function measure(cases) {
  const warmups = [];
  const iterationsByWorkload = new Map();

  for (const workload of WORKLOADS) {
    const workloadWarmups = [];
    for (const mode of MODES) {
      const result = await warm(cases.get(mode), workload);
      warmups.push(result);
      workloadWarmups.push(result);
    }
    const fastestOpsPerSec = Math.max(...workloadWarmups.map(result => result.lastOpsPerSec));
    const calibrated = Math.max(1, Math.ceil((fastestOpsPerSec * targetSampleMs) / 1000));
    iterationsByWorkload.set(workload, explicitIters ?? Math.min(calibrated, maxSampleIters));
  }

  const samples = [];
  const workloadChecksums = new Map();
  for (const workload of WORKLOADS) {
    const iters = iterationsByWorkload.get(workload);
    if (iters === undefined) {
      throw new Error(`no calibrated iteration count for ${workload}`);
    }

    for (let round = 0; round < PERMUTATIONS.length; round += 1) {
      const order = PERMUTATIONS[round];
      if (order === undefined) {
        throw new Error(`missing observability order for round ${round}`);
      }
      for (let position = 0; position < order.length; position += 1) {
        const mode = order[position];
        const benchmarkCase = cases.get(mode);
        if (mode === undefined || benchmarkCase === undefined) {
          throw new Error(`unknown observability mode at round ${round}, position ${position}`);
        }

        benchmarkCase.reset();
        const result = await benchmarkObservability({
          mode,
          workload,
          iters,
          ...(benchmarkCase.observability === undefined ? {} : { observability: benchmarkCase.observability }),
        });
        await benchmarkCase.flush();
        const exported = benchmarkCase.exported();
        assertExporterResult(mode, workload, iters, exported);
        assertWorkloadChecksum(workloadChecksums, result);

        samples.push({
          round: round + 1,
          position: position + 1,
          mode,
          workload,
          iters,
          totalMs: result.totalMs,
          opsPerSec: result.opsPerSec,
          nsPerOp: (result.totalMs * 1_000_000) / iters,
          checksum: result.checksum,
          exportedSpans: exported.count,
          exporterChecksum: exported.checksum,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    suite: '@zmdb/web observability overhead',
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
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      loadAverage: loadavg(),
      cpuGovernor: readOptional('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
    },
    dependencies: dependencyVersions,
    methodology: {
      source: 'packages/web/src/bench/index.ts via scripts/ts-specifier-hook.mjs',
      warmup: `each workload/mode ran until ${warmupMs} ms of timed hot-loop work had elapsed`,
      warmupMs,
      warmupBatchIters,
      targetSampleMs,
      maxSampleIters,
      explicitIters: explicitIters ?? null,
      rounds: PERMUTATIONS.length,
      order: 'all six permutations; every mode appears twice in every ordinal position',
      permutations: PERMUTATIONS,
      workloads: {
        request: 'one matched GET route; response status and body length consumed; three spans per operation',
        query: 'one compiled SELECT through tracedDriver; returned row count consumed; one span per operation',
      },
      modes: {
        off: 'no Observability object passed to the hot path',
        noop: '@opentelemetry/api default no-op tracer adapted through fromOpenTelemetry',
        'recording-exporter':
          'BasicTracerProvider + SimpleSpanProcessor + bounded recording SpanExporter through fromOpenTelemetry',
      },
      exporter: 'flush and reset occur outside the timed interval; metrics are disabled in every mode',
    },
    warmups,
    samples,
    summary: summarize(samples),
  };
}

async function warm(benchmarkCase, workload) {
  if (benchmarkCase === undefined) {
    throw new Error(`missing benchmark case while warming ${workload}`);
  }
  benchmarkCase.reset();
  let hotLoopMs = 0;
  let iterations = 0;
  let lastOpsPerSec = 0;
  const wallStart = performance.now();

  while (hotLoopMs < warmupMs) {
    const result = await benchmarkObservability({
      mode: benchmarkCase.mode,
      workload,
      iters: warmupBatchIters,
      ...(benchmarkCase.observability === undefined ? {} : { observability: benchmarkCase.observability }),
    });
    hotLoopMs += result.totalMs;
    iterations += result.iters;
    lastOpsPerSec = result.opsPerSec;
  }

  await benchmarkCase.flush();
  const exported = benchmarkCase.exported();
  assertExporterResult(benchmarkCase.mode, workload, iterations, exported);
  benchmarkCase.reset();
  return {
    mode: benchmarkCase.mode,
    workload,
    iterations,
    hotLoopMs,
    wallMs: performance.now() - wallStart,
    lastOpsPerSec,
  };
}

function createBenchmarkCases() {
  const noopTracer = trace.getTracer(
    '@zmdb/web-observability-benchmark-noop',
    dependencyVersions['@opentelemetry/api'],
  );
  const exporter = new BoundedRecordingSpanExporter(1024);
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const recordingTracer = provider.getTracer(
    '@zmdb/web-observability-benchmark-recording',
    dependencyVersions['@opentelemetry/sdk-trace-base'],
  );

  return new Map([
    [
      'off',
      {
        mode: 'off',
        observability: undefined,
        reset: () => undefined,
        flush: () => Promise.resolve(),
        exported: () => ({ count: 0, checksum: 0 }),
        shutdown: () => Promise.resolve(),
      },
    ],
    [
      'noop',
      {
        mode: 'noop',
        observability: fromOpenTelemetry({ tracer: noopTracer }),
        reset: () => undefined,
        flush: () => Promise.resolve(),
        exported: () => ({ count: 0, checksum: 0 }),
        shutdown: () => Promise.resolve(),
      },
    ],
    [
      'recording-exporter',
      {
        mode: 'recording-exporter',
        observability: fromOpenTelemetry({ tracer: recordingTracer }),
        reset: () => exporter.reset(),
        flush: () => provider.forceFlush(),
        exported: () => exporter.snapshot(),
        shutdown: () => provider.shutdown(),
      },
    ],
  ]);
}

class BoundedRecordingSpanExporter {
  #ring;
  #next = 0;
  #count = 0;
  #checksum = 0;

  constructor(capacity) {
    this.#ring = Array.from({ length: capacity });
  }

  export(spans, resultCallback) {
    for (const span of spans) {
      let attributeCount = 0;
      let fingerprint = hashString(span.name);
      for (const key in span.attributes) {
        if (!Object.hasOwn(span.attributes, key)) continue;
        attributeCount += 1;
        fingerprint = mix(fingerprint, hashString(key));
        fingerprint = mix(fingerprint, hashString(String(span.attributes[key])));
      }
      fingerprint = mix(fingerprint, span.events.length);
      fingerprint = mix(fingerprint, span.status.code);
      this.#ring[this.#next] = {
        name: span.name,
        attributeCount,
        eventCount: span.events.length,
        statusCode: span.status.code,
      };
      this.#next = (this.#next + 1) % this.#ring.length;
      this.#count += 1;
      this.#checksum = mix(this.#checksum, fingerprint);
    }
    resultCallback({ code: 0 });
  }

  forceFlush() {
    return Promise.resolve();
  }

  shutdown() {
    return Promise.resolve();
  }

  reset() {
    this.#ring.fill(undefined);
    this.#next = 0;
    this.#count = 0;
    this.#checksum = 0;
  }

  snapshot() {
    return { count: this.#count, checksum: this.#checksum };
  }
}

const benchmarkCases = createBenchmarkCases();
let output;
try {
  output = await measure(benchmarkCases);
} finally {
  await Promise.all([...benchmarkCases.values()].map(benchmarkCase => benchmarkCase.shutdown()));
}

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (writeFinal) {
  writeFileSync(FINAL_RESULT, serialized);
  process.stderr.write(`wrote final observability benchmark: ${FINAL_RESULT}\n`);
} else {
  process.stdout.write(serialized);
}

function summarize(samples) {
  const summary = [];
  for (const workload of WORKLOADS) {
    const medians = new Map();
    for (const mode of MODES) {
      const selected = samples.filter(sample => sample.workload === workload && sample.mode === mode);
      medians.set(mode, median(selected.map(sample => sample.nsPerOp)));
    }
    const offNsPerOp = medians.get('off');
    if (offNsPerOp === undefined) {
      throw new Error(`no off-path median for ${workload}`);
    }

    for (const mode of MODES) {
      const selected = samples.filter(sample => sample.workload === workload && sample.mode === mode);
      const nsValues = selected.map(sample => sample.nsPerOp);
      const medianNsPerOp = medians.get(mode);
      if (medianNsPerOp === undefined) {
        throw new Error(`no ${mode} median for ${workload}`);
      }
      const exporterCounts = new Set(selected.map(sample => sample.exportedSpans));
      const exporterChecksums = new Set(selected.map(sample => sample.exporterChecksum));
      summary.push({
        workload,
        mode,
        samples: selected.length,
        itersPerSample: selected[0]?.iters ?? 0,
        medianNsPerOp,
        medianOpsPerSec: 1_000_000_000 / medianNsPerOp,
        minNsPerOp: Math.min(...nsValues),
        maxNsPerOp: Math.max(...nsValues),
        spreadMaxOverMin: Math.max(...nsValues) / Math.min(...nsValues),
        overheadVsOffPercent: (medianNsPerOp / offNsPerOp - 1) * 100,
        exportedSpans: singleValue(exporterCounts, `${workload}/${mode} exported span count`),
        exporterChecksum: singleValue(exporterChecksums, `${workload}/${mode} exporter checksum`),
      });
    }
  }
  return summary;
}

function assertWorkloadChecksum(checksums, result) {
  const expected = checksums.get(result.workload);
  if (expected === undefined) {
    checksums.set(result.workload, result.checksum);
    return;
  }
  if (result.checksum !== expected) {
    throw new Error(
      `${result.workload}/${result.mode} checksum ${result.checksum} does not match the baseline ${expected}`,
    );
  }
}

function assertExporterResult(mode, workload, iters, exported) {
  const expected = mode === 'recording-exporter' ? iters * (workload === 'request' ? 3 : 1) : 0;
  if (exported.count !== expected) {
    throw new Error(`${workload}/${mode} exported ${exported.count} spans; expected ${expected}`);
  }
  if (mode === 'recording-exporter' ? exported.checksum === 0 : exported.checksum !== 0) {
    throw new Error(`${workload}/${mode} produced an invalid exporter checksum ${exported.checksum}`);
  }
}

function singleValue(values, label) {
  if (values.size !== 1) {
    throw new Error(`${label} changed across samples: ${[...values].join(', ')}`);
  }
  const value = values.values().next().value;
  if (value === undefined) {
    throw new Error(`${label} has no value`);
  }
  return value;
}

function median(values) {
  if (values.length === 0) {
    throw new Error('cannot take the median of an empty sample');
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  if (high === undefined) {
    throw new Error('median has no middle value');
  }
  if (sorted.length % 2 === 1) {
    return high;
  }
  const low = sorted[middle - 1];
  if (low === undefined) {
    throw new Error('median has no lower middle value');
  }
  return (low + high) / 2;
}

function mix(current, value) {
  return Math.imul(current ^ value, 16_777_619) >>> 0;
}

function hashString(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = mix(hash, value.charCodeAt(index));
  }
  return hash;
}

function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveNumber(raw, name) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function parseArgs(args) {
  for (const arg of args) {
    if (arg !== '--write-final') {
      throw new Error(`unknown observability benchmark argument: ${arg}`);
    }
  }
  return args.includes('--write-final');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

function packageVersion(name) {
  let directory = dirname(require.resolve(name));
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, 'utf8'));
      if (value.name === name && typeof value.version === 'string') {
        return value.version;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`could not locate package.json for ${name}`);
    }
    directory = parent;
  }
}

async function benchmarkInputManifest() {
  return Promise.all(
    BENCHMARK_INPUTS.map(async path => ({
      path,
      sha256: await sha256(readFileSync(join(ROOT, path))),
    })),
  );
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
