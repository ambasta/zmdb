import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { createDependencyGraph, lookupPackage, topologicalOrder } from '../architecture/index.mjs';
import {
  compareSemver,
  compareText,
  parseChangelog,
  parseSemver,
  rangeFloor,
  releaseChannel,
  satisfiesRange,
} from './lib.mjs';

const require = createRequire(import.meta.url);
const GROUPS = new Set(['core', 'integration', 'tooling']);
const POLICY_FIELDS = ['group', 'internalCompatibility', 'peers'];
const COMPATIBILITY_FIELDS = ['evidence', 'floor', 'range', 'tested'];

const freezeArray = values => Object.freeze([...values]);
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function isDeeplyFrozen(value) {
  if (!Array.isArray(value) && !isRecord(value)) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diagnostic(code, subject, detail, remediation) {
  return `[${code}] ${subject}: ${detail}. Remediation: ${remediation}.`;
}

function manifestRecord(manifest, field) {
  const value = manifest[field];
  return isRecord(value) ? value : {};
}

function publicPackageManifests(architecture) {
  return architecture.workspacePackages
    .flatMap(packageRecord => {
      const { manifest } = packageRecord;
      if (
        !isRecord(manifest) ||
        manifest.private === true ||
        !isRecord(manifest.publishConfig) ||
        manifest.publishConfig.access !== 'public'
      ) {
        return [];
      }
      return [
        Object.freeze({
          directory: packageRecord.directory,
          manifest,
        }),
      ];
    })
    .toSorted((left, right) => compareText(left.directory, right.directory));
}

function loadReleasePolicy(root) {
  const path = join(root, 'scripts', 'release', 'policy.mjs');
  if (!existsSync(path)) {
    throw new ReleaseGovernanceError([
      diagnostic(
        'RELEASE_POLICY_MISSING',
        'scripts/release/policy.mjs',
        'the repository has no release-group authority',
        'add the complete RELEASE_PACKAGE_POLICY',
      ),
    ]);
  }
  const namespace = require(path);
  return namespace.RELEASE_PACKAGE_POLICY;
}

function nextPrerelease(version) {
  const identifiers = [...version.prerelease];
  const last = identifiers.at(-1);
  if (last === undefined || !/^\d+$/.test(last)) return undefined;
  identifiers[identifiers.length - 1] = String(Number(last) + 1);
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}-${identifiers.join('.')}`;
}

function compatibilityDiagnostics(subject, compatibility) {
  const diagnostics = [];
  if (!isRecord(compatibility)) {
    return [
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        'compatibility policy is not an object',
        'restore range, floor, tested and evidence',
      ),
    ];
  }
  const fields = Object.keys(compatibility).toSorted(compareText);
  if (!sameValues(fields, COMPATIBILITY_FIELDS)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `fields are ${fields.join(', ') || 'empty'}, expected ${COMPATIBILITY_FIELDS.join(', ')}`,
        'restore the exact compatibility policy shape',
      ),
    );
  }
  const { evidence, floor, range, tested } = compatibility;
  const parsedFloor = parseSemver(floor);
  if (typeof range !== 'string' || range.length === 0 || parsedFloor === undefined) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `range ${JSON.stringify(range)} or floor ${JSON.stringify(floor)} is not valid`,
        'record one valid range and exact SemVer floor',
      ),
    );
  }
  if (
    !Array.isArray(tested) ||
    tested.length === 0 ||
    tested.some(version => parseSemver(version) === undefined) ||
    new Set(tested).size !== tested.length ||
    !sameValues(tested, [...tested].toSorted(compareText))
  ) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `tested versions are ${JSON.stringify(tested)}, expected sorted unique exact SemVer values`,
        'record the floor and every exact packed-consumer version',
      ),
    );
  } else if (!tested.includes(floor)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `tested versions ${tested.join(', ')} omit floor ${String(floor)}`,
        'include the exact floor in tested',
      ),
    );
  }
  if (typeof evidence !== 'string' || evidence.length === 0 || evidence.startsWith('/')) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `evidence is ${JSON.stringify(evidence)}, expected a repository-relative path`,
        'name the packed-consumer fixture or generated matrix case',
      ),
    );
  }
  if (typeof range === 'string' && parsedFloor !== undefined && !satisfiesRange(parsedFloor, range)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        `range ${range} does not admit floor ${floor}`,
        'make the advertised range start at its tested floor',
      ),
    );
  }
  if (typeof range === 'string' && parsedFloor !== undefined) {
    const advertisedFloor = rangeFloor(range);
    if (advertisedFloor === undefined) {
      diagnostics.push(
        diagnostic(
          'RELEASE_COMPATIBILITY_INVALID',
          subject,
          `range ${range} has no exact inclusive lower bound`,
          'make the advertised range start exactly at its tested floor',
        ),
      );
    } else if (advertisedFloor.source !== floor) {
      diagnostics.push(
        diagnostic(
          'RELEASE_COMPATIBILITY_INVALID',
          subject,
          `range ${range} starts at ${advertisedFloor.source}, expected declared floor ${floor}`,
          'make the advertised range start exactly at its tested floor',
        ),
      );
    }
  }
  if (typeof range === 'string' && Array.isArray(tested)) {
    for (const version of tested) {
      if (parseSemver(version) !== undefined && !satisfiesRange(version, range)) {
        diagnostics.push(
          diagnostic(
            'RELEASE_COMPATIBILITY_INVALID',
            subject,
            `range ${range} does not admit tested version ${version}`,
            'align the range and exact packed-consumer cases',
          ),
        );
      }
    }
  }
  if (typeof range === 'string' && parsedFloor !== undefined && parsedFloor.prerelease.length > 0) {
    const next = Array.isArray(tested)
      ? tested
          .map(version => parseSemver(version))
          .filter(version => version?.prerelease.length > 0)
          .flatMap(version => {
            const candidate = nextPrerelease(version);
            return candidate === undefined ? [] : [candidate];
          })
          .filter(version => !tested.includes(version) && satisfiesRange(version, range))
          .toSorted((left, right) => compareSemver(parseSemver(left), parseSemver(right)))[0]
      : undefined;
    if (next !== undefined) {
      const measured =
        tested.length === 1 ? `only ${String(tested[0])}` : tested.map(value => String(value)).join(', ');
      diagnostics.push(
        diagnostic(
          'RELEASE_PRERELEASE_RANGE',
          subject,
          `range ${range} admits untested ${next} while tested contains ${measured}`,
          `use ${floor} until another exact prerelease passes, then list an explicit union`,
        ),
      );
    }
  }
  if (!isDeeplyFrozen(compatibility)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_COMPATIBILITY_INVALID',
        subject,
        'compatibility policy is mutable',
        'deep-freeze the policy at module evaluation',
      ),
    );
  }
  return diagnostics;
}

function groupOf(policy, id) {
  const group = policy[id]?.group;
  return typeof group === 'string' ? group : undefined;
}

function isSameCore(policy, left, right) {
  return groupOf(policy, left) === 'core' && groupOf(policy, right) === 'core';
}

function internalProjectionDiagnostics(packageRecord, architecture, releasePolicy) {
  const diagnostics = [];
  const row = releasePolicy[packageRecord.id];
  if (!isRecord(row) || !isRecord(row.internalCompatibility)) return diagnostics;
  const optionalPeerIds = Object.keys(packageRecord.policy.optionalPeerEntries).flatMap(npmName => {
    const target = architecture.packages.find(candidate => candidate.npmName === npmName);
    return target === undefined ? [] : [target.id];
  });
  const releaseDependencies = [...packageRecord.policy.allowedWorkspaceDependencies, ...optionalPeerIds];
  const architectureIds = new Set(releaseDependencies);
  const expectedCrossing = releaseDependencies.filter(
    dependency => !isSameCore(releasePolicy, packageRecord.id, dependency),
  );
  const actualCrossing = Object.keys(row.internalCompatibility);

  for (const dependency of expectedCrossing) {
    if (!Object.hasOwn(row.internalCompatibility, dependency)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_INTERNAL_POLICY_MISSING',
          `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
          'cross-unit architecture edge has no compatibility policy',
          'add the exact range, floor, tested versions and evidence',
        ),
      );
    }
  }
  for (const dependency of actualCrossing) {
    if (!architectureIds.has(dependency) || isSameCore(releasePolicy, packageRecord.id, dependency)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_INTERNAL_POLICY_STALE',
          `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
          'compatibility policy names no crossing architecture edge',
          'delete the stale row or admit the real edge in architecture policy',
        ),
      );
    }
  }

  const dependencies = manifestRecord(packageRecord.manifest, 'dependencies');
  const optionalDependencies = manifestRecord(packageRecord.manifest, 'optionalDependencies');
  const peerDependencies = manifestRecord(packageRecord.manifest, 'peerDependencies');
  const devDependencies = manifestRecord(packageRecord.manifest, 'devDependencies');
  const peerMetadata = manifestRecord(packageRecord.manifest, 'peerDependenciesMeta');

  for (const dependency of releaseDependencies) {
    const target = lookupPackage(architecture, dependency);
    if (target === undefined) continue;
    if (isSameCore(releasePolicy, packageRecord.id, dependency)) {
      if (dependencies[target.npmName] !== 'workspace:^') {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            `same-core dependencies declares ${String(dependencies[target.npmName])}, expected workspace:^`,
            `declare dependencies.${target.npmName} as workspace:^`,
          ),
        );
      }
      continue;
    }

    const compatibility = row.internalCompatibility[dependency];
    if (!isRecord(compatibility)) continue;
    diagnostics.push(
      ...compatibilityDiagnostics(`${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`, compatibility),
    );
    const targetIsCore = groupOf(releasePolicy, dependency) === 'core';
    const sourceIsIndependent = groupOf(releasePolicy, packageRecord.id) !== 'core';
    const optionalPeer = Object.hasOwn(packageRecord.policy.optionalPeerEntries, target.npmName);
    const peerProjection = (sourceIsIndependent && targetIsCore) || optionalPeer;
    if (peerProjection) {
      const observed = peerDependencies[target.npmName];
      if (observed !== compatibility.range) {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            `policy requires ${compatibility.range} but peerDependencies declares ${String(observed)}`,
            `declare peerDependencies.${target.npmName} as ${compatibility.range} and retain workspace:^ only in devDependencies`,
          ),
        );
      }
      if (devDependencies[target.npmName] !== 'workspace:^') {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            `devDependencies declares ${String(devDependencies[target.npmName])}, expected workspace:^`,
            `retain workspace:^ only in devDependencies.${target.npmName}`,
          ),
        );
      }
      if (dependencies[target.npmName] !== undefined || optionalDependencies[target.npmName] !== undefined) {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            'the peer is also bundled by a production dependency section',
            'remove the bundled copy and keep the peer plus workspace development evidence',
          ),
        );
      }
      if (optionalPeer && peerMetadata[target.npmName]?.optional !== true) {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            'optional internal peer lacks peerDependenciesMeta.optional',
            'mark only the architecture-approved peer optional',
          ),
        );
      }
    } else {
      const expected = `workspace:${compatibility.range}`;
      const observed = dependencies[target.npmName] ?? optionalDependencies[target.npmName];
      if (observed !== expected) {
        diagnostics.push(
          diagnostic(
            'RELEASE_INTERNAL_RANGE',
            `${packageRecord.id} (${packageRecord.npmName}) -> ${dependency}`,
            `policy requires ${compatibility.range} but dependencies declares ${String(observed)}`,
            `declare dependencies.${target.npmName} as ${expected}`,
          ),
        );
      }
    }
  }
  return diagnostics;
}

function peerProjectionDiagnostics(packageRecord, architecture, releasePolicy) {
  const diagnostics = [];
  const row = releasePolicy[packageRecord.id];
  if (!isRecord(row) || !isRecord(row.peers)) return diagnostics;
  const catalogNames = new Set(architecture.packages.map(candidate => candidate.npmName));
  const manifestPeers = manifestRecord(packageRecord.manifest, 'peerDependencies');
  const thirdPartyPeers = Object.keys(manifestPeers).filter(peer => !catalogNames.has(peer));
  const policyPeers = Object.keys(row.peers);

  for (const peer of thirdPartyPeers) {
    if (!Object.hasOwn(row.peers, peer)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_PEER_POLICY_MISSING',
          `${packageRecord.id} (${packageRecord.npmName}) peer ${peer}`,
          'manifest peer has no compatibility policy',
          'record its exact range, floor, tested versions and evidence',
        ),
      );
    }
  }
  for (const peer of policyPeers) {
    const compatibility = row.peers[peer];
    diagnostics.push(
      ...compatibilityDiagnostics(`${packageRecord.id} (${packageRecord.npmName}) peer ${peer}`, compatibility),
    );
    if (!isRecord(compatibility)) continue;
    const observed = manifestPeers[peer];
    if (observed !== compatibility.range) {
      diagnostics.push(
        diagnostic(
          'RELEASE_PEER_FLOOR',
          `${packageRecord.id} (${packageRecord.npmName}) peer ${peer}`,
          `policy range ${compatibility.range} has floor ${compatibility.floor} but peerDependencies declares ${String(observed)}`,
          `set peerDependencies.${peer} to ${compatibility.range} and prove exact ${peer}@${compatibility.floor} in a packed consumer`,
        ),
      );
    }
  }

  const devDependencies = manifestRecord(packageRecord.manifest, 'devDependencies');
  for (const [name, range] of Object.entries(devDependencies)) {
    if (typeof range !== 'string' || !range.startsWith('npm:')) continue;
    const match = /^npm:((?:@[^/]+\/)?[^@]+)@/.exec(range);
    const peer = match?.[1];
    if (peer === undefined || name === peer || !Object.hasOwn(row.peers, peer)) continue;
    diagnostics.push(
      diagnostic(
        'RELEASE_PEER_ALIAS',
        `${packageRecord.id} (${packageRecord.npmName})`,
        `devDependencies.${name} aliases ${range} outside the declared ${peer} policy`,
        `remove the alias and install each exact tested ${peer} version in an isolated consumer`,
      ),
    );
  }
  return diagnostics;
}

function policyDiagnostics(architecture, releasePolicy) {
  if (!isRecord(releasePolicy)) {
    return [
      diagnostic(
        'RELEASE_POLICY_INVALID',
        'RELEASE_PACKAGE_POLICY',
        'export is not an object',
        'export one deeply frozen row per public catalog package',
      ),
    ];
  }
  const diagnostics = [];
  const catalogById = new Map(architecture.packages.map(packageRecord => [packageRecord.id, packageRecord]));
  const catalogByDirectory = new Map(
    architecture.packages.map(packageRecord => [packageRecord.directory, packageRecord]),
  );

  for (const candidate of publicPackageManifests(architecture)) {
    const packageRecord = catalogByDirectory.get(candidate.directory);
    if (packageRecord === undefined || !Object.hasOwn(releasePolicy, packageRecord.id)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_PACKAGE_UNCLASSIFIED',
          `${candidate.directory}/package.json (${String(candidate.manifest.name)})`,
          'publishable manifest has no product-catalog or RELEASE_PACKAGE_POLICY row',
          'add one matching catalog and release-policy row, or mark the workspace private',
        ),
      );
    }
  }

  for (const packageRecord of architecture.packages) {
    if (!Object.hasOwn(releasePolicy, packageRecord.id)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_PACKAGE_UNCLASSIFIED',
          `${packageRecord.directory}/package.json (${packageRecord.npmName})`,
          'publishable manifest has no product-catalog or RELEASE_PACKAGE_POLICY row',
          'add one matching catalog and release-policy row, or mark the workspace private',
        ),
      );
      continue;
    }
    const row = releasePolicy[packageRecord.id];
    if (!isRecord(row)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_POLICY_INVALID',
          `${packageRecord.id} (${packageRecord.npmName})`,
          'policy row is not an object',
          'restore group, internalCompatibility and peers',
        ),
      );
      continue;
    }
    if (Array.isArray(row.group) && row.group.length > 1) {
      diagnostics.push(
        diagnostic(
          'RELEASE_GROUP_DUPLICATE',
          `${packageRecord.id} (${packageRecord.npmName})`,
          `RELEASE_PACKAGE_POLICY assigns both ${row.group.join(' and ')}`,
          'classify each publishable package in exactly one release group',
        ),
      );
    } else if (!GROUPS.has(row.group)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_GROUP_INVALID',
          `${packageRecord.id} (${packageRecord.npmName})`,
          `release group is ${JSON.stringify(row.group)}`,
          'choose core, integration or tooling exactly once',
        ),
      );
    }
    const fields = Object.keys(row).toSorted(compareText);
    if (!sameValues(fields, POLICY_FIELDS)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_POLICY_INVALID',
          `${packageRecord.id} (${packageRecord.npmName})`,
          `fields are ${fields.join(', ') || 'empty'}, expected ${POLICY_FIELDS.join(', ')}`,
          'restore the exact release-policy shape',
        ),
      );
    }
    for (const field of ['internalCompatibility', 'peers']) {
      if (!isRecord(row[field])) {
        diagnostics.push(
          diagnostic(
            'RELEASE_POLICY_INVALID',
            `${packageRecord.id} (${packageRecord.npmName})`,
            `${field} is not an object`,
            `restore the ${field} record`,
          ),
        );
      } else {
        const keys = Object.keys(row[field]);
        if (!sameValues(keys, keys.toSorted(compareText))) {
          diagnostics.push(
            diagnostic(
              'RELEASE_POLICY_INVALID',
              `${packageRecord.id} (${packageRecord.npmName})`,
              `${field} keys are not sorted`,
              'keep policy records deterministic',
            ),
          );
        }
      }
    }
    if (!isDeeplyFrozen(row)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_POLICY_INVALID',
          `${packageRecord.id} (${packageRecord.npmName})`,
          'policy row is mutable',
          'deep-freeze policy data at module evaluation',
        ),
      );
    }
  }
  for (const id of Object.keys(releasePolicy)) {
    if (!catalogById.has(id)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_POLICY_STALE',
          id,
          'RELEASE_PACKAGE_POLICY names no product-catalog package or public manifest',
          'delete the stale policy row or admit the real package atomically',
        ),
      );
    }
  }
  if (!isDeeplyFrozen(releasePolicy)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_POLICY_INVALID',
        'RELEASE_PACKAGE_POLICY',
        'policy export is mutable',
        'deep-freeze the complete record',
      ),
    );
  }
  return diagnostics;
}

function coreVersionDiagnostics(architecture, releasePolicy) {
  const core = architecture.packages
    .filter(packageRecord => groupOf(releasePolicy, packageRecord.id) === 'core')
    .toSorted((left, right) => compareText(left.id, right.id));
  const reference = core[0];
  if (reference === undefined) {
    return [
      diagnostic(
        'RELEASE_CORE_MISSING',
        'core',
        'release policy contains no cohesive core package',
        'classify the eight core packages as core',
      ),
    ];
  }
  const diagnostics = [];
  for (const packageRecord of core) {
    if (
      parseSemver(packageRecord.manifest.version) === undefined ||
      packageRecord.manifest.version !== reference.manifest.version
    ) {
      diagnostics.push(
        diagnostic(
          'RELEASE_CORE_VERSION_DRIFT',
          `${packageRecord.id} (${packageRecord.npmName})`,
          `core manifest version ${String(packageRecord.manifest.version)} disagrees with ${reference.id} at ${String(reference.manifest.version)}`,
          'set every core manifest to one byte-identical version',
        ),
      );
    }
  }
  return diagnostics;
}

function releaseOwners(architecture, releasePolicy) {
  const core = architecture.packages
    .filter(packageRecord => groupOf(releasePolicy, packageRecord.id) === 'core')
    .map(packageRecord => packageRecord.id)
    .toSorted(compareText);
  return Object.freeze(
    Object.fromEntries([
      ['core', freezeArray(core)],
      ...architecture.packages
        .filter(packageRecord => groupOf(releasePolicy, packageRecord.id) !== 'core')
        .toSorted((left, right) => compareText(left.id, right.id))
        .map(packageRecord => [packageRecord.id, freezeArray([packageRecord.id])]),
    ]),
  );
}

function releaseDependencyGraph(architecture, releasePolicy) {
  const architectureGraph = createDependencyGraph(architecture);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(architectureGraph).map(([id, dependencies]) => [
        id,
        freezeArray(
          [...new Set([...dependencies, ...Object.keys(releasePolicy[id]?.internalCompatibility ?? {})])].toSorted(
            compareText,
          ),
        ),
      ]),
    ),
  );
}

export class ReleaseGovernanceError extends Error {
  constructor(diagnostics) {
    super(diagnostics.join('\n'));
    this.name = 'ReleaseGovernanceError';
    this.diagnostics = freezeArray(diagnostics);
  }
}

export function releaseModel(root, options = {}) {
  const resolvedRoot = resolve(root);
  const { architecture } = options;
  if (architecture === undefined) {
    throw new TypeError('releaseModel requires architecture from loadGovernanceSnapshot({ root })');
  }
  const releasePolicy = loadReleasePolicy(resolvedRoot);
  const diagnostics = [
    ...policyDiagnostics(architecture, releasePolicy),
    ...coreVersionDiagnostics(architecture, releasePolicy),
  ];
  for (const packageRecord of architecture.packages) {
    diagnostics.push(
      ...internalProjectionDiagnostics(packageRecord, architecture, releasePolicy),
      ...peerProjectionDiagnostics(packageRecord, architecture, releasePolicy),
    );
  }

  const changelogPath = join(resolvedRoot, 'CHANGELOG.md');
  let changelogSource = '';
  try {
    changelogSource = readFileSync(changelogPath, 'utf8');
  } catch {
    diagnostics.push(
      diagnostic(
        'RELEASE_CHANGELOG_MISSING',
        'CHANGELOG.md',
        'root release notes are absent',
        'restore the one project changelog',
      ),
    );
  }
  const owners = releaseOwners(architecture, releasePolicy);
  const changelog = parseChangelog(changelogSource, owners);
  diagnostics.push(...changelog.diagnostics);

  if (diagnostics.length > 0) {
    throw new ReleaseGovernanceError([...new Set(diagnostics)].toSorted(compareText));
  }

  const order = topologicalOrder(releaseDependencyGraph(architecture, releasePolicy));
  const entries = order.map(id => {
    const packageRecord = lookupPackage(architecture, id);
    if (packageRecord === undefined) throw new TypeError(`topological order references unknown catalog id ${id}`);
    return packageRecord;
  });
  const model = Object.freeze({
    architecture,
    changelog,
    changelogSource,
    entries: freezeArray(entries),
    releaseOwners: owners,
    releasePolicy,
    root: resolvedRoot,
  });
  return Object.freeze({
    ...model,
    plan: createReleasePlan(model, currentCoreTarget(model)),
  });
}

export function currentCoreTarget(model) {
  const packageRecord = model.architecture.packages.find(
    candidate => groupOf(model.releasePolicy, candidate.id) === 'core',
  );
  if (packageRecord === undefined || typeof packageRecord.manifest.version !== 'string') {
    throw new TypeError('release policy has no versioned core package');
  }
  return Object.freeze({ kind: 'core', version: packageRecord.manifest.version });
}

function targetIdentity(model, target) {
  if (!isRecord(target) || (target.kind !== 'core' && target.kind !== 'package')) {
    throw new TypeError('release target must be { kind: "core"|"package", ... }');
  }
  if (parseSemver(target.version) === undefined || releaseChannel(target.version) === undefined) {
    throw new TypeError(`release target version ${String(target.version)} is not a supported SemVer`);
  }
  if (target.kind === 'core') {
    return Object.freeze({ releaseId: 'core', version: target.version });
  }
  if (typeof target.id !== 'string' || target.id.length === 0) {
    throw new TypeError('package release target requires a catalog id');
  }
  const packageRecord = lookupPackage(model.architecture, target.id);
  if (packageRecord === undefined) throw new TypeError(`unknown release target ${target.id}`);
  if (groupOf(model.releasePolicy, packageRecord.id) === 'core') {
    throw new TypeError(`${target.id} belongs to the core release target`);
  }
  return Object.freeze({ releaseId: packageRecord.id, version: target.version });
}

function publishedCoreRange(version) {
  const parsed = parseSemver(version);
  if (parsed === undefined) throw new TypeError(`invalid core release version ${version}`);
  return parsed.prerelease.length > 0 ? version : `^${version}`;
}

export function createReleasePlan(model, target) {
  const identity = targetIdentity(model, target);
  const selectedIds =
    identity.releaseId === 'core'
      ? new Set(
          model.architecture.packages
            .filter(packageRecord => groupOf(model.releasePolicy, packageRecord.id) === 'core')
            .map(packageRecord => packageRecord.id),
        )
      : new Set([identity.releaseId]);
  const selected = model.entries.filter(entry => selectedIds.has(entry.id));
  const manifestChanges = selected.map(entry => {
    const packageRecord = lookupPackage(model.architecture, entry.id);
    if (packageRecord === undefined) throw new TypeError(`release entry ${entry.id} is not in the catalog`);
    const row = model.releasePolicy[entry.id];
    const ranges = [];
    for (const dependency of packageRecord.policy.allowedWorkspaceDependencies) {
      const targetPackage = lookupPackage(model.architecture, dependency);
      if (targetPackage === undefined) continue;
      const range = selectedIds.has(dependency)
        ? publishedCoreRange(identity.version)
        : row.internalCompatibility[dependency]?.range;
      if (range !== undefined) ranges.push([targetPackage.npmName, range]);
    }
    for (const [peer, compatibility] of Object.entries(row.peers)) {
      ranges.push([peer, compatibility.range]);
    }
    return Object.freeze({
      package: packageRecord.npmName,
      version: identity.version,
      ranges: Object.freeze(Object.fromEntries(ranges.toSorted(([left], [right]) => compareText(left, right)))),
    });
  });
  const compatibilityCases = [
    ...new Set(
      selected.flatMap(entry => {
        const row = model.releasePolicy[entry.id];
        return [
          ...Object.values(row.internalCompatibility).map(compatibility => compatibility.evidence),
          ...Object.values(row.peers).map(compatibility => compatibility.evidence),
        ];
      }),
    ),
  ].toSorted(compareText);
  const released = model.changelog.releases.get(`${identity.releaseId}@${identity.version}`);
  return Object.freeze({
    releaseId: identity.releaseId,
    version: identity.version,
    packages: freezeArray(selected.map(entry => entry.npmName)),
    publishOrder: freezeArray(selected.map(entry => entry.npmName)),
    manifestChanges: freezeArray(manifestChanges),
    compatibilityCases: freezeArray(compatibilityCases),
    changelogEntry: released?.body ?? '',
  });
}
