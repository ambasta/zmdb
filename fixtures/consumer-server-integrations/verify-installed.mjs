#!/usr/bin/env node
// Installed-tree evidence for #655.
//
// `--core` packs the current publishable workspace, installs the local tarballs
// into a clean npm project and proves that neither an optional server package nor
// one of its peers appears anywhere in that dependency tree.
//
// `--integration <package>` packs one implemented target into its clean fixture,
// while `--integrations` checks the complete target set. The aggregate mode stays
// intentionally red until the remaining six package manifests exist.

import { spawnSync } from 'node:child_process';
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = join(ROOT, 'fixtures', 'consumer-server-integrations');
const PACKAGES_DIR = join(ROOT, 'packages');
const SERVER_PACKAGES = [
  '@zmdb/protobuf',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
];
const SERVER_PEERS = ['@grpc/grpc-js', '@nats-io/transport-node', '@opentelemetry/api', 'amqplib', 'pg', 'redis'];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function message(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function workspacePackages() {
  const packages = new Map();
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(PACKAGES_DIR, entry.name);
    const path = join(dir, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof manifest.name === 'string') packages.set(manifest.name, { dir, manifest });
  }
  return packages;
}

function workspaceClosure(packages, roots) {
  const closure = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || closure.has(name)) continue;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`workspace package ${name} has no manifest`);
    closure.add(name);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (packages.has(dependency)) queue.push(dependency);
    }
  }
  return [...closure];
}

function copyForPack(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function packWorkspace(packages, names, scratch) {
  const tarballs = new Map();
  const stage = join(scratch, 'stage');
  mkdirSync(stage, { recursive: true });

  for (const name of names) {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`cannot pack absent workspace package ${name}`);
    const destination = join(stage, pkg.dir.slice(PACKAGES_DIR.length + 1));
    copyForPack(pkg.dir, destination);
    writeFileSync(join(destination, 'package.json'), `${JSON.stringify(publishManifest(pkg.manifest), null, 2)}\n`);

    const packed = run('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: destination,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    if (packed.status !== 0) throw new Error(`npm pack failed for ${name}: ${message(packed)}`);
    const report = JSON.parse(packed.stdout);
    const row = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (row === undefined || typeof row.filename !== 'string') {
      throw new Error(`npm pack returned no filename for ${name}`);
    }
    tarballs.set(name, join(scratch, row.filename));
  }
  return tarballs;
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
          const packageDir = join(path, scoped.name);
          const manifest = join(packageDir, 'package.json');
          if (existsSync(manifest)) {
            const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
            if (typeof pkg.name === 'string') names.add(pkg.name);
          }
          scan(join(packageDir, 'node_modules'));
        }
      } else {
        const manifest = join(path, 'package.json');
        if (existsSync(manifest)) {
          const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
          if (typeof pkg.name === 'string') names.add(pkg.name);
        }
        scan(join(path, 'node_modules'));
      }
    }
  };

  scan(nodeModules);
  return names;
}

function verifyCoreInstall(packages, scratch) {
  const names = workspaceClosure(packages, ['zmdb']);
  const tarballs = packWorkspace(packages, names, scratch);
  const app = join(scratch, 'core-consumer');
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: '@zmdb-fixture/core-install',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`])),
      },
      null,
      2,
    )}\n`,
  );

  const installed = run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
    {
      cwd: app,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    },
  );
  if (installed.status !== 0) throw new Error(`core consumer install failed: ${message(installed)}`);

  const namesInTree = installedPackageNames(join(app, 'node_modules'));
  const forbidden = [...SERVER_PACKAGES, ...SERVER_PEERS].filter(name => namesInTree.has(name));
  if (forbidden.length > 0) {
    throw new Error(`core install contains optional server packages or peers: ${forbidden.join(', ')}`);
  }
  console.log(
    `core install: ${String(names.length)} workspace tarballs, ${String(namesInTree.size)} installed packages, 0 optional server packages or peers`,
  );
}

function fixtureProjects() {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = join(FIXTURES, entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const fixture = manifest.zmdbFixture;
      if (
        typeof fixture !== 'object' ||
        fixture === null ||
        typeof fixture.target !== 'string' ||
        !Array.isArray(fixture.links) ||
        fixture.links.some(link => typeof link !== 'string')
      ) {
        throw new Error(`${relative(ROOT, dir)}/package.json has an invalid zmdbFixture contract`);
      }
      return { name: entry.name, dir, target: fixture.target, links: fixture.links };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function packagePath(nodeModules, name) {
  return join(nodeModules, ...name.split('/'));
}

function extractTarball(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const extracted = run('tar', ['-xzf', tarball, '-C', destination, '--strip-components=1']);
  if (extracted.status !== 0) throw new Error(`could not extract ${tarball}: ${message(extracted)}`);
}

function linkRootPackage(appNodeModules, name) {
  const source = packagePath(join(ROOT, 'node_modules'), name);
  if (!existsSync(source)) throw new Error(`fixture dependency ${name} is not installed at the workspace root`);
  const destination = packagePath(appNodeModules, name);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(source, destination, 'dir');
}

function verifyIntegrationConsumers(packages, scratch, target) {
  const fixtures =
    target === undefined ? fixtureProjects() : fixtureProjects().filter(fixture => fixture.target === target);
  if (fixtures.length === 0) throw new Error(`no optional-server fixture targets ${String(target)}`);
  const missing = fixtures.filter(fixture => !packages.has(fixture.target)).map(fixture => fixture.target);
  if (missing.length > 0) {
    throw new Error(`optional server packages are not implemented: ${missing.join(', ')}`);
  }

  const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('yarn build failed before installed integration verification');

  const allNames = workspaceClosure(
    packages,
    fixtures.map(fixture => fixture.target),
  );
  const tarballs = packWorkspace(packages, allNames, scratch);
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
  const failures = [];
  cpSync(join(FIXTURES, 'tsconfig.base.json'), join(scratch, 'tsconfig.base.json'));

  for (const fixture of fixtures) {
    const app = join(scratch, `consumer-${fixture.name}`);
    copyForPack(fixture.dir, app);
    const nodeModules = join(app, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const name of workspaceClosure(packages, [fixture.target])) {
      const tarball = tarballs.get(name);
      if (tarball === undefined) throw new Error(`no packed tarball recorded for ${name}`);
      extractTarball(tarball, packagePath(nodeModules, name));
    }
    for (const name of fixture.links) linkRootPackage(nodeModules, name);

    const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], { cwd: app });
    const declarations = run(tsc, ['--noEmit', '-p', join(app, 'tsconfig.json')], { cwd: app });
    if (runtime.status !== 0) failures.push(`${fixture.target} runtime: ${message(runtime)}`);
    if (declarations.status !== 0) failures.push(`${fixture.target} declarations: ${message(declarations)}`);
    if (runtime.status === 0 && declarations.status === 0) {
      console.log(`installed consumer: ${fixture.target} runtime and declarations OK`);
    }
  }

  if (failures.length > 0) throw new Error(failures.join('\n'));
}

function main() {
  const mode = process.argv[2];
  const target = process.argv[3];
  if (mode !== '--core' && mode !== '--integrations' && mode !== '--integration') {
    throw new Error('usage: verify-installed.mjs --core|--integrations|--integration <package>');
  }
  if (mode === '--integration' && target === undefined) {
    throw new Error('--integration requires an exact package name');
  }
  if (mode !== '--integration' && target !== undefined) throw new Error(`${mode} accepts no package argument`);

  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-server-consumer-'));
  try {
    const packages = workspacePackages();
    if (mode === '--core') verifyCoreInstall(packages, scratch);
    else verifyIntegrationConsumers(packages, scratch, mode === '--integration' ? target : undefined);
  } finally {
    if (process.env.ZMDB_KEEP_SERVER_FIXTURES === undefined) {
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
