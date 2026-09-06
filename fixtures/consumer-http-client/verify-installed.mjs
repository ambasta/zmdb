#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain } from '../../.github/scripts/lib/publish-manifest.mjs';

const FIXTURE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(FIXTURE, '../..');
const RELEASE_VERSION = (await publishTrain(ROOT)).version;
const CLIENT = join(ROOT, 'packages', 'client');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');
const ESBUILD = join(ROOT, 'node_modules', '.bin', 'esbuild');
const SOURCE_HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const ZMDB_BIN = join(ROOT, 'packages', 'zmdb', 'src', 'cli', 'bin.ts');

function run(command, arguments_, options = {}) {
  return spawnSync(command, arguments_, { encoding: 'utf8', ...options });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${String(result.status)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

function requestedTarball(argv) {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== '--client-tarball') {
    throw new Error('usage: verify-installed.mjs [--client-tarball <path>]');
  }
  const path = resolve(argv[1]);
  if (!existsSync(path)) throw new Error(`client tarball does not exist: ${path}`);
  return path;
}

function buildClientTarball(temporary) {
  const stage = join(temporary, 'stage');
  const dist = join(stage, 'dist');
  mkdirSync(stage, { recursive: true });
  cpSync(join(CLIENT, 'src'), join(stage, 'src'), { recursive: true });
  cpSync(join(CLIENT, 'README.md'), join(stage, 'README.md'));
  cpSync(join(ROOT, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(CLIENT, '.npmignore'), join(stage, '.npmignore'));

  requireSuccess(
    'client declaration/runtime build',
    run(
      TSC,
      [
        '-p',
        join(CLIENT, 'tsconfig.build.json'),
        '--rootDir',
        join(CLIENT, 'src'),
        '--outDir',
        dist,
        '--tsBuildInfoFile',
        join(temporary, 'client.tsbuildinfo'),
      ],
      { cwd: ROOT },
    ),
  );

  const committed = JSON.parse(readFileSync(join(CLIENT, 'package.json'), 'utf8'));
  writeFileSync(
    join(stage, 'package.json'),
    `${JSON.stringify(publishManifest(committed, RELEASE_VERSION), null, 2)}\n`,
  );
  const packed = run('npm', ['pack', '--json', '--pack-destination', temporary], {
    cwd: stage,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  requireSuccess('client npm pack', packed);
  const report = JSON.parse(packed.stdout);
  const entry = Array.isArray(report) ? report[0] : Object.values(report)[0];
  if (entry === undefined || typeof entry.filename !== 'string') throw new Error('npm pack returned no filename');
  return join(temporary, entry.filename);
}

async function startServer(temporary) {
  const bundle = join(temporary, 'server.mjs');
  symlinkSync(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  requireSuccess(
    'real @zmdb/web fixture bundle',
    run(
      ESBUILD,
      [
        join(FIXTURE, 'server.ts'),
        '--bundle',
        '--format=esm',
        '--packages=external',
        '--platform=node',
        '--target=node26',
        `--outfile=${bundle}`,
      ],
      { cwd: ROOT },
    ),
  );

  const child = spawn(process.execPath, ['--import', SOURCE_HOOK, bundle], {
    cwd: ROOT,
    env: { ...process.env, ZMDB_HTTP_FIXTURE_ROOT: FIXTURE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  const url = await new Promise((resolveUrl, rejectUrl) => {
    let timeout;
    const finish = action => {
      clearTimeout(timeout);
      child.stdout.off('data', inspect);
      child.off('error', failed);
      child.off('exit', exited);
      action();
    };
    const inspect = () => {
      const line = stdout.split(/\r?\n/u).find(candidate => /^http:\/\/127\.0\.0\.1:\d+$/u.test(candidate));
      if (line === undefined) return;
      finish(() => resolveUrl(line));
    };
    const failed = error => {
      finish(() => rejectUrl(error));
    };
    const exited = (code, signal) => {
      finish(() =>
        rejectUrl(
          new Error(
            `@zmdb/web fixture exited before listening (code=${String(code)}, signal=${String(signal)}): ${stderr}`,
          ),
        ),
      );
    };
    timeout = setTimeout(
      () =>
        finish(() =>
          rejectUrl(new Error(`timed out waiting for @zmdb/web fixture; stdout=${stdout} stderr=${stderr}`)),
        ),
      30_000,
    );
    child.stdout.on('data', inspect);
    child.once('error', failed);
    child.once('exit', exited);
    inspect();
  }).catch(error => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    throw error;
  });

  return {
    url,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolveExit, rejectExit) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          rejectExit(new Error('@zmdb/web fixture did not stop after SIGTERM'));
        }, 10_000);
        child.once('exit', (code, signal) => {
          clearTimeout(timeout);
          if (code === 0) resolveExit();
          else rejectExit(new Error(`@zmdb/web fixture stopped with code=${String(code)}, signal=${String(signal)}`));
        });
      });
    },
  };
}

function runConsumer(kind, temporary, tarball, baseUrl) {
  const app = join(temporary, kind);
  const installed = join(app, 'node_modules', '@zmdb', 'client');
  mkdirSync(installed, { recursive: true });
  mkdirSync(join(app, 'generated'), { recursive: true });
  cpSync(join(FIXTURE, 'package.json'), join(app, 'package.json'));
  cpSync(join(FIXTURE, 'consumer.ts'), join(app, 'consumer.ts'));
  cpSync(join(FIXTURE, 'generated', 'http-client.generated.ts'), join(app, 'generated', 'http-client.generated.ts'));
  cpSync(join(FIXTURE, `tsconfig.${kind}.json`), join(app, `tsconfig.${kind}.json`));
  requireSuccess(`${kind} tarball extraction`, run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']));

  const scopeEntries = readdirSync(join(app, 'node_modules', '@zmdb'));
  if (JSON.stringify(scopeEntries) !== JSON.stringify(['client'])) {
    throw new Error(`${kind} consumer installed unexpected @zmdb packages: ${scopeEntries.join(', ')}`);
  }
  requireSuccess(`${kind} packed declarations`, run(TSC, ['-p', `tsconfig.${kind}.json`], { cwd: app }));

  const bundle = join(app, 'consumer.mjs');
  requireSuccess(
    `${kind} packed bundle`,
    run(
      ESBUILD,
      [
        'consumer.ts',
        '--bundle',
        '--format=esm',
        `--platform=${kind === 'browser' ? 'browser' : 'node'}`,
        '--target=es2022',
        `--define:FIXTURE_BASE_URL=${JSON.stringify(baseUrl)}`,
        `--define:FIXTURE_KIND=${JSON.stringify(kind)}`,
        `--outfile=${bundle}`,
      ],
      { cwd: app },
    ),
  );
  const runtime = run(process.execPath, [bundle], { cwd: app });
  requireSuccess(`${kind} packed runtime`, runtime);
  if (!runtime.stdout.includes(`${kind}-packed-client-ok`)) {
    throw new Error(`${kind} packed runtime omitted its success marker\n${runtime.stdout}\n${runtime.stderr}`);
  }
  process.stdout.write(runtime.stdout);
}

const temporary = mkdtempSync(join(tmpdir(), 'zmdb-client-consumer-'));
let server;
try {
  requireSuccess(
    'committed HTTP client generation check',
    run(
      process.execPath,
      ['--import', SOURCE_HOOK, ZMDB_BIN, 'client', 'generate', '--check', '--config', join(FIXTURE, 'zmdb.config.ts')],
      { cwd: ROOT },
    ),
  );
  requireSuccess(
    'real @zmdb/web fixture typecheck',
    run(TSC, ['-p', join(FIXTURE, 'tsconfig.server.json')], { cwd: ROOT }),
  );

  const tarball = requestedTarball(process.argv.slice(2)) ?? buildClientTarball(temporary);
  server = await startServer(temporary);
  for (const kind of ['node', 'browser']) runConsumer(kind, temporary, tarball, server.url);

  process.stdout.write(
    'packed Node and browser generated-client consumers passed against real @zmdb/web with only @zmdb/client installed\n',
  );
} finally {
  await server?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
