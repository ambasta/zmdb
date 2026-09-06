#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE_VERSION = publishTrain(ROOT).version;
const FIXTURE = join(ROOT, 'fixtures', 'database-sqlite');
const PACKAGE_ROOT = join(ROOT, 'packages');
const BUILD_ORDER = [
  '@zmdb/query-compiler',
  '@zmdb/schema-core',
  '@zmdb/ai',
  '@zmdb/aot-validator',
  '@zmdb/repository',
  '@zmdb/sqlite',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function packages() {
  const found = new Map();
  for (const entry of readdirSync(PACKAGE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(PACKAGE_ROOT, entry.name);
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name === 'string') found.set(manifest.name, { directory, manifest });
  }
  return found;
}

function copyForPack(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function build() {
  for (const name of BUILD_ORDER) {
    const result = run('yarn', ['workspace', name, 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`build failed for ${name}`);
  }
}

function pack(allPackages, scratch) {
  const archives = new Map();
  for (const name of BUILD_ORDER) {
    const pkg = allPackages.get(name);
    if (pkg === undefined) throw new Error(`workspace package is missing: ${name}`);
    const stage = join(scratch, 'stage', name.replaceAll('/', '__'));
    mkdirSync(dirname(stage), { recursive: true });
    copyForPack(pkg.directory, stage);
    const manifest = publishManifest(pkg.manifest, RELEASE_VERSION);
    manifest.dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies ?? {}).map(([dependency, range]) => {
        const archive = archives.get(dependency);
        return [dependency, archive === undefined ? range : `file:${archive}`];
      }),
    );
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = run('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    if (result.status !== 0) throw new Error(`npm pack failed for ${name}: ${output(result)}`);
    const report = JSON.parse(result.stdout);
    const row = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (row === undefined || typeof row.filename !== 'string') {
      throw new Error(`npm pack returned no archive for ${name}`);
    }
    archives.set(name, join(scratch, row.filename));
  }
  return archives;
}

function verifyInstalledTree(app) {
  const appManifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  if (JSON.stringify(Object.keys(appManifest.dependencies ?? {})) !== JSON.stringify(['@zmdb/sqlite'])) {
    throw new Error('packed consumer must declare only @zmdb/sqlite');
  }
  const installedRoot = join(app, 'node_modules', '@zmdb', 'sqlite');
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  for (const file of ['LICENSE', 'README.md', 'dist/index.js', 'dist/embedded.js', 'dist/node.js']) {
    if (!existsSync(join(installedRoot, file))) {
      throw new Error(`packed @zmdb/sqlite is missing ${file}`);
    }
  }
  const dependencies = Object.keys(manifest.dependencies ?? {}).toSorted();
  const expectedDependencies = ['@zmdb/query-compiler', '@zmdb/repository'];
  if (JSON.stringify(dependencies) !== JSON.stringify(expectedDependencies)) {
    throw new Error(
      `@zmdb/sqlite dependencies are [${dependencies.join(', ')}], expected [${expectedDependencies.join(', ')}]`,
    );
  }
  const exports = Object.keys(manifest.exports ?? {}).toSorted();
  const expectedExports = ['.', './embedded', './node'];
  if (JSON.stringify(exports) !== JSON.stringify(expectedExports)) {
    throw new Error(`@zmdb/sqlite exports are [${exports.join(', ')}], expected [${expectedExports.join(', ')}]`);
  }
  const rootSource = readFileSync(join(installedRoot, 'dist', 'index.js'), 'utf8');
  if (/from\s+['"]node:/.test(rootSource) || /import\s*\(\s*['"]node:/.test(rootSource)) {
    throw new Error('@zmdb/sqlite root imports a Node built-in');
  }
}

function main() {
  const allPackages = packages();
  build();
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-database-sqlite-'));
  try {
    const archives = pack(allPackages, scratch);
    const app = join(scratch, 'app');
    copyForPack(FIXTURE, app);
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    const sqliteArchive = archives.get('@zmdb/sqlite');
    if (sqliteArchive === undefined) throw new Error('@zmdb/sqlite archive is missing');
    manifest.dependencies = { '@zmdb/sqlite': `file:${sqliteArchive}` };
    writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const installed = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
      {
        cwd: app,
        env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
      },
    );
    if (installed.status !== 0) throw new Error(`packed consumer install failed: ${output(installed)}`);
    verifyInstalledTree(app);

    const types = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', join(app, 'tsconfig.json')], {
      cwd: app,
    });
    if (types.status !== 0) throw new Error(`packed consumer declarations failed: ${output(types)}`);

    const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], { cwd: app });
    if (runtime.status !== 0) throw new Error(`packed consumer runtime failed: ${output(runtime)}`);
    process.stdout.write(runtime.stdout);
  } finally {
    if (process.env.ZMDB_KEEP_DATABASE_SQLITE_FIXTURE === undefined) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      console.log(`kept packed SQLite fixture at ${scratch}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
