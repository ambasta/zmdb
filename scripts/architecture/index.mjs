// Read-only architecture discovery and graph operations.
//
// Product membership always comes from the catalog below the supplied root.
// Policy contributes constraints only; release versions, changelog content,
// tags, publication state, and mutation remain outside this module.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const POLICY_FIELDS = [
  'allowedRuntimeDependencies',
  'allowedWorkspaceDependencies',
  'directory',
  'optionalPeerEntries',
  'release',
  'ring',
  'toolingEntries',
  'zone',
];

const PACKAGE_ZONES = new Set(['foundation', 'runtime', 'integration', 'tooling', 'application', 'facade']);

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

const freezeArray = values => Object.freeze([...values]);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

function isDeeplyFrozen(value) {
  if (!Array.isArray(value) && !isRecord(value)) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].toSorted(compareText);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  const duplicates = duplicateValues(value);
  if (duplicates.length > 0) {
    throw new TypeError(`${label} contains duplicate values: ${duplicates.join(', ')}`);
  }
}

function assertSelectors(value, label) {
  assertStringArray(value, label);
  for (const selector of value) {
    const isExport = selector === '.' || (selector.startsWith('./') && !selector.includes('*'));
    const isBin = /^bin:[^/:]+$/.test(selector);
    if (!isExport && !isBin) {
      throw new TypeError(`${label} contains invalid entry selector ${selector}`);
    }
  }
  const sorted = [...value].toSorted(compareText);
  if (JSON.stringify(value) !== JSON.stringify(sorted)) {
    throw new TypeError(`${label} must be sorted`);
  }
}

function assertCatalogIdentity(row, index) {
  if (
    !isRecord(row) ||
    typeof row.id !== 'string' ||
    row.id.length === 0 ||
    typeof row.directory !== 'string' ||
    row.directory.length === 0 ||
    typeof row.npmName !== 'string' ||
    row.npmName.length === 0
  ) {
    throw new TypeError(`PRODUCT_CATALOG row ${String(index)} has an invalid identity`);
  }
}

function assertUniqueCatalogIdentity(catalog, field) {
  const duplicates = duplicateValues(catalog.map(row => row[field]));
  if (duplicates.length > 0) {
    throw new TypeError(`PRODUCT_CATALOG has duplicate ${field} values: ${duplicates.join(', ')}`);
  }
}

function assertPolicyRow(id, row) {
  if (!isRecord(row)) throw new TypeError(`PACKAGE_POLICY row ${id} must be an object`);
  const fields = Object.keys(row).toSorted(compareText);
  if (JSON.stringify(fields) !== JSON.stringify(POLICY_FIELDS)) {
    throw new TypeError(`PACKAGE_POLICY row ${id} must contain exactly ${POLICY_FIELDS.join(', ')}`);
  }
  if (typeof row.directory !== 'string' || row.directory.length === 0) {
    throw new TypeError(`PACKAGE_POLICY row ${id}.directory must be a non-empty string`);
  }
  if (!PACKAGE_ZONES.has(row.zone)) {
    throw new TypeError(`PACKAGE_POLICY row ${id}.zone is invalid`);
  }
  if (!Number.isSafeInteger(row.ring) || row.ring < 0) {
    throw new TypeError(`PACKAGE_POLICY row ${id}.ring must be a non-negative safe integer`);
  }
  assertStringArray(row.allowedWorkspaceDependencies, `PACKAGE_POLICY row ${id}.allowedWorkspaceDependencies`);
  assertStringArray(row.allowedRuntimeDependencies, `PACKAGE_POLICY row ${id}.allowedRuntimeDependencies`);
  if (!isRecord(row.optionalPeerEntries)) {
    throw new TypeError(`PACKAGE_POLICY row ${id}.optionalPeerEntries must be an object`);
  }
  for (const [dependency, selectors] of Object.entries(row.optionalPeerEntries)) {
    if (dependency.length === 0) throw new TypeError(`PACKAGE_POLICY row ${id} has an empty optional peer`);
    assertSelectors(selectors, `PACKAGE_POLICY row ${id}.optionalPeerEntries[${dependency}]`);
  }
  assertSelectors(row.toolingEntries, `PACKAGE_POLICY row ${id}.toolingEntries`);
  if (row.release !== 'lockstep') {
    throw new TypeError(`PACKAGE_POLICY row ${id}.release must be lockstep`);
  }
  if (!isDeeplyFrozen(row)) {
    throw new TypeError(`PACKAGE_POLICY row ${id} must be deeply frozen`);
  }
}

function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function resolveInside(root, path, label) {
  const resolved = resolve(root, path);
  if (!isInside(root, resolved)) throw new TypeError(`${label} escapes the supplied root`);
  return resolved;
}

async function moduleExport(root, path, name) {
  const modulePath = resolveInside(root, path, path);
  const namespace = await import(`${pathToFileURL(modulePath).href}?architecture-root=${encodeURIComponent(root)}`);
  return namespace[name];
}

function moduleExportSync(root, path, name) {
  const modulePath = resolveInside(root, path, path);
  return require(modulePath)[name];
}

function defaultBinName(npmName) {
  return npmName.split('/').at(-1);
}

function entryTarget(packageRecord, selector) {
  if (selector.startsWith('bin:')) {
    const command = selector.slice('bin:'.length);
    const { bin } = packageRecord.manifest;
    if (typeof bin === 'string') return defaultBinName(packageRecord.npmName) === command ? bin : undefined;
    if (!isRecord(bin)) return undefined;
    return typeof bin[command] === 'string' ? bin[command] : undefined;
  }

  const exportMap = packageRecord.manifest.exports;
  if (typeof exportMap === 'string') return selector === '.' ? exportMap : undefined;
  if (!isRecord(exportMap)) return undefined;
  return typeof exportMap[selector] === 'string' ? exportMap[selector] : undefined;
}

function assertPolicySelectorsResolve(packageRecord) {
  const assigned = new Set(packageRecord.policy.toolingEntries);
  for (const selectors of Object.values(packageRecord.policy.optionalPeerEntries)) {
    for (const selector of selectors) assigned.add(selector);
  }
  for (const selector of [...assigned].toSorted(compareText)) {
    if (entryTarget(packageRecord, selector) === undefined) {
      throw new TypeError(`${packageRecord.id} policy selector ${selector} is absent from its manifest`);
    }
  }
}

export class ArchitecturePolicyError extends Error {
  constructor(diagnostics) {
    super(diagnostics.join('\n'));
    this.name = 'ArchitecturePolicyError';
    this.diagnostics = freezeArray(diagnostics);
  }
}

export class DependencyCycleError extends Error {
  constructor(cycle) {
    super(`workspace dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'DependencyCycleError';
    this.cycle = freezeArray(cycle);
  }
}

export function policyMembershipDiagnostics(catalog, policy) {
  if (!Array.isArray(catalog)) throw new TypeError('catalog must be an array');
  if (!isRecord(policy)) throw new TypeError('policy must be an object');

  const diagnostics = [];
  const catalogById = new Map();
  for (const [index, row] of catalog.entries()) {
    assertCatalogIdentity(row, index);
    catalogById.set(row.id, row);
    if (!Object.hasOwn(policy, row.id)) {
      diagnostics.push(
        `[ARCH_POLICY_MISSING] ${row.id} (${row.npmName}): catalog package ${row.directory} has no PACKAGE_POLICY row. Remediation: add the row under that catalog id.`,
      );
      continue;
    }
    const policyRow = policy[row.id];
    if (isRecord(policyRow) && policyRow.directory !== row.directory) {
      diagnostics.push(
        `[ARCH_DIRECTORY_MISMATCH] ${row.id} (${row.npmName}): catalog directory ${row.directory} disagrees with policy directory ${String(policyRow.directory)}. Remediation: make all three equal to the real repository-relative directory.`,
      );
    }
  }

  for (const id of Object.keys(policy)) {
    if (!catalogById.has(id)) {
      diagnostics.push(
        `[ARCH_POLICY_STALE] ${id}: PACKAGE_POLICY row has no product-catalog member. Remediation: delete it or admit the package in the catalog in the same change.`,
      );
    }
  }

  return freezeArray(diagnostics.toSorted(compareText));
}

function architectureFromModules(resolvedRoot, catalog, policy) {
  if (!Array.isArray(catalog)) throw new TypeError('scripts/product/catalog.mjs must export PRODUCT_CATALOG');
  if (!isRecord(policy)) throw new TypeError('scripts/architecture/policy.mjs must export PACKAGE_POLICY');
  if (!isDeeplyFrozen(catalog)) throw new TypeError('PRODUCT_CATALOG must be deeply frozen');
  if (!isDeeplyFrozen(policy)) throw new TypeError('PACKAGE_POLICY must be deeply frozen');

  for (const [index, row] of catalog.entries()) assertCatalogIdentity(row, index);
  for (const field of ['id', 'directory', 'npmName']) assertUniqueCatalogIdentity(catalog, field);

  const diagnostics = policyMembershipDiagnostics(catalog, policy);
  if (diagnostics.length > 0) throw new ArchitecturePolicyError(diagnostics);

  for (const [id, row] of Object.entries(policy)) assertPolicyRow(id, row);

  const packages = catalog.map(row => {
    const directoryPath = resolveInside(resolvedRoot, row.directory, `catalog directory ${row.directory}`);
    const manifestPath = resolveInside(directoryPath, 'package.json', `${row.id} manifest`);
    const manifest = deepFreeze(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (!isRecord(manifest)) throw new TypeError(`${row.directory}/package.json must contain an object`);

    const packageRecord = Object.freeze({
      id: row.id,
      directory: row.directory,
      directoryPath,
      npmName: row.npmName,
      manifestPath,
      catalog: row,
      policy: policy[row.id],
      manifest,
    });
    assertPolicySelectorsResolve(packageRecord);
    return packageRecord;
  });

  return Object.freeze({
    root: resolvedRoot,
    catalog,
    policy,
    packages: Object.freeze(packages),
  });
}

export async function loadArchitecture(root) {
  const resolvedRoot = resolve(root);
  const catalog = await moduleExport(resolvedRoot, 'scripts/product/catalog.mjs', 'PRODUCT_CATALOG');
  const policy = await moduleExport(resolvedRoot, 'scripts/architecture/policy.mjs', 'PACKAGE_POLICY');
  return architectureFromModules(resolvedRoot, catalog, policy);
}

export function loadArchitectureSync(root) {
  const resolvedRoot = resolve(root);
  const catalog = moduleExportSync(resolvedRoot, 'scripts/product/catalog.mjs', 'PRODUCT_CATALOG');
  const policy = moduleExportSync(resolvedRoot, 'scripts/architecture/policy.mjs', 'PACKAGE_POLICY');
  return architectureFromModules(resolvedRoot, catalog, policy);
}

export function lookupPackage(architecture, identity) {
  if (!isRecord(architecture) || !Array.isArray(architecture.packages)) {
    throw new TypeError('architecture must be returned by loadArchitecture(root)');
  }
  return architecture.packages.find(
    packageRecord =>
      packageRecord.id === identity ||
      packageRecord.npmName === identity ||
      packageRecord.directory === identity ||
      packageRecord.directoryPath === identity,
  );
}

function packageSpecifierParts(specifier) {
  if (
    typeof specifier !== 'string' ||
    specifier.length === 0 ||
    specifier.startsWith('.') ||
    specifier.startsWith('/')
  ) {
    return undefined;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (parts.length < 2 || parts[0]?.length === 0 || parts[1]?.length === 0) return undefined;
    return {
      npmName: `${parts[0]}/${parts[1]}`,
      selector: parts.length === 2 ? '.' : `./${parts.slice(2).join('/')}`,
    };
  }
  if (parts[0]?.length === 0) return undefined;
  return {
    npmName: parts[0],
    selector: parts.length === 1 ? '.' : `./${parts.slice(1).join('/')}`,
  };
}

export function lookupExport(architecture, specifier) {
  const parts = packageSpecifierParts(specifier);
  if (parts === undefined) return undefined;
  const packageRecord = architecture.packages.find(candidate => candidate.npmName === parts.npmName);
  if (packageRecord === undefined) return undefined;
  const target = entryTarget(packageRecord, parts.selector);
  if (target === undefined) return undefined;
  const path = resolveInside(packageRecord.directoryPath, target, `${specifier} export target`);
  return Object.freeze({
    package: packageRecord,
    selector: parts.selector,
    target,
    path,
  });
}

export function createDependencyGraph(architecture) {
  if (!isRecord(architecture) || !Array.isArray(architecture.packages)) {
    throw new TypeError('architecture must be returned by loadArchitecture(root)');
  }
  return Object.freeze(
    Object.fromEntries(
      architecture.packages.map(packageRecord => [
        packageRecord.id,
        freezeArray(packageRecord.policy.allowedWorkspaceDependencies),
      ]),
    ),
  );
}

function insertSorted(values, value) {
  let index = 0;
  while (index < values.length && compareText(values[index], value) < 0) index++;
  values.splice(index, 0, value);
}

function shortestCycle(graph, ids) {
  let best;
  for (const start of ids) {
    const queue = [[start]];
    while (queue.length > 0) {
      const path = queue.shift();
      const current = path?.at(-1);
      if (current === undefined) continue;
      if (best !== undefined && path.length + 1 > best.length) continue;
      for (const dependency of [...graph[current]].toSorted(compareText)) {
        if (dependency === start) {
          const candidate = [...path, start];
          const candidateText = candidate.join('\u0000');
          const bestText = best?.join('\u0000');
          if (
            best === undefined ||
            candidate.length < best.length ||
            (candidate.length === best.length && bestText !== undefined && candidateText < bestText)
          ) {
            best = candidate;
          }
        } else if (!path.includes(dependency)) {
          queue.push([...path, dependency]);
        }
      }
    }
  }
  return best;
}

export function topologicalOrder(graph) {
  if (!isRecord(graph)) throw new TypeError('dependency graph must be an object');
  const ids = Object.keys(graph).toSorted(compareText);
  const idSet = new Set(ids);
  const remaining = new Map();
  const dependents = new Map(ids.map(id => [id, []]));

  for (const id of ids) {
    assertStringArray(graph[id], `dependency graph row ${id}`);
    for (const dependency of graph[id]) {
      if (!idSet.has(dependency)) {
        throw new TypeError(`dependency graph row ${id} references unknown package ${dependency}`);
      }
      dependents.get(dependency).push(id);
    }
    remaining.set(id, new Set(graph[id]));
  }

  const ready = ids.filter(id => remaining.get(id).size === 0);
  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const dependent of dependents.get(id).toSorted(compareText)) {
      const dependencies = remaining.get(dependent);
      dependencies.delete(id);
      if (dependencies.size === 0) insertSorted(ready, dependent);
    }
  }

  if (order.length !== ids.length) {
    const cycle = shortestCycle(graph, ids);
    if (cycle !== undefined) throw new DependencyCycleError(cycle);
    throw new Error('dependency graph cannot be topologically ordered');
  }

  return freezeArray(order);
}
