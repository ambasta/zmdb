// Read package identities and manifests for documentation, build and publication.
// Dependency order comes from the manifest dependency fields.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

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

export class DependencyCycleError extends Error {
  constructor(cycle) {
    super(`workspace dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'DependencyCycleError';
    this.cycle = freezeArray(cycle);
  }
}

function architectureFromModules(resolvedRoot, catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('scripts/product/catalog.mjs must export PRODUCT_CATALOG');

  for (const [index, row] of catalog.entries()) assertCatalogIdentity(row, index);
  for (const field of ['id', 'directory', 'npmName']) assertUniqueCatalogIdentity(catalog, field);

  const packagesRoot = resolveInside(resolvedRoot, 'packages', 'workspace packages');
  const workspacePackages = Object.freeze(
    readdirSync(packagesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .toSorted((left, right) => compareText(left.name, right.name))
      .flatMap(entry => {
        const directory = `packages/${entry.name}`;
        const directoryPath = resolveInside(resolvedRoot, directory, `workspace directory ${directory}`);
        const manifestPath = resolveInside(directoryPath, 'package.json', `${directory} manifest`);
        if (!existsSync(manifestPath)) return [];
        const manifest = deepFreeze(JSON.parse(readFileSync(manifestPath, 'utf8')));
        if (!isRecord(manifest)) throw new TypeError(`${directory}/package.json must contain an object`);
        return [Object.freeze({ directory, directoryPath, manifestPath, manifest })];
      }),
  );
  const workspaceByDirectory = new Map(workspacePackages.map(record => [record.directory, record]));
  const packages = catalog.map(row => {
    const workspace = workspaceByDirectory.get(row.directory);
    if (workspace === undefined) {
      throw new TypeError(`catalog package ${row.id} has no manifest at ${row.directory}/package.json`);
    }

    const packageRecord = Object.freeze({
      id: row.id,
      directory: row.directory,
      directoryPath: workspace.directoryPath,
      npmName: row.npmName,
      manifestPath: workspace.manifestPath,
      catalog: row,
      manifest: workspace.manifest,
    });
    return packageRecord;
  });

  return Object.freeze({
    root: resolvedRoot,
    catalog,
    packages: Object.freeze(packages),
    workspacePackages,
  });
}

export async function loadArchitecture(root) {
  const resolvedRoot = resolve(root);
  const catalog = await moduleExport(resolvedRoot, 'scripts/product/catalog.mjs', 'PRODUCT_CATALOG');
  return architectureFromModules(resolvedRoot, catalog);
}

export function loadArchitectureSync(root) {
  const resolvedRoot = resolve(root);
  const catalog = moduleExportSync(resolvedRoot, 'scripts/product/catalog.mjs', 'PRODUCT_CATALOG');
  return architectureFromModules(resolvedRoot, catalog);
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
  const byName = new Map(architecture.packages.map(record => [record.npmName, record.id]));
  return Object.freeze(
    Object.fromEntries(
      architecture.packages.map(record => [
        record.id,
        freezeArray(
          [
            ...new Set(
              ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap(field =>
                Object.keys(record.manifest[field] ?? {}).flatMap(name => {
                  const id = byName.get(name);
                  return id === undefined ? [] : [id];
                }),
              ),
            ),
          ].toSorted(compareText),
        ),
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
