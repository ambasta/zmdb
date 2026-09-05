#!/usr/bin/env node
// Build, pack, install and execute the four independent foundation consumers.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = join(ROOT, 'fixtures', 'consumer-runtime-foundation');
const PACKAGES = join(ROOT, 'packages');
const TARGETS = ['@zmdb/schema', '@zmdb/sql', '@zmdb/validator', '@zmdb/orm'];

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

function closure(packages, roots) {
  const found = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || found.has(name)) continue;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`foundation package is not implemented: ${name}`);
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
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(publishManifest(pkg.manifest), null, 2)}\n`);
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

function fixtures() {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = join(FIXTURES, entry.name);
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const dependencies = Object.keys(manifest.dependencies ?? {}).toSorted();
      if (dependencies.some(name => !TARGETS.includes(name))) {
        throw new Error(`${relative(ROOT, directory)} declares a non-foundation dependency`);
      }
      return { name: entry.name, directory, manifest, dependencies };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function verifyFixture(packages, archives, fixture, scratch) {
  const app = join(scratch, `consumer-${fixture.name}`);
  copyForPack(fixture.directory, app);
  const names = closure(packages, fixture.dependencies);
  const installManifest = {
    ...fixture.manifest,
    dependencies: Object.fromEntries(
      names.map(name => {
        const archive = archives.get(name);
        if (archive === undefined) throw new Error(`no archive for ${name}`);
        return [name, `file:${archive}`];
      }),
    ),
  };
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(installManifest, null, 2)}\n`);

  const installed = run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
    {
      cwd: app,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    },
  );
  if (installed.status !== 0) throw new Error(`${fixture.name} install failed: ${output(installed)}`);

  const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], { cwd: app });
  if (runtime.status !== 0) throw new Error(`${fixture.name} runtime failed: ${output(runtime)}`);

  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
  const types = run(tsc, ['--noEmit', '-p', join(app, 'tsconfig.json')], { cwd: app });
  if (types.status !== 0) throw new Error(`${fixture.name} declarations failed: ${output(types)}`);

  console.log(`${fixture.name}: ${names.join(', ')} packed runtime and declarations OK`);
}

function main() {
  const packages = workspacePackages();
  const missing = TARGETS.filter(name => !packages.has(name));
  if (missing.length > 0) throw new Error(`runtime foundation packages are not implemented: ${missing.join(', ')}`);

  const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('yarn build failed before packed foundation verification');

  const projects = fixtures();
  const names = closure(
    packages,
    projects.flatMap(project => project.dependencies),
  );
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-runtime-foundation-'));
  try {
    const archives = pack(packages, names, scratch);
    for (const fixture of projects) verifyFixture(packages, archives, fixture, scratch);
  } finally {
    if (process.env.ZMDB_KEEP_RUNTIME_FOUNDATION_FIXTURES === undefined) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      console.log(`kept fixture tree at ${scratch}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
