import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const evidence =
  process.env.ZMDB_CLI_EVIDENCE ??
  '/home/amitprakash/foss/zmdb-handover/campaign-20260907-takeover-1709/issue-630/qualification';
export const dataRoots = [
  '@zmdb/compiler',
  '@zmdb/migrations',
  '@zmdb/schema-core',
  '@zmdb/aot-validator',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/sqlite',
  'typescript',
  '@types/node',
];
export const appRoots = [...dataRoots, '@zmdb/app', '@zmdb/web', '@zmdb/client', 'esbuild'];
export const versions = {
  typescript: '7.0.2',
  '@types/node': '26.4.1',
  esbuild: '0.28.2',
  oxfmt: '0.66.0',
  oxlint: '1.81.0',
  vitest: '4.1.9',
};
export const cleanEnvironment = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith('NPM_CONFIG_') ||
      key.startsWith('npm_config_') ||
      /^(?:NODE_OPTIONS|NODE_PATH|https?_proxy|HTTPS?_PROXY|ALL_PROXY|all_proxy|NODE_EXTRA_CA_CERTS)$/.test(key)
    )
      delete env[key];
  return env;
};
const groups = new Set();
export function trackChild(child) {
  if (child.pid) groups.add(child.pid);
  return child;
}
const groupAlive = pid => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function sha(bytes, algorithm = 'SHA-256', encoding = 'hex') {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return encoding === 'base64' ? digest.toBase64() : digest.toHex();
}

export async function command(executable, argv, { cwd, env = {}, timeout = 120_000, input = '', expected, log } = {}) {
  const child = spawn(executable, argv, {
    cwd,
    env: { ...cleanEnvironment(), ...env },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  trackChild(child);
  let stdout = '',
    stderr = '',
    timedOut = false;
  const stop = signal => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop('SIGTERM');
    setTimeout(() => stop('SIGKILL'), 1000).unref();
  }, timeout);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => {
    stdout += text;
    if (stdout.length > 8_388_608) stop('SIGTERM');
  });
  child.stderr.on('data', text => {
    stderr += text;
    if (stderr.length > 8_388_608) stop('SIGTERM');
  });
  child.stdin.end(input);
  let result;
  try {
    result = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept({ code, signal, stdout, stderr, pid: child.pid, timedOut }));
    });
  } finally {
    clearTimeout(timer);
  }
  if (log !== undefined) await writeFile(log, JSON.stringify({ executable, argv, cwd, ...result }, null, 2) + '\n');
  assert.equal(timedOut, false, `TIMEOUT: ${executable} ${argv.join(' ')}`);
  if (expected !== undefined)
    assert.equal(result.code, expected, `${executable} ${argv.join(' ')}\n${stdout}\n${stderr}`);
  return result;
}

export async function startRegistry(records) {
  const requested = [];
  const archives = new Map([...records.values()].map(record => [record.sha256, record]));
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      requested.push(path);
      if (request.method !== 'GET') {
        response.writeHead(405);
        response.end();
        return;
      }
      if (path === '/-/ping') {
        response.end('{}');
        return;
      }
      if (path.startsWith('/tarballs/')) {
        const archive = archives.get(path.slice('/tarballs/'.length).replace(/\.tgz$/, ''));
        if (!archive) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.setHeader('content-type', 'application/octet-stream');
        response.end(await readFile(archive.file));
        return;
      }
      const name = path.slice(1),
        record = records.get(name);
      if (record) {
        response.setHeader('content-type', 'application/json');
        const version = {
          ...record.manifest,
          dist: {
            tarball: `${origin}/tarballs/${record.sha256}.tgz`,
            integrity: record.integrity,
            shasum: record.shasum,
          },
        };
        response.end(
          JSON.stringify({
            name,
            'dist-tags': { latest: record.manifest.version, alpha: record.manifest.version },
            versions: { [record.manifest.version]: version },
          }),
        );
        return;
      }
      if (name === 'zmdb' || name.startsWith('@zmdb/')) {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      response.writeHead(302, { location: `https://registry.npmjs.org/${encodeURIComponent(name)}` });
      response.end();
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert(address);
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    port: address.port,
    requested,
    async close() {
      server.closeAllConnections();
      await new Promise((accept, reject) => server.close(error => (error ? reject(error) : accept())));
      const probe = createServer();
      await new Promise((accept, reject) => {
        probe.once('error', reject);
        probe.listen(address.port, '127.0.0.1', accept);
      });
      await new Promise((accept, reject) => probe.close(error => (error ? reject(error) : accept())));
    },
  };
}

export async function createFixture() {
  assert.equal(await realpath(root), root, 'fixture root must be canonical');
  assert(relative(root, evidence).startsWith(`..${sep}`), 'evidence must be external');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const parent = await stat(evidence);
  assert.equal(parent.uid, process.getuid());
  assert.equal(parent.mode & 0o077, 0);
  const directory = join(evidence, `run-${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const identity = await stat(directory);
  const children = new Set();
  let registry;
  async function owned(name) {
    assert(!name.includes('/'));
    children.add(name);
    const path = join(directory, name);
    await mkdir(path, { mode: 0o700 });
    return path;
  }
  async function cleanup() {
    const failures = [];
    const now = await stat(directory);
    assert.equal(now.ino, identity.ino);
    assert.equal(now.dev, identity.dev);
    const entries = await readdir(directory);
    assert.deepEqual(
      entries.filter(entry => !children.has(entry)),
      [],
      'CLEANUP unexpected child; preserve owned tree',
    );
    try {
      if (registry) await registry.close();
    } catch (error) {
      failures.push(String(error));
    }
    for (const entry of entries) {
      if (!children.has(entry)) {
        failures.push(`unexpected child ${entry}`);
        continue;
      }
      const path = join(directory, entry);
      assert(!(await lstat(path)).isSymbolicLink());
      await rm(path, { recursive: true });
    }
    const remaining = await readdir(directory);
    if (remaining.length === 0) await rm(directory, { recursive: true });
    assert.deepEqual(failures, [], 'CLEANUP failure');
    const processes = [...groups].filter(groupAlive);
    assert.deepEqual(processes, [], 'CLEANUP surviving process groups');
    return { children: remaining, ports: [], processes };
  }
  try {
    const payloads = await owned('payloads'),
      tarballs = await owned('tarballs'),
      consumers = await owned('consumers');
    const manifests = new Map();
    for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
        manifests.set(manifest.name, { manifest, directory: join(root, 'packages', entry.name) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const selected = new Map();
    function visit(name) {
      if (selected.has(name)) return;
      const record = manifests.get(name);
      if (!record) return;
      selected.set(name, record);
      for (const dependency of Object.keys({ ...record.manifest.dependencies, ...record.manifest.peerDependencies })) {
        if (record.manifest.peerDependenciesMeta?.[dependency]?.optional && !appRoots.includes(dependency)) continue;
        visit(dependency);
      }
    }
    for (const name of [...appRoots, '@zmdb/cli', 'zmdb']) visit(name);
    const { publishManifest } = await import(
      pathToFileURL(join(root, '.github/scripts/lib/publish-manifest.mjs')).href
    );
    const records = new Map();
    // Share the existing packed-adapter lock; only build/stage/pack owns shared dist.
    const buildLock = join(tmpdir(), `zmdb-adapter-packed-build-${encodeURIComponent(await realpath(root))}.lock`);
    const started = Date.now();
    for (;;) {
      try {
        await mkdir(buildLock);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() - started > 600_000)
          throw new Error(`TIMEOUT waiting for packed build lock ${buildLock}`, { cause: error });
        await new Promise(accept => setTimeout(accept, 50));
      }
    }
    const lockIdentity = await stat(buildLock);
    try {
      for (const [name, record] of selected) {
        process.stderr.write(`CLI fixture build ${name}\n`);
        const label = name.replaceAll(/[/@]/g, '_');
        await command(process.execPath, ['/home/amitprakash/foss/zmdb/scripts/build-package.mjs'], {
          cwd: record.directory,
          timeout: 600_000,
          expected: 0,
          log: join(evidence, `build-${label}.json`),
        });
        const payload = join(payloads, label);
        await mkdir(payload);
        for (const member of ['dist', 'src', 'README.md', 'LICENSE']) {
          try {
            await cp(join(record.directory, member), join(payload, member), { recursive: true, errorOnExist: true });
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        const manifest = publishManifest(record.manifest);
        await writeFile(join(payload, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
        const packed = await command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], {
          cwd: payload,
          timeout: 600_000,
          expected: 0,
          log: join(evidence, `pack-${label}.json`),
        });
        const report = JSON.parse(packed.stdout);
        assert.equal(Array.isArray(report), false);
        assert.deepEqual(Object.keys(report), [name]);
        const filename = report[name].filename;
        assert.equal(typeof filename, 'string');
        assert.equal(dirname(resolve(tarballs, filename)), tarballs);
        const file = join(tarballs, filename);
        assert((await lstat(file)).isFile());
        const bytes = await readFile(file);
        records.set(name, {
          manifest,
          file,
          sha256: await sha(bytes),
          integrity: `sha512-${await sha(bytes, 'SHA-512', 'base64')}`,
          shasum: await sha(bytes, 'SHA-1'),
        });
      }
    } finally {
      const currentLock = await lstat(buildLock);
      assert(!currentLock.isSymbolicLink());
      assert.equal(currentLock.ino, lockIdentity.ino);
      assert.equal(currentLock.dev, lockIdentity.dev);
      await rm(buildLock, { recursive: true });
    }
    registry = await startRegistry(records);
    async function install(role, names, nested = false) {
      const consumer = join(consumers, role);
      await mkdir(consumer, { recursive: true });
      const dependencies = Object.fromEntries(
        names.map(name => [name, records.get(name)?.manifest.version ?? versions[name]]),
      );
      for (const [name, version] of Object.entries(dependencies))
        assert.equal(typeof version, 'string', `No real archive/version for ${name}`);
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify({ name: `cli-${role}`, private: true, type: 'module', dependencies }, null, 2) + '\n',
      );
      const cache = join(consumer, '.npm-cache'),
        userconfig = join(consumer, '.npmrc');
      await writeFile(userconfig, '');
      const flags = [
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=true',
        `--install-strategy=${nested ? 'nested' : 'hoisted'}`,
        '--registry',
        registry.origin,
        '--cache',
        cache,
        '--userconfig',
        userconfig,
      ];
      await command('npm', ['install', ...flags], {
        cwd: consumer,
        timeout: 600_000,
        expected: 0,
        log: join(evidence, `install-${role}.json`),
      });
      const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
      assert.deepEqual(lock.packages[''].dependencies, dependencies);
      for (const [path, locked] of Object.entries(lock.packages)) {
        const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
        const record = records.get(name);
        if (!record) continue;
        assert.equal(locked.resolved, `${registry.origin}/tarballs/${record.sha256}.tgz`);
        assert.equal(locked.integrity, record.integrity);
      }
      await rm(join(consumer, 'node_modules'), { recursive: true });
      await command('npm', ['ci', ...flags], {
        cwd: consumer,
        timeout: 600_000,
        expected: 0,
        log: join(evidence, `ci-${role}.json`),
      });
      return consumer;
    }
    await writeFile(
      join(evidence, 'archives.json'),
      JSON.stringify(
        [...records].map(([name, r]) => ({ name, manifest: r.manifest, sha256: r.sha256, integrity: r.integrity })),
        null,
        2,
      ) + '\n',
    );
    return { directory, records, registry, consumers, install, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'SETUP and CLEANUP failed', { cause: cleanupError });
    }
    throw error;
  }
}
