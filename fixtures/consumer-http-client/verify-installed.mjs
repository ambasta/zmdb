#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const FIXTURE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(FIXTURE, '../..');
const CLIENT = join(ROOT, 'packages', 'client');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

function run(command, arguments_, options = {}) {
  return spawnSync(command, arguments_, { encoding: 'utf8', ...options });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${String(result.status)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

const temporary = mkdtempSync(join(tmpdir(), 'zmdb-client-consumer-'));
try {
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
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(publishManifest(committed), null, 2)}\n`);
  const packed = run('npm', ['pack', '--json', '--pack-destination', temporary], {
    cwd: stage,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  requireSuccess('client npm pack', packed);
  const report = JSON.parse(packed.stdout);
  const entry = Array.isArray(report) ? report[0] : Object.values(report)[0];
  if (entry === undefined || typeof entry.filename !== 'string') throw new Error('npm pack returned no filename');
  const tarball = join(temporary, entry.filename);

  for (const kind of ['node', 'browser']) {
    const app = join(temporary, kind);
    const installed = join(app, 'node_modules', '@zmdb', 'client');
    mkdirSync(installed, { recursive: true });
    cpSync(join(FIXTURE, 'package.json'), join(app, 'package.json'));
    cpSync(join(FIXTURE, `${kind}-runtime.mjs`), join(app, `${kind}-runtime.mjs`));
    cpSync(join(FIXTURE, `${kind}-contracts.ts`), join(app, `${kind}-contracts.ts`));
    cpSync(join(FIXTURE, `tsconfig.${kind}.json`), join(app, `tsconfig.${kind}.json`));
    requireSuccess(
      `${kind} tarball extraction`,
      run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']),
    );

    const scopeEntries = readdirSync(join(app, 'node_modules', '@zmdb'));
    if (JSON.stringify(scopeEntries) !== JSON.stringify(['client'])) {
      throw new Error(`${kind} consumer installed unexpected @zmdb packages: ${scopeEntries.join(', ')}`);
    }
    requireSuccess(`${kind} packed runtime`, run(process.execPath, [`${kind}-runtime.mjs`], { cwd: app }));
    requireSuccess(`${kind} packed declarations`, run(TSC, ['-p', `tsconfig.${kind}.json`], { cwd: app }));
  }

  process.stdout.write('packed Node and browser client consumers passed with only @zmdb/client installed\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
