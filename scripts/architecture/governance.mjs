#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ReleaseGovernanceError, releaseModel } from '../release/model.mjs';
import {
  renderNativeRelationshipDiagnostics,
  validateNativeRelationshipSnapshot,
} from '../roadmap/native-relationships.mjs';
import {
  architectureExceptionInventory,
  databaseBoundaryFinding,
  GOVERNANCE_EXCEPTIONS,
  serverBoundaryProblemFinding,
  toolingGeneratedFinding,
  toolingRuntimeFinding,
  verifyGovernanceSnapshotExceptionSource,
} from './exceptions.mjs';
import { ArchitecturePolicyError, createDependencyGraph, DependencyCycleError, loadArchitecture } from './index.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CHECKS = Object.freeze(['architecture', 'exceptions', 'metadata', 'product', 'release', 'runtime']);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function freezeArray(values) {
  return Object.freeze([...values]);
}

function isDeeplyReadonly(value, seen = new WeakSet()) {
  if (typeof value !== 'object' || value === null) return true;
  if (value instanceof Map || !Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Reflect.ownKeys(value).every(key => isDeeplyReadonly(Reflect.get(value, key), seen));
}

function readonlyMap(entries, seen) {
  const map = new Map();
  const view = Object.create(null);
  Object.defineProperties(view, {
    size: { enumerable: false, get: () => map.size },
    get: { enumerable: false, value: key => map.get(key) },
    has: { enumerable: false, value: key => map.has(key) },
    entries: { enumerable: false, value: () => map.entries() },
    keys: { enumerable: false, value: () => map.keys() },
    values: { enumerable: false, value: () => map.values() },
    forEach: {
      enumerable: false,
      value: (callback, thisArgument) => {
        for (const [key, value] of map) callback.call(thisArgument, value, key, view);
      },
    },
    [Symbol.iterator]: { enumerable: false, value: () => map[Symbol.iterator]() },
    [Symbol.toStringTag]: { enumerable: false, value: 'Map' },
  });
  seen.set(entries, view);
  for (const [key, value] of entries) map.set(deepReadonly(key, seen), deepReadonly(value, seen));
  return Object.freeze(view);
}

function deepReadonly(value, seen = new WeakMap()) {
  if (typeof value !== 'object' || value === null || isDeeplyReadonly(value)) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (value instanceof Map) return readonlyMap(value, seen);

  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    Object.defineProperty(copy, key, {
      configurable: false,
      enumerable: Object.prototype.propertyIsEnumerable.call(value, key),
      value: deepReadonly(Reflect.get(value, key), seen),
      writable: false,
    });
  }
  return Object.freeze(copy);
}

function diagnosticCode(line) {
  return /^\[([^\]]+)]/.exec(line)?.[1] ?? 'GOVERNANCE_ERROR';
}

function finding(domain, line) {
  const code = diagnosticCode(line);
  const message = line.replace(/^\[[^\]]+]\s*/, '');
  const subject = message.split(':', 1)[0] ?? message;
  return Object.freeze({
    id: `${code}/path/${encodeURIComponent(subject)}`,
    code,
    scope: Object.freeze({ kind: 'path', path: subject }),
    message,
    remediation: message.includes('Remediation:') ? (message.split('Remediation:').at(-1)?.trim() ?? '') : '',
    disposition: 'active',
    domain,
    line,
  });
}

function findings(domain, diagnostics) {
  return diagnostics.map(line => finding(domain, line));
}

function sortedFindings(values) {
  const unique = new Map(values.map(item => [item.id, item]));
  return freezeArray(
    [...unique.values()].toSorted((left, right) =>
      compareText(`${left.code}\u0000${left.id}`, `${right.code}\u0000${right.id}`),
    ),
  );
}

function exceptionFinding(domain, value) {
  return Object.freeze({
    ...value,
    domain,
    line: `[${value.code}] ${value.message}`,
  });
}

function exceptionDiagnosticFinding(diagnostic) {
  return Object.freeze({
    id: `${diagnostic.code}/path/${encodeURIComponent(diagnostic.exceptionId)}`,
    code: diagnostic.code,
    scope: Object.freeze({ kind: 'path', path: diagnostic.exceptionId }),
    message: diagnostic.message,
    remediation: diagnostic.message,
    disposition: 'active',
    domain: 'exceptions',
    line: `[${diagnostic.code}] ${diagnostic.exceptionId}: ${diagnostic.message}`,
  });
}

function graphMap(graph) {
  return deepReadonly(
    new Map(
      Object.entries(graph)
        .toSorted(([left], [right]) => compareText(left, right))
        .map(([id, dependencies]) => [id, freezeArray(dependencies)]),
    ),
  );
}

function emptySnapshot(root, values) {
  return Object.freeze({
    root,
    architecture: null,
    packages: Object.freeze([]),
    packageGraph: deepReadonly(new Map()),
    release: null,
    exceptions: GOVERNANCE_EXCEPTIONS,
    issues: null,
    findings: sortedFindings(values),
    queries: Object.freeze({}),
  });
}

function selectedChecks(input, root) {
  if (input.checks !== undefined) return new Set(input.checks);
  const checks = new Set(DEFAULT_CHECKS);
  if (!existsSync(join(root, 'docs-site', 'pages.mjs'))) checks.delete('product');
  if (!existsSync(join(root, 'scripts', 'architecture', 'exceptions.mjs'))) checks.delete('exceptions');
  return checks;
}

export function readGovernanceRelationshipSnapshot(path) {
  const resolved = resolve(path);
  const snapshot = JSON.parse(readFileSync(resolved, 'utf8'));
  const report = validateNativeRelationshipSnapshot(snapshot);
  if (report.diagnostics.length > 0) {
    throw new Error(
      `${resolved} is not a complete native relationship snapshot:\n${renderNativeRelationshipDiagnostics(report).trimEnd()}`,
    );
  }
  return snapshot;
}

async function inspectGovernanceExceptions({ root, architecture, release, packageGraph, issues, requireOwnerStates }) {
  const [databaseModule, runtimeModule, serverModule, toolingModule] = await Promise.all([
    import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-database-boundaries.mjs')).href}?governance-exceptions=1`
    ),
    import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-runtime-foundation.mjs')).href}?governance-exceptions=1`
    ),
    import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-server-boundaries.mjs')).href}?governance-exceptions=1`
    ),
    import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-tooling-boundaries.mjs')).href}?governance-exceptions=1`
    ),
  ]);
  const [database, runtime, server, tooling] = await Promise.all([
    databaseModule.inspectDatabaseBoundaries(root, { architecture }),
    Promise.resolve(runtimeModule.inspectRuntimeFoundation(root, { architecture })),
    Promise.resolve(serverModule.analyzeServerBoundaries(root, { architecture, release })),
    Promise.resolve(toolingModule.analyseToolingBoundaries({ root, architecture, classifyExceptions: false })),
  ]);
  const rawBySource = {
    'database-boundaries': database.findings.map(databaseBoundaryFinding),
    'runtime-foundation': runtime.findings,
    'server-boundaries': server.map(serverBoundaryProblemFinding),
    'tooling-boundaries': [
      ...tooling.runtimeViolations.map(toolingRuntimeFinding),
      ...tooling.generatedViolations.map(toolingGeneratedFinding),
    ],
  };
  const context = Object.freeze({
    root,
    packageGraph,
    exceptions: GOVERNANCE_EXCEPTIONS,
    issues,
  });
  const reports = Object.fromEntries(
    Object.entries(rawBySource).map(([source, rawFindings]) => [
      source,
      verifyGovernanceSnapshotExceptionSource({
        snapshot: context,
        source,
        rawFindings,
        requireOwnerStates,
      }),
    ]),
  );
  return Object.freeze({
    inventory: architectureExceptionInventory(),
    reports: deepReadonly(reports),
  });
}

export async function loadGovernanceSnapshot(input) {
  if (typeof input !== 'object' || input === null || typeof input.root !== 'string') {
    throw new TypeError('loadGovernanceSnapshot requires an explicit root');
  }
  const root = resolve(input.root);
  const checks = selectedChecks(input, root);
  let architecture;
  try {
    architecture = await loadArchitecture(root);
  } catch (error) {
    if (!(error instanceof ArchitecturePolicyError)) throw error;
    return emptySnapshot(root, findings('architecture', error.diagnostics));
  }

  const packageGraph = graphMap(createDependencyGraph(architecture));
  const values = [];
  const queries = {};
  const issues =
    input.relationships === undefined
      ? null
      : deepReadonly(new Map(input.relationships.issues.map(issue => [issue.number, issue])));

  if (checks.has('architecture')) {
    const { inspectArchitectureZones } = await import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-architecture-zones.mjs')).href}?governance=1`
    );
    queries.architecture = await inspectArchitectureZones(root, { architecture });
    values.push(...findings('architecture', queries.architecture.diagnostics));
  }

  if (checks.has('runtime')) {
    const { verifyRuntimeReachability } = await import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-runtime-reachability.mjs')).href}?governance=1`
    );
    queries.runtime = await verifyRuntimeReachability(root, { architecture });
    values.push(...findings('runtime', queries.runtime.diagnostics));
  }

  if (checks.has('metadata')) {
    const { inspectPackageMetadata } = await import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-package-metadata.mjs')).href}?governance=1`
    );
    queries.metadata = await inspectPackageMetadata(root, { architecture });
    values.push(...findings('metadata', queries.metadata.diagnostics));
  }

  let release = null;
  const exceptionsNeedRelease = checks.has('exceptions') && existsSync(join(root, 'scripts', 'release', 'policy.mjs'));
  if (checks.has('release') || checks.has('product') || exceptionsNeedRelease) {
    try {
      queries.release = releaseModel(root, { architecture });
      release = queries.release.plan;
    } catch (error) {
      if (error instanceof ReleaseGovernanceError) {
        values.push(...findings('release', error.diagnostics));
      } else if (!(error instanceof DependencyCycleError)) {
        throw error;
      }
    }
  }

  if (checks.has('product')) {
    const { inspectProductCatalog } = await import(
      `${pathToFileURL(join(DEFAULT_ROOT, '.github', 'scripts', 'verify-product-catalog.mjs')).href}?governance=1`
    );
    queries.product = await inspectProductCatalog(root, { architecture, release: queries.release });
    const productProblems = [
      ...queries.product.membershipProblems,
      ...queries.product.facadeProblems,
      ...queries.product.generatedProblems,
      ...queries.product.consumerProblems,
    ].map(
      problem =>
        `[PRODUCT_CATALOG_INVALID] product catalog: ${problem}. Remediation: restore the canonical catalog projection.`,
    );
    values.push(...findings('product', productProblems));
  }

  if (checks.has('exceptions')) {
    queries.exceptions = await inspectGovernanceExceptions({
      root,
      architecture,
      release: queries.release,
      packageGraph,
      issues,
      requireOwnerStates: input.requireExceptionOwnerStates ?? input.relationships !== undefined,
    });
    for (const [source, report] of Object.entries(queries.exceptions.reports)) {
      values.push(...report.findings.map(value => exceptionFinding(source, value)));
      values.push(...report.diagnostics.map(exceptionDiagnosticFinding));
    }
  }

  const readonlyQueries = deepReadonly(queries);
  return Object.freeze({
    root,
    architecture,
    packages: architecture.packages,
    packageGraph,
    release,
    exceptions: GOVERNANCE_EXCEPTIONS,
    issues,
    findings: sortedFindings(values),
    queries: readonlyQueries,
  });
}

export function renderGovernanceReport(snapshot) {
  const lines = ['governance architecture report v1'];
  for (const packageRecord of [...snapshot.packages].toSorted((left, right) => compareText(left.id, right.id))) {
    const dependencies = snapshot.packageGraph.get(packageRecord.id) ?? [];
    lines.push(
      `package ${packageRecord.id} ${packageRecord.npmName} ring=${String(packageRecord.policy.ring)} dependencies=${dependencies.length === 0 ? '-' : dependencies.join(',')}`,
    );
  }
  lines.push(`findings ${String(snapshot.findings.length)}`);
  return `${lines.join('\n')}\n`;
}

function inventoryPath(root, group, path) {
  return group.externalRoot === undefined ? join(root, path) : join(dirname(group.externalRoot), path);
}

const COMMAND_ENTRYPOINTS = Object.freeze({
  'verify:architecture-zones': 'verify-architecture-zones.mjs',
  'verify:build-budget': 'verify-build-budget.mjs',
  'verify:devtools-boundary': 'verify-devtools-boundary.mjs',
  'verify:docs-generated': 'verify-docs-generated.mjs',
  'verify:exports': 'verify-exports.mjs',
  'verify:package-metadata': 'verify-package-metadata.mjs',
  'verify:product-catalog': 'verify-product-catalog.mjs',
  'verify:publish': 'verify-publish.mjs',
  'verify:release-governance': 'verify-release-governance.mjs',
  'verify:runtime-reachability': 'verify-runtime-reachability.mjs',
});

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function queryProjection(domain, query) {
  if (domain === 'exceptions') {
    return {
      inventory: query.inventory,
      reports: Object.fromEntries(
        Object.entries(query.reports).map(([source, report]) => [
          source,
          {
            diagnostics: report.diagnostics,
            findings: report.findings.map(item => ({
              id: item.id,
              count: item.count,
              disposition: item.disposition,
              exceptionId: item.exceptionId,
            })),
          },
        ]),
      ),
    };
  }
  if (domain === 'architecture') {
    return {
      dependencyGraph: query.dependencyGraph,
      diagnostics: query.diagnostics,
    };
  }
  if (domain === 'runtime') {
    return {
      diagnostics: query.diagnostics,
      entriesChecked: query.entriesChecked,
      packagesChecked: query.packagesChecked,
    };
  }
  if (domain === 'metadata') {
    return {
      diagnostics: query.diagnostics,
      packageCount: query.packageCount,
      version: query.version,
    };
  }
  if (domain === 'product') {
    return {
      consumerProblems: query.consumerProblems,
      facadeProblems: query.facadeProblems,
      generatedProblems: query.generatedProblems,
      integrationBytes: query.integrationBytes,
      manifestIdentities: [...query.manifests.entries()].map(([directory, entry]) => [directory, entry.manifest.name]),
      membershipProblems: query.membershipProblems,
      packageReferenceBytes: query.packageReferenceBytes,
      rows: query.rows.map(row => [row.id, row.directory, row.npmName]),
    };
  }
  if (domain === 'release') {
    return {
      entries: query.entries.map(entry => [entry.id, entry.directory, entry.npmName]),
      plan: query.plan,
    };
  }
  throw new TypeError(`unknown governance query domain ${domain}`);
}

function consumerSources(root, inventory) {
  const paths = new Set(['.github/scripts/lib/import-graph.mjs', 'scripts/architecture/governance.mjs']);
  for (const group of inventory.groups) {
    if (group.externalRoot !== undefined) continue;
    for (const path of group.paths) {
      const absolute = join(root, path);
      if (existsSync(absolute) && statSync(absolute).isFile() && /\.(?:[cm]?[jt]s|mts)$/.test(path)) {
        paths.add(path);
      }
    }
  }
  return [...paths].toSorted(compareText);
}

function migrationProblems(root, inventory) {
  const problems = [];
  const directModelTests = new Set([
    'packages/zmdb/src/architecture-governance.spec.ts',
    'scripts/architecture/governance.mjs',
    'scripts/architecture/index.mjs',
  ]);
  for (const path of consumerSources(root, inventory)) {
    const source = readFileSync(join(root, path), 'utf8');
    if (!directModelTests.has(path) && /\bloadArchitecture(?:Sync)?\s*\(/.test(source)) {
      problems.push(`${path}: consumer still calls the pre-snapshot architecture loader`);
    }
    if (
      !directModelTests.has(path) &&
      /from\s+['"][^'"]*scripts\/(?:architecture\/policy|product\/catalog)\.mjs['"]/.test(source)
    ) {
      problems.push(`${path}: consumer still imports catalog or policy authority directly`);
    }
    for (const match of source.matchAll(/\bcreateImportGraph\(([^()\n]*)\)/g)) {
      if (!(match[1] ?? '').includes(',')) {
        problems.push(`${path}: createImportGraph call omitted snapshot package records`);
      }
    }
    if (
      path !== 'scripts/architecture/index.mjs' &&
      source.split('\n').some(line => /readdirSync\([^)]*(?:['"]packages['"]|packagesRoot|PACKAGES_DIR)/.test(line))
    ) {
      problems.push(`${path}: consumer still enumerates packages/*`);
    }
  }

  for (const path of ['.github/scripts/lib/publish-manifest.mjs', '.github/scripts/repoint-dist.mjs']) {
    if (/\breadFileSync\s*\(/.test(readFileSync(join(root, path), 'utf8'))) {
      problems.push(`${path}: release consumer still reloads a governed manifest`);
    }
  }
  return problems;
}

export async function verifyConsumerParity({ root, inventory }) {
  const problems = migrationProblems(root, inventory);
  for (const group of inventory.groups) {
    for (const path of group.paths) {
      if (!existsSync(inventoryPath(root, group, path))) problems.push(`${group.id}:${path} is missing`);
    }
  }

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const command of inventory.commands) {
    const script = manifest.scripts?.[command];
    if (typeof script !== 'string') {
      problems.push(`package script ${command} is missing`);
    } else if (!script.includes(COMMAND_ENTRYPOINTS[command])) {
      problems.push(`package script ${command} no longer invokes ${COMMAND_ENTRYPOINTS[command]}`);
    }
  }
  if (manifest.scripts?.['verify:governance'] !== 'node scripts/architecture/governance.mjs') {
    problems.push('package script verify:governance is missing or no longer invokes the aggregate');
  }

  const governanceSource = readFileSync(join(root, 'scripts', 'architecture', 'governance.mjs'), 'utf8');
  const governanceImports = governanceSource
    .split('\n')
    .filter(line => line.startsWith('import '))
    .join('\n');
  for (const forbidden of ['node:child_process', 'writeFileSync', 'api.github.com']) {
    if (governanceImports.includes(forbidden)) {
      problems.push(`governance loader contains forbidden side effect ${forbidden}`);
    }
  }

  const snapshot = await loadGovernanceSnapshot({ root });
  if (snapshot.architecture === null) {
    problems.push('aggregate governance snapshot has no architecture');
    return Object.freeze({
      problems: freezeArray(problems.toSorted(compareText)),
      generatedOutputs: freezeArray(inventory.generatedOutputs),
      queryDomains: Object.freeze([]),
    });
  }
  if (!Object.isFrozen(snapshot.packageGraph) || Reflect.has(snapshot.packageGraph, 'set')) {
    problems.push('aggregate governance package graph is mutable');
  }
  if (!Object.isFrozen(snapshot.exceptions) || snapshot.exceptions !== GOVERNANCE_EXCEPTIONS) {
    problems.push('aggregate governance exception registry is mutable or detached from its authority');
  }
  if (Object.values(snapshot.queries).some(query => !Object.isFrozen(query))) {
    problems.push('aggregate governance query result is mutable');
  }
  const productManifests = snapshot.queries.product?.manifests;
  if (productManifests === undefined || !Object.isFrozen(productManifests) || Reflect.has(productManifests, 'set')) {
    problems.push('aggregate governance product manifest inventory is mutable or missing');
  }

  const [architectureModule, metadataModule, productModule, runtimeModule] = await Promise.all([
    import(`${pathToFileURL(join(root, '.github', 'scripts', 'verify-architecture-zones.mjs')).href}?parity=1`),
    import(`${pathToFileURL(join(root, '.github', 'scripts', 'verify-package-metadata.mjs')).href}?parity=1`),
    import(`${pathToFileURL(join(root, '.github', 'scripts', 'verify-product-catalog.mjs')).href}?parity=1`),
    import(`${pathToFileURL(join(root, '.github', 'scripts', 'verify-runtime-reachability.mjs')).href}?parity=1`),
  ]);
  const focused = {
    architecture: await architectureModule.inspectArchitectureZones(root, { architecture: snapshot.architecture }),
    exceptions: await inspectGovernanceExceptions({
      root,
      architecture: snapshot.architecture,
      release: snapshot.queries.release,
      packageGraph: snapshot.packageGraph,
      issues: snapshot.issues,
      requireOwnerStates: false,
    }),
    metadata: await metadataModule.inspectPackageMetadata(root, { architecture: snapshot.architecture }),
    product: await productModule.inspectProductCatalog(root, {
      architecture: snapshot.architecture,
      release: snapshot.queries.release,
    }),
    release: releaseModel(root, { architecture: snapshot.architecture }),
    runtime: await runtimeModule.verifyRuntimeReachability(root, { architecture: snapshot.architecture }),
  };
  const queryDomains = Object.keys(focused).toSorted(compareText);
  for (const domain of queryDomains) {
    const aggregate = snapshot.queries[domain];
    if (aggregate === undefined) {
      problems.push(`aggregate governance snapshot omitted ${domain} query`);
      continue;
    }
    if (!sameValue(queryProjection(domain, aggregate), queryProjection(domain, focused[domain]))) {
      problems.push(`${domain} focused query disagrees with the aggregate snapshot`);
    }
  }

  const { checkGeneratedDocumentation } = await import(
    `${pathToFileURL(join(root, 'docs-site', 'generated.mjs')).href}?governance=1`
  );
  const generated = checkGeneratedDocumentation(root, {
    architecture: snapshot.architecture,
    release: snapshot.queries.release,
  });
  problems.push(...generated.problems.map(problem => `generated:${problem}`));

  return Object.freeze({
    problems: freezeArray(problems.toSorted(compareText)),
    generatedOutputs: freezeArray(inventory.generatedOutputs),
    queryDomains: freezeArray(queryDomains),
  });
}

function parseArguments(argv) {
  let root = DEFAULT_ROOT;
  let json = false;
  let relationships;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined) throw new TypeError('--root requires a path');
      root = resolve(value);
    } else if (argument === '--relationships') {
      const value = argv[++index];
      if (value === undefined) throw new TypeError('--relationships requires a path');
      relationships = resolve(value);
    } else if (argument === '--json') {
      json = true;
    } else {
      throw new TypeError(
        'usage: node scripts/architecture/governance.mjs [--root <path>] [--relationships <path>] [--json]',
      );
    }
  }
  return { root, json, relationships };
}

async function main(argv) {
  const options = parseArguments(argv);
  const relationships =
    options.relationships === undefined ? undefined : readGovernanceRelationshipSnapshot(options.relationships);
  const snapshot = await loadGovernanceSnapshot({
    root: options.root,
    relationships,
    requireExceptionOwnerStates: true,
  });
  const activeFindings = snapshot.findings.filter(item => item.disposition === 'active');
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          packages: snapshot.packages.length,
          findings: snapshot.findings,
          release: snapshot.release,
        },
        undefined,
        2,
      ),
    );
  } else if (activeFindings.length === 0) {
    const edgeCount = [...snapshot.packageGraph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0);
    console.log(
      `governance: ${String(snapshot.packages.length)} packages, ${String(edgeCount)} policy edges, and ${String(snapshot.release?.publishOrder.length ?? 0)} release steps verified.`,
    );
  } else {
    for (const item of activeFindings) console.error(item.line);
  }
  return activeFindings.length === 0 ? 0 : 1;
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  void main(process.argv.slice(2))
    .then(status => {
      process.exitCode = status;
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
