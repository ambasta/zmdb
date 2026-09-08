#!/usr/bin/env node
// Repeat the existing zmdb workloads and retain their raw output beside a summary.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({
  options: {
    stage: { type: 'string', default: 'all' },
    rounds: { type: 'string', default: '7' },
    'work-dir': { type: 'string' },
    output: { type: 'string', default: join(ROOT, 'benchmarks/site/engineering.json') },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'node benchmarks/scripts/baseline.mjs --work-dir PATH [--stage all|editor|lifecycle|orm|report] [--rounds 7] [--output FILE]',
  );
  console.log(
    'Run on an idle machine. ORM requires K6 and PGURL for a seeded current PostgreSQL server. Only zmdb is measured.',
  );
  process.exit(0);
}
assert(values['work-dir'], '--work-dir is required; use a directory outside the source workspace');
assert(['all', 'editor', 'lifecycle', 'orm', 'report'].includes(values.stage), 'Unknown stage');
const rounds = Number(values.rounds);
assert(Number.isSafeInteger(rounds) && rounds > 0, '--rounds must be a positive integer');
const work = resolve(values['work-dir']);
mkdirSync(work, { recursive: true });
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const metadata = join(work, 'environment.json');
if (!existsSync(metadata))
  write(metadata, {
    startedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    node: process.version,
    npm: execFileSync('npm', ['--version'], { cwd: work, encoding: 'utf8' }).trim(),
    yarn: execFileSync('yarn', ['--version'], { encoding: 'utf8' }).trim(),
    platform: `${platform()} ${release()} ${process.arch}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    initialLoadAverage: loadavg(),
  });

function command(label, executable, args, cwd = ROOT, env = {}) {
  process.stderr.write(`[baseline] ${label}\n`);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 1_800_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const record = {
    label,
    executable,
    args,
    startedAt,
    elapsedMs: performance.now() - start,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  write(join(work, `${label}-${startedAt.replaceAll(':', '-')}.command.json`), record);
  assert.equal(result.status, 0, `${label} failed: ${result.error ?? result.stderr}`);
  return result.stdout;
}

if (values.stage === 'all' || values.stage === 'editor') {
  for (let round = 1; round <= rounds; round++) {
    command(`editor-${round}`, process.execPath, [
      join(ROOT, 'benchmarks/scripts/typescript.mjs'),
      '--output',
      join(work, `editor-${round}.json`),
    ]);
  }
}
if (values.stage === 'all' || values.stage === 'lifecycle') {
  for (let round = 1; round <= rounds; round++) {
    command(`lifecycle-${round}`, process.execPath, [
      join(ROOT, 'benchmarks/scripts/lifecycle.mjs'),
      '--work-dir',
      join(work, `lifecycle-${round}`),
      '--stage',
      'all',
    ]);
  }
}
if (values.stage === 'all' || values.stage === 'orm') {
  assert(process.env.K6 && process.env.PGURL, 'ORM requires K6 and PGURL');
  const database = command(
    'postgres-version',
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {Client} from 'pg'; const db=new Client({connectionString:process.env.PGURL}); await db.connect(); console.log(JSON.stringify((await db.query('SELECT version() AS version')).rows[0])); await db.end();",
    ],
    join(ROOT, 'benchmarks/harness/orm'),
  );
  const k6 = command('k6-version', process.env.K6, ['version']).trim();
  write(join(work, 'database.json'), { ...jsonFromOutput(database), k6 });
  command('orm', 'bash', [join(ROOT, 'benchmarks/harness/orm/run-k6-rich.sh')], ROOT, {
    ORMS: 'zmdb',
    REPEATS: String(rounds),
    WORK: join(work, 'orm'),
  });
}

function jsonFromOutput(text) {
  return JSON.parse(text.trim());
}

if (values.stage === 'all' || values.stage === 'report') {
  const raw = { environment: json(metadata), editor: [], lifecycle: [], orm: [], commands: [] };
  const metrics = new Map();
  function sample(name, unit, value) {
    assert(Number.isFinite(value), `${name} did not produce a finite measurement`);
    if (!metrics.has(name)) metrics.set(name, { name, unit, samples: [] });
    metrics.get(name).samples.push(value);
  }
  for (let round = 1; round <= rounds; round++) {
    const editor = json(join(work, `editor-${round}.json`));
    raw.editor.push(editor);
    for (const fixture of editor.results) {
      for (const entry of fixture.editor) sample(`editor/${fixture.fixture}/${entry.operation}`, 'ms', entry.elapsedMs);
      for (const entry of fixture.compilation)
        sample(`compiler/${fixture.fixture}/${entry.mode}`, 'ms', entry.elapsedMs);
    }
    const lifecycle = json(join(work, `lifecycle-${round}/lifecycle-all.json`));
    assert(lifecycle.ok, `lifecycle round ${round} failed`);
    raw.lifecycle.push(lifecycle);
    for (const entry of lifecycle.build.builds) sample(`build/${entry.cache}`, 'ms', entry.durationMs);
    const packs = lifecycle.commands.filter(entry => entry.label.startsWith('pack '));
    sample(
      'package/pack-required-closure',
      'ms',
      packs.reduce((sum, entry) => sum + entry.durationMs, 0),
    );
    sample(
      'package/archive-size',
      'bytes',
      lifecycle.build.packages.reduce((sum, entry) => sum + entry.bytes, 0),
    );
    for (const field of ['installMs', 'importMs', 'typecheckAndEmitMs', 'processMs'])
      sample(`consumer/${field}`, 'ms', lifecycle.consumer[field]);
    sample('consumer/installed-size-with-typescript', 'bytes', lifecycle.consumer.installedBytes);
    sample('consumer/installed-package-count-with-typescript', 'count', lifecycle.consumer.packageCount);
    for (const field of [
      'applicationInitMs',
      'processToReadinessMs',
      'firstHttpMs',
      'firstApplicationQueryMs',
      'shutdownMs',
    ])
      sample(`startup/${field}`, 'ms', lifecycle.consumer.firstWork[field]);
    const orm = json(join(work, `orm/k6rich/zmdb-rep${round}.json`));
    raw.orm.push(orm);
    const metric = name => orm.metrics[name]?.values ?? orm.metrics[name];
    const failed = metric('http_req_failed');
    const failures = failed?.passes ?? failed?.fails;
    assert.equal(failures, 0, `ORM round ${round} returned failed requests`);
    sample('postgres/requests-per-second', 'req/s', metric('http_reqs').rate);
    for (const key of ['avg', 'med', 'p(90)', 'p(95)', 'p(99)'])
      sample(`postgres/latency-${key}`, 'ms', metric('http_req_duration')[key]);
  }
  for (const file of readdirSync(work).filter(entry => entry.endsWith('.command.json')))
    raw.commands.push(json(join(work, file)));
  const summaries = [...metrics.values()].map(metric => {
    const sorted = metric.samples.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      ...metric,
      median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      min: sorted[0],
      max: sorted.at(-1),
    };
  });
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  const rawFile = output.replace(/\.json$/, '') + '-raw.json.gz';
  writeFileSync(rawFile, gzipSync(JSON.stringify(raw)));
  write(output, {
    ...raw.environment,
    completedAt: new Date().toISOString(),
    rounds,
    project: 'zmdb',
    typescript: raw.editor[0].typescript,
    sqlite: raw.lifecycle[0].consumer.firstWork.database.version,
    postgres: json(join(work, 'database.json')).version,
    k6: json(join(work, 'database.json')).k6,
    rawFile: rawFile.slice(dirname(output).length + 1),
    methodology:
      'Repeated current-revision zmdb measurements. Every sample is retained; summaries report median and range. Clean build means no emitted output; cached build retains filesystem/dependency caches. OS caches are not flushed. Compiler and installation tools are included in consumer size. PostgreSQL and load generator share this machine. No competitor reruns or comparative ranking.',
    reproduction:
      'node benchmarks/scripts/baseline.mjs --work-dir <outside-workspace> --rounds 7 (K6 and PGURL must identify the load generator and seeded PostgreSQL server)',
    metrics: summaries,
  });
  console.log(output);
}
