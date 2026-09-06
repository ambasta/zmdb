#!/usr/bin/env node
// Freeze the hard runtime-foundation cutover from issues #635 and #636.
//
// Default mode is a ratchet over today's tree. It accepts only the exact checked-in
// baseline: a newly introduced inversion fails, and a retired finding also fails until
// the implementation issue updates the baseline deliberately. `--strict` is the final
// state and succeeds only when the old packages and every recorded reachability gap are
// gone.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { createImportGraph } from './lib/import-graph.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_BASELINE = join(ROOT, '.github', 'scripts', 'runtime-foundation-baseline.json');
const OWNERSHIP_SPEC = '.github/scripts/verify-runtime-foundation.SPEC.md';
const CONSUMER_ROOT = 'fixtures/consumer-runtime-foundation';
const OLD_PACKAGES = ['@zmdb/aot-validator', '@zmdb/query-compiler', '@zmdb/repository', '@zmdb/schema-core'];
const OPTIONAL_TARGETS = ['@zmdb/ai', '@zmdb/mssql', '@zmdb/postgres', '@zmdb/sqlite'];
const TRANSITIONAL_OPTIONAL_EDGES = new Map([
  // #672 implements the SQL Server vertical against the current generic seams;
  // #629 moves its migration strategy and catalog normalizer to migrations.
  ['@zmdb/mssql', new Set(['@zmdb/migrations', '@zmdb/query-compiler', '@zmdb/repository'])],
  // #670 implements the PostgreSQL vertical against the current generic seams.
  // #634 owns the hard cutover to @zmdb/sql and @zmdb/orm. Keep this exact
  // old-package closure visible to oldPackageProblems (and therefore strict
  // mode) while refusing any unrelated workspace edge here. #629 adds only the
  // extracted migration/introspection owner.
  ['@zmdb/postgres', new Set([...OLD_PACKAGES, '@zmdb/migrations'])],
  // #669 owns the SQLite vertical; #629 extracts its generic migration
  // lifecycle while keeping the database-specific strategy in this package.
  ['@zmdb/sqlite', new Set(['@zmdb/migrations'])],
]);
const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  '@zmdb/ai',
  '@zmdb/ai-anthropic',
  '@zmdb/ai-langchain',
  '@zmdb/ai-vercel',
  '@zmdb/app',
  '@zmdb/cli',
  '@zmdb/compiler',
  '@zmdb/jobs',
  '@zmdb/jobs-postgres',
  '@zmdb/mcp',
  '@zmdb/migrations',
  '@zmdb/mssql',
  '@zmdb/mysql',
  '@zmdb/otel',
  '@zmdb/postgres',
  '@zmdb/protobuf',
  '@zmdb/singlestore',
  '@zmdb/sqlite',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
  '@zmdb/web',
]);

export const FOUNDATION_PACKAGES = [
  {
    name: '@zmdb/schema',
    dir: 'schema',
    exports: [
      '.',
      './custom-types',
      './derive',
      './dto',
      './entity-modeling',
      './ir',
      './naming',
      './openapi',
      './relations',
      './tags',
    ],
    dependencies: [],
  },
  {
    name: '@zmdb/sql',
    dir: 'sql',
    exports: ['.', './aggregations', './comments', './fts', './joins', './schema-objects', './set-ops'],
    dependencies: [],
  },
  {
    name: '@zmdb/validator',
    dir: 'validator',
    exports: ['.', './advanced', './errors', './serialization'],
    dependencies: ['@zmdb/schema'],
  },
  {
    name: '@zmdb/orm',
    dir: 'orm',
    exports: [
      '.',
      './dto',
      './entity-modeling',
      './outbox',
      './relations',
      './replicas',
      './seeding',
      './transactions',
    ],
    dependencies: ['@zmdb/schema', '@zmdb/sql', '@zmdb/validator'],
  },
];

export const CONSUMER_FIXTURES = [
  { dir: 'schema', dependencies: ['@zmdb/schema'] },
  { dir: 'sql', dependencies: ['@zmdb/sql'] },
  { dir: 'validator', dependencies: ['@zmdb/schema', '@zmdb/validator'] },
  { dir: 'orm', dependencies: ['@zmdb/orm', '@zmdb/schema', '@zmdb/sql', '@zmdb/validator'] },
];

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sortedKeys(value) {
  return Object.keys(record(value)).toSorted();
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function packageRoot(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (
      entry.name === '.next' ||
      entry.name === '__budget__' ||
      entry.name === '__generated__' ||
      entry.name === 'dist' ||
      entry.name === 'node_modules'
    ) {
      return [];
    }
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function moduleSpecifiers(source) {
  const specifiers = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  return [...new Set(specifiers)];
}

function packageEntryFiles(pkg) {
  return Object.values(pkg.exports)
    .flatMap(target => {
      if (typeof target === 'string') return [join(pkg.dir, target)];
      if (record(target).import !== undefined && typeof record(target).import === 'string') {
        return [join(pkg.dir, record(target).import)];
      }
      return [];
    })
    .toSorted();
}

function reachableImports(graph, starts, stopAt = new Set()) {
  const queue = starts.map(file => ({ file, chain: [file] }));
  const seen = new Set();
  const references = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current.file) || !existsSync(current.file)) continue;
    seen.add(current.file);
    for (const imported of graph.importsOf(current.file, readFileSync(current.file, 'utf8'))) {
      references.push({ file: current.file, chain: current.chain, ...imported });
      if (imported.resolved !== null && !stopAt.has(packageRoot(imported.specifier))) {
        queue.push({ file: imported.resolved, chain: [...current.chain, imported.resolved] });
      }
    }
  }
  return references;
}

function manifestProblems(root, graph, architecture, target, requireAll) {
  const problems = [];
  const packageRecord = architecture.workspacePackages.find(candidate => candidate.manifest.name === target.name);
  const path = packageRecord?.manifestPath ?? join(root, 'packages', target.dir, 'package.json');
  if (packageRecord === undefined) {
    if (requireAll) problems.push(`missing target package ${target.name}: ${relative(root, path)}`);
    return problems;
  }

  const { manifest } = packageRecord;
  if (manifest.name !== target.name) {
    problems.push(`${relative(root, path)} names ${String(manifest.name)}, expected ${target.name}`);
  }

  const exports = sortedKeys(manifest.exports);
  if (!same(exports, target.exports.toSorted())) {
    problems.push(`${target.name} exports [${exports.join(', ')}], expected [${target.exports.toSorted().join(', ')}]`);
  }

  const dependencies = sortedKeys(manifest.dependencies);
  if (!same(dependencies, target.dependencies.toSorted())) {
    problems.push(
      `${target.name} dependencies [${dependencies.join(', ')}], expected [${target.dependencies.toSorted().join(', ')}]`,
    );
  }

  for (const field of ['optionalDependencies', 'peerDependencies']) {
    const names = sortedKeys(manifest[field]);
    if (names.length > 0) problems.push(`${target.name} has forbidden ${field} [${names.join(', ')}]`);
  }
  const externalDependencies = dependencies.filter(name => !name.startsWith('@zmdb/'));
  if (externalDependencies.length > 0) {
    problems.push(`${target.name} has external runtime dependencies [${externalDependencies.join(', ')}]`);
  }

  const pkg = graph.packages.get(target.name);
  if (pkg === undefined) {
    problems.push(`${target.name} is not discoverable as a workspace package`);
    return problems;
  }

  const entries = packageEntryFiles(pkg);
  for (const entry of entries) {
    if (!existsSync(entry)) problems.push(`${target.name} export target is absent: ${relative(root, entry)}`);
  }

  const allowed = new Set(target.dependencies);
  for (const imported of reachableImports(graph, entries)) {
    const rootName = packageRoot(imported.specifier);
    const chain = [...imported.chain.map(file => relative(root, file)), imported.specifier].join(' -> ');
    if (imported.specifier.startsWith('node:')) {
      problems.push(`${target.name} reaches forbidden built-in through ${chain}`);
    } else if (rootName.startsWith('@zmdb/')) {
      if (rootName !== target.name && !allowed.has(rootName)) {
        problems.push(`${target.name} reaches forbidden workspace package ${rootName} through ${chain}`);
      }
    } else if (!imported.specifier.startsWith('.') && rootName !== 'zmdb') {
      problems.push(`${target.name} reaches external package ${rootName} through ${chain}`);
    }
  }
  return problems;
}

function ownershipProblems(root) {
  const specPath = join(root, OWNERSHIP_SPEC);
  if (!existsSync(specPath)) return [`missing ownership contract: ${OWNERSHIP_SPEC}`];
  const catalog = readFileSync(specPath, 'utf8')
    .split('\n')
    .filter(line =>
      /^packages\/(?:schema-core|query-compiler|aot-validator|repository)\/src\/.*\.ts$/.test(line.trim()),
    )
    .map(line => line.trim())
    .toSorted();
  const duplicateCatalog = catalog.filter((path, index) => path === catalog[index - 1]);

  const current = ['schema-core', 'query-compiler', 'aot-validator', 'repository']
    .flatMap(name =>
      sourceFiles(join(root, 'packages', name, 'src'))
        .filter(path => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.type-test.ts'))
        .map(path => relative(root, path)),
    )
    .toSorted();
  const currentSet = new Set(current);
  const catalogSet = new Set(catalog);
  const omitted = current.filter(path => !catalogSet.has(path));
  const stale = catalog.filter(path => !currentSet.has(path));
  const problems = [];
  if (duplicateCatalog.length > 0) {
    problems.push(`ownership catalog repeats [${[...new Set(duplicateCatalog)].join(', ')}]`);
  }
  if (omitted.length > 0) problems.push(`ownership catalog omits [${omitted.join(', ')}]`);
  if (stale.length > 0) problems.push(`ownership catalog names absent files [${stale.join(', ')}]`);
  return problems;
}

function oldPackageProblems(root, architecture) {
  const problems = [];
  const workspaceNames = new Set(architecture.workspacePackages.map(packageRecord => packageRecord.manifest.name));
  for (const name of OLD_PACKAGES) {
    if (workspaceNames.has(name)) problems.push(`old package still exists: ${name}`);
  }

  const scanRoots = [join(root, 'packages'), join(root, 'fixtures')];
  const oldImports = new Map();
  for (const file of scanRoots.flatMap(sourceFiles)) {
    const logical = relative(root, file);
    if (
      !/\.(?:[cm]?[jt]s|d\.ts)$/.test(file) ||
      file.endsWith('.spec.ts') ||
      file.endsWith('.type-test.ts') ||
      logical.includes(`${sep}__fixtures__${sep}`)
    ) {
      continue;
    }
    for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
      if (OLD_PACKAGES.includes(packageRoot(specifier))) {
        const paths = oldImports.get(specifier) ?? [];
        paths.push(logical);
        oldImports.set(specifier, paths);
      }
    }
  }
  for (const [specifier, paths] of [...oldImports].toSorted(([left], [right]) => left.localeCompare(right))) {
    problems.push(`old import ${specifier} remains in [${paths.toSorted().join(', ')}]`);
  }
  return problems;
}

function optionalDirectionProblems(root, graph) {
  const problems = [];
  for (const target of OPTIONAL_TARGETS) {
    const pkg = graph.packages.get(target);
    if (pkg === undefined) continue;
    const currentDependencies = TRANSITIONAL_OPTIONAL_EDGES.get(target) ?? new Set();
    const references = reachableImports(graph, packageEntryFiles(pkg), currentDependencies);
    for (const imported of references) {
      const reached = packageRoot(imported.specifier);
      if (FOUNDATION_PACKAGES.some(foundation => foundation.name === reached)) continue;
      if (currentDependencies.has(reached)) continue;
      if (
        imported.specifier.startsWith('.') ||
        imported.specifier.startsWith('node:') ||
        reached === target ||
        reached === 'zmdb'
      ) {
        continue;
      }
      if (reached.startsWith('@zmdb/')) {
        problems.push(`${target} reaches non-foundation workspace package ${reached}`);
      }
    }
  }

  for (const foundation of FOUNDATION_PACKAGES) {
    const pkg = graph.packages.get(foundation.name);
    if (pkg === undefined) continue;
    for (const imported of reachableImports(graph, packageEntryFiles(pkg))) {
      const reached = packageRoot(imported.specifier);
      if (FORBIDDEN_RUNTIME_PACKAGES.has(reached)) {
        problems.push(`${foundation.name} reaches outward integration ${reached}`);
      }
    }
  }
  return problems;
}

function consumerProblems(root, requireAll) {
  const problems = [];
  const fixtureRoot = join(root, CONSUMER_ROOT);
  for (const fixture of CONSUMER_FIXTURES) {
    const directory = join(fixtureRoot, fixture.dir);
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) {
      if (requireAll) problems.push(`missing packed consumer fixture ${relative(root, directory)}`);
      continue;
    }
    const manifest = readJson(manifestPath);
    const dependencies = sortedKeys(manifest.dependencies);
    if (!same(dependencies, fixture.dependencies.toSorted())) {
      problems.push(
        `${relative(root, manifestPath)} dependencies [${dependencies.join(', ')}], expected [` +
          `${fixture.dependencies.toSorted().join(', ')}]`,
      );
    }
    for (const [name, range] of Object.entries(record(manifest.dependencies))) {
      if (typeof range !== 'string' || /^(?:file|link|portal|workspace):/.test(range)) {
        problems.push(`${relative(root, manifestPath)} uses a workspace alias for ${name}: ${String(range)}`);
      }
    }
    for (const required of ['src/contracts.ts', 'src/runtime.mjs', 'tsconfig.json']) {
      if (!existsSync(join(directory, required))) {
        problems.push(`${relative(root, directory)} is missing ${required}`);
      }
    }
  }

  const base = join(fixtureRoot, 'tsconfig.base.json');
  if (!existsSync(base)) {
    if (requireAll) problems.push(`missing packed consumer TypeScript base: ${relative(root, base)}`);
  } else if (Object.hasOwn(record(readJson(base).compilerOptions), 'paths')) {
    problems.push(`${relative(root, base)} must not define compilerOptions.paths`);
  }
  return problems;
}

export function analyzeRuntimeFoundation(root = ROOT, options = {}) {
  const { architecture } = options;
  if (architecture === undefined) {
    throw new TypeError('analyzeRuntimeFoundation requires architecture from loadGovernanceSnapshot({ root })');
  }
  const requireAll = options.requireAll !== false;
  const graph = createImportGraph(root, architecture);
  return [
    ...(options.checkOwnership === false ? [] : ownershipProblems(root)),
    ...FOUNDATION_PACKAGES.flatMap(target => manifestProblems(root, graph, architecture, target, requireAll)),
    ...(options.checkLegacy === false ? [] : oldPackageProblems(root, architecture)),
    ...optionalDirectionProblems(root, graph),
    ...(options.checkConsumers === false ? [] : consumerProblems(root, requireAll)),
  ].toSorted();
}

export function readRuntimeFoundationBaseline(path = DEFAULT_BASELINE) {
  const parsed = readJson(path);
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
  let root = ROOT;
  let baseline = DEFAULT_BASELINE;
  let strict = false;
  let requireAll = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--strict') strict = true;
    else if (argument === '--partial') requireAll = false;
    else if (argument === '--root') root = resolve(argv[++index] ?? '');
    else if (argument === '--baseline') baseline = resolve(argv[++index] ?? '');
    else throw new Error(`unknown argument: ${argument}`);
  }
  return { root, baseline, strict, requireAll };
}

async function runCli() {
  const { root, baseline, strict, requireAll } = parseArgs(process.argv.slice(2));
  const snapshot = await loadGovernanceSnapshot({ root, checks: [] });
  if (snapshot.architecture === null) throw new Error('governance snapshot has no architecture');
  const actual = analyzeRuntimeFoundation(root, { architecture: snapshot.architecture, requireAll });
  const expected = strict ? [] : readRuntimeFoundationBaseline(baseline);
  const added = difference(actual, expected);
  const retired = difference(expected, actual);

  if (added.length > 0 || retired.length > 0) {
    console.error(`runtime foundation verification failed: ${String(actual.length)} current finding(s)`);
    for (const problem of added) console.error(`  NEW: ${problem}`);
    for (const problem of retired) console.error(`  RETIRED (update the baseline): ${problem}`);
    process.exit(1);
  }

  if (strict) {
    console.log('runtime foundation: strict four-package DAG and hard cutover verified.');
  } else {
    console.log(
      `runtime foundation: ${String(actual.length)} frozen finding(s) match the checked-in #636/#629 baseline; strict target remains red.`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli();
}
