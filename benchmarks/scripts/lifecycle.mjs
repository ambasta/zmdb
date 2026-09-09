#!/usr/bin/env node
// One diagnostic sample of the installed zmdb product. Final baselines belong to the campaign.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { startRegistry } from '../../fixtures/consumer-cli/registry.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '../..') },
    'work-dir': { type: 'string' },
    stage: { type: 'string', default: 'all' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log(`Usage: node benchmarks/scripts/lifecycle.mjs [--root PATH] [--work-dir PATH] [--stage all|build|consumer]

build: private checkout/install, clean and warm-cache builds, then npm pack of zmdb's required closure.
consumer: reuse artifacts.json in --work-dir; install, import, strict typecheck, SQLite HTTP first work.
all: both stages. Results and archives remain in --work-dir; temporary checkouts/consumers are removed.
The warm-cache build uses the same command again; it is not claimed to be an incremental compiler build.
Output is one diagnostic sample, not a baseline or a comparative result.`);
  process.exit(0);
}
assert(['all', 'build', 'consumer'].includes(values.stage), 'stage must be all, build or consumer');
assert(values.stage !== 'consumer' || values['work-dir'], 'consumer stage requires --work-dir');
const root = resolve(values.root);
const work = values['work-dir'] ? resolve(values['work-dir']) : await mkdtemp(join(dirname(root), 'zmdb-lifecycle-'));
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
};
assert(!inside(root, work), '--work-dir must be outside the source workspace');
await mkdir(work, { recursive: true });
const result = {
  diagnostic: true,
  product: 'zmdb',
  stage: values.stage,
  startedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    parallelism: availableParallelism(),
  },
  commands: [],
};
const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
for (const key of Object.keys(environment)) {
  if (/^npm_config_/i.test(key)) delete environment[key];
}
const sha = async (bytes, algorithm = 'SHA-256', encoding = 'hex') => {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return encoding === 'base64' ? digest.toBase64() : digest.toHex();
};

async function run(label, executable, args, cwd, env = {}, timeout = 600_000) {
  process.stderr.write(`[lifecycle] ${label}\n`);
  const started = performance.now();
  const child = spawn(executable, args, {
    cwd,
    env: { ...environment, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.setEncoding('utf8').on('data', text => (stdout += text));
  child.stderr.setEncoding('utf8').on('data', text => (stderr += text));
  const stop = () => {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const timer = setTimeout(stop, timeout);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let code;
  try {
    code = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', accept);
    });
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  const sample = { label, executable, args, cwd, durationMs: performance.now() - started, code, stdout, stderr };
  result.commands.push(sample);
  assert.equal(code, 0, `${label} failed (${String(code)})\n${stdout}\n${stderr}`);
  return sample;
}

async function bytesUnder(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) bytes += await bytesUnder(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

async function build() {
  const scratch = await mkdtemp(join(work, 'build-'));
  const checkout = join(scratch, 'source');
  let attached = false;
  try {
    const revision = (await run('source revision', 'git', ['rev-parse', 'HEAD'], root)).stdout.trim();
    await run('isolated checkout', 'git', ['worktree', 'add', '--detach', checkout, revision], root);
    attached = true;
    const env = { YARN_ENABLE_GLOBAL_CACHE: 'false', YARN_CACHE_FOLDER: join(scratch, 'yarn-cache') };
    await run('isolated build dependencies', 'yarn', ['install', '--immutable'], checkout, env);
    const { loadArchitecture } = await import(pathToFileURL(join(checkout, 'scripts/architecture/index.mjs')));
    const { releaseModel } = await import(pathToFileURL(join(checkout, 'scripts/release/model.mjs')));
    const { publishManifest } = await import(pathToFileURL(join(checkout, '.github/scripts/lib/publish-manifest.mjs')));
    const model = releaseModel(checkout, { architecture: await loadArchitecture(checkout) });
    const records = new Map(model.entries.map(entry => [entry.npmName, entry]));
    const selected = new Set();
    function visit(name) {
      if (selected.has(name) || !records.has(name)) return;
      selected.add(name);
      const { manifest } = records.get(name);
      for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }))
        visit(dependency);
      for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
        if (!manifest.peerDependenciesMeta?.[peer]?.optional) visit(peer);
      }
    }
    visit('@zmdb/core');
    const plan = JSON.parse(
      (await run('canonical build plan', process.execPath, ['scripts/build-workspaces.mjs', '--plan'], checkout, env))
        .stdout,
    ).filter(entry => selected.has(entry.name));
    assert.equal(plan.length, selected.size);
    const builds = [];
    for (const cache of ['clean', 'cached']) {
      const started = performance.now();
      for (const entry of plan)
        await run(`${cache} build ${entry.name}`, 'yarn', ['workspace', entry.name, 'run', 'build'], checkout, env);
      builds.push({ cache, durationMs: performance.now() - started });
    }
    const archives = await mkdtemp(join(work, 'archives-'));
    const packages = [];
    for (const entry of model.entries.filter(record => selected.has(record.npmName))) {
      const stage = join(scratch, 'stage', entry.id);
      await mkdir(stage, { recursive: true });
      for (const name of ['dist', 'src', 'README.md', 'LICENSE']) {
        await cp(join(checkout, entry.directory, name), join(stage, name), { recursive: true });
      }
      const manifest = publishManifest(entry.manifest);
      await writeFile(join(stage, 'package.json'), JSON.stringify(manifest));
      const packed = await run(
        `pack ${entry.npmName}`,
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
        stage,
      );
      const info = Object.values(JSON.parse(packed.stdout))[0];
      const file = join(archives, info.filename);
      const bytes = await readFile(file);
      packages.push({
        manifest,
        file,
        bytes: bytes.length,
        sha256: await sha(bytes),
        integrity: `sha512-${await sha(bytes, 'SHA-512', 'base64')}`,
        shasum: await sha(bytes, 'SHA-1'),
      });
    }
    const artifacts = {
      revision,
      builds,
      buildCache:
        'clean starts without emitted outputs after dependency installation; cached repeats the same build command with private dependency cache and warm filesystem; OS caches are not flushed; no incremental claim',
      packages,
    };
    await writeFile(join(work, 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n');
    result.build = artifacts;
  } finally {
    if (attached) await run('remove isolated checkout', 'git', ['worktree', 'remove', '--force', checkout], root);
    await rm(scratch, { recursive: true, force: true });
  }
}

async function consume() {
  const artifacts = JSON.parse(await readFile(join(work, 'artifacts.json'), 'utf8'));
  const records = new Map();
  for (const record of artifacts.packages) {
    assert.equal(await sha(await readFile(record.file)), record.sha256, `archive changed: ${record.manifest.name}`);
    records.set(record.manifest.name, record);
  }
  const consumer = await mkdtemp(join(work, 'consumer-'));
  let registry;
  try {
    registry = await startRegistry(records);
    const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const manifest = {
      name: 'zmdb-lifecycle-consumer',
      private: true,
      type: 'module',
      dependencies: { '@zmdb/core': records.get('@zmdb/core').manifest.version },
      devDependencies: {
        typescript: rootManifest.devDependencies.typescript,
        '@types/node': rootManifest.devDependencies['@types/node'],
      },
    };
    await writeFile(join(consumer, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(consumer, '.npmrc'), '');
    await cp(join(import.meta.dirname, 'lifecycle-consumer.ts'), join(consumer, 'main.ts'));
    await writeFile(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          allowImportingTsExtensions: false,
          module: 'NodeNext',
          target: 'ES2024',
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          types: ['node'],
          outDir: 'dist',
        },
        files: ['main.ts'],
      }),
    );
    const installed = await run(
      'install packed product',
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--registry',
        registry.origin,
        '--cache',
        join(consumer, '.npm-cache'),
        '--userconfig',
        join(consumer, '.npmrc'),
      ],
      consumer,
    );
    const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
    const packages = [];
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue;
      const location = join(consumer, path);
      try {
        await stat(location);
      } catch (error) {
        if (error.code === 'ENOENT' && entry.optional) continue;
        throw error;
      }
      assert(inside(consumer, await realpath(location)), `${path} resolves outside the installed consumer`);
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      if (records.has(name)) assert.equal(entry.integrity, records.get(name).integrity);
      packages.push({
        path,
        name,
        version: entry.version,
        dev: entry.dev === true,
        dependencies: entry.dependencies ?? {},
      });
    }
    const imported = await run(
      'import packed product',
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const product = await import('@zmdb/core'); if (typeof product.createApp !== 'function') throw new Error('createApp missing'); console.log(import.meta.resolve('@zmdb/core'));",
      ],
      consumer,
      {},
      30_000,
    );
    assert(imported.stdout.trim().startsWith(pathToFileURL(join(consumer, 'node_modules')).href + '/'));
    const typecheck = await run(
      'strict installed typecheck and emit',
      join(consumer, 'node_modules/.bin/tsc'),
      ['-p', 'tsconfig.json'],
      consumer,
    );
    const startup = await run(
      'packed startup and first work',
      process.execPath,
      ['dist/main.js'],
      consumer,
      {},
      30_000,
    );
    const firstWork = JSON.parse(startup.stdout);
    assert.equal(firstWork.closed, true);
    assert.deepEqual(firstWork.body, { answer: 42 });
    result.consumer = {
      revision: artifacts.revision,
      archives: artifacts.packages.map(({ manifest: packageManifest, file, bytes, sha256 }) => ({
        name: packageManifest.name,
        file,
        bytes,
        sha256,
      })),
      installCache: 'empty private npm cache',
      installedBytes: await bytesUnder(join(consumer, 'node_modules')),
      packageCount: packages.length,
      packages,
      installMs: installed.durationMs,
      importMs: imported.durationMs,
      typecheckAndEmitMs: typecheck.durationMs,
      processMs: startup.durationMs,
      firstWork,
    };
    await cp(join(consumer, 'package-lock.json'), join(work, 'consumer-package-lock.json'));
  } finally {
    try {
      await registry?.close();
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  }
}

try {
  if (values.stage !== 'consumer') await build();
  if (values.stage !== 'build') await consume();
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  const output = join(work, `lifecycle-${values.stage}.json`);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(output);
}
