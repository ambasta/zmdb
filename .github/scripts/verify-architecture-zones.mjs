#!/usr/bin/env node
// Verify catalog-backed workspace ownership without inferring architecture from
// the current imports. Policy, manifests, and production import reachability
// remain three independent authorities and must agree exactly.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ArchitecturePolicyError,
  DependencyCycleError,
  loadArchitecture,
  lookupExport,
  topologicalOrder,
} from '../../scripts/architecture/index.mjs';
import { createImportGraph } from './lib/import-graph.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_EDGE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const ZONE_RANK = new Map([
  ['foundation', 0],
  ['runtime', 1],
  ['application', 2],
  ['integration', 3],
  ['tooling', 4],
  ['facade', 5],
]);

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function pathText(root, path) {
  return relative(root, path).split(sep).join('/');
}

function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function diagnostic(code, sortKey, subject, violation, remediation) {
  return {
    code,
    sortKey,
    line: `[${code}] ${subject}: ${violation}. Remediation: ${remediation}.`,
  };
}

function compareDiagnostics(left, right) {
  return `${left.code}\u0000${left.sortKey}\u0000${left.line}`.localeCompare(
    `${right.code}\u0000${right.sortKey}\u0000${right.line}`,
  );
}

function packageForSpecifier(architecture, specifier) {
  return architecture.packages.find(
    packageRecord => specifier === packageRecord.npmName || specifier.startsWith(`${packageRecord.npmName}/`),
  );
}

function packageForId(architecture, id) {
  return architecture.packages.find(packageRecord => packageRecord.id === id);
}

function packageForPath(architecture, path) {
  return architecture.packages.find(packageRecord => isInside(packageRecord.directoryPath, path));
}

function entryTargets(packageRecord) {
  const targets = [];
  const exports = packageRecord.manifest.exports;
  if (typeof exports === 'string') targets.push(exports);
  else if (isRecord(exports)) {
    for (const target of Object.values(exports)) {
      if (typeof target === 'string') targets.push(target);
    }
  }

  const bin = packageRecord.manifest.bin;
  if (typeof bin === 'string') targets.push(bin);
  else if (isRecord(bin)) {
    for (const target of Object.values(bin)) {
      if (typeof target === 'string') targets.push(target);
    }
  }

  return [...new Set(targets.map(target => resolve(packageRecord.directoryPath, target)))].toSorted();
}

function manifestWorkspaceEdges(architecture, packageRecord) {
  const edges = new Map();
  for (const field of MANIFEST_EDGE_FIELDS) {
    const dependencies = packageRecord.manifest[field];
    if (!isRecord(dependencies)) continue;
    for (const dependencyName of Object.keys(dependencies)) {
      const dependency = architecture.packages.find(candidate => candidate.npmName === dependencyName);
      if (dependency !== undefined) edges.set(dependency.id, dependency);
    }
  }
  return edges;
}

function addImport(imports, dependency, sourcePath, specifier) {
  const key = dependency.id;
  const references = imports.get(key) ?? [];
  references.push({ dependency, sourcePath, specifier });
  imports.set(key, references);
}

function addPrivateImport(privateImports, dependency, sourcePath, specifier) {
  privateImports.set(`${dependency?.id ?? ''}\u0000${sourcePath}\u0000${specifier}`, {
    dependency,
    sourcePath,
    specifier,
  });
}

function ownershipImports(root, architecture, packageRecord, graph) {
  const imports = new Map();
  const privateImports = new Map();
  const seen = new Set();
  const queue = entryTargets(packageRecord);

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !isInside(packageRecord.directoryPath, file)) continue;
    if (!existsSync(file)) continue;
    seen.add(file);

    const sourcePath = pathText(root, file);
    for (const reference of graph.importsOf(file, readFileSync(file, 'utf8'))) {
      if (reference.specifier.startsWith('.')) {
        if (reference.resolved === null || isInside(packageRecord.directoryPath, reference.resolved)) {
          if (reference.resolved !== null) queue.push(reference.resolved);
          continue;
        }
        const dependency = packageForPath(architecture, reference.resolved);
        if (dependency === undefined) {
          addPrivateImport(privateImports, undefined, sourcePath, reference.specifier);
          continue;
        }
        if (dependency.id === packageRecord.id) continue;
        addImport(imports, dependency, sourcePath, reference.specifier);
        addPrivateImport(privateImports, dependency, sourcePath, reference.specifier);
        continue;
      }

      const dependency = packageForSpecifier(architecture, reference.specifier);
      if (dependency === undefined) continue;
      if (dependency.id === packageRecord.id) {
        if (reference.resolved !== null) queue.push(reference.resolved);
        continue;
      }

      addImport(imports, dependency, sourcePath, reference.specifier);
      if (lookupExport(architecture, reference.specifier) === undefined) {
        addPrivateImport(privateImports, dependency, sourcePath, reference.specifier);
      }
    }
  }

  for (const references of imports.values()) {
    references.sort((left, right) =>
      `${left.sourcePath}\u0000${left.specifier}`.localeCompare(`${right.sourcePath}\u0000${right.specifier}`),
    );
  }
  return { imports, privateImports };
}

function effectiveDependencyGraph(architecture, states) {
  const catalogIds = new Set(architecture.packages.map(packageRecord => packageRecord.id));
  return Object.freeze(
    Object.fromEntries(
      architecture.packages.map(packageRecord => {
        const state = states.get(packageRecord.id);
        const dependencies = new Set(packageRecord.policy.allowedWorkspaceDependencies);
        for (const id of state?.manifest.keys() ?? []) dependencies.add(id);
        for (const id of state?.ownership.imports.keys() ?? []) dependencies.add(id);
        return [packageRecord.id, Object.freeze([...dependencies].filter(id => catalogIds.has(id)).toSorted())];
      }),
    ),
  );
}

function edgeDiagnostics(root, architecture, states) {
  const diagnostics = [];
  for (const consumer of architecture.packages) {
    const state = states.get(consumer.id);
    if (state === undefined) continue;

    const policyIds = new Set(consumer.policy.allowedWorkspaceDependencies);
    const edgeIds = new Set([...policyIds, ...state.manifest.keys(), ...state.ownership.imports.keys()]);
    for (const dependencyId of [...edgeIds].toSorted()) {
      const dependency = packageForId(architecture, dependencyId);
      const policy = policyIds.has(dependencyId);
      const manifest = state.manifest.has(dependencyId);
      const references = state.ownership.imports.get(dependencyId) ?? [];
      const observed = references.length > 0;
      const first = references[0];
      const sortKey = `${consumer.id}\u0000${dependencyId}\u0000${first?.sourcePath ?? ''}`;

      if (dependency === undefined) {
        diagnostics.push(
          diagnostic(
            'ARCH_EDGE_FORBIDDEN',
            sortKey,
            `${consumer.id} -> ${dependencyId} at scripts/architecture/policy.mjs`,
            `${consumer.id}.allowedWorkspaceDependencies names a package absent from the product catalog`,
            'use an existing inward public contract or review manifest and policy together',
          ),
        );
        continue;
      }

      if (!policy && (manifest || observed)) {
        diagnostics.push(
          first === undefined
            ? diagnostic(
                'ARCH_EDGE_FORBIDDEN',
                sortKey,
                `${consumer.id} -> ${dependency.id} at ${pathText(root, consumer.manifestPath)}`,
                `${consumer.npmName} declares ${dependency.npmName}, but ${dependency.id} is absent from ${consumer.id}.allowedWorkspaceDependencies`,
                'use an existing inward public contract or review manifest and policy together',
              )
            : diagnostic(
                'ARCH_EDGE_FORBIDDEN',
                sortKey,
                `${consumer.id} -> ${dependency.id} at ${first.sourcePath}`,
                `${consumer.npmName} imports ${first.specifier}, but ${dependency.id} is absent from ${consumer.id}.allowedWorkspaceDependencies`,
                'use an existing inward public contract or review manifest and policy together',
              ),
        );
      }

      if (!manifest && (policy || observed)) {
        diagnostics.push(
          first === undefined
            ? diagnostic(
                'ARCH_EDGE_UNDECLARED',
                sortKey,
                `${consumer.id} -> ${dependency.id} at ${pathText(root, consumer.manifestPath)}`,
                `${consumer.id}.allowedWorkspaceDependencies names ${dependency.id}, but ${consumer.npmName} has no non-dev manifest dependency on ${dependency.npmName}`,
                'add the intended direct dependency and policy id, or remove the import',
              )
            : diagnostic(
                'ARCH_EDGE_UNDECLARED',
                sortKey,
                `${consumer.id} -> ${dependency.id} at ${first.sourcePath}`,
                `${consumer.npmName} imports ${first.specifier}, but ${pathText(root, consumer.manifestPath)} has no non-dev dependency on ${dependency.npmName}`,
                'add the intended direct dependency and policy id, or remove the import',
              ),
        );
      }

      if (policy && manifest && !observed) {
        diagnostics.push(
          diagnostic(
            'ARCH_EDGE_STALE',
            sortKey,
            `${consumer.id} -> ${dependency.id}`,
            `${pathText(root, consumer.manifestPath)} and ${consumer.id}.allowedWorkspaceDependencies name ${dependency.npmName}, but no production export or executable imports it`,
            'remove the stale edge from both authorities',
          ),
        );
      }

      const consumerRank = ZONE_RANK.get(consumer.policy.zone);
      const dependencyRank = ZONE_RANK.get(dependency.policy.zone);
      if (consumerRank !== undefined && dependencyRank !== undefined && dependencyRank > consumerRank) {
        diagnostics.push(
          diagnostic(
            'ARCH_ZONE_DIRECTION',
            `${consumer.id}\u0000${dependency.id}`,
            `${consumer.id} (${consumer.policy.zone}) -> ${dependency.id} (${dependency.policy.zone})`,
            `${consumer.npmName} depends on an outward zone`,
            'move ownership inward or introduce an explicit lower-layer contract',
          ),
        );
      }
    }

    for (const { dependency, sourcePath, specifier } of state.ownership.privateImports.values()) {
      const dependencySubject = dependency === undefined ? consumer.id : `${consumer.id} -> ${dependency.id}`;
      const violation =
        dependency === undefined
          ? `${consumer.npmName} imports package-external relative path ${specifier}`
          : `${consumer.npmName} imports private cross-package path ${specifier}`;
      diagnostics.push(
        diagnostic(
          'ARCH_PRIVATE_IMPORT',
          `${consumer.id}\u0000${dependency?.id ?? ''}\u0000${sourcePath}\u0000${specifier}`,
          `${dependencySubject} at ${sourcePath}`,
          violation,
          "publish/use the owning package's public export",
        ),
      );
    }
  }
  return diagnostics;
}

function graphDiagnostics(architecture, graph) {
  const diagnostics = [];
  let order;
  try {
    order = topologicalOrder(graph);
  } catch (error) {
    if (!(error instanceof DependencyCycleError)) throw error;
    const catalogOrder = new Map(architecture.packages.map((packageRecord, index) => [packageRecord.id, index]));
    const nodes = error.cycle.slice(0, -1);
    const start = nodes.reduce(
      (best, id, index) =>
        (catalogOrder.get(id) ?? Number.POSITIVE_INFINITY) < (catalogOrder.get(nodes[best]) ?? Number.POSITIVE_INFINITY)
          ? index
          : best,
      0,
    );
    const rotated = [...nodes.slice(start), ...nodes.slice(0, start)];
    const cycle = [...rotated, rotated[0]].join(' -> ');
    diagnostics.push(
      diagnostic(
        'ARCH_CYCLE',
        cycle,
        cycle,
        `workspace dependency graph contains the complete shortest cycle ${cycle}`,
        'remove or reverse an ownership edge; do not raise rings',
      ),
    );
    return diagnostics;
  }

  const canonicalRings = new Map();
  for (const id of order) {
    const dependencies = graph[id] ?? [];
    const ring =
      dependencies.length === 0
        ? 0
        : 1 + Math.max(...dependencies.map(dependency => canonicalRings.get(dependency) ?? 0));
    canonicalRings.set(id, ring);
    const packageRecord = packageForId(architecture, id);
    if (packageRecord === undefined || packageRecord.policy.ring === ring) continue;
    const basis = dependencies.length === 0 ? 'no workspace dependencies' : `dependencies [${dependencies.join(', ')}]`;
    diagnostics.push(
      diagnostic(
        'ARCH_RING_INVALID',
        id,
        id,
        `declared ring ${String(packageRecord.policy.ring)} disagrees with canonical ring ${String(ring)} from ${basis}`,
        'set the canonical ring after fixing all edges',
      ),
    );
  }
  return diagnostics;
}

export async function inspectArchitectureZones(root = SCRIPT_ROOT) {
  const architecture = await loadArchitecture(root);
  const graph = createImportGraph(root, architecture.packages);
  const states = new Map(
    architecture.packages.map(packageRecord => [
      packageRecord.id,
      {
        manifest: manifestWorkspaceEdges(architecture, packageRecord),
        ownership: ownershipImports(root, architecture, packageRecord, graph),
      },
    ]),
  );
  const dependencyGraph = effectiveDependencyGraph(architecture, states);
  const diagnostics = [
    ...edgeDiagnostics(root, architecture, states),
    ...graphDiagnostics(architecture, dependencyGraph),
  ]
    .toSorted(compareDiagnostics)
    .map(item => item.line);
  return Object.freeze({
    architecture,
    dependencyGraph,
    diagnostics: Object.freeze(diagnostics),
  });
}

function parseArgs(argv) {
  let root = SCRIPT_ROOT;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument !== '--root' || argv[index + 1] === undefined) {
      throw new TypeError('usage: verify-architecture-zones.mjs [--root <path>]');
    }
    root = resolve(argv[index + 1]);
    index += 1;
  }
  return root;
}

async function main(argv) {
  let root;
  try {
    root = parseArgs(argv);
    if (!statSync(root).isDirectory()) throw new TypeError(`root is not a directory: ${root}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    const report = await inspectArchitectureZones(root);
    if (report.diagnostics.length > 0) {
      for (const line of report.diagnostics) console.error(line);
      return 1;
    }
    const edgeCount = Object.values(report.dependencyGraph).reduce((sum, dependencies) => sum + dependencies.length, 0);
    console.log(
      `architecture zones: ${String(report.architecture.packages.length)} catalog packages, ${String(edgeCount)} workspace edges, and canonical rings verified.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ArchitecturePolicyError) {
      for (const line of error.diagnostics) console.error(line);
      return 1;
    }
    console.error(
      `architecture verifier could not read ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
