#!/usr/bin/env node
// Policy-driven runtime, tooling, and optional-peer reachability.
//
// Product membership and entry assignments come only from the canonical
// architecture model. Every export and executable is walked independently so a
// broad barrel cannot inherit permission from a narrower tooling or integration
// entry.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadArchitecture, lookupExport } from '../../scripts/architecture/index.mjs';
import { createImportGraph } from './lib/import-graph.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '').split('/')[0]));
const PEER_REMEDIATION = 'align the declaration and prove the range with the real peer';

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function logicalPath(root, path) {
  if (!isInside(root, path)) return path.split(sep).join('/');
  return relative(root, path).split(sep).join('/');
}

function entryId(packageRecord, selector) {
  return `${packageRecord.npmName}#${selector}`;
}

function defaultBinName(npmName) {
  return npmName.split('/').at(-1);
}

function manifestEntries(packageRecord) {
  const entries = [];
  for (const [selector, target] of Object.entries(record(packageRecord.manifest.exports)).toSorted(([left], [right]) =>
    compareText(left, right),
  )) {
    if (typeof target !== 'string') continue;
    entries.push({
      package: packageRecord,
      selector,
      target,
      path: resolve(packageRecord.directoryPath, target),
    });
  }

  const { bin } = packageRecord.manifest;
  if (typeof bin === 'string') {
    const command = defaultBinName(packageRecord.npmName);
    if (command !== undefined) {
      entries.push({
        package: packageRecord,
        selector: `bin:${command}`,
        target: bin,
        path: resolve(packageRecord.directoryPath, bin),
      });
    }
  } else {
    for (const [command, target] of Object.entries(record(bin)).toSorted(([left], [right]) =>
      compareText(left, right),
    )) {
      if (typeof target !== 'string') continue;
      entries.push({
        package: packageRecord,
        selector: `bin:${command}`,
        target,
        path: resolve(packageRecord.directoryPath, target),
      });
    }
  }

  return entries.map(entry => ({
    ...entry,
    id: entryId(packageRecord, entry.selector),
    tooling: packageRecord.policy.toolingEntries.includes(entry.selector),
  }));
}

function allEntries(architecture) {
  return architecture.packages
    .flatMap(manifestEntries)
    .toSorted((left, right) =>
      compareText(`${left.package.id}\u0000${left.selector}`, `${right.package.id}\u0000${right.selector}`),
    );
}

function dependencyKind(packageRecord, dependency) {
  const manifest = packageRecord.manifest;
  if (Object.hasOwn(record(manifest.dependencies), dependency)) return 'dependency';
  if (Object.hasOwn(record(manifest.optionalDependencies), dependency)) return 'optionalDependency';
  if (Object.hasOwn(record(manifest.peerDependencies), dependency)) return 'peerDependency';
  if (Object.hasOwn(record(manifest.devDependencies), dependency)) return 'devDependency';
  return 'missing';
}

function isBuiltin(specifier) {
  const normalized = specifier.replace(/^node:/, '').split('/')[0];
  return BUILTINS.has(normalized);
}

function isRepl(specifier) {
  return specifier.replace(/^node:/, '').split('/')[0] === 'repl';
}

function formatTrail(root, steps) {
  return steps.map(step => (isAbsolute(step) ? logicalPath(root, step) : step)).join(' -> ');
}

function contextFor(packageRecord, selector) {
  return {
    package: packageRecord,
    selector,
    tooling: packageRecord.policy.toolingEntries.includes(selector),
  };
}

function findingCollector() {
  const findings = new Map();
  return {
    add(key, diagnostic, distance) {
      const previous = findings.get(key);
      if (
        previous === undefined ||
        distance < previous.distance ||
        (distance === previous.distance && compareText(diagnostic, previous.diagnostic) < 0)
      ) {
        findings.set(key, { diagnostic, distance });
      }
    },
    diagnostics() {
      return [...findings.values()].map(finding => finding.diagnostic).toSorted(compareText);
    },
  };
}

function peerMetadataDiagnostics(architecture) {
  const diagnostics = [];
  for (const packageRecord of architecture.packages) {
    const dependencies = record(packageRecord.manifest.dependencies);
    const optionalDependencies = record(packageRecord.manifest.optionalDependencies);
    const peers = record(packageRecord.manifest.peerDependencies);
    const peerMeta = record(packageRecord.manifest.peerDependenciesMeta);
    const assignments = packageRecord.policy.optionalPeerEntries;

    for (const peer of Object.keys(assignments).toSorted(compareText)) {
      if (typeof peers[peer] !== 'string' || peers[peer].length === 0) {
        diagnostics.push(
          `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: optionalPeerEntries names a peer absent from peerDependencies. Remediation: ${PEER_REMEDIATION}.`,
        );
      }
      if (!isRecord(peerMeta[peer]) || peerMeta[peer].optional !== true) {
        diagnostics.push(
          `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: peerDependenciesMeta.optional is not true. Remediation: ${PEER_REMEDIATION}.`,
        );
      }
      if (Object.hasOwn(dependencies, peer) || Object.hasOwn(optionalDependencies, peer)) {
        diagnostics.push(
          `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: optional peer is also owned by dependencies or optionalDependencies. Remediation: ${PEER_REMEDIATION}.`,
        );
      }
    }

    for (const [peer, metadata] of Object.entries(peerMeta).toSorted(([left], [right]) => compareText(left, right))) {
      if (!isRecord(metadata) || metadata.optional !== true) continue;
      if (!Object.hasOwn(peers, peer)) {
        diagnostics.push(
          `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: optional metadata has no peerDependencies declaration. Remediation: ${PEER_REMEDIATION}.`,
        );
      } else if (!Object.hasOwn(assignments, peer)) {
        diagnostics.push(
          `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: manifest optional peer has no optionalPeerEntries policy assignment. Remediation: ${PEER_REMEDIATION}.`,
        );
      }
    }
  }
  return diagnostics;
}

function conformancePeerUses(root, architecture, graph) {
  const uses = new Set();
  const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;

  for (const packageRecord of architecture.packages) {
    const fixture = packageRecord.catalog.consumer?.fixture;
    if (typeof fixture !== 'string') continue;
    const fixtureRoot = resolve(root, fixture);
    if (!isInside(root, fixtureRoot) || !existsSync(fixtureRoot)) continue;

    const importedSelectors = new Set();
    const importedPackages = new Set();
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.isFile() || !sourceExtensions.test(entry.name)) continue;
        for (const imported of graph.importsOf(path, readFileSync(path, 'utf8'), 'ownership')) {
          if (imported.packageName !== undefined) importedPackages.add(imported.packageName);
          const exported = lookupExport(architecture, imported.specifier);
          if (exported?.package.id === packageRecord.id) importedSelectors.add(exported.selector);
        }
      }
    };
    visit(fixtureRoot);

    for (const [peer, selectors] of Object.entries(packageRecord.policy.optionalPeerEntries)) {
      if (!importedPackages.has(peer)) continue;
      for (const selector of selectors) {
        if (importedSelectors.has(selector)) uses.add(`${packageRecord.id}\u0000${peer}\u0000${selector}`);
      }
    }
  }

  return uses;
}

function cloneArchitecturePackage(architecture, id, mutate) {
  const current = architecture.packages.find(packageRecord => packageRecord.id === id);
  if (current === undefined) throw new Error(`self-test package ${id} is missing`);
  const replacement = mutate(current);
  return {
    ...architecture,
    policy: {
      ...architecture.policy,
      [id]: replacement.policy,
    },
    packages: architecture.packages.map(packageRecord => (packageRecord.id === id ? replacement : packageRecord)),
  };
}

export function analyzeRuntimeReachability(root, architecture, graph = createImportGraph(root, architecture)) {
  const entries = allEntries(architecture);
  const entryByKey = new Map(entries.map(entry => [`${entry.package.id}\u0000${entry.selector}`, entry]));
  const toolingTargets = new Map();
  const ordinaryTargets = new Map();

  for (const entry of entries) {
    const key = `${entry.package.id}\u0000${entry.path}`;
    if (entry.tooling) {
      const owners = toolingTargets.get(entry.path) ?? [];
      owners.push(entry);
      toolingTargets.set(entry.path, owners);
    } else {
      ordinaryTargets.set(key, entry);
    }
  }

  const findings = findingCollector();
  const optionalPeerUses = new Set();
  const runtimeDependencyUses = new Set();
  const workspacePackages = new Map(architecture.packages.map(packageRecord => [packageRecord.npmName, packageRecord]));

  const addToolingLeak = (entry, sink, trail, detail) => {
    findings.add(
      `ARCH_TOOLING_LEAK\u0000${entry.id}\u0000${sink}`,
      `[ARCH_TOOLING_LEAK] ${entry.id} via ${formatTrail(root, trail)}: ${detail}. Remediation: move the sink behind a tooling entry or split the tool owner.`,
      trail.length,
    );
  };

  const addPeerLeak = (entry, peer, trail) => {
    findings.add(
      `ARCH_PEER_LEAK\u0000${entry.id}\u0000${peer}`,
      `[ARCH_PEER_LEAK] ${peer} from ${entry.id} via ${formatTrail(root, trail)}: optional peer is reachable from an export not assigned in optionalPeerEntries. Remediation: route through an assigned integration entry or move it to an integration package.`,
      trail.length,
    );
  };

  const addUndeclared = (entry, owner, dependency, trail) => {
    findings.add(
      `ARCH_DEPENDENCY_UNDECLARED\u0000${entry.id}\u0000${owner.id}\u0000${dependency}`,
      `[ARCH_DEPENDENCY_UNDECLARED] ${dependency} from ${entry.id} via ${formatTrail(root, trail)}: production import is absent from ${owner.directory}/package.json dependencies. Remediation: declare it at the correct manifest boundary or remove the import.`,
      trail.length,
    );
  };

  const walkEntry = (entry, mode) => {
    const seen = new Set();
    const queue = [
      {
        file: entry.path,
        context: contextFor(entry.package, entry.selector),
        trail: [entry.path],
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      const stateKey = `${current.file}\u0000${current.context.package.id}\u0000${current.context.selector}`;
      if (seen.has(stateKey)) continue;
      seen.add(stateKey);

      if (mode === 'runtime' && !entry.tooling && !current.context.tooling) {
        const sinks = toolingTargets.get(current.file);
        if (sinks !== undefined) {
          const sink = sinks.toSorted((left, right) => compareText(left.id, right.id))[0];
          if (sink !== undefined) {
            addToolingLeak(entry, sink.id, current.trail, `runtime export reaches policy tooling entry ${sink.id}`);
          }
        }
      }

      if (!existsSync(current.file)) continue;
      const source = readFileSync(current.file, 'utf8');
      for (const imported of graph.importsOf(current.file, source, mode)) {
        const trail = [...current.trail, imported.resolved ?? imported.specifier];
        const workspaceExport =
          imported.packageName === undefined ? undefined : lookupExport(architecture, imported.specifier);

        if (workspaceExport !== undefined) {
          const kind = dependencyKind(current.context.package, workspaceExport.package.npmName);
          const peer = workspaceExport.package.npmName;
          const assignments = current.context.package.policy.optionalPeerEntries[peer];
          const manifestOptional =
            kind === 'peerDependency' &&
            isRecord(record(current.context.package.manifest.peerDependenciesMeta)[peer]) &&
            record(current.context.package.manifest.peerDependenciesMeta)[peer].optional === true;
          if (assignments !== undefined || manifestOptional) {
            if (assignments?.includes(current.context.selector) === true) {
              optionalPeerUses.add(`${current.context.package.id}\u0000${peer}\u0000${current.context.selector}`);
            } else {
              addPeerLeak(entry, peer, trail);
            }
          }
          if (kind === 'missing' || kind === 'devDependency') {
            addUndeclared(entry, current.context.package, peer, trail);
          }
          const nextContext = contextFor(workspaceExport.package, workspaceExport.selector);
          if (mode === 'runtime' && !entry.tooling && !current.context.tooling && nextContext.tooling) {
            addToolingLeak(
              entry,
              entryId(workspaceExport.package, workspaceExport.selector),
              trail,
              `runtime export reaches policy tooling entry ${entryId(workspaceExport.package, workspaceExport.selector)}`,
            );
          }
          queue.push({
            file: workspaceExport.path,
            context: nextContext,
            trail,
          });
          continue;
        }

        if (imported.resolved !== null) {
          queue.push({
            file: imported.resolved,
            context: current.context,
            trail,
          });
          continue;
        }

        if (isBuiltin(imported.specifier)) {
          if (mode === 'runtime' && !entry.tooling && !current.context.tooling && isRepl(imported.specifier)) {
            addToolingLeak(
              entry,
              imported.specifier,
              trail,
              `runtime export reaches the tooling-only module ${imported.specifier}`,
            );
          }
          continue;
        }

        const dependency = imported.packageName;
        if (dependency === undefined) continue;
        if (workspacePackages.has(dependency)) {
          const kind = dependencyKind(current.context.package, dependency);
          if (kind === 'missing' || kind === 'devDependency') {
            addUndeclared(entry, current.context.package, dependency, trail);
          }
          continue;
        }

        const assignments = current.context.package.policy.optionalPeerEntries[dependency];
        const kind = dependencyKind(current.context.package, dependency);
        const allowedRuntime =
          mode === 'runtime' &&
          !entry.tooling &&
          !current.context.tooling &&
          current.context.package.policy.allowedRuntimeDependencies.includes(dependency);
        if (allowedRuntime) {
          runtimeDependencyUses.add(`${current.context.package.id}\u0000${dependency}`);
        }
        const manifestOptional =
          kind === 'peerDependency' &&
          isRecord(record(current.context.package.manifest.peerDependenciesMeta)[dependency]) &&
          record(current.context.package.manifest.peerDependenciesMeta)[dependency].optional === true;

        if (assignments !== undefined || manifestOptional) {
          if (assignments?.includes(current.context.selector) === true) {
            optionalPeerUses.add(`${current.context.package.id}\u0000${dependency}\u0000${current.context.selector}`);
          } else {
            addPeerLeak(entry, dependency, trail);
          }
          if (kind === 'missing' || kind === 'devDependency') {
            addUndeclared(entry, current.context.package, dependency, trail);
          }
          continue;
        }

        if (kind === 'peerDependency') {
          const integration =
            current.context.package.policy.zone === 'integration' &&
            current.context.package.catalog.optionality?.kind === 'integration';
          if (!integration) addUndeclared(entry, current.context.package, dependency, trail);
          continue;
        }

        if (kind === 'dependency') {
          if (mode === 'runtime' && !entry.tooling && !current.context.tooling) {
            if (!allowedRuntime) {
              addToolingLeak(
                entry,
                dependency,
                trail,
                `runtime export reaches the tooling-only dependency ${dependency}`,
              );
            }
          }
          continue;
        }

        addUndeclared(entry, current.context.package, dependency, trail);
      }
    }
  };

  for (const entry of entries) {
    walkEntry(entry, 'runtime');
    walkEntry(entry, 'ownership');
  }
  for (const use of conformancePeerUses(root, architecture, graph)) optionalPeerUses.add(use);

  for (const packageRecord of architecture.packages) {
    for (const dependency of packageRecord.policy.allowedRuntimeDependencies) {
      if (!runtimeDependencyUses.has(`${packageRecord.id}\u0000${dependency}`)) {
        findings.add(
          `ARCH_EXEMPTION_STALE\u0000${packageRecord.id}\u0000runtime\u0000${dependency}`,
          `[ARCH_EXEMPTION_STALE] ${dependency} runtime allowance for ${packageRecord.npmName}: no ordinary runtime entry reaches the dependency. Remediation: remove the exemption.`,
          0,
        );
      }
    }

    for (const selector of packageRecord.policy.toolingEntries) {
      const entry = entryByKey.get(`${packageRecord.id}\u0000${selector}`);
      if (entry === undefined) continue;
      const ordinary = ordinaryTargets.get(`${packageRecord.id}\u0000${entry.path}`);
      if (ordinary !== undefined) {
        findings.add(
          `ARCH_EXEMPTION_STALE\u0000${packageRecord.id}\u0000tooling\u0000${selector}`,
          `[ARCH_EXEMPTION_STALE] tooling selector ${entry.id}: target ${logicalPath(root, entry.path)} is also ordinary runtime entry ${ordinary.id}. Remediation: remove the exemption.`,
          0,
        );
      }
    }

    for (const [peer, selectors] of Object.entries(packageRecord.policy.optionalPeerEntries)) {
      for (const selector of selectors) {
        if (!optionalPeerUses.has(`${packageRecord.id}\u0000${peer}\u0000${selector}`)) {
          findings.add(
            `ARCH_EXEMPTION_STALE\u0000${packageRecord.id}\u0000peer\u0000${peer}\u0000${selector}`,
            `[ARCH_EXEMPTION_STALE] ${peer} assignment ${entryId(packageRecord, selector)}: policy selector reaches no runtime or declaration reference to the peer. Remediation: remove the exemption.`,
            0,
          );
        }
      }
    }
  }

  for (const diagnostic of peerMetadataDiagnostics(architecture)) {
    findings.add(diagnostic, diagnostic, 0);
  }

  return {
    diagnostics: findings.diagnostics(),
    entriesChecked: entries.length,
    packagesChecked: architecture.packages.length,
  };
}

export async function verifyRuntimeReachability(root = DEFAULT_ROOT, options = {}) {
  const architecture = options.architecture ?? (await loadArchitecture(root));
  return analyzeRuntimeReachability(root, architecture, createImportGraph(root, architecture));
}

async function runSelfTest(root) {
  const fixtureRoot = join(root, 'scripts', 'architecture', '__fixtures__');
  const cases = [
    {
      name: 'valid fixture',
      root: join(fixtureRoot, 'valid'),
      diagnostics: [],
    },
    {
      name: 'tooling leak fixture',
      root: join(fixtureRoot, 'tooling-leak'),
      diagnostics: [
        '[ARCH_TOOLING_LEAK] @fixture/app#. via packages/app/src/index.ts -> fixture-tool: runtime export reaches the tooling-only dependency fixture-tool. Remediation: move the sink behind a tooling entry or split the tool owner.',
      ],
    },
    {
      name: 'peer leak fixture',
      root: join(fixtureRoot, 'peer-leak'),
      diagnostics: [
        '[ARCH_PEER_LEAK] fixture-peer from @fixture/app#. via packages/app/src/index.ts -> fixture-peer: optional peer is reachable from an export not assigned in optionalPeerEntries. Remediation: route through an assigned integration entry or move it to an integration package.',
      ],
    },
    {
      name: 'undeclared dependency fixture',
      root: join(fixtureRoot, 'metadata-drift'),
      diagnostics: [
        '[ARCH_DEPENDENCY_UNDECLARED] fixture-runtime from @fixture/app#. via packages/app/src/index.ts -> fixture-runtime: production import is absent from packages/app/package.json dependencies. Remediation: declare it at the correct manifest boundary or remove the import.',
      ],
    },
  ];

  let passed = 0;
  for (const testCase of cases) {
    const report = await verifyRuntimeReachability(testCase.root);
    if (JSON.stringify(report.diagnostics) !== JSON.stringify(testCase.diagnostics)) {
      throw new Error(
        `${testCase.name} expected ${JSON.stringify(testCase.diagnostics)}, received ${JSON.stringify(report.diagnostics)}`,
      );
    }
    passed++;
  }

  const validRoot = join(fixtureRoot, 'valid');
  const valid = await loadArchitecture(validRoot);
  const validApp = valid.packages.find(packageRecord => packageRecord.id === 'app');
  if (validApp === undefined) throw new Error('valid fixture omitted the app package');
  const indexPath = join(validApp.directoryPath, 'src', 'index.ts');
  const cliPath = join(validApp.directoryPath, 'src', 'cli.ts');
  const peerPath = join(validApp.directoryPath, 'src', 'peer.ts');
  const shortestOverlay = new Map([
    [indexPath, "import './cli.js';\nimport './peer.js';\n"],
    [cliPath, "import './peer.js';\n"],
    [peerPath, "import 'fixture-tool';\n"],
  ]);
  const baseGraph = createImportGraph(validRoot, valid);
  const overlayGraph = {
    ...baseGraph,
    importsOf(file, source, mode) {
      return baseGraph.importsOf(file, shortestOverlay.get(file) ?? source, mode);
    },
  };
  const shortestReport = analyzeRuntimeReachability(validRoot, valid, overlayGraph);
  if (
    !shortestReport.diagnostics.includes(
      '[ARCH_TOOLING_LEAK] @fixture/app#. via packages/app/src/index.ts -> packages/app/src/peer.ts -> fixture-tool: runtime export reaches the tooling-only dependency fixture-tool. Remediation: move the sink behind a tooling entry or split the tool owner.',
    )
  ) {
    throw new Error(`shortest-path self-test received ${JSON.stringify(shortestReport.diagnostics)}`);
  }
  passed++;

  const stalePeer = cloneArchitecturePackage(valid, 'app', packageRecord => ({
    ...packageRecord,
    policy: {
      ...packageRecord.policy,
      optionalPeerEntries: {
        ...packageRecord.policy.optionalPeerEntries,
        'fixture-peer': ['./cli', './peer'],
      },
    },
  }));
  const stalePeerReport = await verifyRuntimeReachability(validRoot, { architecture: stalePeer });
  if (
    !stalePeerReport.diagnostics.includes(
      '[ARCH_EXEMPTION_STALE] fixture-peer assignment @fixture/app#./cli: policy selector reaches no runtime or declaration reference to the peer. Remediation: remove the exemption.',
    )
  ) {
    throw new Error(`stale peer self-test received ${JSON.stringify(stalePeerReport.diagnostics)}`);
  }
  passed++;

  const workspaceOptionalPeer = cloneArchitecturePackage(valid, 'app', packageRecord => ({
    ...packageRecord,
    manifest: {
      ...packageRecord.manifest,
      dependencies: Object.fromEntries(
        Object.entries(record(packageRecord.manifest.dependencies)).filter(([name]) => name !== '@fixture/core'),
      ),
      peerDependencies: {
        ...record(packageRecord.manifest.peerDependencies),
        '@fixture/core': 'workspace:^',
      },
      peerDependenciesMeta: {
        ...record(packageRecord.manifest.peerDependenciesMeta),
        '@fixture/core': {
          optional: true,
        },
      },
    },
    policy: {
      ...packageRecord.policy,
      optionalPeerEntries: {
        ...packageRecord.policy.optionalPeerEntries,
        '@fixture/core': ['.'],
      },
    },
  }));
  const workspaceOptionalPeerReport = await verifyRuntimeReachability(validRoot, {
    architecture: workspaceOptionalPeer,
  });
  if (workspaceOptionalPeerReport.diagnostics.length > 0) {
    throw new Error(
      `workspace optional-peer self-test received ${JSON.stringify(workspaceOptionalPeerReport.diagnostics)}`,
    );
  }
  passed++;

  const staleTooling = cloneArchitecturePackage(valid, 'app', packageRecord => ({
    ...packageRecord,
    manifest: {
      ...packageRecord.manifest,
      exports: {
        ...record(packageRecord.manifest.exports),
        './runtime-alias': './src/index.ts',
      },
    },
    policy: {
      ...packageRecord.policy,
      toolingEntries: ['./cli', './runtime-alias'],
    },
  }));
  const staleToolingReport = await verifyRuntimeReachability(validRoot, { architecture: staleTooling });
  if (
    !staleToolingReport.diagnostics.includes(
      '[ARCH_EXEMPTION_STALE] tooling selector @fixture/app#./runtime-alias: target packages/app/src/index.ts is also ordinary runtime entry @fixture/app#.. Remediation: remove the exemption.',
    )
  ) {
    throw new Error(`stale tooling self-test received ${JSON.stringify(staleToolingReport.diagnostics)}`);
  }
  passed++;

  const invalidPeerMetadata = cloneArchitecturePackage(valid, 'app', packageRecord => ({
    ...packageRecord,
    manifest: {
      ...packageRecord.manifest,
      peerDependenciesMeta: {
        'fixture-peer': {
          optional: false,
        },
      },
    },
  }));
  const invalidMetadataReport = await verifyRuntimeReachability(validRoot, { architecture: invalidPeerMetadata });
  if (
    !invalidMetadataReport.diagnostics.includes(
      '[PACKAGE_PEER_METADATA] @fixture/app peer fixture-peer: peerDependenciesMeta.optional is not true. Remediation: align the declaration and prove the range with the real peer.',
    )
  ) {
    throw new Error(`optional-peer metadata self-test received ${JSON.stringify(invalidMetadataReport.diagnostics)}`);
  }
  passed++;

  const missingPeerDeclaration = cloneArchitecturePackage(valid, 'app', packageRecord => ({
    ...packageRecord,
    manifest: {
      ...packageRecord.manifest,
      peerDependencies: {},
    },
  }));
  const missingPeerReport = await verifyRuntimeReachability(validRoot, { architecture: missingPeerDeclaration });
  if (
    !missingPeerReport.diagnostics.includes(
      '[PACKAGE_PEER_METADATA] @fixture/app peer fixture-peer: optionalPeerEntries names a peer absent from peerDependencies. Remediation: align the declaration and prove the range with the real peer.',
    )
  ) {
    throw new Error(
      `missing optional-peer declaration self-test received ${JSON.stringify(missingPeerReport.diagnostics)}`,
    );
  }
  passed++;

  return passed;
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let selfTest = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined || value.length === 0) throw new TypeError('--root requires a path');
      root = resolve(value);
    } else if (argument === '--self-test') {
      selfTest = true;
    } else {
      throw new TypeError(`unknown argument ${argument}`);
    }
  }
  return { root, selfTest };
}

export async function runRuntimeReachabilityCli(argv = process.argv.slice(2), options = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`runtime reachability usage error: ${error.message}`);
    return 2;
  }

  if (!existsSync(parsed.root)) {
    console.error(`runtime reachability root is unreadable: ${parsed.root}`);
    return 2;
  }

  try {
    if (parsed.selfTest) {
      const passed = await runSelfTest(parsed.root);
      console.log(`runtime reachability self-test: ${String(passed)} case(s) passed.`);
      return 0;
    }

    const report = await verifyRuntimeReachability(parsed.root);
    if (report.diagnostics.length > 0) {
      for (const diagnostic of report.diagnostics) console.error(diagnostic);
      console.error(`runtime reachability failed with ${String(report.diagnostics.length)} violation(s).`);
      return 1;
    }
    const prefix = options.compatibilityName === undefined ? 'runtime reachability' : options.compatibilityName;
    console.log(
      `${prefix}: ${String(report.entriesChecked)} export/bin entry point(s) across ` +
        `${String(report.packagesChecked)} catalog package(s) satisfy architecture policy.`,
    );
    return 0;
  } catch (error) {
    console.error(`runtime reachability could not inspect ${parsed.root}: ${error.message}`);
    return 2;
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  process.exitCode = await runRuntimeReachabilityCli();
}
