#!/usr/bin/env node
// Tooling-package boundary ratchet for #627.
//
// The package extraction itself belongs to #628-#630, so this gate has two jobs
// before those packages exist:
//
// 1. turn #626's ownership policy, amended to 138 paths after #667, into an executable,
//    bijective inventory; and
// 2. prevent the known runtime/generated-import violations from growing while
//    the expected-failure tests freeze the zero-violation target.
//
// A violation disappearing is always accepted. A new violation is not.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createImportGraph } from './lib/import-graph.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const TARGET_TOOLING_EXPORTS = Object.freeze({
  '@zmdb/compiler': Object.freeze([
    '.',
    './config',
    './emit',
    './errors',
    './lint',
    './metro',
    './reflect',
    './testing',
    './transform',
    './unplugin',
  ]),
  '@zmdb/migrations': Object.freeze([
    '.',
    './declarations',
    './embedded',
    './files',
    './introspect',
    './runner',
    './testing',
  ]),
  '@zmdb/cli': Object.freeze(['.']),
});

export const TARGET_TOOLING_BIN = Object.freeze({
  packageName: '@zmdb/cli',
  command: 'zmdb',
});

export const TARGET_PRODUCT_TOOLING_EXPORTS = Object.freeze({
  '@zmdb/compiler': Object.freeze(['./compiler', './config']),
  '@zmdb/migrations': Object.freeze(['./migrations']),
  '@zmdb/cli': Object.freeze(['./cli']),
});

export const TARGET_TOOLING_MANIFESTS = Object.freeze({
  '@zmdb/compiler': Object.freeze({
    dependencies: Object.freeze(['@zmdb/aot-validator', '@zmdb/query-compiler', '@zmdb/schema-core']),
    peerDependencies: Object.freeze(['metro', 'metro-babel-transformer', 'oxlint', 'typescript']),
    optionalPeers: Object.freeze(['metro', 'metro-babel-transformer', 'oxlint']),
  }),
  '@zmdb/migrations': Object.freeze({
    dependencies: Object.freeze(['@zmdb/query-compiler', 'oxfmt']),
    peerDependencies: Object.freeze([]),
    optionalPeers: Object.freeze([]),
  }),
  '@zmdb/cli': Object.freeze({
    dependencies: Object.freeze(['@zmdb/compiler', '@zmdb/migrations', 'oxfmt']),
    peerDependencies: Object.freeze(['@zmdb/web', 'esbuild']),
    optionalPeers: Object.freeze(['@zmdb/web', 'esbuild']),
  }),
});

const POLICY_PATH = '.github/scripts/verify-tooling-ownership.SPEC.md';
const INVENTORY_ROOTS = ['packages/aot-validator/src', 'packages/query-compiler/src', 'packages/zmdb/src'];
const INVENTORY_EXTENSIONS = new Set(['.ts', '.js', '.json', '.proto']);
const EXPECTED_OWNER_COUNTS = Object.freeze({
  compiler: 30,
  migrations: 20,
  cli: 20,
  runtime: 23,
  facade: 10,
  'optional-integration': 6,
  'test-only': 28,
  obsolete: 1,
});

const RUNTIME_ROOTS = Object.freeze([
  '@zmdb/schema-core',
  '@zmdb/query-compiler',
  '@zmdb/aot-validator',
  '@zmdb/repository',
  '@zmdb/web',
  'zmdb',
]);
const RUNTIME_FOUNDATIONS = new Set(RUNTIME_ROOTS.filter(packageName => packageName !== 'zmdb'));
const TARGET_TOOLING_PACKAGES = new Set(Object.keys(TARGET_TOOLING_MANIFESTS));

// Measured at 1b686ee10162f566a23bd3175a577eb8d641ef34. These are
// exact import edges. Deleting one is accepted; adding another route into the
// same category is not.
const BASELINE_RUNTIME_VIOLATIONS = new Set([
  '@zmdb/repository|compiler|packages/aot-validator/src/utilities/index.ts|../emit/shape.js',
  '@zmdb/repository|migrations|packages/query-compiler/src/migrations/index.ts|./runner.js',
  '@zmdb/repository|migrations|packages/query-compiler/src/schema-objects/index.ts|../migrations/index.js',
  '@zmdb/web|compiler|packages/aot-validator/src/utilities/index.ts|../emit/shape.js',
  '@zmdb/web|migrations|packages/query-compiler/src/migrations/index.ts|./runner.js',
  '@zmdb/web|migrations|packages/query-compiler/src/schema-objects/index.ts|../migrations/index.js',
  'zmdb|compiler|packages/aot-validator/src/utilities/index.ts|../emit/shape.js',
  'zmdb|migrations|packages/query-compiler/src/migrations/index.ts|./runner.js',
  'zmdb|migrations|packages/query-compiler/src/schema-objects/index.ts|../migrations/index.js',
  'zmdb|migrations|packages/zmdb/src/index.ts|@zmdb/query-compiler/migrations',
]);

const RUNTIME_EXTERNAL_TOOLING = Object.freeze([
  ['typescript', /^typescript(?:\/|$)/],
  ['oxfmt', /^oxfmt(?:\/|$)/],
  ['oxlint', /^oxlint(?:\/|$)/],
  ['metro', /^(?:metro|metro-babel-transformer)(?:\/|$)/],
  ['bundler', /^(?:esbuild|rollup|unplugin|vite|webpack)(?:\/|$)/],
  ['node:repl', /^node:repl(?:\/|$)/],
]);

export const GENERATED_ARTIFACTS = Object.freeze([
  'benchmarks/harness/framework/model.zmdb.generated.d.ts',
  'benchmarks/harness/framework/model.zmdb.generated.js',
  'benchmarks/harness/framework/model.zmdb.witness.ts',
  'benchmarks/harness/validation/aot.generated.ts',
  'benchmarks/harness/validation/model.generated.ts',
  'benchmarks/harness/validation/shallow.generated.ts',
  'fixtures/consumer-cli/src/orders.zmdb.generated.d.ts',
  'fixtures/consumer-cli/src/orders.zmdb.generated.js',
  'fixtures/consumer-cli/src/orders.zmdb.witness.ts',
  'packages/zmdb/src/config/index.zmdb.generated.d.ts',
  'packages/zmdb/src/config/index.zmdb.generated.js',
  'packages/zmdb/src/config/index.zmdb.witness.ts',
]);

const BASELINE_GENERATED_VIOLATIONS = new Set([
  'benchmarks/harness/framework/model.zmdb.generated.js|../../../packages/aot-validator/src/utilities/index.ts|private-source',
  'benchmarks/harness/framework/model.zmdb.witness.ts|../../../packages/aot-validator/src/utilities/index.js|private-source',
  'benchmarks/harness/validation/model.generated.ts|../../../packages/schema-core/src/ir/index.js|private-source',
]);

const BASELINE_BIN_OWNERS = new Set(['@zmdb/aot-validator|zmdb-codegen', 'zmdb|zmdb']);
const GENERATED_EXTERNAL_TOOLING = [
  /^typescript(?:\/|$)/,
  /^oxlint(?:\/|$)/,
  /^oxfmt(?:\/|$)/,
  /^metro(?:\/|$)/,
  /^metro-babel-transformer(?:\/|$)/,
  /^unplugin(?:\/|$)/,
  /^vite(?:\/|$)/,
  /^rollup(?:\/|$)/,
  /^webpack(?:\/|$)/,
  /^esbuild(?:\/|$)/,
  /^node:/,
];
const GENERATED_TOOLING_SUBPATHS = [
  /^@zmdb\/compiler(?:\/|$)/,
  /^@zmdb\/migrations(?:\/|$)/,
  /^@zmdb\/cli(?:\/|$)/,
  /^@zmdb\/aot-validator\/(?:codegen|emit|lint|metro|plugin|reflect|testing|transformer|unplugin)(?:\/|$)/,
  /^@zmdb\/query-compiler\/(?:introspect|migrations)(?:\/|$)/,
  /^zmdb\/(?:cli|compiler|config|migrations|unplugin)(?:\/|$)/,
];

function extension(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

function isInventoryPath(path) {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  if (name === 'SPEC.md' || name.endsWith('.spec.ts') || name.endsWith('.type-test.ts')) return false;
  return INVENTORY_EXTENSIONS.has(extension(path));
}

export function parseOwnershipCatalog(source) {
  const match = /## 2\. Exact source move map[\s\S]*?```text\n([\s\S]*?)```/.exec(source);
  if (match === null) throw new Error(`${POLICY_PATH} has no exact source move map`);

  const entries = [];
  const paths = new Set();
  for (const line of (match[1] ?? '').trim().split('\n')) {
    const [owner, path, extra] = line.split('\t');
    if (owner === undefined || path === undefined || extra !== undefined) {
      throw new Error(`${POLICY_PATH} has an invalid ownership row: ${line}`);
    }
    if (paths.has(path)) throw new Error(`${POLICY_PATH} lists ${path} more than once`);
    paths.add(path);
    entries.push({ owner, path });
  }
  return entries;
}

function ownershipInventory(root) {
  const policy = readFileSync(join(root, POLICY_PATH), 'utf8');
  const catalog = parseOwnershipCatalog(policy);
  const catalogPaths = new Set(catalog.map(entry => entry.path));
  const actual = INVENTORY_ROOTS.flatMap(directory =>
    filesUnder(join(root, directory))
      .filter(isInventoryPath)
      .map(path => relative(root, path)),
  ).toSorted();
  const actualPaths = new Set(actual);
  const problems = [];

  for (const path of actual) {
    if (!catalogPaths.has(path)) problems.push(`ownership catalog omits ${path}`);
  }
  for (const { path } of catalog) {
    if (!actualPaths.has(path)) problems.push(`ownership catalog names missing path ${path}`);
  }

  const ownerCounts = Object.fromEntries(Object.keys(EXPECTED_OWNER_COUNTS).map(owner => [owner, 0]));
  for (const { owner, path } of catalog) {
    if (!(owner in EXPECTED_OWNER_COUNTS)) {
      problems.push(`ownership catalog gives ${path} unknown owner ${owner}`);
      continue;
    }
    ownerCounts[owner] += 1;
  }
  for (const [owner, expected] of Object.entries(EXPECTED_OWNER_COUNTS)) {
    const observed = ownerCounts[owner] ?? 0;
    if (observed !== expected) {
      problems.push(`ownership catalog has ${String(observed)} ${owner} path(s), expected ${String(expected)}`);
    }
  }

  return { catalog, ownerCounts, actualCount: actual.length, problems };
}

function ownerByAbsolutePath(root, catalog) {
  return new Map(catalog.map(entry => [join(root, entry.path), entry.owner]));
}

function runtimeCategory(reference, owners) {
  if (reference.resolved !== null) {
    const owner = owners.get(reference.resolved);
    if (owner === 'compiler' || owner === 'migrations' || owner === 'cli') return owner;
  }
  return RUNTIME_EXTERNAL_TOOLING.find(([, pattern]) => pattern.test(reference.specifier))?.[0];
}

function runtimeViolations(root, catalog, overlays) {
  const graph = createImportGraph(root);
  const owners = ownerByAbsolutePath(root, catalog);
  const violations = [];

  for (const packageName of RUNTIME_ROOTS) {
    const pkg = graph.packages.get(packageName);
    const target = pkg?.exports?.['.'];
    if (pkg === undefined || typeof target !== 'string') {
      violations.push({
        id: `${packageName}|missing-root`,
        entry: packageName,
        category: 'missing-root',
        chain: [],
      });
      continue;
    }
    const entry = join(pkg.dir, target);
    const seen = new Set();
    const queue = [{ file: entry, chain: [entry] }];
    const packageViolations = new Map();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current.file)) continue;
      const source =
        overlays.get(current.file) ?? (existsSync(current.file) ? readFileSync(current.file, 'utf8') : undefined);
      if (source === undefined) continue;
      seen.add(current.file);
      for (const imported of graph.importsOf(current.file, source)) {
        const category = runtimeCategory(imported, owners);
        if (category !== undefined) {
          const sourcePath = relative(root, current.file);
          const id = `${packageName}|${category}|${sourcePath}|${imported.specifier}`;
          if (!packageViolations.has(id)) {
            packageViolations.set(id, {
              id,
              entry: packageName,
              category,
              source: sourcePath,
              specifier: imported.specifier,
              chain: [...current.chain, imported.specifier].map(step =>
                step.startsWith(root) ? relative(root, step) : step,
              ),
            });
          }
        }
        if (imported.resolved !== null) {
          queue.push({ file: imported.resolved, chain: [...current.chain, imported.resolved] });
        }
      }
    }
    violations.push(...packageViolations.values());
  }
  return violations.toSorted((left, right) => left.id.localeCompare(right.id));
}

function workspaceManifests(root) {
  const manifests = new Map();
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, 'packages', entry.name, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof manifest.name === 'string') manifests.set(manifest.name, { directory: entry.name, manifest });
  }
  return manifests;
}

function workspaceDependencyEdges(manifests) {
  const edges = [];
  for (const [packageName, value] of manifests) {
    for (const dependency of Object.keys(value.manifest.dependencies ?? {})) {
      if (manifests.has(dependency)) edges.push([packageName, dependency]);
    }
  }
  return edges.toSorted(([leftFrom, leftTo], [rightFrom, rightTo]) =>
    `${leftFrom}\0${leftTo}`.localeCompare(`${rightFrom}\0${rightTo}`),
  );
}

export function findPackageCycle(edges) {
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

function packageGraphProblems(manifests) {
  const problems = [];
  const edges = workspaceDependencyEdges(manifests);
  const cycle = findPackageCycle(edges);
  if (cycle !== null) problems.push(`workspace package dependency cycle: ${cycle.join(' -> ')}`);

  for (const packageName of RUNTIME_FOUNDATIONS) {
    const manifest = manifests.get(packageName)?.manifest;
    if (manifest === undefined) continue;
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (TARGET_TOOLING_PACKAGES.has(dependency)) {
          problems.push(`${packageName} ${field} reaches tooling package ${dependency}`);
        }
      }
    }
  }
  return { edges, problems };
}

function packageDirectory(root, file) {
  const path = relative(join(root, 'packages'), file);
  if (path.startsWith('..')) return null;
  return path.split(sep)[0] ?? null;
}

function generatedViolation(root, file, reference) {
  if (GENERATED_EXTERNAL_TOOLING.some(pattern => pattern.test(reference.specifier))) {
    return 'tooling-external';
  }
  if (GENERATED_TOOLING_SUBPATHS.some(pattern => pattern.test(reference.specifier))) {
    return 'tooling-subpath';
  }
  const resolvedPackage = reference.resolved === null ? null : packageDirectory(root, reference.resolved);
  const generatedPackage = packageDirectory(root, file);
  if (
    reference.specifier.startsWith('.') &&
    resolvedPackage !== null &&
    reference.resolved?.includes(`${sep}src${sep}`) === true &&
    resolvedPackage !== generatedPackage
  ) {
    return 'private-source';
  }
  return null;
}

function generatedViolations(root, overlays) {
  const graph = createImportGraph(root);
  const violations = [];
  for (const path of GENERATED_ARTIFACTS) {
    const file = join(root, path);
    const source = overlays.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    if (source === undefined) {
      violations.push({
        id: `${path}|missing|missing-artifact`,
        path,
        specifier: 'missing',
        reason: 'missing-artifact',
      });
      continue;
    }
    for (const reference of graph.importsOf(file, source)) {
      const reason = generatedViolation(root, file, reference);
      if (reason === null) continue;
      violations.push({
        id: `${path}|${reference.specifier}|${reason}`,
        path,
        specifier: reference.specifier,
        reason,
      });
    }
  }
  return violations;
}

function embeddedEntry(root, graph) {
  const target = graph.packages.get('@zmdb/migrations');
  const exported = target?.exports?.['./embedded'];
  if (target !== undefined && typeof exported === 'string') return join(target.dir, exported);
  return join(root, 'packages', 'query-compiler', 'src', 'migrations', 'embedded.ts');
}

function embeddedViolations(root, overlays) {
  const graph = createImportGraph(root);
  const entry = embeddedEntry(root, graph);
  if (!existsSync(entry) && !overlays.has(entry)) {
    return [{ id: 'missing-embedded-entry', file: relative(root, entry), specifier: 'missing' }];
  }

  const target = graph.packages.get('@zmdb/migrations');
  const otherEntries = new Set(
    Object.entries(target?.exports ?? {})
      .filter(([subpath, exported]) => subpath !== './embedded' && typeof exported === 'string')
      .map(([, exported]) => join(target.dir, exported)),
  );
  if (target === undefined) {
    const current = graph.packages.get('@zmdb/query-compiler');
    for (const subpath of ['./migrations', './migrations/runner']) {
      const exported = current?.exports?.[subpath];
      if (current !== undefined && typeof exported === 'string') otherEntries.add(join(current.dir, exported));
    }
  }

  const seen = new Set();
  const queue = [entry];
  const violations = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    const source = overlays.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    if (source === undefined) continue;
    seen.add(file);
    for (const imported of graph.importsOf(file, source)) {
      const bare = !imported.specifier.startsWith('.');
      const anotherEntry = imported.resolved !== null && otherEntries.has(imported.resolved);
      if (bare || anotherEntry) {
        violations.push({
          id: `${relative(root, file)}|${imported.specifier}`,
          file: relative(root, file),
          specifier: imported.specifier,
        });
      }
      if (imported.resolved !== null) queue.push(imported.resolved);
    }
  }
  return violations.toSorted((left, right) => left.id.localeCompare(right.id));
}

function normalizeBins(manifest) {
  if (typeof manifest.bin === 'string') return { [manifest.name ?? '']: manifest.bin };
  return typeof manifest.bin === 'object' && manifest.bin !== null ? manifest.bin : {};
}

function binOwners(root) {
  const owners = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(root, 'packages', entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string') continue;
    for (const command of Object.keys(normalizeBins(manifest))) {
      if (command === 'zmdb' || command === 'zmdb-codegen') owners.push(`${manifest.name}|${command}`);
    }
  }
  return owners.toSorted();
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).toSorted();
}

function targetPackageProblems(root) {
  const problems = [];
  const productPath = join(root, 'packages', 'zmdb', 'package.json');
  const product = JSON.parse(readFileSync(productPath, 'utf8'));
  for (const [packageName, expected] of Object.entries(TARGET_TOOLING_EXPORTS)) {
    const directory = packageName.slice('@zmdb/'.length);
    const manifestPath = join(root, 'packages', directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const observed = sortedKeys(manifest.exports);
    if (manifest.name !== packageName)
      problems.push(`${manifestPath} declares ${String(manifest.name)}, expected ${packageName}`);
    if (JSON.stringify(observed) !== JSON.stringify([...expected].toSorted())) {
      problems.push(`${packageName} exports ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`);
    }
    const contract = TARGET_TOOLING_MANIFESTS[packageName];
    const dependencies = sortedKeys(manifest.dependencies);
    if (JSON.stringify(dependencies) !== JSON.stringify([...contract.dependencies].toSorted())) {
      problems.push(
        `${packageName} dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(contract.dependencies)}`,
      );
    }
    const peers = sortedKeys(manifest.peerDependencies);
    if (JSON.stringify(peers) !== JSON.stringify([...contract.peerDependencies].toSorted())) {
      problems.push(
        `${packageName} peerDependencies ${JSON.stringify(peers)}, expected ${JSON.stringify(contract.peerDependencies)}`,
      );
    }
    for (const peer of contract.peerDependencies) {
      const optional = manifest.peerDependenciesMeta?.[peer]?.optional === true;
      if (optional !== contract.optionalPeers.includes(peer)) {
        problems.push(
          `${packageName} peer ${peer} optional=${String(optional)}, expected ${String(contract.optionalPeers.includes(peer))}`,
        );
      }
    }
    if (packageName === TARGET_TOOLING_BIN.packageName) {
      const bins = Object.keys(normalizeBins(manifest));
      if (JSON.stringify(bins) !== JSON.stringify([TARGET_TOOLING_BIN.command])) {
        problems.push(`${packageName} bins ${JSON.stringify(bins)}, expected ["${TARGET_TOOLING_BIN.command}"]`);
      }
    } else if (Object.keys(normalizeBins(manifest)).length > 0) {
      problems.push(`${packageName} must not publish an executable`);
    }
    for (const subpath of TARGET_PRODUCT_TOOLING_EXPORTS[packageName]) {
      if (typeof product.exports?.[subpath] !== 'string') {
        problems.push(`zmdb is missing the ${subpath} facade for ${packageName}`);
      }
    }
    if (product.dependencies?.[packageName] === undefined) {
      problems.push(`zmdb does not depend on ${packageName}`);
    }
  }
  return problems;
}

export function analyseToolingBoundaries({ root = ROOT, overlays = new Map() } = {}) {
  const inventory = ownershipInventory(root);
  const manifests = workspaceManifests(root);
  const packageGraph = packageGraphProblems(manifests);
  const runtime = runtimeViolations(root, inventory.catalog, overlays);
  const generated = generatedViolations(root, overlays);
  const embedded = embeddedViolations(root, overlays);
  const bins = binOwners(root);
  const problems = [...inventory.problems, ...packageGraph.problems, ...targetPackageProblems(root)];

  for (const violation of runtime) {
    if (!BASELINE_RUNTIME_VIOLATIONS.has(violation.id)) {
      problems.push(`new runtime tooling reachability ${violation.id}: ${violation.chain.join(' -> ')}`);
    }
  }
  for (const violation of generated) {
    if (!BASELINE_GENERATED_VIOLATIONS.has(violation.id)) {
      problems.push(`new generated import violation ${violation.path} -> ${violation.specifier} (${violation.reason})`);
    }
  }
  for (const violation of embedded) {
    problems.push(`embedded migrations reaches forbidden import ${violation.file} -> ${violation.specifier}`);
  }

  const allowedBins = new Set([
    ...BASELINE_BIN_OWNERS,
    `${TARGET_TOOLING_BIN.packageName}|${TARGET_TOOLING_BIN.command}`,
  ]);
  for (const owner of bins) {
    if (!allowedBins.has(owner)) problems.push(`unexpected tooling binary owner ${owner}`);
  }
  const zmdbOwners = bins.filter(owner => owner.endsWith('|zmdb'));
  if (zmdbOwners.length > 1) problems.push(`more than one workspace owns the zmdb binary: ${zmdbOwners.join(', ')}`);

  return {
    problems,
    inventory,
    packageGraph,
    runtimeViolations: runtime,
    generatedViolations: generated,
    embeddedViolations: embedded,
    binOwners: bins,
  };
}

function successLine(result) {
  const counts = Object.entries(result.inventory.ownerCounts)
    .map(([owner, count]) => `${owner} ${String(count)}`)
    .join(', ');
  return (
    `tooling boundaries: ${String(result.inventory.actualCount)} source path(s) (${counts}); ` +
    `${String(result.packageGraph.edges.length)} acyclic workspace dependency edge(s), ` +
    `${String(result.runtimeViolations.length)} measured runtime violation edge(s), ` +
    `${String(result.generatedViolations.length)} generated-import violation(s), ` +
    `${String(result.embeddedViolations.length)} embedded-runner violation(s), ` +
    `${String(result.binOwners.length)} tooling bin owner(s) ratcheted.`
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = analyseToolingBoundaries();
  if (result.problems.length > 0) {
    console.error(`tooling boundary verification failed with ${String(result.problems.length)} problem(s):`);
    for (const problem of result.problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(successLine(result));
  }
}
