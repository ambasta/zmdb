import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startRegistry } from '../consumer-jobs-providers/registry.mjs';
import { inspectInstalledConsumer, ROOTS } from './verify-installed.mjs';

const source = import.meta.dirname;
const providerSource = resolve(source, '../consumer-jobs-providers');

export async function qualifySelectedJobs({ tarballs, evidence, failureMode }) {
  assert(failureMode === undefined || failureMode === 'consumer' || failureMode === 'timeout');
  const directory = await mkdtemp(join(resolve(source, '../../..'), 'selected-jobs-qualification-'));
  const report = { directory, commands: [], consumers: [], failures: [], cleaned: false, node: process.version };
  const stop = new AbortController();
  const interrupt = () => stop.abort(new Error('selected-jobs qualification interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let registry;
  let postgres;
  async function run(command, argv, cwd, environment = {}, timeout = 120_000, cleanup = false, expectedCode = 0) {
    if (!cleanup) stop.signal.throwIfAborted();
    const childEnvironment = { ...process.env, ...environment, NODE_PATH: '', NODE_OPTIONS: '' };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const child = spawn(command, argv, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnvironment,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', bytes => {
      stdout += bytes;
    });
    child.stderr.on('data', bytes => {
      stderr += bytes;
    });
    const kill = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    };
    const timer = setTimeout(kill, timeout);
    if (!cleanup) stop.signal.addEventListener('abort', kill, { once: true });
    let result;
    try {
      result = await new Promise((complete, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => complete({ code, signal }));
      });
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', kill);
    }
    report.commands.push({ command, argv, cwd, ...result, stdout, stderr });
    assert.equal(result.code, expectedCode, `${command} ${argv.join(' ')}: ${stderr}\n${stdout}`);
    return stdout;
  }
  try {
    const packages = new Map(tarballs.map(entry => [entry.manifest.name, entry]));
    for (const name of new Set(
      Object.values(ROOTS)
        .flat()
        .filter(candidate => candidate !== 'pg'),
    )) {
      assert(packages.has(name), `missing packed input ${name}`);
    }
    const integrities = new Map();
    report.tarballs = [];
    for (const entry of tarballs) {
      const bytes = await readFile(entry.tarball);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      // eslint-disable-next-line no-restricted-globals
      const base64 = globalThis.btoa(
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512', bytes)), b => String.fromCharCode(b)).join(''),
      );
      integrities.set(entry.manifest.name, `sha512-${base64}`);
      report.tarballs.push({ name: entry.manifest.name, version: entry.manifest.version, sha256 });
    }
    registry = await startRegistry(tarballs);
    report.registryOrigin = registry.origin;
    report.npm = (await run('npm', ['--version'], directory)).trim();
    for (const lane of Object.keys(ROOTS)) {
      stop.signal.throwIfAborted();
      const consumer = join(directory, lane);
      await mkdir(consumer);
      const dependencies = Object.fromEntries(
        ROOTS[lane].map(name => [name, name === 'pg' ? '8.23.0' : `file:${resolve(packages.get(name).tarball)}`]),
      );
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify(
          {
            name: `selected-jobs-${lane}`,
            private: true,
            type: 'module',
            dependencies,
            devDependencies: {
              typescript: '7.0.2',
              '@types/node': '26.4.1',
              ...(lane === 'postgres' ? { '@types/pg': '8.23.1' } : {}),
            },
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(consumer, '.npmrc'),
        `@zmdb:registry=${registry.origin}\nregistry=https://registry.npmjs.org/\naudit=false\nfund=false\n`,
      );
      await run('npm', ['install', '--no-audit', '--no-fund', '--cache', join(directory, 'npm-cache')], consumer);
      const installed = await inspectInstalledConsumer(consumer, lane, integrities);
      if (lane !== 'postgres') {
        for (const file of ['default.ts', 'dialect.ts', 'invalid-dto.ts', 'tsconfig.json'])
          await cp(join(source, file), join(consumer, file));
        await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
        const diagnostics = await run(
          process.execPath,
          [
            'node_modules/typescript/bin/tsc',
            '--ignoreConfig',
            '--noEmit',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--target',
            'ES2022',
            '--lib',
            'ESNext',
            '--types',
            'node',
            '--strict',
            '--skipLibCheck',
            'false',
            'invalid-dto.ts',
          ],
          consumer,
          {},
          120_000,
          false,
          1,
        );
        assert.equal((diagnostics.match(/error TS\d+:/g) ?? []).length, 1);
        assert.match(
          diagnostics,
          /invalid-dto\.ts\(8,44\): error TS2322: Type 'string' is not assignable to type 'number & Sql<"integer"> & PrimaryKey'\./,
        );
        if (lane === 'default') await run(process.execPath, ['dist/default.js'], consumer);
      }
      if (lane !== 'default') {
        await mkdir(join(consumer, 'providers'));
        for (const file of [
          'conformance.mjs',
          `${lane}.mjs`,
          'tasks.ts',
          'contracts.ts',
          `${lane}-contracts.ts`,
          'tsconfig.json',
        ]) {
          await cp(join(providerSource, file), join(consumer, 'providers', file));
        }
        const configPath = join(consumer, 'providers/tsconfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        config.files.push('tasks.ts', `${lane}-contracts.ts`);
        await writeFile(configPath, JSON.stringify(config));
        await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'providers/tsconfig.json'], consumer);
        await cp(join(source, `${lane}.mjs`), join(consumer, `${lane}.mjs`));
        if (lane === 'postgres') {
          const data = join(directory, 'postgres-data');
          await run(
            'initdb',
            ['-D', data, '-U', 'issue757', '--auth-local=trust', '--auth-host=trust', '--no-locale', '--encoding=UTF8'],
            directory,
          );
          const socket = createServer();
          await new Promise(done => socket.listen(0, '127.0.0.1', done));
          const port = socket.address().port;
          await new Promise(done => socket.close(done));
          postgres = data;
          await run(
            'pg_ctl',
            [
              '-D',
              data,
              '-l',
              join(directory, 'postgres.log'),
              '-w',
              '-t',
              '15',
              '-o',
              `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c max_connections=20`,
              'start',
            ],
            directory,
          );
          report.postgres = {
            port,
            pid: Number((await readFile(join(data, 'postmaster.pid'), 'utf8')).split('\n')[0]),
          };
          if (failureMode !== undefined) {
            await run(
              process.execPath,
              ['-e', failureMode === 'consumer' ? 'process.exit(17)' : 'setInterval(() => {}, 1000)'],
              consumer,
              {},
              100,
            );
            assert.fail('injected qualification failure was accepted');
          }
          const output = await run(process.execPath, ['--test-reporter=tap', 'postgres.mjs'], consumer, {
            ZMDB_PG: `postgresql://issue757@127.0.0.1:${port}/postgres`,
          });
          assert.match(output, /# fail 0/);
          assert.match(output, /# tests 25\b/);
          assert.match(output, /# skipped 0/);
        } else {
          const output = await run(process.execPath, ['--test-reporter=tap', 'sqlite.mjs'], consumer);
          assert.match(output, /# fail 0/);
          assert.match(output, /# tests 16\b/);
          assert.match(output, /# skipped 0/);
          assert.match(output, /"journey":"default-product"/);
        }
      }
      report.consumers.push(installed);
    }
    report.registryRequests = [...registry.requests];
  } catch (error) {
    report.failures.push(error.stack ?? String(error));
  } finally {
    if (postgres !== undefined) {
      try {
        await run('pg_ctl', ['-D', postgres, '-w', '-t', '15', '-m', 'fast', 'stop'], directory, {}, 30_000, true);
      } catch (error) {
        report.failures.push(`PostgreSQL cleanup: ${String(error)}`);
      }
    }
    if (registry !== undefined) {
      try {
        await registry.close();
      } catch (error) {
        report.failures.push(`registry cleanup: ${String(error)}`);
      }
    }
    if (!report.failures.some(failure => /cleanup:/.test(failure))) {
      await rm(directory, { recursive: true });
      report.cleaned = true;
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (evidence !== undefined) await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, input, evidenceFlag, evidence] = process.argv.slice(2);
  assert.equal(flag, '--tarballs');
  assert(input !== undefined, '--tarballs requires a JSON file containing real publish-manifest tarball records');
  assert.equal(evidenceFlag, '--evidence');
  assert(evidence !== undefined, '--evidence requires a path');
  const report = await qualifySelectedJobs({ tarballs: JSON.parse(await readFile(input, 'utf8')), evidence });
  process.stdout.write(
    `${JSON.stringify({ consumers: report.consumers.map(entry => entry.lane), cleaned: report.cleaned, failures: report.failures })}\n`,
  );
  process.exitCode = report.cleaned && report.failures.length === 0 && report.consumers.length === 3 ? 0 : 1;
}
