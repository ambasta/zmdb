import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';
import { cleanEnvironment, startRegistry } from '../consumer-cli/registry.mjs';
import { startKafkaBroker } from './broker.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
assert(
  args.length === 2 && args[0] === '--evidence' && isAbsolute(args[1]),
  'usage: verify-installed.mjs --evidence <absolute directory>',
);
const evidence = args[1];
assert(relative(root, evidence).startsWith('..'), 'Kafka evidence must be outside the workspace');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(evidence, 'consumer-'));
const report = {
  base: undefined,
  archives: [],
  commands: [],
  installed: undefined,
  wire: undefined,
  failures: [],
  cleaned: false,
};
let registry;
let broker;
let interrupted = false;
let currentPid;
const stop = () => {
  interrupted = true;
  if (Number.isInteger(currentPid) && currentPid > 0) {
    try {
      process.kill(-currentPid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function run(label, executable, argv, cwd, env = {}) {
  assert(!interrupted, 'Kafka qualification interrupted');
  const log = join(evidence, `${String(report.commands.length + 1)}-${label}.json`);
  const child = spawn(executable, argv, {
    cwd,
    env: { ...cleanEnvironment(), ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  currentPid = child.pid;
  let stdout = '',
    stderr = '',
    timedOut = false,
    hardKill;
  const kill = signal => {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', bytes => {
    stdout += bytes;
    if (stdout.length > 16777216) kill('SIGTERM');
  });
  child.stderr.on('data', bytes => {
    stderr += bytes;
    if (stderr.length > 16777216) kill('SIGTERM');
  });
  const timer = setTimeout(() => {
    timedOut = true;
    kill('SIGTERM');
    hardKill = setTimeout(() => kill('SIGKILL'), 1000);
  }, 120000);
  let outcome;
  try {
    outcome = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept({ code, signal }));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(hardKill);
    currentPid = undefined;
  }
  const result = { ...outcome, stdout, stderr, timedOut, pid: child.pid };
  await writeFile(log, JSON.stringify({ executable, argv, cwd, ...result }, null, 2) + '\n');
  report.commands.push({ label, command: executable, argv, code: result.code, signal: result.signal, timedOut });
  assert.equal(result.code, 0, `${label} failed: ${stderr}\n${stdout}`);
  assert(!timedOut && !interrupted, `${label} timed out or was interrupted`);
  return result.stdout;
}

async function digest(bytes, algorithm, encoding = 'hex') {
  const hashed = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return globalThis.Buffer.from(hashed).toString(encoding === 'base64' ? 'base64' : 'hex');
}

try {
  report.base = (await run('base', 'git', ['rev-parse', 'HEAD'], root)).trim();
  const manifests = new Map();
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
      manifests.set(manifest.name, { manifest, source: join(root, 'packages', entry.name) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const selected = new Map();
  function select(name) {
    if (selected.has(name)) return;
    const entry = manifests.get(name);
    if (!entry) return;
    for (const dependency of Object.keys({ ...entry.manifest.dependencies, ...entry.manifest.peerDependencies })) {
      if (!entry.manifest.peerDependenciesMeta?.[dependency]?.optional) select(dependency);
    }
    selected.set(name, entry);
  }
  select('@zmdb/transport-kafka');
  assert(selected.has('@zmdb/transport-kafka'), 'Kafka publication manifest is missing');
  const records = new Map();
  const archives = join(directory, 'archives');
  await mkdir(archives);
  // Other installed-consumer tests rebuild the same dist directories.
  const buildLock = join(tmpdir(), `zmdb-adapter-packed-build-${encodeURIComponent(await realpath(root))}.lock`);
  const lockStarted = Date.now();
  for (;;) {
    assert(!interrupted, 'Kafka qualification interrupted');
    try {
      await mkdir(buildLock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - lockStarted > 600000) {
        throw new Error(`timed out waiting for packed build lock ${buildLock}`, { cause: error });
      }
      await new Promise(accept => setTimeout(accept, 50));
    }
  }
  const lockIdentity = await lstat(buildLock);
  try {
    for (const [name, { manifest, source }] of selected) {
      const label = name.replaceAll('/', '-').replace('@', '');
      await run(`build-${label}`, process.execPath, [join(root, 'scripts/build-package.mjs')], source);
      const stage = join(directory, `stage-${label}`);
      await mkdir(stage);
      for (const path of ['dist', 'src', 'README.md', 'LICENSE']) {
        await cp(join(source, path), join(stage, path), { recursive: true });
      }
      const published = publishManifest(manifest);
      await writeFile(join(stage, 'package.json'), JSON.stringify(published, null, 2) + '\n');
      const packed = JSON.parse(
        await run(
          `pack-${label}`,
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
          stage,
        ),
      );
      assert.equal(Array.isArray(packed), false);
      assert.deepEqual(Object.keys(packed), [name]);
      const file = join(archives, packed[name].filename);
      const bytes = await readFile(file);
      const record = {
        file,
        manifest: published,
        sha256: await digest(bytes, 'SHA-256'),
        shasum: await digest(bytes, 'SHA-1'),
        integrity: `sha512-${await digest(bytes, 'SHA-512', 'base64')}`,
      };
      assert.equal(record.integrity, packed[name].integrity);
      records.set(name, record);
      report.archives.push({ name, version: published.version, sha256: record.sha256, integrity: record.integrity });
    }
  } finally {
    const currentLock = await lstat(buildLock);
    assert(!currentLock.isSymbolicLink());
    assert.equal(currentLock.ino, lockIdentity.ino);
    assert.equal(currentLock.dev, lockIdentity.dev);
    await rm(buildLock, { recursive: true });
  }
  registry = await startRegistry(records);
  const consumer = join(directory, 'installed');
  await mkdir(consumer);
  const roots = ['@zmdb/app', '@zmdb/transport-kafka', 'kafkajs'];
  const dependencies = Object.fromEntries(
    roots.map(name => [name, name === 'kafkajs' ? '2.2.4' : records.get(name).manifest.version]),
  );
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'zmdb-kafka-installed-consumer',
        private: true,
        type: 'module',
        dependencies,
        devDependencies: { typescript: '7.0.2', '@types/node': '26.4.1', esbuild: '0.28.2' },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(join(consumer, '.npmrc'), `registry=${registry.origin}\nfund=false\naudit=false\n`);
  for (const path of ['contracts.ts', 'tsconfig.json', 'application.ts', 'runtime.mjs']) {
    await cp(join(import.meta.dirname, path), join(consumer, path));
  }
  await run('npm-install', 'npm', ['install', '--ignore-scripts', '--package-lock=true'], consumer);
  const before = await readFile(join(consumer, 'package-lock.json'));
  await rm(join(consumer, 'node_modules'), { recursive: true });
  await run('npm-ci', 'npm', ['ci', '--ignore-scripts'], consumer);
  assert.deepEqual(await readFile(join(consumer, 'package-lock.json')), before, 'npm ci changed the lock');
  const lock = JSON.parse(before);
  assert.deepEqual(lock.packages[''].dependencies, dependencies);
  const production = Object.entries(lock.packages)
    .filter(([path, entry]) => path && !entry.dev)
    .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length))
    .toSorted();
  assert.deepEqual(
    production,
    [...selected.keys(), 'kafkajs'].toSorted(),
    'installed production closure contains an undeclared package',
  );
  for (const [name, record] of records) {
    const locked = lock.packages[`node_modules/${name}`];
    assert.equal(locked.integrity, record.integrity);
    assert.equal(locked.resolved, `${registry.origin}/tarballs/${record.sha256}.tgz`);
    const path = join(consumer, 'node_modules', name);
    assert(!(await lstat(path)).isSymbolicLink());
    assert((await realpath(path)).startsWith(`${consumer}/node_modules/`));
  }
  await run('types', join(consumer, 'node_modules/.bin/tsc'), ['--noEmit', '-p', 'tsconfig.json'], consumer);
  await run(
    'private-entries',
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    const resolved = import.meta.resolve('@zmdb/transport-kafka');
    assert(resolved.includes('/node_modules/@zmdb/transport-kafka/dist/index.js'));
    for (const entry of ['@zmdb/transport-kafka/src/index.js', '@zmdb/web/transports/kafka']) {
      await assert.rejects(import(entry), error => ['ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_MODULE_NOT_FOUND'].includes(error.code));
    }
  `,
    ],
    consumer,
  );
  report.installed = {
    roots,
    npmCi: true,
    typecheck: true,
    privateEntriesRefused: 2,
    production,
    lockSha256: await digest(before, 'SHA-256'),
  };
  await run(
    'app-build',
    join(consumer, 'node_modules/.bin/esbuild'),
    ['application.ts', '--platform=node', '--format=esm', '--target=es2022', '--outfile=application.js'],
    consumer,
  );
  if (!process.env.ZMDB_KAFKA_URL) broker = await startKafkaBroker();
  const output = await run('broker-runtime', process.execPath, ['runtime.mjs'], consumer, {
    ZMDB_KAFKA_URL: process.env.ZMDB_KAFKA_URL ?? broker.endpoint,
  });
  report.wire = JSON.parse(output.trim().split('\n').at(-1)).wire;
} catch (error) {
  report.failures.push(error.stack ?? String(error));
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  const results = await Promise.allSettled([broker?.close(), registry?.close()]);
  for (const result of results) if (result.status === 'rejected') report.failures.push(String(result.reason));
  try {
    await rm(directory, { recursive: true });
    report.cleaned = results.every(result => result.status === 'fulfilled');
  } catch (error) {
    report.failures.push(String(error));
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
if (report.failures.length || !report.cleaned || !report.wire) process.exitCode = 1;
