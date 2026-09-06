#!/usr/bin/env node
// Packed external-consumer evidence for the app/web/jobs core split (#646).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE_VERSION = publishTrain(ROOT).version;
const FIXTURE = join(ROOT, 'fixtures', 'consumer-server-core');
const PACKAGES_DIR = join(ROOT, 'packages');
const JOBS_ROOTS = ['@zmdb/jobs'];
const TARGET_ROOTS = ['@zmdb/app', '@zmdb/jobs', '@zmdb/web', 'zmdb'];
const OPTIONAL_SERVER_PACKAGES = [
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
  '@zmdb/protobuf',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
];
const SERVER_PEERS = ['@grpc/grpc-js', '@nats-io/transport-node', '@opentelemetry/api', 'amqplib', 'pg', 'redis'];

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

export function inspectServerCoreFixture(fixture = FIXTURE) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
  const expectedDependencies = TARGET_ROOTS.toSorted();
  const dependencies = Object.keys(manifest.dependencies ?? {}).toSorted();
  if (JSON.stringify(dependencies) !== JSON.stringify(expectedDependencies)) {
    problems.push(
      `fixture dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(expectedDependencies)}`,
    );
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof range !== 'string' || /^(?:file|link|patch|portal|workspace):/.test(range) || range.includes('/')) {
      problems.push(`${name} has non-registry range ${JSON.stringify(range)}`);
    }
  }
  const expectedDevDependencies = ['@types/node', 'typescript'];
  const devDependencies = Object.keys(manifest.devDependencies ?? {}).toSorted();
  if (JSON.stringify(devDependencies) !== JSON.stringify(expectedDevDependencies)) {
    problems.push(
      `fixture devDependencies ${JSON.stringify(devDependencies)}, expected ${JSON.stringify(expectedDevDependencies)}`,
    );
  }
  for (const [name, range] of Object.entries(manifest.devDependencies ?? {})) {
    if (typeof range !== 'string' || /^(?:file|link|patch|portal|workspace):/.test(range) || range.includes('/')) {
      problems.push(`${name} has non-registry dev range ${JSON.stringify(range)}`);
    }
  }

  const tsconfig = JSON.parse(readFileSync(join(fixture, 'tsconfig.consumer.json'), 'utf8'));
  if (tsconfig.compilerOptions?.paths !== undefined) problems.push('fixture tsconfig declares compilerOptions.paths');
  if (tsconfig.compilerOptions?.skipLibCheck !== false) problems.push('fixture tsconfig must keep skipLibCheck=false');
  if (tsconfig.compilerOptions?.allowImportingTsExtensions !== false) {
    problems.push('fixture tsconfig must keep allowImportingTsExtensions=false');
  }
  const jobsTsconfig = JSON.parse(readFileSync(join(fixture, 'tsconfig.jobs.json'), 'utf8'));
  if (jobsTsconfig.extends !== './tsconfig.consumer.json') {
    problems.push('jobs fixture must extend tsconfig.consumer.json');
  }
  if (JSON.stringify(jobsTsconfig.include) !== JSON.stringify(['src/jobs-contracts.ts'])) {
    problems.push('jobs fixture must include only src/jobs-contracts.ts');
  }
  const runtimeTsconfig = JSON.parse(readFileSync(join(fixture, 'tsconfig.runtime.json'), 'utf8'));
  if (runtimeTsconfig.extends !== './tsconfig.consumer.json') {
    problems.push('runtime fixture must extend tsconfig.consumer.json');
  }
  if (JSON.stringify(runtimeTsconfig.include) !== JSON.stringify(['src/journey.ts'])) {
    problems.push('runtime fixture must include only src/journey.ts');
  }
  if (runtimeTsconfig.compilerOptions?.noEmit !== false || runtimeTsconfig.compilerOptions?.target !== 'ES2022') {
    problems.push('runtime fixture must emit decorator-lowered ES2022');
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
  return [...closure].toSorted();
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
    writeFileSync(
      join(destination, 'package.json'),
      `${JSON.stringify(publishManifest(pkg.manifest, RELEASE_VERSION), null, 2)}\n`,
    );
    const packed = run('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: destination,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    if (packed.status !== 0) throw new Error(`npm pack failed for ${name}: ${output(packed)}`);
    const report = JSON.parse(packed.stdout);
    const row = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (row === undefined || typeof row.filename !== 'string') throw new Error(`npm pack returned no file for ${name}`);
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
          const manifestPath = join(packageDir, 'package.json');
          if (existsSync(manifestPath)) {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (typeof manifest.name === 'string') names.add(manifest.name);
          }
          scan(join(packageDir, 'node_modules'));
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

function installConsumer(tarballs, scratch, options = {}) {
  const app = join(scratch, 'consumer');
  copyForPack(FIXTURE, app);
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  manifest.dependencies = Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`]));
  if (options.includeTypecheckTools !== true) delete manifest.devDependencies;
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const installed = run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
    {
      cwd: app,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    },
  );
  if (installed.status !== 0) throw new Error(`server consumer install failed: ${output(installed)}`);
  return app;
}

function assertNoOptionalServerPackages(app, workspaceCount, label = 'core') {
  const names = installedPackageNames(join(app, 'node_modules'));
  const forbidden = [...OPTIONAL_SERVER_PACKAGES, ...SERVER_PEERS].filter(name => names.has(name));
  if (forbidden.length > 0) throw new Error(`core install contains optional server packages or peers: ${forbidden}`);
  console.log(
    `${label} install: ${String(workspaceCount)} workspace tarballs, ${String(names.size)} installed packages, 0 optional server packages or peers`,
  );
}

function assertWorkspaceClosure(app, expected) {
  const names = installedPackageNames(join(app, 'node_modules'));
  const observed = [...names].filter(name => name === 'zmdb' || name.startsWith('@zmdb/')).toSorted();
  if (JSON.stringify(observed) !== JSON.stringify([...expected].toSorted())) {
    throw new Error(`installed zmdb packages ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`);
  }
}

function verifyPlain(packages, scratch) {
  const names = workspaceClosure(packages, ['zmdb']);
  const app = installConsumer(packWorkspace(packages, names, scratch), scratch, { includeTypecheckTools: false });
  assertNoOptionalServerPackages(app, names.length);
}

function verifyJobs(packages, scratch) {
  const hygiene = inspectServerCoreFixture();
  if (hygiene.length > 0) throw new Error(`server consumer fixture is invalid: ${hygiene.join('; ')}`);

  const built = run('yarn', ['workspaces', 'foreach', '-R', '-t', '--from', '@zmdb/jobs', 'run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('jobs dependency closure build failed before installed verification');

  const names = workspaceClosure(packages, JOBS_ROOTS);
  const app = installConsumer(packWorkspace(packages, names, scratch), scratch, { includeTypecheckTools: true });
  assertNoOptionalServerPackages(app, names.length, 'jobs');
  assertWorkspaceClosure(app, names);

  const typecheck = run(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '-p', join(app, 'tsconfig.jobs.json')],
    { cwd: app },
  );
  if (typecheck.status !== 0) throw new Error(`installed jobs declarations failed: ${output(typecheck)}`);

  const runtime = run(process.execPath, [join(app, 'src', 'jobs-runtime.mjs')], { cwd: app });
  if (runtime.status !== 0) throw new Error(`installed jobs runtime failed: ${output(runtime)}`);
  process.stdout.write(runtime.stdout);
}

function verifyTarget(packages, scratch) {
  const missing = TARGET_ROOTS.filter(name => !packages.has(name));
  if (missing.length > 0) throw new Error(`core server packages are not implemented: ${missing.join(', ')}`);
  const hygiene = inspectServerCoreFixture();
  if (hygiene.length > 0) throw new Error(`server consumer fixture is invalid: ${hygiene.join('; ')}`);

  const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('yarn build failed before installed server verification');

  const names = workspaceClosure(packages, TARGET_ROOTS);
  const app = installConsumer(packWorkspace(packages, names, scratch), scratch, { includeTypecheckTools: true });
  assertNoOptionalServerPackages(app, names.length);
  assertWorkspaceClosure(app, names);

  const typecheck = run(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '-p', join(app, 'tsconfig.consumer.json')],
    { cwd: app },
  );
  if (typecheck.status !== 0) throw new Error(`installed server declarations failed: ${output(typecheck)}`);

  const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], { cwd: app });
  if (runtime.status !== 0) throw new Error(`installed server runtime failed: ${output(runtime)}`);
  process.stdout.write(runtime.stdout);

  const compiled = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(app, 'tsconfig.runtime.json')], {
    cwd: app,
  });
  if (compiled.status !== 0) throw new Error(`installed cohesive journey failed to compile: ${output(compiled)}`);

  const journey = run(process.execPath, [join(app, 'dist', 'journey.js')], { cwd: app });
  if (journey.status !== 0) throw new Error(`installed cohesive journey failed: ${output(journey)}`);
  process.stdout.write(journey.stdout);
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--jobs' && mode !== '--plain' && mode !== '--target') {
    throw new Error('usage: verify-installed.mjs --jobs|--plain|--target');
  }
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-server-core-'));
  try {
    const packages = workspacePackages();
    if (mode === '--jobs') verifyJobs(packages, scratch);
    else if (mode === '--plain') verifyPlain(packages, scratch);
    else verifyTarget(packages, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
