#!/usr/bin/env node
// Compare repeated eager HTTP application creation using each revision's sources.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { cpus, loadavg, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '../..');
const args = process.argv.slice(2);
const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const positive = (input, name) => {
  const number = Number(input);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
};

if (args.includes('--help')) {
  process.stdout.write(
    'node benchmarks/scripts/app-startup.mjs --quick\n' +
      'node benchmarks/scripts/app-startup.mjs --before=/clean/before --after=/clean/after --write-final\n' +
      'Optional: --rounds=8 --iterations=20000 --warmup=5000. Each sample uses a fresh child process.\n',
  );
} else if (args.includes('--child')) {
  await child(resolve(value('root')), positive(value('iterations'), 'iterations'), positive(value('warmup'), 'warmup'));
} else {
  const allowed = /^(?:--quick|--write-final|--(?:before|after|rounds|iterations|warmup)=.+)$/;
  for (const arg of args) if (!allowed.test(arg)) throw new Error(`unknown option: ${arg}`);
  const quick = args.includes('--quick');
  const writeFinal = args.includes('--write-final');
  const before = value('before');
  if (writeFinal && (quick || before === undefined)) throw new Error('--write-final requires --before and no --quick');
  const revisions = [
    ...(before === undefined ? [] : [{ label: 'before', root: resolve(before) }]),
    { label: 'after', root: resolve(value('after') ?? root) },
  ];
  const rounds = positive(value('rounds') ?? (quick ? '1' : '8'), 'rounds');
  const iterations = positive(value('iterations') ?? (quick ? '100' : '20000'), 'iterations');
  const warmup = positive(value('warmup') ?? (quick ? '20' : '5000'), 'warmup');
  if (writeFinal && (rounds < 8 || rounds % 2 !== 0))
    throw new Error('final comparison requires at least eight balanced rounds');
  const git = (directory, command) => execFileSync('git', command, { cwd: directory, encoding: 'utf8' }).trim();
  for (const revision of revisions) {
    revision.head = git(revision.root, ['rev-parse', 'HEAD']);
    revision.status = git(revision.root, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (writeFinal && revision.status !== '')
      throw new Error(`final comparison requires a clean ${revision.label} worktree`);
  }
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0 ? revisions : revisions.toReversed();
    for (const [position, revision] of order.entries()) {
      const command = [
        script,
        '--child',
        `--root=${revision.root}`,
        `--iterations=${iterations}`,
        `--warmup=${warmup}`,
      ];
      const sample = JSON.parse(
        execFileSync(process.execPath, command, { cwd: revision.root, encoding: 'utf8', timeout: 120_000 }),
      );
      samples.push({ round, position, revision: revision.label, command: [process.execPath, ...command], ...sample });
    }
  }
  const median = numbers => {
    const sorted = numbers.toSorted((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  };
  const summary = revisions.map(revision => {
    const values = samples.filter(sample => sample.revision === revision.label).map(sample => sample.nsPerApplication);
    return {
      revision: revision.label,
      samples: values.length,
      medianNsPerApplication: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });
  const result = {
    suite: 'zmdb eager HTTP application startup',
    publicationStatus: writeFinal ? 'final' : 'diagnostic',
    measuredAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)],
    runtime: {
      node: process.version,
      platform: platform(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      loadAverage: loadavg(),
    },
    methodology: {
      rounds,
      iterations,
      warmup,
      workload:
        'createApp with one eager module and one value provider; module-plan warmup excluded; no init hooks or request handling',
      processPerSample: true,
      order: 'alternating before/after and after/before',
    },
    revisions,
    samples,
    summary,
    ...(summary.length === 2
      ? { changePercent: (summary[1].medianNsPerApplication / summary[0].medianNsPerApplication - 1) * 100 }
      : {}),
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (writeFinal) writeFileSync(join(root, 'benchmarks/site/app-startup.json'), json);
  process.stdout.write(json);
}

async function child(revisionRoot, iterations, warmup) {
  // Bind official imports to this checkout even when third-party dependencies are shared.
  const resolvedPackages = new Map();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@zmdb/')) {
        const [name, ...subpath] = specifier.slice('@zmdb/'.length).split('/');
        const directory = join(revisionRoot, 'packages', name);
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        let target = manifest.exports[subpath.length === 0 ? '.' : `./${subpath.join('/')}`];
        while (target !== null && typeof target === 'object') target = target.import ?? target.default;
        if (typeof target !== 'string') throw new Error(`no runtime export for ${specifier} in ${revisionRoot}`);
        const url = pathToFileURL(join(directory, target)).href;
        resolvedPackages.set(name, { version: manifest.version, directory });
        return { url, shortCircuit: true };
      }
      if (/^\.{1,2}\/.*\.js$/.test(specifier) && context.parentURL !== undefined) {
        const js = new URL(specifier, context.parentURL);
        const ts = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts)))
          return { url: ts.href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const moduleOwner = existsSync(join(revisionRoot, 'packages/app/src/modules/index.ts')) ? 'app' : 'web';
  const { Module } = await import(
    pathToFileURL(join(revisionRoot, `packages/${moduleOwner}/src/modules/index.ts`)).href
  );
  const { createApp } = await import(pathToFileURL(join(revisionRoot, 'packages/web/src/app/index.ts')).href);
  class StartupModule {
    label = 'startup';
  }
  const metadata = Object.create(null);
  Object.defineProperty(StartupModule, Symbol.metadata, { value: metadata });
  Module({ providers: [{ token: Symbol('startup-value'), useValue: 42 }] })(StartupModule, {
    kind: 'class',
    name: 'StartupModule',
    metadata,
    addInitializer() {},
  });
  for (let index = 0; index < warmup; index += 1) createApp(StartupModule);
  let checksum = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const application = createApp(StartupModule);
    checksum += application.lazy.length + Number(typeof application.handle === 'function');
  }
  const totalMs = performance.now() - start;
  if (checksum !== iterations) throw new Error(`unexpected application checksum ${checksum}`);
  process.stdout.write(
    JSON.stringify({
      iterations,
      totalMs,
      nsPerApplication: (totalMs * 1e6) / iterations,
      checksum,
      moduleOwner,
      node: process.version,
      resolvedPackages: Object.fromEntries(resolvedPackages),
    }),
  );
}
