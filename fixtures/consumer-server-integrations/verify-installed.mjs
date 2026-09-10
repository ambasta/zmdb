#!/usr/bin/env node
// Installed-tree evidence for #655.
//
// `--core` packs the current publishable workspace, installs the local tarballs
// into a clean npm project and proves that neither an optional server package nor
// a third-party client peer appears anywhere in that dependency tree.
//
// `--integration <entry>` packs one implemented target into its clean fixture,
// while `--integrations` checks the complete target set. A target names an import
// entry point, which may be a subpath of a package that carries several of them.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishCatalog, publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLISH_PACKAGES = await publishCatalog(ROOT);
const FIXTURES = join(ROOT, 'fixtures', 'consumer-server-integrations');
const PACKAGES_DIR = join(ROOT, 'packages');
// Import entries and third-party clients exercised by these fixture projects. `name`
// is the specifier a consumer imports and `package` is the workspace package that
// publishes it; the two differ where one package publishes several adapters.
const SERVER_TARGETS = [
  { name: '@zmdb/protobuf', package: '@zmdb/protobuf' },
  { name: '@zmdb/transport/grpc', package: '@zmdb/transport', peer: { name: '@grpc/grpc-js' } },
  { name: '@zmdb/transport/nats', package: '@zmdb/transport', peer: { name: '@nats-io/transport-node' } },
  { name: '@zmdb/transport/rabbitmq', package: '@zmdb/transport', peer: { name: 'amqplib' } },
  { name: '@zmdb/transport/redis', package: '@zmdb/transport', peer: { name: 'redis' } },
  { name: '@zmdb/jobs-sqlite', package: '@zmdb/jobs-sqlite' },
  { name: '@zmdb/jobs-postgres', package: '@zmdb/jobs-postgres', peer: { name: 'pg' } },
  { name: '@zmdb/app/otel', package: '@zmdb/app', peer: { name: '@opentelemetry/api' } },
];
const SERVER_ENTRIES = SERVER_TARGETS.map(target => target.name);
const SERVER_PACKAGES = [...new Set(SERVER_TARGETS.map(target => target.package))];
const SERVER_PEERS = SERVER_TARGETS.flatMap(target => (target.peer === undefined ? [] : [target.peer.name]));
const PUBLISH_PACKAGE_NAMES = PUBLISH_PACKAGES.map(packageRecord => packageRecord.npmName);
const REQUIRED_SERVICE_ENV = new Map([
  ['@zmdb/jobs-postgres', 'ZMDB_PG'],
  ['@zmdb/transport/nats', 'ZMDB_NATS_URL'],
  ['@zmdb/transport/rabbitmq', 'ZMDB_RABBITMQ_URL'],
  ['@zmdb/transport/redis', 'ZMDB_REDIS_URL'],
]);

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

function workspaceInstallDependencies(packages, pkg) {
  const dependencies = Object.keys(pkg.manifest.dependencies ?? {}).filter(name => packages.has(name));
  const requiredPeers = Object.keys(pkg.manifest.peerDependencies ?? {}).filter(
    name => packages.has(name) && pkg.manifest.peerDependenciesMeta?.[name]?.optional !== true,
  );
  return [...new Set([...dependencies, ...requiredPeers])].toSorted();
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
    queue.push(...workspaceInstallDependencies(packages, pkg));
  }
  const ordered = PUBLISH_PACKAGE_NAMES.filter(name => closure.has(name));
  const missing = [...closure].filter(name => !PUBLISH_PACKAGE_NAMES.includes(name));
  if (missing.length > 0) {
    throw new Error(`publish manifest omits workspace package(s): ${missing.join(', ')}`);
  }

  const position = new Map(ordered.map((name, index) => [name, index]));
  for (const name of ordered) {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`workspace package ${name} disappeared while ordering`);
    for (const dependency of workspaceInstallDependencies(packages, pkg)) {
      if (!closure.has(dependency)) continue;
      const dependencyIndex = position.get(dependency);
      const packageIndex = position.get(name);
      if (dependencyIndex === undefined || packageIndex === undefined || dependencyIndex >= packageIndex) {
        throw new Error(`publish order places ${name} before its dependency ${dependency}`);
      }
    }
  }
  return ordered;
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
  console.log(`publish order: ${names.join(' -> ')}`);

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
  const names = workspaceClosure(packages, ['@zmdb/core']);
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
  // A core install legitimately contains a core package that also publishes an
  // optional adapter subpath, so only packages outside the core closure are
  // forbidden. Every third-party client peer stays forbidden either way, which is
  // what makes an unused adapter subpath cost nothing.
  const coreClosure = new Set(names);
  const optionalPackages = SERVER_PACKAGES.filter(name => !coreClosure.has(name));
  const forbidden = [...optionalPackages, ...SERVER_PEERS].filter(name => namesInTree.has(name));
  if (forbidden.length > 0) {
    throw new Error(`core install contains optional server packages or peers: ${forbidden.join(', ')}`);
  }
  console.log(
    `core install: ${String(names.length)} workspace tarballs, ${String(namesInTree.size)} installed packages, ` +
      `0 of ${String(optionalPackages.length)} optional server packages, 0 of ${String(SERVER_PEERS.length)} client peers`,
  );
}

function fixtureProjects() {
  const fixtures = readdirSync(FIXTURES, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = join(FIXTURES, entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const fixture = manifest.zmdbFixture;
      if (typeof fixture !== 'object' || fixture === null || typeof fixture.target !== 'string') {
        throw new Error(`${relative(ROOT, dir)}/package.json has an invalid zmdbFixture contract`);
      }
      return { name: entry.name, dir, target: fixture.target, manifest };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));

  const targetCounts = new Map();
  for (const fixture of fixtures) {
    targetCounts.set(fixture.target, (targetCounts.get(fixture.target) ?? 0) + 1);
  }
  const missing = SERVER_ENTRIES.filter(name => !targetCounts.has(name));
  const repeated = [...targetCounts].filter(([, count]) => count !== 1).map(([name]) => name);
  const unexpected = [...targetCounts.keys()].filter(name => !SERVER_ENTRIES.includes(name));
  if (missing.length > 0 || repeated.length > 0 || unexpected.length > 0) {
    throw new Error(
      `optional-server fixtures must cover each entry once; missing=[${missing.join(', ')}], ` +
        `repeated=[${repeated.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
    );
  }
  return fixtures;
}

function packagePath(nodeModules, name) {
  return join(nodeModules, ...name.split('/'));
}

function externalDependencies(packages, dependencies) {
  return Object.fromEntries(
    Object.entries(dependencies ?? {})
      .filter(([name]) => !packages.has(name))
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function writeConsumerManifest(packages, fixture, closure, tarballs, app) {
  const localPackages = Object.fromEntries(
    closure.map(name => {
      const tarball = tarballs.get(name);
      if (tarball === undefined) throw new Error(`no packed tarball recorded for ${name}`);
      return [name, `file:${tarball}`];
    }),
  );
  const dependencies = {
    ...localPackages,
    ...externalDependencies(packages, fixture.manifest.dependencies),
  };
  const devDependencies = externalDependencies(packages, fixture.manifest.devDependencies);
  const manifest = {
    ...fixture.manifest,
    dependencies,
    ...(Object.keys(devDependencies).length === 0 ? {} : { devDependencies }),
  };
  if (Object.keys(devDependencies).length === 0) delete manifest.devDependencies;
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function installConsumer(app, target) {
  const installed = run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefer-offline',
      '--loglevel=error',
    ],
    {
      cwd: app,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    },
  );
  if (installed.status !== 0) throw new Error(`${target} consumer install failed: ${message(installed)}`);
}

function targetContract(name) {
  const target = SERVER_TARGETS.find(candidate => candidate.name === name);
  if (target === undefined) throw new Error(`no optional-server boundary contract for ${name}`);
  return target;
}

function targetPackage(name) {
  return targetContract(name).package;
}

function verifyInstalledIntegration(packages, fixture, closure, app) {
  const target = targetContract(fixture.target);
  const sourcePackage = packages.get(target.package);
  if (sourcePackage === undefined) throw new Error(`workspace package ${target.package} disappeared`);
  const nodeModules = join(app, 'node_modules');
  const namesInTree = installedPackageNames(nodeModules);
  const allowedPackages = new Set(closure);
  const unexpectedPackages = SERVER_PACKAGES.filter(name => namesInTree.has(name) && !allowedPackages.has(name));
  const expectedPeer = target.peer?.name;
  const unexpectedPeers = SERVER_PEERS.filter(name => namesInTree.has(name) && name !== expectedPeer);
  if (unexpectedPackages.length > 0 || unexpectedPeers.length > 0) {
    throw new Error(
      `${fixture.target} consumer contains unrelated optional packages=[${unexpectedPackages.join(', ')}] ` +
        `or peers=[${unexpectedPeers.join(', ')}]`,
    );
  }
  if (expectedPeer !== undefined && !namesInTree.has(expectedPeer)) {
    throw new Error(`${fixture.target} consumer did not install required peer ${expectedPeer}`);
  }

  const installedManifest = JSON.parse(
    readFileSync(join(packagePath(nodeModules, target.package), 'package.json'), 'utf8'),
  );
  const actualPeers = Object.entries(installedManifest.peerDependencies ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedPeers = Object.entries(publishManifest(sourcePackage.manifest).peerDependencies ?? {}).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  if (JSON.stringify(actualPeers) !== JSON.stringify(expectedPeers)) {
    throw new Error(
      `${fixture.target} packed peers ${JSON.stringify(actualPeers)}, expected ${JSON.stringify(expectedPeers)}`,
    );
  }
  const optionalPeers = new Set(
    Object.entries(publishManifest(sourcePackage.manifest).peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional === true)
      .map(([name]) => name),
  );
  for (const [peer] of expectedPeers) {
    if (optionalPeers.has(peer) || namesInTree.has(peer)) continue;
    throw new Error(`${fixture.target} consumer did not install required peer ${peer}`);
  }
  // A client one adapter needs must be an optional peer when the package publishes
  // several adapters, so that selecting one never obliges the others' clients.
  const peerIsPerEntry = target.name !== target.package;
  if (expectedPeer !== undefined && optionalPeers.has(expectedPeer) !== peerIsPerEntry) {
    throw new Error(
      `${fixture.target} packed peer ${expectedPeer} must be ${peerIsPerEntry ? 'optional' : 'required'}`,
    );
  }

  console.log(
    `installed boundary: ${fixture.target} from ${target.package}, ${String(closure.length)} workspace tarball(s), ` +
      `${expectedPeer === undefined ? 'no peer' : `peer ${expectedPeer}`}, 0 unrelated optional peers`,
  );
}

function runtimeEnvironment(fixtures, requireServices) {
  const env = { ...process.env };
  if (!requireServices) return env;

  const missing = [];
  for (const fixture of fixtures) {
    const variable = REQUIRED_SERVICE_ENV.get(fixture.target);
    if (variable !== undefined && (env[variable] === undefined || env[variable].length === 0)) missing.push(variable);
  }
  if (missing.length > 0) {
    throw new Error(
      `required live-service lane is missing environment variable(s): ${[...new Set(missing)].join(', ')}`,
    );
  }
  if (fixtures.some(fixture => fixture.target === '@zmdb/jobs-postgres')) {
    env.ZMDB_REQUIRE_PG = '1';
  }
  return env;
}

function verifyIntegrationConsumers(packages, scratch, target, requireServices) {
  const fixtures =
    target === undefined ? fixtureProjects() : fixtureProjects().filter(fixture => fixture.target === target);
  if (fixtures.length === 0) throw new Error(`no optional-server fixture targets ${String(target)}`);
  const missing = fixtures
    .filter(fixture => !packages.has(targetPackage(fixture.target)))
    .map(fixture => fixture.target);
  if (missing.length > 0) {
    throw new Error(`optional server packages are not implemented: ${missing.join(', ')}`);
  }
  const childEnvironment = runtimeEnvironment(fixtures, requireServices);

  const built = run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('yarn build failed before installed integration verification');

  const allNames = workspaceClosure(
    packages,
    fixtures.map(fixture => targetPackage(fixture.target)),
  );
  const tarballs = packWorkspace(packages, allNames, scratch);
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
  const failures = [];
  cpSync(join(FIXTURES, 'tsconfig.base.json'), join(scratch, 'tsconfig.base.json'));

  for (const fixture of fixtures) {
    const app = join(scratch, `consumer-${fixture.name}`);
    copyForPack(fixture.dir, app);
    const closure = workspaceClosure(packages, [targetPackage(fixture.target)]);
    writeConsumerManifest(packages, fixture, closure, tarballs, app);
    installConsumer(app, fixture.target);
    verifyInstalledIntegration(packages, fixture, closure, app);

    const runtime = run(process.execPath, [join(app, 'src', 'runtime.mjs')], {
      cwd: app,
      env: childEnvironment,
    });
    const declarations = run(tsc, ['--noEmit', '-p', join(app, 'tsconfig.json')], { cwd: app });
    if (runtime.status !== 0) failures.push(`${fixture.target} runtime: ${message(runtime)}`);
    if (declarations.status !== 0) failures.push(`${fixture.target} declarations: ${message(declarations)}`);
    if (runtime.status === 0 && declarations.status === 0) {
      const runtimeOutput = message(runtime);
      if (runtimeOutput.length > 0) console.log(runtimeOutput);
      console.log(`installed consumer: ${fixture.target} runtime and declarations OK`);
    }
  }

  if (failures.length > 0) throw new Error(failures.join('\n'));
  if (requireServices) {
    console.log(`required live-service lane: ${String(fixtures.length)} installed integration consumer(s) executed`);
  }
}

function main() {
  const raw = process.argv.slice(2);
  const requireServices = raw.includes('--require-services');
  const args = raw.filter(argument => argument !== '--require-services');
  const [mode, target, ...extra] = args;
  if (extra.length > 0) throw new Error(`unexpected argument(s): ${extra.join(', ')}`);
  if (mode !== '--core' && mode !== '--integrations' && mode !== '--integration') {
    throw new Error(
      'usage: verify-installed.mjs --core|--integrations [--require-services]|' +
        '--integration <package> [--require-services]',
    );
  }
  if (mode === '--integration' && target === undefined) {
    throw new Error('--integration requires an exact entry specifier');
  }
  if (mode !== '--integration' && target !== undefined) throw new Error(`${mode} accepts no entry argument`);
  if (mode === '--core' && requireServices) throw new Error('--core does not accept --require-services');

  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-server-consumer-'));
  try {
    const packages = workspacePackages();
    if (mode === '--core') verifyCoreInstall(packages, scratch);
    else verifyIntegrationConsumers(packages, scratch, mode === '--integration' ? target : undefined, requireServices);
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
