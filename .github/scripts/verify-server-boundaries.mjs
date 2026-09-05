#!/usr/bin/env node
// Freeze the package graph for the optional server integrations.
//
// The default invocation compares the live tree with the checked-in tests-freeze
// baseline. That makes this useful before the packages exist: a new leak fails,
// while each implementation slice retires its own recorded finding. `--strict`
// is the target state and succeeds only when no finding remains.

import { existsSync, readFileSync } from 'node:fs';
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
    dependencies: { '@zmdb/jobs': 'workspace:^' },
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

function entryFiles(pkg) {
  return Object.values(pkg.exports)
    .filter(target => typeof target === 'string')
    .map(target => join(pkg.dir, target));
}

function reachablePackages(graph, starts) {
  const external = new Set();
  const workspace = new Set();
  const seen = new Set();
  const queue = [...starts];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const imported of graph.importsOf(file, readFileSync(file, 'utf8'))) {
      const root = packageRoot(imported.specifier);
      if (OPTIONAL_PACKAGES.has(root)) workspace.add(root);
      if (imported.resolved !== null) {
        queue.push(imported.resolved);
      } else if (
        !imported.specifier.startsWith('.') &&
        !imported.specifier.startsWith('node:') &&
        !root.startsWith('@zmdb/') &&
        root !== 'zmdb'
      ) {
        external.add(root);
      }
    }
  }

  return { external: [...external].toSorted(), workspace: [...workspace].toSorted() };
}

function manifestAt(root, dir) {
  return join(root, 'packages', dir, 'package.json');
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageByName(graph, name) {
  const pkg = graph.packages.get(name);
  return pkg === undefined ? undefined : { ...pkg, name };
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

  const reached = reachablePackages(graph, entryFiles(pkg));
  const expectedExternal = target.peer === undefined ? [] : [target.peer.name];
  if (JSON.stringify(reached.external) !== JSON.stringify(expectedExternal.toSorted())) {
    problems.push(
      `${target.name} reaches external packages ${display(reached.external)}, expected ${display(expectedExternal)}`,
    );
  }

  return problems;
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

    const reached = reachablePackages(graph, entryFiles(pkg));
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
  return [
    ...SERVER_PACKAGES.flatMap(target => targetProblems(root, graph, target, requireAll)),
    ...coreProblems(root, graph),
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
    console.log(`server boundaries: strict package graph clean across ${String(SERVER_PACKAGES.length)} packages.`);
  } else {
    console.log(
      `server boundaries: ${String(actual.length)} frozen finding(s) match the tests-freeze baseline; strict target remains red.`,
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
