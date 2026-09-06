#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'fixtures', 'database-mssql');
const PACKAGES = join(ROOT, 'packages');
const ROOTS = ['@zmdb/mssql', '@zmdb/query-compiler', '@zmdb/repository'];
const EXPECTED_DEPENDENCIES = [...ROOTS, 'mssql'].toSorted();

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    specifiers.push(specifier);
  }
  return specifiers;
}

export function inspectMssqlFixture(fixture = FIXTURE) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
  const dependencies = Object.keys(manifest.dependencies ?? {}).toSorted();
  if (JSON.stringify(dependencies) !== JSON.stringify(EXPECTED_DEPENDENCIES)) {
    problems.push(
      `fixture dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(EXPECTED_DEPENDENCIES)}`,
    );
  }
  if (manifest.devDependencies?.['@types/mssql'] !== '12.3.0') {
    problems.push('fixture must pin @types/mssql 12.3.0 for declaration proof');
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof range !== 'string' || /^(?:file|link|patch|portal|workspace):/.test(range) || range.includes('/')) {
      problems.push(`${name} has non-registry range ${JSON.stringify(range)}`);
    }
  }

  const tsconfig = JSON.parse(readFileSync(join(fixture, 'tsconfig.consumer.json'), 'utf8'));
  if (tsconfig.compilerOptions?.paths !== undefined) problems.push('fixture tsconfig declares compilerOptions.paths');
  if (tsconfig.compilerOptions?.skipLibCheck !== false) problems.push('fixture tsconfig must keep skipLibCheck=false');
  if (tsconfig.compilerOptions?.allowImportingTsExtensions !== false) {
    problems.push('fixture tsconfig must keep allowImportingTsExtensions=false');
  }

  for (const path of allFiles(fixture)) {
    if (path === fileURLToPath(import.meta.url)) continue;
    const source = readFileSync(path, 'utf8');
    if (source.includes('workspace:')) problems.push(`${relative(fixture, path)} contains a workspace protocol`);
    if (!/\.[cm]?[jt]s$/.test(path)) continue;
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('.') && !/\.(?:[cm]?js|json)$/.test(specifier)) {
        problems.push(`${relative(fixture, path)} uses extensionless relative import ${specifier}`);
      }
    }
  }
  return problems.toSorted();
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

function workspaceInstallDependencies(packages, pkg) {
  const dependencies = Object.keys(pkg.manifest.dependencies ?? {}).filter(name => packages.has(name));
  const requiredPeers = Object.keys(pkg.manifest.peerDependencies ?? {}).filter(
    name => packages.has(name) && pkg.manifest.peerDependenciesMeta?.[name]?.optional !== true,
  );
  return [...new Set([...dependencies, ...requiredPeers])].toSorted();
}

function closure(packages, roots) {
  const names = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || names.has(name)) continue;
    const current = packages.get(name);
    if (current === undefined) throw new Error(`workspace package ${name} has no manifest`);
    names.add(name);
    queue.push(...workspaceInstallDependencies(packages, current));
  }
  return [...names].toSorted();
}

function copyForPack(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function packWorkspace(packages, names, scratch) {
  const archives = new Map();
  for (const name of names) {
    const current = packages.get(name);
    if (current === undefined) throw new Error(`cannot pack absent workspace package ${name}`);
    const stage = join(scratch, 'stage', name.replaceAll('/', '__'));
    mkdirSync(dirname(stage), { recursive: true });
    copyForPack(current.directory, stage);
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(publishManifest(current.manifest), null, 2)}\n`);
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

function installConsumer(archives, scratch, mode) {
  const app = join(scratch, mode);
  copyForPack(FIXTURE, app);
  const fixtureManifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries([...archives].map(([name, path]) => [name, `file:${path}`]));
  if (mode === 'live') dependencies.mssql = fixtureManifest.dependencies.mssql;
  const manifest = {
    ...fixtureManifest,
    dependencies,
    ...(mode === 'live' ? {} : { devDependencies: {} }),
  };
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'];
  if (mode === 'package-only') args.push('--omit=optional');
  const installed = run('npm', args, {
    cwd: app,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  if (installed.status !== 0) throw new Error(`${mode} consumer install failed: ${output(installed)}`);
  return app;
}

function installedPackageNames(nodeModules) {
  const names = new Set();
  const visited = new Set();
  const scan = directory => {
    if (!existsSync(directory) || visited.has(directory)) return;
    visited.add(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(path, { withFileTypes: true })) {
          if (!scoped.isDirectory()) continue;
          const packageDirectory = join(path, scoped.name);
          const manifestPath = join(packageDirectory, 'package.json');
          if (existsSync(manifestPath)) {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (typeof manifest.name === 'string') names.add(manifest.name);
          }
          scan(join(packageDirectory, 'node_modules'));
        }
      } else {
        const manifestPath = join(path, 'package.json');
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          if (typeof manifest.name === 'string') names.add(manifest.name);
        }
        scan(join(path, 'node_modules'));
      }
    }
  };
  scan(nodeModules);
  return names;
}

function assertPackageContract(packages) {
  const manifest = packages.get('@zmdb/mssql')?.manifest;
  if (manifest === undefined) throw new Error('@zmdb/mssql has no workspace manifest');
  if (manifest.dependencies?.mssql !== undefined) throw new Error('@zmdb/mssql makes mssql a hard dependency');
  if (manifest.peerDependencies?.mssql !== '^12.7.0') {
    throw new Error(`@zmdb/mssql peer is ${JSON.stringify(manifest.peerDependencies?.mssql)}, expected ^12.7.0`);
  }
  if (manifest.peerDependenciesMeta?.mssql?.optional !== true) {
    throw new Error('@zmdb/mssql must mark the mssql peer optional');
  }
  if (manifest.devDependencies?.mssql !== '12.7.0') {
    throw new Error('@zmdb/mssql must pin mssql 12.7.0 for live qualification');
  }
}

function verifyPackageOnly(archives, scratch) {
  const app = installConsumer(archives, scratch, 'package-only');
  const names = installedPackageNames(join(app, 'node_modules'));
  const forbidden = ['mssql', 'tedious', '@types/mssql'].filter(name => names.has(name));
  if (forbidden.length > 0) {
    throw new Error(`package-only install contains SQL Server client packages: ${forbidden.join(', ')}`);
  }
  const runtime = run(process.execPath, [join(app, 'src', 'package-only.mjs')], { cwd: app });
  if (runtime.status !== 0) throw new Error(`package-only import failed: ${output(runtime)}`);
  process.stdout.write(runtime.stdout);
  console.log(`package-only install: ${String(names.size)} packages, 0 SQL Server client packages`);
}

function verifyLive(archives, scratch) {
  if (process.env.ZMDB_MSSQL_URL === undefined) {
    throw new Error('ZMDB_MSSQL_URL is required; packed SQL Server acceptance may not pass by skipping');
  }
  const app = installConsumer(archives, scratch, 'live');
  const typecheck = run(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '-p', join(app, 'tsconfig.consumer.json')],
    { cwd: app },
  );
  if (typecheck.status !== 0) throw new Error(`packed @zmdb/mssql declarations failed: ${output(typecheck)}`);

  const runtime = run(process.execPath, [join(app, 'src', 'acceptance.mjs')], {
    cwd: app,
    env: process.env,
  });
  if (runtime.status !== 0) throw new Error(`packed @zmdb/mssql live acceptance failed: ${output(runtime)}`);
  process.stdout.write(runtime.stdout);
}

function main() {
  const hygiene = inspectMssqlFixture();
  if (hygiene.length > 0) throw new Error(`SQL Server packed fixture is invalid: ${hygiene.join('; ')}`);
  const packages = workspacePackages();
  assertPackageContract(packages);
  const names = closure(packages, ROOTS);

  if (process.env.ZMDB_MSSQL_PREBUILT === '1') {
    const missing = names.filter(name => {
      const current = packages.get(name);
      return current === undefined || !existsSync(join(current.directory, 'dist'));
    });
    if (missing.length > 0) {
      throw new Error(`prebuilt SQL Server closure is missing dist output for: ${missing.join(', ')}`);
    }
    console.log(`using prebuilt SQL Server closure: ${String(names.length)} workspace packages`);
  } else {
    const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('yarn build failed before packed SQL Server verification');
  }

  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-mssql-672-'));
  try {
    const archives = packWorkspace(packages, names, scratch);
    verifyPackageOnly(archives, scratch);
    verifyLive(archives, scratch);
    console.log(`packed SQL Server acceptance: ${String(names.length)} workspace tarballs`);
  } finally {
    if (process.env.ZMDB_KEEP_MSSQL_FIXTURE === undefined) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      console.log(`kept packed SQL Server fixture at ${scratch}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
