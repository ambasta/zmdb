import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { publishCatalog, publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';
import { command, startRegistry } from '../consumer-cli/registry.mjs';
import { startFixtures } from './broker.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const evidence = process.env.ZMDB_760_EVIDENCE ?? (await mkdtemp(join(dirname(ROOT), 'zmdb-760-evidence-')));
const temporaryEvidence = process.env.ZMDB_760_EVIDENCE === undefined;
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(dirname(ROOT), 'zmdb-760-packed-'));
let registry, fixtures;
const result = { commands: [], archives: [], roots: {}, processes: [], cleaned: false };
const digest = async (algorithm, bytes, encoding = 'hex') => {
  const hash = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return encoding === 'base64'
    ? globalThis.btoa(String.fromCharCode(...hash))
    : Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
};
const groupAlive = pid => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
const run = async (executable, args, cwd, env = {}) => {
  const record = await command(executable, args, { cwd, env, timeout: 120_000 });
  result.commands.push({
    executable,
    args,
    cwd,
    pid: record.pid,
    code: record.code,
    stdout: record.stdout,
    stderr: record.stderr,
  });
  assert.equal(record.code, 0, `${executable} ${args.join(' ')}\n${record.stdout}\n${record.stderr}`);
  return record;
};
try {
  const catalog = await publishCatalog(ROOT);
  const byName = new Map(catalog.map(record => [record.npmName, record]));
  assert(byName.has('@zmdb/transport-sqs'), 'required public @zmdb/transport-sqs package has not been implemented');
  const needed = new Set();
  const include = name => {
    if (needed.has(name)) return;
    const entry = byName.get(name);
    if (!entry) return;
    needed.add(name);
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) include(dependency);
    for (const dependency of Object.keys(entry.manifest.peerDependencies ?? {})) {
      if (entry.manifest.peerDependenciesMeta?.[dependency]?.optional !== true) include(dependency);
    }
  };
  include('@zmdb/transport-sqs');
  include('@zmdb/app');
  const records = new Map();
  const lock = join(tmpdir(), `zmdb-adapter-packed-build-${encodeURIComponent(await realpath(ROOT))}.lock`);
  const deadline = Date.now() + 600_000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
  }
  try {
    for (const entry of catalog.filter(record => needed.has(record.npmName))) {
      const source = join(ROOT, entry.directory),
        stage = join(directory, 'stage', entry.id);
      await run(process.execPath, [join(ROOT, 'scripts/build-package.mjs')], source);
      await mkdir(stage, { recursive: true });
      for (const file of ['dist', 'src', 'README.md', 'LICENSE']) {
        try {
          await cp(join(source, file), join(stage, file), { recursive: true, dereference: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const manifest = publishManifest(entry.manifest);
      await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      const packed = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory], stage, {
        COREPACK_ENABLE_PROJECT_SPEC: '0',
      });
      const [{ filename }] = Object.values(JSON.parse(packed.stdout));
      const file = join(directory, filename),
        bytes = await readFile(file);
      const record = {
        file,
        manifest,
        sha256: await digest('SHA-256', bytes),
        shasum: await digest('SHA-1', bytes),
        integrity: `sha512-${await digest('SHA-512', bytes, 'base64')}`,
      };
      records.set(entry.npmName, record);
      result.archives.push({ name: entry.npmName, sha256: record.sha256, integrity: record.integrity });
    }
  } finally {
    await rm(lock, { recursive: true });
  }
  registry = await startRegistry(records);
  const consumer = join(directory, 'consumer');
  await mkdir(consumer);
  const dependencies = {
    '@zmdb/transport-sqs': byName.get('@zmdb/transport-sqs').manifest.version,
    '@zmdb/app': byName.get('@zmdb/app').manifest.version,
    '@aws-sdk/client-sqs': '3.1127.0',
    typescript: '7.0.2',
    '@types/node': '26.4.1',
  };
  result.roots = dependencies;
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'zmdb-sqs-installed-consumer', private: true, type: 'module', dependencies }, null, 2) +
      '\n',
  );
  for (const file of ['broker.mjs', 'runtime.mjs', 'wire.mjs', 'app.mjs', 'installed.mjs', 'contracts.ts'])
    await cp(join(import.meta.dirname, file), join(consumer, file));
  await writeFile(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          allowImportingTsExtensions: false,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ESNext',
          lib: ['ESNext'],
          types: ['node'],
        },
        files: ['contracts.ts'],
      },
      null,
      2,
    ),
  );
  const npmArgs = [
    '--registry',
    registry.origin,
    '--cache',
    join(directory, 'npm-cache'),
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ];
  await run('npm', ['install', ...npmArgs], consumer, {
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    NODE_OPTIONS: '',
    NODE_PATH: '',
  });
  const lockfile = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lockfile.packages[''].dependencies, dependencies);
  for (const [name, record] of records)
    assert.equal(lockfile.packages[`node_modules/${name}`]?.integrity, record.integrity);
  await run('npm', ['ci', ...npmArgs], consumer, {
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    NODE_OPTIONS: '',
    NODE_PATH: '',
  });
  await run(join(consumer, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json', '--pretty', 'false'], consumer, {
    NODE_OPTIONS: '',
    NODE_PATH: '',
  });
  fixtures = await startFixtures();
  await run(process.execPath, ['installed.mjs'], consumer, {
    NODE_OPTIONS: '',
    NODE_PATH: '',
    ZMDB_760_SQS_ENDPOINT: fixtures.endpoint,
    ZMDB_760_WIRE_ENDPOINT: fixtures.wire,
  });
} finally {
  const cleanup = await Promise.allSettled([fixtures?.stop(), registry?.close()]);
  await rm(directory, { recursive: true, force: true });
  result.processes = result.commands.map(record => record.pid).filter(groupAlive);
  result.cleaned = cleanup.every(record => record.status === 'fulfilled') && result.processes.length === 0;
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (temporaryEvidence) await rm(evidence, { recursive: true, force: true });
  assert(result.cleaned, 'SQS packed fixture cleanup failed');
}
