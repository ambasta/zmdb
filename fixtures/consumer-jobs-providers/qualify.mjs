import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startRegistry } from './registry.mjs';

const source = import.meta.dirname;
const rootArgument = process.argv.indexOf('--root');
const root = resolve(rootArgument < 0 ? join(source, '../..') : process.argv[rootArgument + 1]);
const failureArgument = process.argv.indexOf('--failure-mode');
const failureMode = failureArgument < 0 ? undefined : process.argv[failureArgument + 1];
assert(failureMode === undefined || failureMode === 'consumer' || failureMode === 'timeout');
const { publishManifest } = await import(pathToFileURL(join(root, '.github/scripts/lib/publish-manifest.mjs')));
const commands = [];
const failures = [];
const packageRecords = new Map();
const packageIntegrities = new Map();

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += HEX[bytes[i]] ?? '00';
  return hex;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;
    result += B64[b0 >> 2] ?? '';
    result += B64[((b0 & 3) << 4) | (b1 >> 4)] ?? '';
    result += i + 1 < len ? (B64[((b1 & 15) << 2) | (b2 >> 6)] ?? '') : '=';
    result += i + 2 < len ? (B64[b2 & 63] ?? '') : '=';
  }
  return result;
}

async function digest(bytes, algorithm = 'SHA-256', encoding = 'hex') {
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, bytes));
  if (encoding === 'base64') return bytesToBase64(hash);
  return typeof hash.toHex === 'function' ? hash.toHex() : bytesToHex(hash);
}
const runtime = await mkdtemp(join(dirname(root), 'jobs-provider-qualification-'));
const results = { base: '', commands, failures, runtime, cleaned: false };
let registry;
let postgresStarted = false;
let postgresDirectory;

async function run(command, arguments_, cwd, additions = {}, allowFailure = false, timeoutMs = 120_000) {
  const environment = { ...process.env, ...additions, NODE_PATH: '', NODE_OPTIONS: '' };
  const child = spawn(command, arguments_, {
    cwd,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let stdout = '';
  child.stdout.on('data', chunk => {
    output += chunk;
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });
  const timer = setTimeout(() => {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  }, timeoutMs);
  let status;
  try {
    status = await new Promise((complete, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => complete({ code, signal }));
    });
  } finally {
    clearTimeout(timer);
  }
  commands.push({ command, arguments: arguments_, cwd, ...status, output });
  if (!allowFailure && status.code !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed (${status.code}/${status.signal})\n${output}`);
  }
  return { ...status, output, stdout };
}

async function installedPackages(directory) {
  const found = new Map();
  async function visit(modules) {
    let entries;
    try {
      entries = await readdir(modules, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(modules, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(path)) await inspect(join(path, scoped));
      } else await inspect(path);
    }
  }
  async function inspect(path) {
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    assert((await realpath(path)).startsWith(`${directory}/`), `${manifest.name} escaped consumer`);
    found.set(manifest.name, manifest);
    await visit(join(path, 'node_modules'));
  }
  await visit(join(directory, 'node_modules'));
  return found;
}

async function packClosure(roots) {
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, 'packages', entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    packageRecords.set(manifest.name, { directory, manifest });
  }
  const visited = new Set();
  const ordered = [];
  function visit(name) {
    if (visited.has(name)) return;
    const entry = packageRecords.get(name);
    if (entry === undefined) throw new Error(`Missing declared workspace dependency ${name}`);
    visited.add(name);
    for (const [dependency, version] of Object.entries({
      ...entry.manifest.dependencies,
      ...entry.manifest.optionalDependencies,
      ...entry.manifest.peerDependencies,
    })) {
      if (entry.manifest.peerDependenciesMeta?.[dependency]?.optional === true) continue;
      if (version.startsWith('workspace:') || packageRecords.has(dependency)) visit(dependency);
    }
    ordered.push(entry);
  }
  for (const name of roots) if (packageRecords.has(name)) visit(name);
  const packed = [];
  const tarballs = join(runtime, 'tarballs');
  await mkdir(tarballs);
  for (const entry of ordered) {
    await run(process.execPath, [join(root, 'scripts/build-package.mjs')], entry.directory);
    const stage = join(runtime, 'stage', entry.manifest.name.replace('/', '-'));
    await mkdir(stage, { recursive: true });
    for (const name of ['dist', 'src', 'README.md', 'LICENSE']) {
      try {
        await cp(join(entry.directory, name), join(stage, name), { recursive: true });
      } catch (error) {
        if (error.code !== 'ENOENT' || name === 'dist' || name === 'src') throw error;
      }
    }
    const manifest = publishManifest(entry.manifest);
    await writeFile(join(stage, 'package.json'), JSON.stringify(manifest));
    const packedResult = await run(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballs],
      stage,
    );
    const packedInfo = JSON.parse(packedResult.stdout);
    const packedObject = Array.isArray(packedInfo) ? packedInfo[0] : packedInfo[manifest.name];
    packed.push({ manifest, tarball: join(tarballs, packedObject.filename) });
    packageIntegrities.set(
      manifest.name,
      `sha512-${await digest(await readFile(join(tarballs, packedObject.filename)), 'SHA-512', 'base64')}`,
    );
  }
  return packed;
}

async function consumer(name, dependencies) {
  const directory = join(runtime, `consumer-${name}`);
  await mkdir(directory);
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify(
      {
        name: `jobs-proof-${name}`,
        private: true,
        type: 'module',
        dependencies,
        devDependencies: {
          typescript: '7.0.2',
          '@types/node': '26.4.1',
          ...(name === 'postgres' ? { '@types/pg': '8.23.1' } : {}),
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(directory, '.npmrc'),
    `@zmdb:registry=${registry.origin}\nregistry=https://registry.npmjs.org/\naudit=false\nfund=false\n`,
  );
  await run('npm', ['install', '--no-audit', '--no-fund', '--cache', join(runtime, 'npm-cache')], directory);
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    const packageName = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!packageName.startsWith('@zmdb/')) continue;
    assert.equal(
      entry.integrity,
      packageIntegrities.get(packageName),
      `${packageName} lock integrity does not match its issue tarball`,
    );
    assert.equal(entry.resolved, `${registry.origin}/${encodeURIComponent(packageName)}/artifact.tgz`);
    assert(
      registry.requests.includes(`${packageName}/artifact.tgz`),
      `${packageName} was not fetched from the issue registry`,
    );
  }
  for (const file of [
    'portable.mjs',
    'conformance.mjs',
    'sqlite.mjs',
    'postgres.mjs',
    'contracts.ts',
    'tasks.ts',
    'sqlite-contracts.ts',
    'postgres-contracts.ts',
    'tsconfig.json',
  ]) {
    await cp(join(source, file), join(directory, file));
  }
  const config = JSON.parse(await readFile(join(directory, 'tsconfig.json'), 'utf8'));
  if (name !== 'portable') config.files.push('tasks.ts', `${name}-contracts.ts`);
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify(config));
  return { directory, packages: await installedPackages(directory) };
}

async function checkTypes(installed, provider) {
  const compiler = join(installed.directory, 'node_modules/typescript/bin/tsc');
  await run(process.execPath, [compiler, '-p', 'tsconfig.json'], installed.directory);
  const negatives = [
    {
      name: 'SQL-shaped store',
      source: "import type { JobStore } from '@zmdb/jobs'; const old: JobStore = { execute: async () => [] };",
      code: 'TS2353',
    },
    { name: 'old dialect', source: "import type { JobDialect } from '@zmdb/jobs';", code: 'TS2305' },
    {
      name: 'missing store',
      source: "import { createQueue } from '@zmdb/jobs'; createQueue({clock:{now:()=>0,sleep:async()=>{}}});",
      code: 'TS2741',
    },
    {
      name: 'wrong payload',
      source:
        "import { createQueue, type JobStore, type Clock } from '@zmdb/jobs'; declare const store:JobStore; declare const clock:Clock; createQueue<{deliver:{id:number}}>({store,clock}).enqueue('deliver',{id:'wrong'});",
      code: 'TS2322',
    },
    {
      name: 'wrong name',
      source:
        "import { createQueue, type JobStore, type Clock } from '@zmdb/jobs'; declare const store:JobStore; declare const clock:Clock; createQueue<{deliver:{id:number}}>({store,clock}).enqueue('wrong',{id:1});",
      code: 'TS2345',
    },
    { name: 'old memory subpath', source: "import { createMemoryJobStore } from '@zmdb/jobs/memory';", code: 'TS2307' },
    {
      name: 'scheduled Date argument',
      source:
        "import { Interval } from '@zmdb/jobs'; class Tasks { @Interval(10,{runs:'once-per-replica'}) run(_instant:Date):void{} }",
      code: 'TS1241',
    },
    {
      name: 'scheduled context argument',
      source:
        "import { Interval } from '@zmdb/jobs'; class Tasks { @Interval(10,{runs:'once-per-replica'}) run(_context:{requestId:string}):void{} }",
      code: 'TS1241',
    },
    {
      name: 'scheduled non-void result',
      source:
        "import { Interval } from '@zmdb/jobs'; class Tasks { @Interval(10,{runs:'once-per-replica'}) async run():Promise<number>{return 1;} }",
      code: 'TS1241',
    },
    ...(provider === 'postgres'
      ? [
          {
            name: 'Pool is not transaction client',
            source:
              "import { pgJobEnqueuer } from '@zmdb/jobs-postgres'; import { Pool } from 'pg'; pgJobEnqueuer(new Pool());",
            code: 'TS2345',
          },
        ]
      : []),
  ];
  for (const negative of negatives) {
    await writeFile(join(installed.directory, 'negative.ts'), negative.source);
    const result = await run(
      process.execPath,
      [
        compiler,
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--lib',
        'ESNext',
        '--types',
        'node',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'negative.ts',
      ],
      installed.directory,
      {},
      true,
    );
    assert.notEqual(result.code, 0, `${negative.name} incorrectly typechecked`);
    const diagnostics = [...result.output.matchAll(/([^\n]+?)\((\d+),(\d+)\): error (TS\d+):/g)];
    assert.equal(diagnostics.length, 1, `${negative.name} must have exactly one diagnostic: ${result.output}`);
    assert.equal(
      diagnostics[0][1].trim(),
      'negative.ts',
      `${negative.name} failed in an unrelated declaration: ${result.output}`,
    );
    assert.equal(diagnostics[0][2], '1');
    assert.equal(
      diagnostics[0][4],
      negative.code,
      `${negative.name} failed for an unintended reason: ${result.output}`,
    );
  }
}

async function record(name, operation) {
  try {
    await operation();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack ?? String(error) });
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

try {
  results.base = (await run('git', ['rev-parse', 'HEAD'], root)).output.trim();
  const packed = await packClosure(['@zmdb/jobs', '@zmdb/jobs-sqlite', '@zmdb/jobs-postgres', '@zmdb/app']);
  registry = await startRegistry(packed);
  results.tarballs = await Promise.all(
    packed.map(async entry => ({
      name: entry.manifest.name,
      sha256: await digest(await readFile(entry.tarball), 'SHA-256', 'hex'),
    })),
  );
  await record('portable install has no concrete provider or obsolete entry', async () => {
    const portable = await consumer('portable', { '@zmdb/jobs': '1.0.0-beta.1' });
    const manifest = portable.packages.get('@zmdb/jobs');
    assert.deepEqual(Object.keys(manifest.dependencies).toSorted(), ['@zmdb/app']);
    assert.deepEqual(Object.keys(manifest.exports).toSorted(), ['.', './schedule']);
    assert.deepEqual(manifest.peerDependencies ?? {}, {});
    for (const forbidden of [
      '@zmdb/sqlite',
      '@zmdb/postgres',
      '@zmdb/jobs-sqlite',
      '@zmdb/jobs-postgres',
      '@zmdb/migrations',
      'pg',
    ]) {
      assert(!portable.packages.has(forbidden), `portable closure contains ${forbidden}`);
    }
    await checkTypes(portable, 'portable');
    await run(process.execPath, ['portable.mjs'], portable.directory);
  });
  for (const provider of ['sqlite', 'postgres']) {
    await record(`${provider} packed provider workflow`, async () => {
      assert(packageRecords.has(`@zmdb/jobs-${provider}`), `Required public package @zmdb/jobs-${provider} is absent`);
      const dependencies = {
        '@zmdb/app': '1.0.0-beta.1',
        '@zmdb/jobs': '1.0.0-beta.1',
        [`@zmdb/jobs-${provider}`]: '1.0.0-beta.1',
        ...(provider === 'postgres' ? { pg: '8.23.0' } : {}),
      };
      const installed = await consumer(provider, dependencies);
      const providerManifest = installed.packages.get(`@zmdb/jobs-${provider}`);
      assert.deepEqual(providerManifest.dependencies, { [`@zmdb/${provider}`]: '1.0.0-beta.1' });
      assert.deepEqual(providerManifest.peerDependencies, {
        '@zmdb/jobs': '1.0.0-beta.1',
        ...(provider === 'postgres' ? { pg: '^8.23.0' } : {}),
      });
      assert.equal(providerManifest.peerDependenciesMeta, undefined);
      assert.deepEqual(Object.keys(providerManifest.exports), ['.']);
      assert(!installed.packages.has(`@zmdb/jobs-${provider === 'sqlite' ? 'postgres' : 'sqlite'}`));
      await checkTypes(installed, provider);
      if (provider === 'postgres') {
        postgresDirectory = join(runtime, 'postgres');
        try {
          await run(
            'initdb',
            [
              '-D',
              postgresDirectory,
              '-U',
              'issue756',
              '--auth-local=trust',
              '--auth-host=trust',
              '--no-locale',
              '--encoding=UTF8',
            ],
            root,
          );
        } catch (error) {
          if (error.message.includes('ENOENT') || error.message.includes('initdb')) {
            process.stdout.write(`SKIP postgres packed provider workflow: initdb not available\n`);
            return;
          }
          throw error;
        }
        const listener = createServer();
        await new Promise(complete => listener.listen(0, '127.0.0.1', complete));
        const port = listener.address().port;
        await new Promise(complete => listener.close(complete));
        await run(
          'pg_ctl',
          [
            '-D',
            postgresDirectory,
            '-l',
            join(runtime, 'postgres.log'),
            '-w',
            '-t',
            '15',
            '-o',
            `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c max_connections=20`,
            'start',
          ],
          root,
        );
        postgresStarted = true;
        results.postgresPid = Number(
          (await readFile(join(postgresDirectory, 'postmaster.pid'), 'utf8')).split('\n')[0],
        );
        results.postgresPort = port;
        if (failureMode !== undefined) {
          results.injectedFailure = failureMode;
          await run(
            process.execPath,
            [
              '-e',
              failureMode === 'consumer'
                ? 'process.stderr.write("injected consumer failure\\n"); process.exit(17);'
                : 'process.stderr.write("injected consumer timeout\\n"); setInterval(() => {}, 1000);',
            ],
            installed.directory,
            {},
            false,
            100,
          );
          assert.fail('injected consumer failure was incorrectly accepted');
        }
        await run(process.execPath, ['postgres.mjs'], installed.directory, {
          ZMDB_PG: `postgresql://issue756@127.0.0.1:${port}/postgres`,
        });
      } else {
        if (failureMode !== undefined) {
          results.injectedFailure = failureMode;
          await run(
            process.execPath,
            [
              '-e',
              failureMode === 'consumer'
                ? 'process.stderr.write("injected consumer failure\\n"); process.exit(17);'
                : 'process.stderr.write("injected consumer timeout\\n"); setInterval(() => {}, 1000);',
            ],
            installed.directory,
            {},
            false,
            100,
          );
          assert.fail('injected consumer failure was incorrectly accepted');
        }
        await run(process.execPath, ['sqlite.mjs'], installed.directory);
      }
    });
  }
  results.registryRequests = registry.requests;
} catch (error) {
  failures.push({ name: 'qualification setup', error: error.stack ?? String(error) });
  process.stderr.write(`${error.stack}\n`);
} finally {
  let cleanupFailed = false;
  if (postgresStarted) {
    try {
      await run('pg_ctl', ['-D', postgresDirectory, '-w', '-t', '15', '-m', 'fast', 'stop'], root);
    } catch (error) {
      cleanupFailed = true;
      failures.push({ name: 'PostgreSQL cleanup', error: String(error) });
    }
  }
  if (registry !== undefined) {
    try {
      await registry.close();
    } catch (error) {
      cleanupFailed = true;
      failures.push({ name: 'registry cleanup', error: String(error) });
    }
  }
  if (!cleanupFailed) {
    await rm(runtime, { recursive: true });
    results.cleaned = true;
  }
  if (process.env.ZMDB_JOBS_EVIDENCE !== undefined) {
    await writeFile(process.env.ZMDB_JOBS_EVIDENCE, `${JSON.stringify(results, null, 2)}\n`);
  }
}

process.exitCode = failures.length === 0 && results.cleaned ? 0 : 1;
