#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE_VERSION = (await publishTrain(ROOT)).version;
const FIXTURE = join(ROOT, 'fixtures', 'database-cockroach');
const PACKAGES = join(ROOT, 'packages');

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function workspacePackages() {
  const packages = new Map();
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(PACKAGES, entry.name);
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name === 'string') packages.set(manifest.name, { directory, manifest });
  }
  return packages;
}

function closure(packages, root) {
  const found = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || found.has(name)) continue;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`workspace dependency is absent: ${name}`);
    found.add(name);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (packages.has(dependency)) queue.push(dependency);
    }
  }
  return [...found].toSorted();
}

function copyForPack(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function pack(packages, names, scratch) {
  const archives = new Map();
  for (const name of names) {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`cannot pack absent package ${name}`);
    const stage = join(scratch, 'stage', name.replaceAll('/', '__'));
    mkdirSync(dirname(stage), { recursive: true });
    copyForPack(pkg.directory, stage);
    writeFileSync(
      join(stage, 'package.json'),
      `${JSON.stringify(publishManifest(pkg.manifest, RELEASE_VERSION), null, 2)}\n`,
    );
    const packed = run('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    if (packed.status !== 0) throw new Error(`npm pack failed for ${name}: ${output(packed)}`);
    const report = JSON.parse(packed.stdout);
    const row = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (row === undefined || typeof row.filename !== 'string') {
      throw new Error(`npm pack returned no archive for ${name}`);
    }
    archives.set(name, join(scratch, row.filename));
  }
  return archives;
}

function main() {
  if (process.env.ZMDB_COCKROACH_URL === undefined) {
    throw new Error('ZMDB_COCKROACH_URL is required; packed CockroachDB acceptance is fail-closed');
  }

  const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('yarn build failed before packed CockroachDB verification');

  const packages = workspacePackages();
  const names = closure(packages, '@zmdb/cockroach');
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-database-cockroach-'));
  try {
    const archives = pack(packages, names, scratch);
    const app = join(scratch, 'consumer');
    copyForPack(FIXTURE, app);
    const fixtureManifest = JSON.parse(readFileSync(join(FIXTURE, 'package.json'), 'utf8'));
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify(
        {
          ...fixtureManifest,
          dependencies: {
            ...Object.fromEntries(
              names.map(name => {
                const archive = archives.get(name);
                if (archive === undefined) throw new Error(`no archive for ${name}`);
                return [name, `file:${archive}`];
              }),
            ),
            pg: fixtureManifest.dependencies.pg,
          },
        },
        null,
        2,
      )}\n`,
    );

    const installed = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
      { cwd: app, env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' } },
    );
    if (installed.status !== 0) throw new Error(`packed CockroachDB install failed: ${output(installed)}`);

    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
    const types = run(tsc, ['--noEmit', '-p', join(app, 'tsconfig.json')], { cwd: app });
    if (types.status !== 0) throw new Error(`packed CockroachDB declarations failed: ${output(types)}`);

    const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], {
      cwd: app,
      env: { ...process.env, ZMDB_COCKROACH_URL: process.env.ZMDB_COCKROACH_URL },
    });
    if (runtime.status !== 0) throw new Error(`packed CockroachDB runtime failed: ${output(runtime)}`);
    process.stdout.write(runtime.stdout);
    process.stdout.write(
      `packed CockroachDB consumer passed with ${names.length} local package archives and consumer-selected pg\n`,
    );
  } finally {
    if (process.env.ZMDB_KEEP_DATABASE_COCKROACH_FIXTURE === undefined) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      process.stdout.write(`kept fixture tree at ${scratch}\n`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
