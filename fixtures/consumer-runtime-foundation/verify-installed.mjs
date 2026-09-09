#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURES = join(ROOT, 'fixtures/consumer-runtime-foundation');
const LANES = ['schema', 'sql', 'validator', 'orm', 'application', 'generated'];
const FOUNDATION = new Set(['@zmdb/schema', '@zmdb/sql', '@zmdb/validator', '@zmdb/orm']);
const DEPENDENCIES = {
  '@zmdb/schema': [],
  '@zmdb/sql': ['@zmdb/schema'],
  '@zmdb/validator': ['@zmdb/schema'],
  '@zmdb/orm': ['@zmdb/schema', '@zmdb/sql', '@zmdb/validator'],
};
const TYPES = { typescript: '7.0.2', '@types/node': '26.4.1' };
const sha = async (bytes, algorithm = 'SHA-256', encoding = 'hex') => {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return encoding === 'hex' ? digest.toHex() : digest.toBase64();
};
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const alive = pid => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};

export async function qualifyRuntimeFoundation({ tarballs, evidence }) {
  const consumers = [],
    failures = [],
    commands = [],
    archives = [];
  let cleaned = false,
    directory,
    identity,
    registry;
  const groups = new Set(),
    active = new Set();
  let aborted = false;
  const stop = (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const abort = () => {
    aborted = true;
    for (const pid of active) {
      stop(pid, 'SIGTERM');
      setTimeout(() => stop(pid, 'SIGKILL'), 1000).unref();
    }
  };
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  const { cleanEnvironment, startRegistry } = await import('../consumer-cli/registry.mjs');
  async function run(executable, argv, cwd, label, expected = 0, timeout = 120_000) {
    assert.equal(aborted, false, 'foundation qualification was aborted');
    const child = spawn(executable, argv, {
      cwd,
      env: cleanEnvironment(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert(child.pid, `unable to start ${label}`);
    const pid = child.pid;
    groups.add(pid);
    active.add(pid);
    let stdout = '',
      stderr = '',
      timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => {
      stdout += text;
    });
    child.stderr.on('data', text => {
      stderr += text;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stop(pid, 'SIGTERM');
    }, timeout);
    const hardLimit = setTimeout(() => stop(pid, 'SIGKILL'), timeout + 1000);
    let result;
    try {
      result = await new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) =>
          accept({ label, executable, argv, cwd, pid, code, signal, timedOut, stdout, stderr }),
        );
      });
      commands.push(result);
      await writeFile(join(evidence, `${commands.length}-${label}.json`), JSON.stringify(result, null, 2) + '\n');
    } finally {
      clearTimeout(timer);
      clearTimeout(hardLimit);
      active.delete(pid);
    }
    assert.equal(timedOut, false, `TIMEOUT ${label}`);
    assert.equal(aborted, false, `ABORTED ${label}`);
    assert.equal(result.code, expected, `${label}\n${stdout}\n${stderr}`);
    return result;
  }
  try {
    assert(isAbsolute(evidence), 'evidence directory must be absolute');
    assert(!inside(ROOT, resolve(evidence)), 'evidence directory must be outside the workspace');
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(evidence, 'run-'));
    identity = await stat(directory);
    const records = new Map();
    for (const { manifest, tarball } of tarballs) {
      assert.equal(typeof manifest.name, 'string');
      assert(isAbsolute(tarball));
      assert(!records.has(manifest.name), `duplicate archive ${manifest.name}`);
      const bytes = await readFile(tarball);
      const record = {
        manifest,
        file: tarball,
        sha256: await sha(bytes),
        integrity: `sha512-${await sha(bytes, 'SHA-512', 'base64')}`,
        shasum: await sha(bytes, 'SHA-1'),
      };
      records.set(manifest.name, record);
      archives.push({ name: manifest.name, sha256: record.sha256, integrity: record.integrity });
    }
    registry = await startRegistry(records);
    const rootsFor = async lane =>
      lane === 'application'
        ? ['@zmdb/orm', '@zmdb/sqlite']
        : Object.keys(JSON.parse(await readFile(join(FIXTURES, lane, 'package.json'), 'utf8')).dependencies);
    async function install(role, roots, typecheck = true) {
      const consumer = join(directory, role);
      await mkdir(consumer);
      const dependencies = Object.fromEntries(
        roots.map(name => {
          const record = records.get(name);
          assert(record, `foundation package is not implemented: ${name}`);
          return [name, record.manifest.version];
        }),
      );
      if (typecheck) Object.assign(dependencies, TYPES);
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify({ name: `foundation-${role}`, private: true, type: 'module', dependencies }, null, 2) + '\n',
      );
      const userconfig = join(consumer, '.npmrc');
      await writeFile(userconfig, '');
      const flags = [
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=true',
        '--registry',
        registry.origin,
        '--cache',
        join(consumer, '.npm-cache'),
        '--userconfig',
        userconfig,
      ];
      await run('npm', ['install', ...flags], consumer, `${role}-install`, 0, 600_000);
      const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
      assert.deepEqual(lock.packages[''].dependencies, dependencies);
      const installed = [],
        installedPaths = [];
      for (const [path, locked] of Object.entries(lock.packages)) {
        if (!path) continue;
        const name = path.slice(path.lastIndexOf('node_modules/') + 13);
        const record = records.get(name);
        if (!record) {
          assert(!name.startsWith('@zmdb/'), `unprovided workspace package ${name}`);
          continue;
        }
        assert.equal(locked.resolved, `${registry.origin}/tarballs/${record.sha256}.tgz`);
        assert.equal(locked.integrity, record.integrity);
        installed.push(name);
        installedPaths.push({ name, path });
      }
      if (FOUNDATION.has(roots[0]) && !['application', 'producer'].includes(role)) {
        assert.deepEqual(
          installed.filter(name => !FOUNDATION.has(name)),
          [],
          'independent foundation installed a forbidden package',
        );
      }
      await rm(join(consumer, 'node_modules'), { recursive: true });
      await run('npm', ['ci', ...flags], consumer, `${role}-ci`, 0, 600_000);
      for (const { name, path: installedPath } of installedPaths) {
        const path = join(consumer, installedPath);
        assert(!(await lstat(path)).isSymbolicLink(), `installed package is a source symlink: ${name}`);
        assert(inside(consumer, await realpath(path)), `installed package escapes its consumer: ${name}`);
        if (FOUNDATION.has(name)) {
          const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
          assert.deepEqual(
            Object.keys(manifest.dependencies ?? {}).toSorted(),
            DEPENDENCIES[name],
            `${name} production dependencies`,
          );
          assert.deepEqual(Object.keys(manifest.optionalDependencies ?? {}), [], `${name} optional dependencies`);
          assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}), [], `${name} peer dependencies`);
          assert.deepEqual(Object.keys(manifest.peerDependenciesMeta ?? {}), [], `${name} peer dependency metadata`);
        }
      }
      return { consumer, roots: dependencies, installed: installed.toSorted() };
    }
    async function typeAndRuntime(lane, installation) {
      const { consumer } = installation;
      await cp(join(FIXTURES, lane, 'src'), join(consumer, 'src'), { recursive: true });
      if (lane === 'orm') await cp(join(FIXTURES, 'sql/src/dialect.ts'), join(consumer, 'src/dialect.ts'));
      const config = JSON.parse(await readFile(join(FIXTURES, 'tsconfig.base.json'), 'utf8'));
      config.include = ['src/**/*.ts'];
      config.compilerOptions.noEmit = false;
      config.compilerOptions.outDir = 'compiled';
      config.compilerOptions.rootDir = 'src';
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n');
      const specifiers = [];
      for (const name of installation.installed) {
        const manifest = JSON.parse(await readFile(join(consumer, 'node_modules', name, 'package.json'), 'utf8'));
        for (const [selector, entry] of Object.entries(manifest.exports)) {
          assert.equal(
            typeof entry,
            'object',
            `published export must have declaration/runtime conditions: ${name}${selector}`,
          );
          assert.equal(typeof entry.types, 'string');
          assert.match(entry.types, /^\.\/dist\/.*\.d\.(?:ts|mts|cts)$/);
          assert.equal(typeof entry.import, 'string');
          assert.match(entry.import, /^\.\/dist\/.*\.(?:js|mjs|cjs)$/);
          specifiers.push(name + (selector === '.' ? '' : selector.slice(1)));
        }
      }
      const imports = specifiers
        .map((specifier, i) => `import type * as surface${i} from ${JSON.stringify(specifier)};`)
        .join('\n');
      await writeFile(
        join(consumer, 'src/exports.ts'),
        `${imports}\nexport type Surface = [${specifiers.map((_, i) => `typeof surface${i}`).join(',')}];\n`,
      );
      await run(
        join(consumer, 'node_modules/.bin/tsc'),
        ['-p', 'tsconfig.json', '--pretty', 'false'],
        consumer,
        `${lane}-types`,
      );
      await cp(join(consumer, 'src/runtime.mjs'), join(consumer, 'compiled/runtime.mjs'));
      await run(process.execPath, ['compiled/runtime.mjs'], consumer, `${lane}-runtime`);
      await cp(join(FIXTURES, 'boundary.mjs'), join(consumer, 'boundary.mjs'));
      await run(process.execPath, ['boundary.mjs', JSON.stringify(specifiers)], consumer, `${lane}-boundary`);
      return { ...installation, exports: specifiers };
    }
    for (const lane of LANES) {
      try {
        let observed;
        if (lane === 'generated') {
          const producer = await install('producer', ['@zmdb/compiler']);
          await cp(join(FIXTURES, 'generated'), join(producer.consumer, 'project'), { recursive: true });
          await cp(join(FIXTURES, 'generated/producer.mjs'), join(producer.consumer, 'producer.mjs'));
          await run(process.execPath, ['producer.mjs'], producer.consumer, 'generated-producer');
          const runtime = await install('generated', ['@zmdb/validator'], false);
          await cp(join(producer.consumer, 'project/compiled'), join(runtime.consumer, 'src'), { recursive: true });
          await cp(join(FIXTURES, 'generated/src/runtime.mjs'), join(runtime.consumer, 'src/runtime.mjs'));
          await run(process.execPath, ['src/runtime.mjs'], runtime.consumer, 'generated-runtime');
          observed = { roots: runtime.roots, installed: runtime.installed, producerRoots: producer.roots };
        } else {
          const installation = await install(lane, await rootsFor(lane), lane !== 'application');
          if (lane === 'application') {
            await cp(join(FIXTURES, 'application/src'), join(installation.consumer, 'src'), { recursive: true });
            await run(process.execPath, ['src/runtime.mjs'], installation.consumer, 'application-runtime');
            observed = installation;
          } else observed = await typeAndRuntime(lane, installation);
        }
        consumers.push({
          lane,
          roots: observed.roots,
          installed: observed.installed,
          ...(observed.exports ? { exports: observed.exports } : {}),
          ...(observed.producerRoots ? { producerRoots: observed.producerRoots } : {}),
        });
      } catch (error) {
        failures.push({ lane, message: error.stack ?? String(error) });
      }
    }
  } catch (error) {
    failures.push({ lane: 'setup', message: error.stack ?? String(error) });
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    try {
      const survivors = [...groups].filter(alive);
      if (survivors.length)
        failures.push({ lane: 'cleanup', message: `surviving process groups: ${survivors.join(', ')}` });
      for (const pid of survivors) stop(pid, 'SIGKILL');
      for (let attempt = 0; attempt < 100 && survivors.some(alive); attempt++)
        await new Promise(accept => setTimeout(accept, 10));
      if (registry) await registry.close();
      if (directory) {
        const current = await lstat(directory);
        assert(!current.isSymbolicLink());
        assert.equal(current.ino, identity.ino);
        assert.equal(current.dev, identity.dev);
        assert.deepEqual(
          (await readdir(directory)).filter(name => ![...LANES, 'producer'].includes(name)),
          [],
          'cleanup found an unexpected child',
        );
        await rm(directory, { recursive: true });
      }
      assert.deepEqual([...groups].filter(alive), [], 'cleanup left a process group');
      cleaned = true;
    } catch (error) {
      failures.push({ lane: 'cleanup', message: error.stack ?? String(error) });
    }
  }
  const result = {
    consumers,
    failures,
    cleaned,
    archives,
    commands: commands.map(({ label, code, signal, timedOut }) => ({ label, code, signal, timedOut })),
  };
  if (isAbsolute(evidence)) await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || (args.length === 2 && args[0] === '--evidence-dir' && isAbsolute(args[1])),
    'usage: verify-installed.mjs [--evidence-dir <absolute-path>]',
  );
  const evidence = args[1] ?? (await mkdtemp(join(tmpdir(), 'zmdb-foundation-proof-')));
  const temporary = args.length === 0;
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  process.env.ZMDB_CLI_EVIDENCE = join(evidence, 'setup');
  await mkdir(process.env.ZMDB_CLI_EVIDENCE, { recursive: true, mode: 0o700 });
  const { createFixture } = await import('../consumer-cli/registry.mjs');
  let fixture;
  try {
    fixture = await createFixture();
    const result = await qualifyRuntimeFoundation({
      tarballs: [...fixture.records.values()].map(record => ({ manifest: record.manifest, tarball: record.file })),
      evidence,
    });
    console.log(JSON.stringify(result));
    if (result.failures.length || !result.cleaned || result.consumers.length !== LANES.length) process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    if (temporary) await rm(evidence, { recursive: true });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(error => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}
