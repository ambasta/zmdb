#!/usr/bin/env node
// Freeze the package graph for the optional server integrations.
//
// The default invocation compares the live tree with the checked-in tests-freeze
// baseline. That makes this useful before the packages exist: a new leak fails,
// while each implementation slice retires its own recorded finding. `--strict`
// is the target state and succeeds only when no finding remains.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createImportGraph } from './lib/import-graph.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_BASELINE = join(SCRIPT_ROOT, '.github', 'scripts', 'server-boundaries-baseline.json');

export const SERVER_PACKAGES = [
  {
    name: '@zmdb/protobuf',
    dir: 'protobuf',
    dependencies: {},
    peer: undefined,
    exports: ['.', './wire'],
  },
  {
    name: '@zmdb/transport-grpc',
    dir: 'transport-grpc',
    dependencies: { '@zmdb/app': 'workspace:^', '@zmdb/protobuf': 'workspace:^' },
    peer: { name: '@grpc/grpc-js', range: '^1.14.0' },
    exports: ['.'],
  },
  {
    name: '@zmdb/transport-nats',
    dir: 'transport-nats',
    dependencies: { '@zmdb/app': 'workspace:^' },
    peer: { name: '@nats-io/transport-node', range: '^3.4.0' },
    exports: ['.'],
  },
  {
    name: '@zmdb/transport-rabbitmq',
    dir: 'transport-rabbitmq',
    dependencies: { '@zmdb/app': 'workspace:^' },
    peer: { name: 'amqplib', range: '^2.0.1' },
    exports: ['.'],
  },
  {
    name: '@zmdb/transport-redis',
    dir: 'transport-redis',
    dependencies: { '@zmdb/app': 'workspace:^' },
    peer: { name: 'redis', range: '^6.2.1' },
    exports: ['.'],
  },
  {
    name: '@zmdb/jobs-postgres',
    dir: 'jobs-postgres',
    dependencies: { '@zmdb/jobs': 'workspace:^', '@zmdb/repository': 'workspace:^' },
    peer: { name: 'pg', range: '^8.23.0' },
    exports: ['.'],
  },
  {
    name: '@zmdb/otel',
    dir: 'otel',
    dependencies: { '@zmdb/app': 'workspace:^' },
    peer: { name: '@opentelemetry/api', range: '^1.9.0' },
    exports: ['.'],
  },
];

export const CORE_SERVER_PACKAGES = [
  {
    name: '@zmdb/app',
    dir: 'app',
    dependencies: {
      '@zmdb/aot-validator': 'workspace:^',
      '@zmdb/query-compiler': 'workspace:^',
      '@zmdb/repository': 'workspace:^',
      '@zmdb/schema-core': 'workspace:^',
    },
    exports: [
      '.',
      './commands',
      './cqrs',
      './data',
      './di',
      './events',
      './health',
      './lifecycle',
      './messaging',
      './modules',
      './observability',
      './state',
    ],
    forbiddenPackages: ['@zmdb/jobs', '@zmdb/web'],
    forbiddenExports: [],
  },
  {
    name: '@zmdb/web',
    dir: 'web',
    dependencies: {
      '@zmdb/aot-validator': 'workspace:^',
      '@zmdb/app': 'workspace:^',
      '@zmdb/schema-core': 'workspace:^',
    },
    exports: [
      '.',
      './app',
      './compression',
      './context',
      './contract',
      './contract/compiler',
      './csrf',
      './data',
      './devtools',
      './dto-pipes',
      './gateways',
      './health',
      './middleware',
      './openapi',
      './pipeline',
      './routing',
      './static',
      './testing',
      './upload',
      './versioning',
    ],
    buildTimeExports: ['./contract/compiler'],
    forbiddenPackages: ['@zmdb/jobs'],
    forbiddenExports: [
      './cli',
      './cqrs',
      './di',
      './events',
      './microservices',
      './modules',
      './observability',
      './queues',
      './queues/backends/memory',
      './schedule',
      './state',
    ],
  },
  {
    name: '@zmdb/jobs',
    dir: 'jobs',
    dependencies: {
      '@zmdb/app': 'workspace:^',
      '@zmdb/query-compiler': 'workspace:^',
      '@zmdb/repository': 'workspace:^',
      '@zmdb/sqlite': 'workspace:^',
    },
    exports: ['.', './memory', './schedule'],
    forbiddenPackages: ['@zmdb/web'],
    forbiddenExports: [],
  },
];

export const PRODUCT_SERVER_EXPORTS = [
  './app',
  './app/commands',
  './app/cqrs',
  './app/data',
  './app/di',
  './app/events',
  './app/health',
  './app/lifecycle',
  './app/messaging',
  './app/modules',
  './app/observability',
  './app/state',
  './jobs',
  './jobs/memory',
  './jobs/schedule',
  './web',
  './web/app',
  './web/compression',
  './web/context',
  './web/contract',
  './web/contract/compiler',
  './web/csrf',
  './web/data',
  './web/devtools',
  './web/dto-pipes',
  './web/gateways',
  './web/health',
  './web/middleware',
  './web/openapi',
  './web/pipeline',
  './web/routing',
  './web/static',
  './web/testing',
  './web/upload',
  './web/versioning',
];

export const APP_KERNEL_EXPORTS = [
  '.',
  './commands',
  './cqrs',
  './data',
  './di',
  './events',
  './health',
  './lifecycle',
  './messaging',
  './modules',
  './observability',
  './state',
];

const APP_KERNEL_MOVES = [
  ['packages/web/src/polyfill.ts', 'packages/app/src/polyfill.ts'],
  ['packages/web/src/lifecycle.ts', 'packages/app/src/lifecycle.ts'],
  ['packages/web/src/di/index.ts', 'packages/app/src/di/index.ts'],
  ['packages/web/src/modules/index.ts', 'packages/app/src/modules/index.ts'],
  ['packages/web/src/modules/lifecycle-instances.ts', 'packages/app/src/modules/lifecycle-instances.ts'],
  ['packages/web/src/modules/runtime.ts', 'packages/app/src/modules/runtime.ts'],
  ['packages/web/src/cli/index.ts', 'packages/app/src/commands/index.ts'],
  ['packages/web/src/events/index.ts', 'packages/app/src/events/index.ts'],
  ['packages/web/src/cqrs/index.ts', 'packages/app/src/cqrs/index.ts'],
  ['packages/web/src/state/index.ts', 'packages/app/src/state/index.ts'],
  ['packages/web/src/observability/index.ts', 'packages/app/src/observability/index.ts'],
  ['packages/web/src/observability/propagation.ts', 'packages/app/src/observability/propagation.ts'],
  ['packages/web/src/observability/types.ts', 'packages/app/src/observability/types.ts'],
  ['packages/web/src/microservices/index.ts', 'packages/app/src/messaging/index.ts'],
  ['packages/web/src/microservices/strategies/codec.ts', 'packages/app/src/messaging/transport-kit.ts'],
  ['packages/web/src/microservices/strategies/drain.ts', 'packages/app/src/messaging/transport-kit.ts'],
];

const SERVER_PEERS = new Set(SERVER_PACKAGES.flatMap(pkg => (pkg.peer === undefined ? [] : [pkg.peer.name])));
const OPTIONAL_PACKAGES = new Set(SERVER_PACKAGES.map(pkg => pkg.name));
const CORE_PACKAGES = ['@zmdb/aot-validator', '@zmdb/app', '@zmdb/jobs', '@zmdb/web', 'zmdb'];
const FORBIDDEN_OLD_EXPORTS = new Map([
  ['@zmdb/aot-validator', ['./protobuf/wire']],
  [
    '@zmdb/web',
    [
      './microservices/grpc',
      './microservices/nats',
      './microservices/rabbitmq',
      './microservices/redis',
      './otel',
      './queues/backends/pg',
    ],
  ],
]);

function record(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

function sortedKeys(value) {
  return Object.keys(record(value)).toSorted();
}

function sameEntries(actual, expected) {
  return JSON.stringify(Object.entries(actual).toSorted()) === JSON.stringify(Object.entries(expected).toSorted());
}

function display(values) {
  return `[${values.toSorted().join(', ')}]`;
}

function packageRoot(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function entryFiles(pkg, excludedSubpaths = []) {
  const excluded = new Set(excludedSubpaths);
  return Object.entries(pkg.exports)
    .filter(([subpath, target]) => !excluded.has(subpath) && typeof target === 'string')
    .map(([, target]) => join(pkg.dir, target));
}

function reachablePackages(repoRoot, graph, starts) {
  const external = new Set();
  const workspace = new Set();
  const directWorkspace = new Set();
  const privateImports = new Set();
  const seen = new Set();
  const queue = [...starts];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const imported of graph.importsOf(file, readFileSync(file, 'utf8'))) {
      const importedPackage = packageRoot(imported.specifier);
      if (!imported.specifier.startsWith('.') && !imported.specifier.startsWith('node:')) {
        if (graph.packages.has(importedPackage)) {
          workspace.add(importedPackage);
          if (packageDirectory(repoRoot, file) === packageDirectory(repoRoot, starts[0] ?? '')) {
            directWorkspace.add(importedPackage);
          }
        } else if (!importedPackage.startsWith('@zmdb/') && importedPackage !== 'zmdb') external.add(importedPackage);
        if (/^(?:@zmdb\/[^/]+|zmdb)\/src(?:\/|$)/.test(imported.specifier)) {
          privateImports.add(imported.specifier);
        }
      }
      if (imported.resolved !== null) {
        const sourcePackage = packageDirectory(repoRoot, file);
        const targetPackage = packageDirectory(repoRoot, imported.resolved);
        if (imported.specifier.startsWith('.') && sourcePackage !== null && targetPackage !== sourcePackage) {
          privateImports.add(`${relative(repoRoot, file)} -> ${relative(repoRoot, imported.resolved)}`);
        }
        queue.push(imported.resolved);
      }
    }
  }

  return {
    external: [...external].toSorted(),
    workspace: [...workspace].toSorted(),
    directWorkspace: [...directWorkspace].toSorted(),
    privateImports: [...privateImports].toSorted(),
  };
}

function manifestAt(root, dir) {
  return join(root, 'packages', dir, 'package.json');
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'dist' || entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function shippedTypeScriptSources(root) {
  return sourceFiles(join(root, 'packages')).filter(
    path =>
      path.endsWith('.ts') &&
      !path.endsWith('.d.ts') &&
      !path.endsWith('.spec.ts') &&
      !path.endsWith('.type-test.ts') &&
      !path.endsWith('.witness.ts'),
  );
}

function packageByName(graph, name) {
  const pkg = graph.packages.get(name);
  return pkg === undefined ? undefined : { ...pkg, name };
}

function packageDirectory(root, file) {
  const path = relative(join(root, 'packages'), file);
  if (path.startsWith('..')) return null;
  return path.split(/[\\/]/)[0] ?? null;
}

function targetProblems(root, graph, target, requireAll) {
  const problems = [];
  const path = manifestAt(root, target.dir);
  if (!existsSync(path)) {
    if (requireAll) problems.push(`missing package manifest for ${target.name}: ${relative(root, path)}`);
    return problems;
  }

  const manifest = readManifest(path);
  if (manifest.name !== target.name) {
    problems.push(`${relative(root, path)} names ${String(manifest.name)}, expected ${target.name}`);
  }

  const exports = sortedKeys(manifest.exports);
  if (JSON.stringify(exports) !== JSON.stringify(target.exports.toSorted())) {
    problems.push(`${target.name} exports ${display(exports)}, expected ${display(target.exports)}`);
  }

  const dependencies = record(manifest.dependencies);
  if (!sameEntries(dependencies, target.dependencies)) {
    problems.push(
      `${target.name} dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(target.dependencies)}`,
    );
  }

  const peers = record(manifest.peerDependencies);
  const expectedPeers = target.peer === undefined ? {} : { [target.peer.name]: target.peer.range };
  if (!sameEntries(peers, expectedPeers)) {
    problems.push(`${target.name} peers ${JSON.stringify(peers)}, expected ${JSON.stringify(expectedPeers)}`);
  }

  const peerMeta = record(manifest.peerDependenciesMeta);
  if (target.peer !== undefined && record(peerMeta[target.peer.name]).optional === true) {
    problems.push(`${target.name} marks required peer ${target.peer.name} optional`);
  }
  const staleMeta = sortedKeys(peerMeta).filter(name => target.peer === undefined || name !== target.peer.name);
  if (staleMeta.length > 0) {
    problems.push(`${target.name} has peer metadata for undeclared peers ${display(staleMeta)}`);
  }

  const pkg = packageByName(graph, target.name);
  if (pkg === undefined) {
    problems.push(`${target.name} is not discoverable as a workspace package`);
    return problems;
  }

  const reached = reachablePackages(root, graph, entryFiles(pkg));
  const expectedExternal = target.peer === undefined ? [] : [target.peer.name];
  if (JSON.stringify(reached.external) !== JSON.stringify(expectedExternal.toSorted())) {
    problems.push(
      `${target.name} reaches external packages ${display(reached.external)}, expected ${display(expectedExternal)}`,
    );
  }

  return problems;
}

function coreTargetProblems(root, graph, target, requireAll) {
  const problems = [];
  const path = manifestAt(root, target.dir);
  if (!existsSync(path)) {
    if (requireAll) problems.push(`missing core package manifest for ${target.name}: ${relative(root, path)}`);
    return problems;
  }

  const manifest = readManifest(path);
  if (manifest.name !== target.name) {
    problems.push(`${relative(root, path)} names ${String(manifest.name)}, expected ${target.name}`);
  }

  const exports = sortedKeys(manifest.exports);
  if (JSON.stringify(exports) !== JSON.stringify(target.exports.toSorted())) {
    problems.push(`${target.name} core exports ${display(exports)}, expected ${display(target.exports)}`);
  }

  const dependencies = record(manifest.dependencies);
  if (!sameEntries(dependencies, target.dependencies)) {
    problems.push(
      `${target.name} core dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(target.dependencies)}`,
    );
  }

  for (const field of ['optionalDependencies', 'peerDependencies']) {
    const names = sortedKeys(manifest[field]);
    if (names.length > 0) {
      problems.push(`${target.name} core ${field} ${display(names)}, expected []`);
    }
  }

  const forbiddenExports = target.forbiddenExports.filter(subpath => record(manifest.exports)[subpath] !== undefined);
  if (forbiddenExports.length > 0) {
    problems.push(`${target.name} still publishes moved core subpaths ${display(forbiddenExports)}`);
  }

  const pkg = packageByName(graph, target.name);
  if (pkg === undefined) {
    problems.push(`${target.name} is not discoverable as a workspace package`);
    return problems;
  }

  const reached = reachablePackages(root, graph, entryFiles(pkg, target.buildTimeExports ?? []));
  const allowedWorkspace = new Set(Object.keys(target.dependencies));
  const unexpectedDirect = reached.directWorkspace.filter(name => name !== target.name && !allowedWorkspace.has(name));
  if (unexpectedDirect.length > 0) {
    problems.push(`${target.name} imports packages outside its direct edge contract ${display(unexpectedDirect)}`);
  }
  const forbiddenWorkspace = reached.workspace.filter(
    name => target.forbiddenPackages.includes(name) || OPTIONAL_PACKAGES.has(name),
  );
  if (forbiddenWorkspace.length > 0) {
    problems.push(`${target.name} reaches forbidden server packages ${display(forbiddenWorkspace)}`);
  }
  const forbiddenExternal = reached.external.filter(name => name === 'typescript' || SERVER_PEERS.has(name));
  if (forbiddenExternal.length > 0) {
    problems.push(`${target.name} reaches forbidden server/reflection peers ${display(forbiddenExternal)}`);
  }
  if (reached.privateImports.length > 0) {
    problems.push(`${target.name} reaches private package source ${display(reached.privateImports)}`);
  }
  return problems;
}

function appKernelMoveProblems(root) {
  const problems = [];
  for (const [oldPath, newPath] of APP_KERNEL_MOVES) {
    if (existsSync(join(root, oldPath))) problems.push(`moved app implementation still exists at ${oldPath}`);
    if (!existsSync(join(root, newPath))) problems.push(`moved app implementation is absent at ${newPath}`);
  }
  return problems;
}

function metadataOwnershipProblems(root) {
  const installations = [];
  const readers = [];
  for (const path of shippedTypeScriptSources(root)) {
    const source = readFileSync(path, 'utf8');
    const logical = relative(root, path);
    const installationCount = source.match(/Object\.defineProperty\(\s*Symbol\s*,\s*['"]metadata['"]/g)?.length ?? 0;
    const readerCount = source.match(/\bexport\s+function\s+metadataOf\s*\(/g)?.length ?? 0;
    installations.push(...Array.from({ length: installationCount }, () => logical));
    readers.push(...Array.from({ length: readerCount }, () => logical));
  }

  const problems = [];
  const orderedInstallations = installations.toSorted();
  const orderedReaders = readers.toSorted();
  if (JSON.stringify(orderedInstallations) !== JSON.stringify(['packages/app/src/polyfill.ts'])) {
    problems.push(
      `Symbol.metadata installations ${display(orderedInstallations)}, expected [packages/app/src/polyfill.ts]`,
    );
  }
  if (JSON.stringify(orderedReaders) !== JSON.stringify(['packages/app/src/index.ts'])) {
    problems.push(`metadataOf implementations ${display(orderedReaders)}, expected [packages/app/src/index.ts]`);
  }
  return problems;
}

export function analyzeAppKernelBoundary(root = SCRIPT_ROOT) {
  const graph = createImportGraph(root);
  const target = {
    ...CORE_SERVER_PACKAGES[0],
    exports: APP_KERNEL_EXPORTS,
  };
  return [
    ...coreTargetProblems(root, graph, target, true),
    ...appKernelMoveProblems(root),
    ...metadataOwnershipProblems(root),
  ].toSorted();
}

function hasPublishedAppKernel(root) {
  const path = manifestAt(root, 'app');
  return existsSync(path) && readManifest(path).private !== true;
}

function productServerProblems(root, graph) {
  const problems = [];
  const pkg = packageByName(graph, 'zmdb');
  if (pkg === undefined) return ['zmdb is not discoverable as a workspace package'];
  const manifest = readManifest(join(pkg.dir, 'package.json'));
  const dependencies = record(manifest.dependencies);
  const missingDependencies = ['@zmdb/app', '@zmdb/jobs', '@zmdb/web'].filter(
    name => dependencies[name] !== 'workspace:^',
  );
  if (missingDependencies.length > 0) {
    problems.push(`zmdb is missing core server dependencies ${display(missingDependencies)}`);
  }

  const exports = record(manifest.exports);
  const missingExports = PRODUCT_SERVER_EXPORTS.filter(subpath => typeof exports[subpath] !== 'string');
  if (missingExports.length > 0) {
    problems.push(`zmdb is missing core server facade subpaths ${display(missingExports)}`);
  }
  return problems;
}

function workspaceDependencyEdges(graph) {
  const edges = [];
  for (const [name, pkg] of graph.packages) {
    const manifest = readManifest(join(pkg.dir, 'package.json'));
    for (const dependency of sortedKeys(manifest.dependencies)) {
      if (graph.packages.has(dependency)) edges.push([name, dependency]);
    }
  }
  return edges.toSorted(([leftFrom, leftTo], [rightFrom, rightTo]) =>
    `${leftFrom}\u0000${leftTo}`.localeCompare(`${rightFrom}\u0000${rightTo}`),
  );
}

export function findServerPackageCycle(edges) {
  const graph = new Map();
  for (const [from, to] of edges) {
    const targets = graph.get(from) ?? new Set();
    targets.add(to);
    graph.set(from, targets);
    if (!graph.has(to)) graph.set(to, new Set());
  }

  const visiting = new Set();
  const visited = new Set();
  const path = [];
  const visit = node => {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

export function analyzeCoreServerBoundaries(root = SCRIPT_ROOT, options = {}) {
  const requireAll = options.requireAll !== false;
  const graph = createImportGraph(root);
  const packageProblems = new Map(
    CORE_SERVER_PACKAGES.map(target => [target.name, coreTargetProblems(root, graph, target, requireAll)]),
  );
  packageProblems.set('zmdb', productServerProblems(root, graph));
  const edges = workspaceDependencyEdges(graph);
  const cycle = findServerPackageCycle(edges);
  const graphProblems = cycle === null ? [] : [`workspace package dependency cycle: ${cycle.join(' -> ')}`];
  return { packageProblems, edges, graphProblems };
}

function coreProblems(root, graph) {
  const problems = [];
  for (const name of CORE_PACKAGES) {
    const pkg = packageByName(graph, name);
    if (pkg === undefined) continue;
    const manifest = readManifest(join(pkg.dir, 'package.json'));
    const declared = new Set([
      ...sortedKeys(manifest.dependencies),
      ...sortedKeys(manifest.peerDependencies),
      ...sortedKeys(manifest.optionalDependencies),
    ]);
    const forbiddenDeclared = [...declared].filter(value => OPTIONAL_PACKAGES.has(value) || SERVER_PEERS.has(value));
    if (forbiddenDeclared.length > 0) {
      problems.push(`${name} declares optional server packages or peers ${display(forbiddenDeclared)}`);
    }

    const reached = reachablePackages(root, graph, entryFiles(pkg));
    const forbiddenExternal = reached.external.filter(value => SERVER_PEERS.has(value));
    if (forbiddenExternal.length > 0) {
      problems.push(`${name} reaches optional server peers ${display(forbiddenExternal)}`);
    }
    const forbiddenWorkspace = reached.workspace.filter(value => OPTIONAL_PACKAGES.has(value));
    if (forbiddenWorkspace.length > 0) {
      problems.push(`${name} reaches optional server packages ${display(forbiddenWorkspace)}`);
    }

    const forbiddenExports = (FORBIDDEN_OLD_EXPORTS.get(name) ?? []).filter(
      subpath => record(manifest.exports)[subpath] !== undefined,
    );
    if (forbiddenExports.length > 0) {
      problems.push(`${name} still publishes old integration subpaths ${display(forbiddenExports)}`);
    }
  }
  return problems;
}

export function analyzeServerBoundaries(root = SCRIPT_ROOT, options = {}) {
  const requireAll = options.requireAll !== false;
  const graph = createImportGraph(root);
  const core = analyzeCoreServerBoundaries(root, { requireAll });
  return [
    ...SERVER_PACKAGES.flatMap(target => targetProblems(root, graph, target, requireAll)),
    ...coreProblems(root, graph),
    ...[...core.packageProblems.values()].flat(),
    ...core.graphProblems,
    ...(hasPublishedAppKernel(root) ? analyzeAppKernelBoundary(root) : []),
  ].toSorted();
}

export function readBoundaryBaseline(path = DEFAULT_BASELINE) {
  const parsed = readManifest(path);
  if (!Array.isArray(parsed.problems) || parsed.problems.some(problem => typeof problem !== 'string')) {
    throw new Error(`${path} must contain a string-array "problems" field`);
  }
  return parsed.problems.toSorted();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter(value => !rightSet.has(value));
}

function parseArgs(argv) {
  let root = SCRIPT_ROOT;
  let strict = false;
  let requireAll = true;
  let baseline = DEFAULT_BASELINE;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--strict') strict = true;
    else if (argument === '--partial') requireAll = false;
    else if (argument === '--root') root = resolve(argv[++index] ?? '');
    else if (argument === '--baseline') baseline = resolve(argv[++index] ?? '');
    else throw new Error(`unknown argument: ${argument}`);
  }
  return { root, strict, requireAll, baseline };
}

function runCli() {
  const { root, strict, requireAll, baseline } = parseArgs(process.argv.slice(2));
  const actual = analyzeServerBoundaries(root, { requireAll });
  const expected = strict ? [] : readBoundaryBaseline(baseline);
  const added = difference(actual, expected);
  const retired = difference(expected, actual);

  if (added.length > 0 || retired.length > 0) {
    console.error(`server boundary verification failed: ${String(actual.length)} current finding(s)`);
    for (const problem of added) console.error(`  NEW: ${problem}`);
    for (const problem of retired) console.error(`  RETIRED (update the baseline): ${problem}`);
    process.exit(1);
  }

  if (strict) {
    console.log(
      `server boundaries: strict package graph clean across ${String(SERVER_PACKAGES.length)} optional and ${String(CORE_SERVER_PACKAGES.length + 1)} core/facade packages.`,
    );
  } else {
    console.log(
      `server boundaries: ${String(actual.length)} frozen finding(s) match the tests-freeze baseline; strict target remains red.`,
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
