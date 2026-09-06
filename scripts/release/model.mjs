import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createDependencyGraph,
  loadArchitectureSync,
  lookupPackage,
  topologicalOrder,
} from '../architecture/index.mjs';
import { compareText, parseChangelog, parseSemver } from './lib.mjs';

const freezeArray = values => Object.freeze([...values]);

export class ReleaseGovernanceError extends Error {
  constructor(diagnostics) {
    super(diagnostics.join('\n'));
    this.name = 'ReleaseGovernanceError';
    this.diagnostics = freezeArray(diagnostics);
  }
}

function versionDiagnostic(versions, invalid) {
  const measured = [
    ...[...versions.entries()]
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([version, ids]) => `${version} (${ids.toSorted(compareText).join(', ')})`),
    ...invalid
      .toSorted((left, right) => compareText(left.id, right.id))
      .map(item => `${String(item.version)} (${item.id})`),
  ].join(', ');
  return `[RELEASE_VERSION_DRIFT] lockstep train versions ${measured}: catalog packages do not share one valid version. Remediation: run one whole-train bump.`;
}

export function releaseModel(root) {
  const resolvedRoot = resolve(root);
  const architecture = loadArchitectureSync(resolvedRoot);
  const catalogOrder = [...architecture.packages].toSorted((left, right) => compareText(left.id, right.id));
  const versions = new Map();
  const invalid = [];

  for (const packageRecord of catalogOrder) {
    const parsed = parseSemver(packageRecord.manifest.version);
    if (parsed === undefined) {
      invalid.push({ id: packageRecord.id, version: packageRecord.manifest.version });
      continue;
    }
    const ids = versions.get(parsed.source) ?? [];
    ids.push(packageRecord.id);
    versions.set(parsed.source, ids);
  }

  const diagnostics = [];
  if (versions.size !== 1 || invalid.length > 0) diagnostics.push(versionDiagnostic(versions, invalid));
  const version = versions.size === 1 && invalid.length === 0 ? versions.keys().next().value : undefined;

  const order = topologicalOrder(createDependencyGraph(architecture));
  const entries = order.map(id => {
    const packageRecord = lookupPackage(architecture, id);
    if (packageRecord === undefined) throw new TypeError(`topological order references unknown catalog id ${id}`);
    return Object.freeze({
      id: packageRecord.id,
      directory: packageRecord.directory,
      npmName: packageRecord.npmName,
    });
  });

  const changelogPath = join(resolvedRoot, 'CHANGELOG.md');
  let changelogSource = '';
  try {
    changelogSource = readFileSync(changelogPath, 'utf8');
  } catch {
    diagnostics.push(
      `[RELEASE_CHANGELOG_MISSING] ${version ?? 'unknown version'} at CHANGELOG.md: no unique non-empty version section exists. Remediation: add one non-empty exact version section.`,
    );
  }
  const changelog = parseChangelog(
    changelogSource,
    architecture.packages.map(packageRecord => packageRecord.id),
  );
  diagnostics.push(...changelog.diagnostics);

  const release = version === undefined ? undefined : changelog.releases.get(version);
  if (version !== undefined && (release === undefined || release.bulletCount === 0)) {
    diagnostics.push(
      `[RELEASE_CHANGELOG_MISSING] ${version} at CHANGELOG.md: no unique non-empty version section exists. Remediation: add one non-empty exact version section.`,
    );
  }
  if (diagnostics.length > 0) {
    throw new ReleaseGovernanceError([...new Set(diagnostics)].toSorted(compareText));
  }

  const plan = Object.freeze({
    version,
    packages: freezeArray(catalogOrder.map(packageRecord => packageRecord.npmName)),
    publishOrder: freezeArray(entries.map(entry => entry.npmName)),
    changelogEntry: release.body,
  });
  return Object.freeze({
    architecture,
    changelog,
    changelogSource,
    entries: freezeArray(entries),
    plan,
  });
}
