#!/usr/bin/env node
// Pure, read-only verification of the canonical product catalog implemented by
// issue #622. Release order and mutation remain deliberately outside this file.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  compareGeneratedRegion,
  renderIntegrationRows,
  renderPackageReferenceRows,
  verifyIntegrationRecords,
} from '../../docs-site/generated.mjs';
import { readFacadeOwnership } from './verify-product-facade.mjs';

export { compareGeneratedRegion, renderIntegrationRows, renderPackageReferenceRows, verifyIntegrationRecords };

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CATALOG_FIELDS = ['consumer', 'directory', 'docsOwner', 'facade', 'id', 'npmName', 'optionality', 'role'];
const MUTATION_FIELDS = new Set([
  'changelog',
  'credentials',
  'distTag',
  'npmTag',
  'publish',
  'publishOrder',
  'releaseNotes',
  'tag',
  'version',
]);
const PACKAGE_REFERENCE_START = '<!-- generated: product-catalog package-reference -->';
const PACKAGE_REFERENCE_END = '<!-- /generated: product-catalog package-reference -->';
const INTEGRATION_START = '<!-- generated: integrations framework-integrations -->';
const INTEGRATION_END = '<!-- /generated: integrations framework-integrations -->';

async function loadLiveCatalog(_root, architecture) {
  if (architecture === undefined) {
    throw new TypeError('inspectProductCatalog requires architecture from loadGovernanceSnapshot({ root })');
  }
  return { rows: architecture.catalog, problems: [] };
}

function manifestInventory(architecture) {
  return new Map(
    architecture.workspacePackages.map(packageRecord => [
      packageRecord.directory,
      {
        directory: packageRecord.directory,
        path: packageRecord.manifestPath,
        manifest: packageRecord.manifest,
      },
    ]),
  );
}

function deeplyFrozen(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(child => deeplyFrozen(child, seen));
}

function pageSlugs(namespace) {
  const pages = namespace.PAGE_META;
  return typeof pages === 'object' && pages !== null ? new Set(Object.keys(pages)) : new Set();
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].toSorted();
}

function objectKeys(value) {
  return typeof value === 'object' && value !== null ? Object.keys(value).toSorted() : [];
}

function sameKeys(value, expected) {
  return JSON.stringify(objectKeys(value)) === JSON.stringify(expected);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function workspaceProductionClosure(rows, manifests, rootName) {
  const byName = new Map(
    rows.flatMap(row => {
      const entry = manifests.get(row.directory);
      return entry === undefined ? [] : [[row.npmName, entry.manifest]];
    }),
  );
  const closure = new Set();
  const queue = [rootName];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || closure.has(name)) continue;
    const manifest = byName.get(name);
    if (manifest === undefined) continue;
    closure.add(name);
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }).toSorted()) {
      if (byName.has(dependency)) queue.push(dependency);
    }
  }
  return closure;
}

export function catalogFacadeOwnership(rows) {
  return {
    root: rows
      .flatMap(row => (row.facade?.root ?? []).map(name => ({ name, owner: row.npmName })))
      .toSorted((left, right) => `${left.name}\u0000${left.owner}`.localeCompare(`${right.name}\u0000${right.owner}`)),
    subpaths: rows
      .flatMap(row => (row.facade?.subpaths ?? []).map(name => ({ name, owner: row.npmName })))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export function verifyFacadeOwnership(rows, surface) {
  const problems = [];
  const packages = new Map(rows.map(row => [row.npmName, row]));
  const visibleRoot = new Map();
  const visibleSubpaths = new Map();

  for (const row of rows) {
    for (const name of row.facade?.root ?? []) {
      const owners = visibleRoot.get(name) ?? [];
      owners.push(row.npmName);
      visibleRoot.set(name, owners);
    }
    for (const name of row.facade?.subpaths ?? []) {
      const owners = visibleSubpaths.get(name) ?? [];
      owners.push(row.npmName);
      visibleSubpaths.set(name, owners);
    }
  }

  for (const item of surface.root) {
    const owner = item.owner === undefined ? undefined : packages.get(item.owner);
    if (owner === undefined) {
      problems.push(`facade root export ${item.name} owner ${item.owner} is absent from the catalog`);
    } else if (!(owner.facade?.root ?? []).includes(item.name)) {
      problems.push(`facade root export ${item.name} is absent from ${item.owner} catalog visibility`);
    }
  }
  for (const item of surface.subpaths) {
    const owners = visibleSubpaths.get(item.name) ?? [];
    const owner = item.owner === undefined ? undefined : packages.get(item.owner);
    if (item.owner === undefined && owners.length === 0) {
      problems.push(`facade subpath ${item.name} has no catalog owner`);
    } else if (item.owner !== undefined && owner === undefined) {
      problems.push(`facade subpath ${item.name} owner ${item.owner} is absent from the catalog`);
    } else if (item.owner !== undefined && !(owner?.facade?.subpaths ?? []).includes(item.name)) {
      problems.push(`facade subpath ${item.name} is absent from ${item.owner} catalog visibility`);
    }
  }

  for (const [name, owners] of visibleRoot) {
    if (owners.length !== 1) problems.push(`catalog root visibility ${name} has ${String(owners.length)} owners`);
    if (!surface.root.some(item => item.name === name && owners.includes(item.owner))) {
      problems.push(`catalog root visibility ${name} is absent from the facade`);
    }
  }
  for (const [name, owners] of visibleSubpaths) {
    if (owners.length !== 1) problems.push(`catalog subpath visibility ${name} has ${String(owners.length)} owners`);
    if (
      !surface.subpaths.some(item => item.name === name && (item.owner === undefined || owners.includes(item.owner)))
    ) {
      problems.push(`catalog subpath visibility ${name} is absent from the facade`);
    }
  }
  return problems.toSorted();
}

export function verifyFacadeDelegation(root, rows, architecture) {
  const problems = [];
  const manifest = architecture.packages.find(packageRecord => packageRecord.id === 'zmdb')?.manifest;
  if (manifest === undefined) return ['governance snapshot omitted the zmdb facade'];
  const owners = new Map(catalogFacadeOwnership(rows).subpaths.map(item => [item.name, item.owner]));

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath === '.') continue;
    const name = `zmdb${subpath.slice(1)}`;
    const owner = owners.get(name);
    if (owner === undefined || owner === 'zmdb') continue;
    if (typeof target !== 'string') {
      problems.push(`facade subpath ${name} has a conditional target and cannot prove owner ${owner}`);
      continue;
    }
    const source = readFileSync(join(root, 'packages', 'zmdb', target), 'utf8');
    const delegates = sourceSpecifiers(source).map(packageName);
    if (!delegates.includes(owner)) {
      problems.push(`facade subpath ${name} does not delegate to catalog owner ${owner}`);
    }
  }
  return problems.toSorted();
}

export function verifyProductCatalogRows(rows, manifests, pages) {
  const problems = [];
  const identities = {
    id: [],
    directory: [],
    npmName: [],
    role: [],
    root: [],
    subpath: [],
  };

  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'object' || row === null) {
      problems.push(`catalog row ${String(index)} is not an object`);
      continue;
    }
    const fields = Object.keys(row).toSorted();
    if (JSON.stringify(fields) !== JSON.stringify(CATALOG_FIELDS)) {
      problems.push(`catalog row ${String(index)} fields differ: ${fields.join(', ')}`);
    }
    for (const field of fields) {
      if (MUTATION_FIELDS.has(field)) problems.push(`catalog row ${String(index)} contains release field ${field}`);
    }
    for (const field of ['id', 'directory', 'npmName', 'role', 'docsOwner']) {
      if (typeof row[field] !== 'string' || row[field].length === 0) {
        problems.push(`catalog row ${String(index)} has invalid ${field}`);
      }
    }
    if (typeof row.directory === 'string' && !/^packages\/[^/]+$/.test(row.directory)) {
      problems.push(`catalog row ${String(index)} has invalid directory ${row.directory}`);
    }
    if (!sameKeys(row.facade, ['root', 'subpaths'])) {
      problems.push(`catalog package ${row.npmName} has invalid facade fields`);
    }
    const rootNames = row.facade?.root;
    const subpaths = row.facade?.subpaths;
    if (!Array.isArray(rootNames) || rootNames.some(name => typeof name !== 'string' || name.length === 0)) {
      problems.push(`catalog package ${row.npmName} has invalid root facade visibility`);
    }
    if (!Array.isArray(subpaths) || subpaths.some(name => typeof name !== 'string' || !name.startsWith('zmdb/'))) {
      problems.push(`catalog package ${row.npmName} has invalid subpath facade visibility`);
    }
    identities.id.push(row.id);
    identities.directory.push(row.directory);
    identities.npmName.push(row.npmName);
    identities.role.push(row.role);
    identities.root.push(...(row.facade?.root ?? []));
    identities.subpath.push(...(row.facade?.subpaths ?? []));

    const entry = manifests.get(row.directory);
    if (entry === undefined) {
      problems.push(`catalog package directory ${row.directory} has no manifest`);
    } else if (entry.manifest.name !== row.npmName) {
      problems.push(`catalog ${row.directory} names ${row.npmName}, manifest names ${String(entry.manifest.name)}`);
    }
    if (!pages.has(row.docsOwner)) {
      problems.push(`catalog package ${row.npmName} docs owner ${row.docsOwner} is absent from the page registry`);
    }
    const optionality = row.optionality;
    if (
      !((optionality?.kind === 'required' || optionality?.kind === 'tooling') && sameKeys(optionality, ['kind'])) &&
      !(
        optionality?.kind === 'integration' &&
        nonEmptyString(optionality.technology) &&
        sameKeys(optionality, ['kind', 'technology'])
      ) &&
      !(
        optionality?.kind === 'capability' &&
        nonEmptyString(optionality.capability) &&
        sameKeys(optionality, ['capability', 'kind'])
      ) &&
      !(
        optionality?.kind === 'provider' &&
        nonEmptyString(optionality.capability) &&
        nonEmptyString(optionality.capabilityOwner) &&
        nonEmptyString(optionality.technology) &&
        typeof optionality.includedInDefault === 'boolean' &&
        sameKeys(optionality, ['capability', 'capabilityOwner', 'includedInDefault', 'kind', 'technology'])
      )
    ) {
      problems.push(`catalog package ${row.npmName} has invalid optionality`);
    }
    const consumer = row.consumer;
    if (
      !(
        typeof consumer?.fixture === 'string' &&
        consumer.fixture.startsWith('fixtures/') &&
        sameKeys(consumer, ['fixture'])
      ) &&
      !(typeof consumer?.reason === 'string' && consumer.reason.trim().length > 0 && sameKeys(consumer, ['reason']))
    ) {
      problems.push(`catalog package ${row.npmName} has invalid consumer ownership`);
    }
  }

  for (const [kind, values] of Object.entries(identities)) {
    for (const duplicate of duplicates(values)) problems.push(`duplicate catalog ${kind} ${duplicate}`);
  }
  for (const directory of manifests.keys()) {
    if (!rows.some(row => row.directory === directory)) {
      problems.push(`official package manifest ${directory}/package.json has no catalog row`);
    }
  }
  const ids = rows.map(row => row.id);
  if (JSON.stringify(ids) !== JSON.stringify([...ids].toSorted())) {
    problems.push('catalog ids are not in deterministic alphabetical order');
  }

  const byId = new Map(rows.map(row => [row.id, row]));
  const providerOwners = new Map();
  for (const row of rows) {
    const optionality = row.optionality;
    if (optionality?.kind === 'capability' && optionality.capability !== row.id) {
      problems.push(
        `catalog capability ${row.id} names capability ${optionality.capability}; the stable capability id must match`,
      );
    }
    if (optionality?.kind !== 'provider') continue;
    const owner = byId.get(optionality.capabilityOwner);
    const ownerMatches =
      owner?.optionality?.kind === 'required' ||
      (owner?.optionality?.kind === 'capability' && owner.optionality.capability === optionality.capability);
    if (!ownerMatches) {
      problems.push(
        `catalog provider ${row.id} names invalid capability owner ${optionality.capabilityOwner} for ${optionality.capability}`,
      );
    }
    if (optionality.includedInDefault && owner?.optionality?.kind !== 'required') {
      problems.push(
        `catalog provider ${row.id} cannot be included by non-required owner ${optionality.capabilityOwner}`,
      );
    }
    const previousOwner = providerOwners.get(optionality.capability);
    if (previousOwner !== undefined && previousOwner !== optionality.capabilityOwner) {
      problems.push(
        `catalog providers for ${optionality.capability} disagree on owners ${previousOwner} and ${optionality.capabilityOwner}`,
      );
    }
    providerOwners.set(optionality.capability, optionality.capabilityOwner);
  }

  const defaultClosure = workspaceProductionClosure(rows, manifests, 'zmdb');
  for (const row of rows) {
    if (row.optionality?.kind === 'capability' && defaultClosure.has(row.npmName)) {
      problems.push(`catalog capability ${row.id} is reachable from the installed zmdb production closure`);
    }
    if (row.optionality?.kind === 'provider' && row.optionality.includedInDefault !== defaultClosure.has(row.npmName)) {
      problems.push(
        `catalog provider ${row.id} includedInDefault ${String(row.optionality.includedInDefault)} disagrees with installed zmdb production closure ${String(defaultClosure.has(row.npmName))}`,
      );
    }
    if (
      (row.optionality?.kind === 'capability' || row.optionality?.kind === 'provider') &&
      row.optionality.capability === 'jobs' &&
      ((row.facade?.root ?? []).length > 0 || (row.facade?.subpaths ?? []).some(name => name.startsWith('zmdb/jobs')))
    ) {
      problems.push(`catalog jobs package ${row.id} has forbidden zmdb facade exposure`);
    }
  }

  for (const owner of rows.filter(row => row.optionality?.kind === 'capability')) {
    const ownerClosure = workspaceProductionClosure(rows, manifests, owner.npmName);
    const leakedProviders = rows
      .filter(
        row =>
          row.optionality?.kind === 'provider' &&
          row.optionality.capabilityOwner === owner.id &&
          ownerClosure.has(row.npmName),
      )
      .map(row => row.npmName)
      .toSorted();
    if (leakedProviders.length > 0) {
      problems.push(`catalog capability ${owner.id} reaches providers ${leakedProviders.join(', ')}`);
    }
  }

  if (!deeplyFrozen(rows)) problems.push('product catalog export is not deeply frozen');
  return problems.toSorted();
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function packageName(specifier) {
  const match = /^(@[^/]+\/[^/]+|[^@./][^/]*)(?:\/|$)/.exec(specifier);
  return match?.[1];
}

function sourceSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/(?:export|import)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  return specifiers.filter(specifier => specifier !== undefined);
}

function fixtureImports(root, fixture) {
  const directory = join(root, fixture);
  const imports = new Set();
  const manifestPath = join(directory, 'package.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(manifest[field] ?? {})) imports.add(name);
    }
  }
  for (const path of filesUnder(directory)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const source = readFileSync(path, 'utf8');
    for (const specifier of sourceSpecifiers(source)) {
      const name = packageName(specifier);
      if (name !== undefined) imports.add(name);
    }
  }
  return [...imports].toSorted();
}

export function discoverCatalogConsumers(root, rows) {
  const problems = [];
  const assignments = [];
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = rootManifest.scripts ?? {};
  for (const row of rows) {
    if (typeof row.consumer?.fixture === 'string') {
      const fixture = join(root, row.consumer.fixture);
      if (!existsSync(fixture)) {
        problems.push(`catalog package ${row.npmName} fixture ${row.consumer.fixture} does not exist`);
        continue;
      }
      const imports = fixtureImports(root, row.consumer.fixture);
      if (!imports.includes(row.npmName)) {
        problems.push(
          `catalog package ${row.npmName} fixture ${row.consumer.fixture} does not import or declare its public package`,
        );
      }
      assignments.push({ npmName: row.npmName, fixture: row.consumer.fixture, imports });
    } else if (typeof row.consumer?.reason !== 'string' || row.consumer.reason.trim().length === 0) {
      problems.push(`catalog package ${row.npmName} has neither an external fixture nor an explicit reason`);
    } else {
      const gates = [...row.consumer.reason.matchAll(/\bverify:[\w-]+\b/g)].map(match => match[0]).toSorted();
      if (gates.length === 0) {
        problems.push(`catalog package ${row.npmName} reason names no machine-checkable verify script`);
      }
      for (const gate of gates) {
        if (typeof scripts[gate] !== 'string') {
          problems.push(`catalog package ${row.npmName} reason names missing script ${gate}`);
        }
      }
      assignments.push({ npmName: row.npmName, reason: row.consumer.reason, gates });
    }
  }
  return { assignments, problems: problems.toSorted() };
}

function withoutGeneratedRegions(source) {
  return source.replace(
    /<!-- generated: [^>]+ -->[\s\S]*?<!-- \/generated: [^>]+ -->/g,
    '<!-- generated content omitted -->',
  );
}

function markdownTables(source) {
  const tables = [];
  let current = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('|')) {
      current.push(line);
    } else if (current.length > 0) {
      tables.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) tables.push(current.join('\n'));
  return tables;
}

export function handwrittenInventoryProblems(root, rows) {
  const problems = [];
  const names = rows.map(row => row.npmName);
  for (const path of [
    'README.md',
    'docs-site/content/framework-integrations.md',
    'docs-site/content/package-reference.md',
    'fixtures/README.md',
  ]) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const source = withoutGeneratedRegions(readFileSync(absolute, 'utf8'));
    for (const table of markdownTables(source)) {
      const present = names.filter(name => table.includes(name));
      if (present.length > 1) {
        problems.push(`${path} contains a handwritten table with ${String(present.length)} catalog packages`);
      }
    }
  }
  const packedVerifier = readFileSync(join(root, '.github', 'scripts', 'verify-product-facade.mjs'), 'utf8');
  if (/\bPACKAGES\b/.test(packedVerifier)) {
    problems.push('packed product consumer still reads a handwritten package inventory');
  }
  return problems.toSorted();
}

async function liveIntegrationRecords(root) {
  const path = join(root, 'docs-site', 'integrations.mjs');
  if (!existsSync(path)) {
    // #716 owns the authored framework-integration records and generator. Once
    // that module exists, this catalog gate validates every package claim.
    return { records: undefined, problems: [] };
  }
  const namespace = await import(`${pathToFileURL(path).href}?product-freeze=${String(Date.now())}`);
  const records = namespace.INTEGRATIONS ?? namespace.integrations ?? namespace.default;
  return Array.isArray(records)
    ? { records, problems: [] }
    : { records: undefined, problems: ['docs-site/integrations.mjs must export an integration record array'] };
}

export async function inspectProductCatalog(root = ROOT, options = {}) {
  const loaded = await loadLiveCatalog(root, options.architecture);
  if (loaded.rows === undefined) {
    const missing = [...loaded.problems];
    return {
      rows: [],
      manifests: manifestInventory(options.architecture),
      membershipProblems: missing,
      facadeProblems: missing,
      generatedProblems: missing,
      consumerProblems: missing,
      packageReferenceBytes: '',
      integrationBytes: '',
    };
  }

  const rows = loaded.rows;
  const manifests = manifestInventory(options.architecture);
  const pagesModule = await import(pathToFileURL(join(root, 'docs-site', 'pages.mjs')).href);
  const membershipProblems = verifyProductCatalogRows(rows, manifests, pageSlugs(pagesModule));
  const facadeProblems = [
    ...verifyFacadeOwnership(rows, readFacadeOwnership(root, options.architecture)),
    ...verifyFacadeDelegation(root, rows, options.architecture),
  ].toSorted();
  const consumers = discoverCatalogConsumers(root, rows);
  const packageReferenceBytes = renderPackageReferenceRows(rows, manifests);
  const packageReference = readFileSync(join(root, 'docs-site', 'content', 'package-reference.md'), 'utf8');
  const generatedProblems = compareGeneratedRegion(
    packageReference,
    PACKAGE_REFERENCE_START,
    PACKAGE_REFERENCE_END,
    packageReferenceBytes,
  );

  const integrations = await liveIntegrationRecords(root);
  let integrationBytes = '';
  generatedProblems.push(...integrations.problems);
  if (integrations.records !== undefined) {
    integrationBytes = renderIntegrationRows(integrations.records);
    generatedProblems.push(...verifyIntegrationRecords(rows, integrations.records));
    const integrationReference = readFileSync(join(root, 'docs-site', 'content', 'framework-integrations.md'), 'utf8');
    generatedProblems.push(
      ...compareGeneratedRegion(integrationReference, INTEGRATION_START, INTEGRATION_END, integrationBytes),
    );
  }
  generatedProblems.push(...handwrittenInventoryProblems(root, rows));

  return {
    rows,
    manifests,
    membershipProblems: membershipProblems.toSorted(),
    facadeProblems,
    generatedProblems: generatedProblems.toSorted(),
    consumerProblems: consumers.problems,
    packageReferenceBytes,
    integrationBytes,
  };
}

async function main() {
  const { loadGovernanceSnapshot } = await import('../../scripts/architecture/governance.mjs');
  const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: ['product'] });
  if (snapshot.findings.length > 0) {
    for (const item of snapshot.findings) console.error(item.line);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Product catalog verified: ${String(snapshot.packages.length)} packages, deterministic docs, facade ownership, and external consumers.`,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  await main();
}
