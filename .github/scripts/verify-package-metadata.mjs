#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { publishManifest, toDist } from './lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_FILES = ['README.md', 'LICENSE', 'SPEC.md', 'tsconfig.json', 'tsconfig.build.json'];
const REQUIRED_MANIFEST_FIELDS = [
  'author',
  'bugs',
  'description',
  'engines',
  'exports',
  'files',
  'homepage',
  'keywords',
  'license',
  'name',
  'publishConfig',
  'repository',
  'scripts',
  'sideEffects',
  'type',
  'version',
];
const OPTIONAL_MANIFEST_FIELDS = new Set([
  'bin',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'zmdb',
]);
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const PRODUCTION_DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const SOURCE_FILES = ['src', 'README.md', 'LICENSE'];
const PUBLISHED_FILES = ['dist', 'src', 'README.md', 'LICENSE'];
const HOMEPAGE = 'https://github.com/ambasta/zmdb#readme';
const BUGS_URL = 'https://github.com/ambasta/zmdb/issues';
const REPOSITORY_URL = 'git+https://github.com/ambasta/zmdb.git';
const METADATA_REMEDIATION = 'restore the exact schema value or required file';
const PEER_REMEDIATION = 'align the declaration and prove the range with the real peer';
const WORKSPACE_REMEDIATION = 'use workspace:^ in source and regenerate the publish manifest';
const VERSION_REMEDIATION = 'run one whole-train bump';

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function ownsRequiredPeer(packageRecord) {
  const kind = packageRecord.catalog.optionality?.kind;
  return packageRecord.policy.zone === 'integration' && (kind === 'integration' || kind === 'provider');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted(compareText)
      .map(key => [key, canonicalValue(value[key])]),
  );
}

const sameValue = (left, right) => JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));

const shown = value => (value === undefined ? 'missing' : JSON.stringify(value));

function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function isFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function metadataDiagnostic(packageRecord, field, detail) {
  return `[PACKAGE_METADATA_INVALID] ${packageRecord.npmName} field ${field}: ${detail}. Remediation: ${METADATA_REMEDIATION}.`;
}

function peerDiagnostic(packageRecord, peer, detail) {
  return `[PACKAGE_PEER_METADATA] ${packageRecord.npmName} peer ${peer}: ${detail}. Remediation: ${PEER_REMEDIATION}.`;
}

function workspaceDiagnostic(packageRecord, dependency, detail) {
  return `[PACKAGE_WORKSPACE_RANGE] ${packageRecord.npmName} dependency ${dependency}: ${detail}. Remediation: ${WORKSPACE_REMEDIATION}.`;
}

function versionDiagnostic(versions) {
  const measured = [...versions.entries()]
    .toSorted(([leftVersion], [rightVersion]) => compareText(leftVersion, rightVersion))
    .map(([version, ids]) => `${version} (${[...ids].toSorted(compareText).join(', ')})`)
    .join(', ');
  return `[PACKAGE_VERSION_DRIFT] lockstep train versions ${measured}: catalog packages do not share one version. Remediation: ${VERSION_REMEDIATION}.`;
}

function parseSemver(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (match === null) return undefined;

  const prerelease = match[4] === undefined ? [] : match[4].split('.');
  const build = match[5] === undefined ? [] : match[5].split('.');
  if (
    prerelease.some(
      identifier =>
        identifier.length === 0 ||
        !/^[0-9A-Za-z-]+$/.test(identifier) ||
        (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')),
    ) ||
    build.some(identifier => identifier.length === 0 || !/^[0-9A-Za-z-]+$/.test(identifier))
  ) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    source: value,
  };
}

function compareSemver(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return compareText(leftPart, rightPart);
  }
  return 0;
}

function upperBoundForCaret(version) {
  if (version.major > 0) return { ...version, major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  if (version.minor > 0) return { ...version, minor: version.minor + 1, patch: 0, prerelease: [] };
  return { ...version, patch: version.patch + 1, prerelease: [] };
}

function upperBoundForTilde(version) {
  return { ...version, minor: version.minor + 1, patch: 0, prerelease: [] };
}

function satisfiesComparator(version, operator, target) {
  const compared = compareSemver(version, target);
  if (operator === '>') return compared > 0;
  if (operator === '>=') return compared >= 0;
  if (operator === '<') return compared < 0;
  if (operator === '<=') return compared <= 0;
  return compared === 0;
}

function satisfiesRange(version, range) {
  if (typeof range !== 'string' || range.trim().length === 0) return false;
  return range.split('||').some(branch => {
    const trimmed = branch.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'latest') return true;
    if (trimmed.startsWith('^')) {
      const lower = parseSemver(trimmed.slice(1));
      return (
        lower !== undefined &&
        compareSemver(version, lower) >= 0 &&
        compareSemver(version, upperBoundForCaret(lower)) < 0
      );
    }
    if (trimmed.startsWith('~')) {
      const lower = parseSemver(trimmed.slice(1));
      return (
        lower !== undefined &&
        compareSemver(version, lower) >= 0 &&
        compareSemver(version, upperBoundForTilde(lower)) < 0
      );
    }
    const exact = parseSemver(trimmed);
    if (exact !== undefined) return compareSemver(version, exact) === 0;

    const comparators = trimmed.split(/\s+/);
    if (comparators.length === 0) return false;
    return comparators.every(comparator => {
      const match = /^(<=|>=|<|>|=)?(.+)$/.exec(comparator);
      if (match === null) return false;
      const target = parseSemver(match[2]);
      return target !== undefined && satisfiesComparator(version, match[1] ?? '=', target);
    });
  });
}

function rangeWitness(range) {
  if (typeof range !== 'string') return undefined;
  for (const branch of range.split('||')) {
    const trimmed = branch.trim();
    if (trimmed.startsWith('^') || trimmed.startsWith('~')) {
      const version = parseSemver(trimmed.slice(1));
      if (version !== undefined) return version;
    }
    const exact = parseSemver(trimmed);
    if (exact !== undefined) return exact;
    for (const comparator of trimmed.split(/\s+/)) {
      const match = /^(>=|=)(.+)$/.exec(comparator);
      if (match === null) continue;
      const version = parseSemver(match[2]);
      if (version !== undefined) return version;
    }
  }
  return undefined;
}

function dependencyRangeWitness(range, dependency, catalogByName) {
  if (range !== 'workspace:^') return rangeWitness(range);
  const packageRecord = catalogByName.get(dependency);
  return packageRecord === undefined ? undefined : parseSemver(packageRecord.manifest.version);
}

function dependencyRangeContains(range, witness, dependency, catalogByName) {
  if (range !== 'workspace:^') return satisfiesRange(witness, range);
  const packageRecord = catalogByName.get(dependency);
  const expected = packageRecord === undefined ? undefined : parseSemver(packageRecord.manifest.version);
  return expected !== undefined && compareSemver(witness, expected) === 0;
}

function releaseChannel(version) {
  if (version.prerelease.length === 0) return 'latest';
  const channel = version.prerelease[0];
  return channel === 'alpha' || channel === 'beta' || channel === 'rc' ? channel : undefined;
}

function sortedUniqueStrings(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(item => typeof item !== 'string' || item.length === 0)
  ) {
    return false;
  }
  const sorted = [...value].toSorted(compareText);
  return sameValue(value, sorted) && new Set(value).size === value.length;
}

function dependencySection(packageRecord, section, diagnostics) {
  const value = packageRecord.manifest[section];
  if (value === undefined) return {};
  if (!isRecord(value)) {
    diagnostics.push(
      metadataDiagnostic(packageRecord, section, `measured value is ${shown(value)}, expected an object`),
    );
    return {};
  }
  const keys = Object.keys(value);
  if (!sameValue(keys, keys.toSorted(compareText))) {
    diagnostics.push(metadataDiagnostic(packageRecord, section, `dependency names are not sorted: ${keys.join(', ')}`));
  }
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== 'string' || range.length === 0) {
      diagnostics.push(
        metadataDiagnostic(packageRecord, `${section}.${name}`, `measured value is ${shown(range)}, expected a range`),
      );
    }
  }
  return value;
}

function sourceTargetDiagnostics(packageRecord, field, target) {
  const diagnostics = [];
  if (
    typeof target !== 'string' ||
    !target.startsWith('./src/') ||
    !/\.tsx?$/.test(target) ||
    target.endsWith('.d.ts') ||
    target.includes('*')
  ) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        field,
        `measured target is ${shown(target)}, expected an explicit package-local ./src/*.ts path`,
      ),
    );
    return diagnostics;
  }
  const path = resolve(packageRecord.directoryPath, target);
  if (!isInside(packageRecord.directoryPath, path)) {
    diagnostics.push(metadataDiagnostic(packageRecord, field, `target ${target} escapes the package directory`));
  } else if (!isFile(path)) {
    diagnostics.push(metadataDiagnostic(packageRecord, field, `target ${target} does not exist`));
  }
  return diagnostics;
}

function manifestShapeDiagnostics(packageRecord) {
  const diagnostics = [];
  const manifest = packageRecord.manifest;
  const allowedFields = new Set([...REQUIRED_MANIFEST_FIELDS, ...OPTIONAL_MANIFEST_FIELDS]);

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!Object.hasOwn(manifest, field)) {
      diagnostics.push(metadataDiagnostic(packageRecord, field, 'measured value is missing'));
    }
  }
  for (const field of Object.keys(manifest)) {
    if (!allowedFields.has(field)) {
      diagnostics.push(metadataDiagnostic(packageRecord, field, 'field is not part of the package manifest schema'));
    }
  }

  if (manifest.name !== packageRecord.npmName) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'name',
        `measured value is ${shown(manifest.name)}, expected ${JSON.stringify(packageRecord.npmName)}`,
      ),
    );
  }
  if (parseSemver(manifest.version) === undefined) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'version',
        `measured value is ${shown(manifest.version)}, expected valid SemVer`,
      ),
    );
  }
  if (typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'description',
        `measured value is ${shown(manifest.description)}, expected a non-empty string`,
      ),
    );
  }
  if (!sortedUniqueStrings(manifest.keywords) || !manifest.keywords.includes('zmdb')) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'keywords',
        `measured value is ${shown(manifest.keywords)}, expected sorted unique non-empty strings containing "zmdb"`,
      ),
    );
  }
  if (manifest.homepage !== HOMEPAGE) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'homepage',
        `measured value is ${shown(manifest.homepage)}, expected ${JSON.stringify(HOMEPAGE)}`,
      ),
    );
  }
  if (!sameValue(manifest.bugs, { url: BUGS_URL })) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'bugs',
        `measured value is ${shown(manifest.bugs)}, expected ${JSON.stringify({ url: BUGS_URL })}`,
      ),
    );
  }
  if (manifest.license !== 'GPL-3.0-or-later') {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'license',
        `measured value is ${shown(manifest.license)}, expected "GPL-3.0-or-later"`,
      ),
    );
  }
  if (manifest.author !== 'zmdb contributors') {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'author',
        `measured value is ${shown(manifest.author)}, expected "zmdb contributors"`,
      ),
    );
  }
  const expectedRepository = {
    type: 'git',
    url: REPOSITORY_URL,
    directory: packageRecord.directory,
  };
  if (!sameValue(manifest.repository, expectedRepository)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'repository',
        `measured value is ${shown(manifest.repository)}, expected ${JSON.stringify(expectedRepository)}`,
      ),
    );
  }
  if (!sameValue(manifest.files, SOURCE_FILES)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'files',
        `measured value is ${shown(manifest.files)}, expected ${JSON.stringify(SOURCE_FILES)}`,
      ),
    );
  }
  if (manifest.type !== 'module') {
    diagnostics.push(
      metadataDiagnostic(packageRecord, 'type', `measured value is ${shown(manifest.type)}, expected "module"`),
    );
  }

  if (manifest.sideEffects !== false) {
    if (!sortedUniqueStrings(manifest.sideEffects)) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'sideEffects',
          `measured value is ${shown(manifest.sideEffects)}, expected false or a sorted unique source-file allowlist`,
        ),
      );
    } else {
      for (const [index, target] of manifest.sideEffects.entries()) {
        diagnostics.push(...sourceTargetDiagnostics(packageRecord, `sideEffects[${String(index)}]`, target));
      }
    }
  }

  if (!isRecord(manifest.exports) || Object.keys(manifest.exports).length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'exports',
        `measured value is ${shown(manifest.exports)}, expected a non-empty explicit export map`,
      ),
    );
  } else {
    for (const [entry, target] of Object.entries(manifest.exports)) {
      const field = `exports[${JSON.stringify(entry)}]`;
      if ((entry !== '.' && !entry.startsWith('./')) || entry.includes('*')) {
        diagnostics.push(
          metadataDiagnostic(packageRecord, field, 'entry key is not an explicit wildcard-free subpath'),
        );
      }
      diagnostics.push(...sourceTargetDiagnostics(packageRecord, field, target));
    }
  }

  let bins = {};
  if (typeof manifest.bin === 'string') {
    bins = { [packageRecord.npmName.split('/').at(-1)]: manifest.bin };
  } else if (manifest.bin !== undefined) {
    if (!isRecord(manifest.bin)) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'bin',
          `measured value is ${shown(manifest.bin)}, expected a string or object`,
        ),
      );
    } else {
      bins = manifest.bin;
    }
  }
  const binNames = Object.keys(bins);
  if (!sameValue(binNames, binNames.toSorted(compareText))) {
    diagnostics.push(metadataDiagnostic(packageRecord, 'bin', `command names are not sorted: ${binNames.join(', ')}`));
  }
  for (const [command, target] of Object.entries(bins)) {
    diagnostics.push(...sourceTargetDiagnostics(packageRecord, `bin.${command}`, target));
    if (!packageRecord.policy.toolingEntries.includes(`bin:${command}`)) {
      diagnostics.push(
        metadataDiagnostic(packageRecord, `bin.${command}`, 'command has no matching policy tooling selector'),
      );
    }
    if (typeof target === 'string') {
      const path = resolve(packageRecord.directoryPath, target);
      if (isInside(packageRecord.directoryPath, path) && isFile(path)) {
        const firstLine = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0];
        if (firstLine !== '#!/usr/bin/env node') {
          diagnostics.push(
            metadataDiagnostic(packageRecord, `bin.${command}`, 'target is missing #!/usr/bin/env node'),
          );
        }
      }
    }
  }

  if (!isRecord(manifest.publishConfig)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'publishConfig',
        `measured value is ${shown(manifest.publishConfig)}, expected an object`,
      ),
    );
  } else {
    if (manifest.publishConfig.access !== 'public') {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'publishConfig.access',
          `measured value is ${shown(manifest.publishConfig.access)}, expected "public"`,
        ),
      );
    }
    const version = parseSemver(manifest.version);
    const expectedChannel = version === undefined ? undefined : releaseChannel(version);
    if (expectedChannel === undefined || manifest.publishConfig.tag !== expectedChannel) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'publishConfig.tag',
          `measured value is ${shown(manifest.publishConfig.tag)}, expected ${shown(expectedChannel)} for ${shown(manifest.version)}`,
        ),
      );
    }
  }

  if (!isRecord(manifest.scripts)) {
    diagnostics.push(
      metadataDiagnostic(packageRecord, 'scripts', `measured value is ${shown(manifest.scripts)}, expected an object`),
    );
  } else {
    if (manifest.scripts.build !== 'node ../../scripts/build-package.mjs') {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'scripts.build',
          `measured value is ${shown(manifest.scripts.build)}, expected "node ../../scripts/build-package.mjs"`,
        ),
      );
    }
    if (manifest.scripts.test !== 'vitest run') {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'scripts.test',
          `measured value is ${shown(manifest.scripts.test)}, expected "vitest run"`,
        ),
      );
    }
  }

  if (!isRecord(manifest.engines) || typeof manifest.engines.node !== 'string') {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'engines.node',
        `measured value is ${shown(manifest.engines?.node)}, expected a Node range`,
      ),
    );
  } else {
    const match = /^>=\s*(\d+)(?:\.\d+(?:\.\d+)?)?$/.exec(manifest.engines.node);
    if (match === null || Number(match[1]) < 26) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'engines.node',
          `measured value is ${shown(manifest.engines.node)}, expected a >= range that admits no Node version below 26`,
        ),
      );
    }
  }

  if (manifest.zmdb !== undefined) {
    const keys = isRecord(manifest.zmdb) ? Object.keys(manifest.zmdb) : [];
    if (
      !isRecord(manifest.zmdb) ||
      keys.length === 0 ||
      !sameValue(keys, keys.toSorted(compareText)) ||
      keys.some(key => key.length === 0 || typeof manifest.zmdb[key] !== 'string' || manifest.zmdb[key].length === 0)
    ) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'zmdb',
          `measured value is ${shown(manifest.zmdb)}, expected sorted non-empty string-valued package metadata`,
        ),
      );
    }
  }

  for (const file of REQUIRED_FILES) {
    const path = join(packageRecord.directoryPath, file);
    if (!isFile(path)) diagnostics.push(metadataDiagnostic(packageRecord, file, 'required package file is missing'));
  }

  return diagnostics;
}

function dependencyDiagnostics(packageRecord, catalogByName) {
  const diagnostics = [];
  const sections = Object.fromEntries(
    DEPENDENCY_SECTIONS.map(section => [section, dependencySection(packageRecord, section, diagnostics)]),
  );
  const peerMetadata = packageRecord.manifest.peerDependenciesMeta;
  if (peerMetadata !== undefined && !isRecord(peerMetadata)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'peerDependenciesMeta',
        `measured value is ${shown(peerMetadata)}, expected an object`,
      ),
    );
  } else if (isRecord(peerMetadata)) {
    const names = Object.keys(peerMetadata);
    if (!sameValue(names, names.toSorted(compareText))) {
      diagnostics.push(
        metadataDiagnostic(packageRecord, 'peerDependenciesMeta', `peer names are not sorted: ${names.join(', ')}`),
      );
    }
  }

  const owners = new Map();
  for (const section of PRODUCTION_DEPENDENCY_SECTIONS) {
    for (const name of Object.keys(sections[section])) {
      const assigned = owners.get(name) ?? [];
      assigned.push(section);
      owners.set(name, assigned);
    }
  }
  for (const [name, assigned] of owners) {
    if (assigned.length > 1) {
      diagnostics.push(
        metadataDiagnostic(packageRecord, name, `dependency ownership is duplicated across ${assigned.join(', ')}`),
      );
    }
  }

  for (const [section, dependencies] of Object.entries(sections)) {
    for (const [name, range] of Object.entries(dependencies)) {
      if (catalogByName.has(name) && range !== 'workspace:^') {
        diagnostics.push(
          workspaceDiagnostic(
            packageRecord,
            name,
            `measured ${section} range is ${shown(range)}, expected "workspace:^"`,
          ),
        );
      }
    }
  }

  for (const dependency of packageRecord.policy.allowedRuntimeDependencies) {
    if (sections.dependencies[dependency] === undefined) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          `dependencies.${dependency}`,
          `measured value is missing while an ordinary runtime entry and policy allowance use ${dependency}`,
        ),
      );
    }
  }

  const optionalPeers = new Set(Object.keys(packageRecord.policy.optionalPeerEntries));
  for (const peer of optionalPeers) {
    const range = sections.peerDependencies[peer];
    if (typeof range !== 'string') {
      diagnostics.push(peerDiagnostic(packageRecord, peer, 'peerDependencies declaration is missing'));
    }
    const metadata = isRecord(peerMetadata) ? peerMetadata[peer] : undefined;
    if (!isRecord(metadata) || metadata.optional !== true) {
      diagnostics.push(peerDiagnostic(packageRecord, peer, `peerDependenciesMeta.${peer}.optional is missing`));
    } else if (!sameValue(Object.keys(metadata).toSorted(compareText), ['optional'])) {
      diagnostics.push(peerDiagnostic(packageRecord, peer, 'optional metadata contains fields other than optional'));
    }
    if (sections.dependencies[peer] !== undefined || sections.optionalDependencies[peer] !== undefined) {
      diagnostics.push(
        peerDiagnostic(packageRecord, peer, 'optional peer is also owned by a production dependency section'),
      );
    }
    const devRange = sections.devDependencies[peer];
    const witness = dependencyRangeWitness(devRange, peer, catalogByName);
    if (typeof devRange !== 'string') {
      diagnostics.push(peerDiagnostic(packageRecord, peer, 'devDependencies evidence is missing'));
    } else if (
      typeof range === 'string' &&
      (witness === undefined || !dependencyRangeContains(range, witness, peer, catalogByName))
    ) {
      diagnostics.push(
        peerDiagnostic(
          packageRecord,
          peer,
          `devDependencies range ${JSON.stringify(devRange)} has no measured witness inside peer range ${JSON.stringify(range)}`,
        ),
      );
    }
  }

  for (const [peer, range] of Object.entries(sections.peerDependencies)) {
    const metadata = isRecord(peerMetadata) ? peerMetadata[peer] : undefined;
    const isOptional = isRecord(metadata) && metadata.optional === true;
    if (isOptional && !optionalPeers.has(peer)) {
      diagnostics.push(peerDiagnostic(packageRecord, peer, 'optional metadata has no matching policy assignment'));
    }
    if (!optionalPeers.has(peer)) {
      if (!ownsRequiredPeer(packageRecord)) {
        diagnostics.push(
          peerDiagnostic(packageRecord, peer, 'required peer is owned by a non-integration/provider package'),
        );
      }
      if (metadata !== undefined) {
        diagnostics.push(peerDiagnostic(packageRecord, peer, 'required peer must omit peerDependenciesMeta'));
      }
      const devRange = sections.devDependencies[peer];
      const witness = dependencyRangeWitness(devRange, peer, catalogByName);
      if (typeof devRange !== 'string') {
        diagnostics.push(peerDiagnostic(packageRecord, peer, 'required peer has no devDependencies evidence'));
      } else if (
        typeof range === 'string' &&
        (witness === undefined || !dependencyRangeContains(range, witness, peer, catalogByName))
      ) {
        diagnostics.push(
          peerDiagnostic(
            packageRecord,
            peer,
            `devDependencies range ${JSON.stringify(devRange)} has no measured witness inside peer range ${JSON.stringify(range)}`,
          ),
        );
      }
    }
  }

  if (isRecord(peerMetadata)) {
    for (const peer of Object.keys(peerMetadata)) {
      if (sections.peerDependencies[peer] === undefined) {
        diagnostics.push(peerDiagnostic(packageRecord, peer, 'peerDependenciesMeta entry has no peer dependency'));
      }
    }
  }

  return diagnostics;
}

function publishedManifestDiagnostics(packageRecord, commonVersion, catalogByName) {
  const diagnostics = [];
  let published;
  try {
    published = publishManifest(packageRecord.manifest, commonVersion);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [metadataDiagnostic(packageRecord, 'publish manifest', `transform failed: ${message}`)];
  }

  if (!sameValue(published.files, PUBLISHED_FILES)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'publish files',
        `measured value is ${shown(published.files)}, expected ${JSON.stringify(PUBLISHED_FILES)}`,
      ),
    );
  }
  if (Object.hasOwn(published, 'devDependencies')) {
    diagnostics.push(
      metadataDiagnostic(packageRecord, 'publish devDependencies', 'consumer manifest retains dev dependencies'),
    );
  }
  const sourceRoot = isRecord(packageRecord.manifest.exports) ? packageRecord.manifest.exports['.'] : undefined;
  const expectedMain = typeof sourceRoot === 'string' ? toDist(sourceRoot, '.js') : undefined;
  const expectedTypes = typeof sourceRoot === 'string' ? toDist(sourceRoot, '.d.ts') : undefined;
  if (published.main !== expectedMain || published.types !== expectedTypes) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'publish entry',
        `measured main/types are ${shown([published.main, published.types])}, expected ${shown([expectedMain, expectedTypes])}`,
      ),
    );
  }

  if (isRecord(packageRecord.manifest.exports)) {
    const expectedExports = Object.fromEntries(
      Object.entries(packageRecord.manifest.exports).map(([entry, target]) => [
        entry,
        typeof target === 'string'
          ? {
              types: toDist(target, '.d.ts'),
              import: toDist(target, '.js'),
            }
          : target,
      ]),
    );
    if (!sameValue(published.exports, expectedExports)) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'publish exports',
          `measured value is ${shown(published.exports)}, expected ${JSON.stringify(expectedExports)}`,
        ),
      );
    }
  }

  if (packageRecord.manifest.bin !== undefined) {
    const expectedBin =
      typeof packageRecord.manifest.bin === 'string'
        ? toDist(packageRecord.manifest.bin, '.js')
        : Object.fromEntries(
            Object.entries(packageRecord.manifest.bin).map(([command, target]) => [
              command,
              typeof target === 'string' ? toDist(target, '.js') : target,
            ]),
          );
    if (!sameValue(published.bin, expectedBin)) {
      diagnostics.push(
        metadataDiagnostic(
          packageRecord,
          'publish bin',
          `measured value is ${shown(published.bin)}, expected ${JSON.stringify(expectedBin)}`,
        ),
      );
    }
  }

  const expectedSideEffects = Array.isArray(packageRecord.manifest.sideEffects)
    ? packageRecord.manifest.sideEffects.map(target => toDist(target, '.js'))
    : packageRecord.manifest.sideEffects;
  if (!sameValue(published.sideEffects, expectedSideEffects)) {
    diagnostics.push(
      metadataDiagnostic(
        packageRecord,
        'publish sideEffects',
        `measured value is ${shown(published.sideEffects)}, expected ${JSON.stringify(expectedSideEffects)}`,
      ),
    );
  }

  const parsedVersion = parseSemver(commonVersion);
  const expectedWorkspaceRange =
    parsedVersion === undefined ? undefined : parsedVersion.prerelease.length > 0 ? commonVersion : `^${commonVersion}`;
  for (const section of PRODUCTION_DEPENDENCY_SECTIONS) {
    for (const [dependency, sourceRange] of Object.entries(packageRecord.manifest[section] ?? {})) {
      const publishedRange = published[section]?.[dependency];
      if (catalogByName.has(dependency) && sourceRange === 'workspace:^' && publishedRange !== expectedWorkspaceRange) {
        diagnostics.push(
          workspaceDiagnostic(
            packageRecord,
            dependency,
            `publish ${section} range is ${shown(publishedRange)}, expected ${shown(expectedWorkspaceRange)}`,
          ),
        );
      }
      if (typeof publishedRange === 'string' && publishedRange.startsWith('workspace:')) {
        diagnostics.push(
          workspaceDiagnostic(
            packageRecord,
            dependency,
            `publish ${section} retains source range ${JSON.stringify(publishedRange)}`,
          ),
        );
      }
    }
  }

  for (const field of [
    'author',
    'bugs',
    'description',
    'engines',
    'homepage',
    'keywords',
    'license',
    'name',
    'peerDependenciesMeta',
    'publishConfig',
    'repository',
    'scripts',
    'type',
    'version',
    'zmdb',
  ]) {
    if (!sameValue(published[field], packageRecord.manifest[field])) {
      diagnostics.push(
        metadataDiagnostic(packageRecord, `publish ${field}`, 'transform did not preserve source metadata'),
      );
    }
  }

  return diagnostics;
}

export function packageMetadataDiagnostics(architecture) {
  const diagnostics = [];
  const catalogByName = new Map(architecture.packages.map(packageRecord => [packageRecord.npmName, packageRecord]));
  const versions = new Map();
  let everyVersionValid = true;

  for (const packageRecord of architecture.packages) {
    diagnostics.push(...manifestShapeDiagnostics(packageRecord));
    diagnostics.push(...dependencyDiagnostics(packageRecord, catalogByName));
    const parsed = parseSemver(packageRecord.manifest.version);
    if (parsed === undefined) {
      everyVersionValid = false;
    } else {
      const ids = versions.get(parsed.source) ?? [];
      ids.push(packageRecord.id);
      versions.set(parsed.source, ids);
    }
  }

  if (everyVersionValid && versions.size > 1) diagnostics.push(versionDiagnostic(versions));
  const commonVersion = everyVersionValid && versions.size === 1 ? versions.keys().next().value : undefined;
  if (typeof commonVersion === 'string') {
    for (const packageRecord of architecture.packages) {
      diagnostics.push(...publishedManifestDiagnostics(packageRecord, commonVersion, catalogByName));
    }
  }

  return [...new Set(diagnostics)].toSorted(compareText);
}

export async function inspectPackageMetadata(root, options = {}) {
  const { architecture } = options;
  if (architecture === undefined) {
    throw new TypeError('inspectPackageMetadata requires architecture from loadGovernanceSnapshot({ root })');
  }
  const diagnostics = packageMetadataDiagnostics(architecture);
  const versions = new Set(
    architecture.packages
      .map(packageRecord => packageRecord.manifest.version)
      .filter(version => typeof version === 'string' && parseSemver(version) !== undefined),
  );
  return {
    diagnostics,
    packageCount: architecture.packages.length,
    version: versions.size === 1 ? versions.values().next().value : undefined,
  };
}

function architectureWithManifest(architecture, id, transform) {
  return {
    ...architecture,
    packages: architecture.packages.map(packageRecord =>
      packageRecord.id === id ? { ...packageRecord, manifest: transform(packageRecord.manifest) } : packageRecord,
    ),
  };
}

function assertDiagnostics(label, actual, expected) {
  if (!sameValue(actual, expected)) {
    throw new Error(
      `${label} self-test mismatch\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`,
    );
  }
}

function assertPublishTransform() {
  const source = {
    name: '@fixture/publish',
    version: '2.0.0-beta.3',
    sideEffects: ['./src/polyfill.ts'],
    exports: { '.': './src/index.ts' },
    bin: { fixture: './src/cli.ts' },
    files: SOURCE_FILES,
    dependencies: { '@fixture/dependency': 'workspace:^' },
    optionalDependencies: { '@fixture/optional': 'workspace:^' },
    peerDependencies: { '@fixture/peer': 'workspace:^' },
    devDependencies: { fixture: '1.0.0' },
  };
  const prerelease = publishManifest(source, source.version);
  const expectedPrerelease = '2.0.0-beta.3';
  for (const [section, dependency] of [
    ['dependencies', '@fixture/dependency'],
    ['optionalDependencies', '@fixture/optional'],
    ['peerDependencies', '@fixture/peer'],
  ]) {
    if (prerelease[section]?.[dependency] !== expectedPrerelease) {
      throw new Error(`${section}.${dependency} did not publish the exact prerelease`);
    }
  }
  if (!sameValue(prerelease.sideEffects, ['./dist/polyfill.js'])) {
    throw new Error(`sideEffects did not repoint to dist: ${shown(prerelease.sideEffects)}`);
  }
  if (Object.hasOwn(prerelease, 'devDependencies')) throw new Error('publish manifest retained devDependencies');

  const subpathsOnly = publishManifest(
    {
      ...source,
      exports: {
        './client': './src/client.ts',
        './server': './src/server.ts',
      },
    },
    source.version,
  );
  if (Object.hasOwn(subpathsOnly, 'main') || Object.hasOwn(subpathsOnly, 'types')) {
    throw new Error('subpath-only publish manifest invented a root entry');
  }

  const stable = publishManifest({ ...source, version: '2.0.0' }, '2.0.0');
  if (stable.dependencies?.['@fixture/dependency'] !== '^2.0.0') {
    throw new Error('stable workspace dependency did not publish as ^2.0.0');
  }
  const stableBuild = publishManifest({ ...source, version: '2.0.0+build-3' }, '2.0.0+build-3');
  if (stableBuild.dependencies?.['@fixture/dependency'] !== '^2.0.0+build-3') {
    throw new Error('stable build metadata was mistaken for a prerelease');
  }
}

async function runSelfTest() {
  const fixtures = join(ROOT, 'scripts', 'architecture', '__fixtures__');
  const { loadGovernanceSnapshot } = await import('../../scripts/architecture/governance.mjs');
  const architectureFor = async root => {
    const snapshot = await loadGovernanceSnapshot({ root, checks: [] });
    if (snapshot.architecture === null) {
      throw new Error(snapshot.findings.map(item => item.line).join('\n') || 'governance snapshot has no architecture');
    }
    return snapshot.architecture;
  };
  const valid = await architectureFor(join(fixtures, 'valid'));
  assertDiagnostics('valid fixture', packageMetadataDiagnostics(valid), []);

  const metadataDriftRoot = join(fixtures, 'metadata-drift');
  const metadataDrift = await inspectPackageMetadata(metadataDriftRoot, {
    architecture: await architectureFor(metadataDriftRoot),
  });
  assertDiagnostics('metadata drift fixture', metadataDrift.diagnostics, [
    '[PACKAGE_METADATA_INVALID] @fixture/app field dependencies.fixture-runtime: measured value is missing while an ordinary runtime entry and policy allowance use fixture-runtime. Remediation: restore the exact schema value or required file.',
  ]);

  const versionDriftRoot = join(fixtures, 'version-drift');
  const versionDrift = await inspectPackageMetadata(versionDriftRoot, {
    architecture: await architectureFor(versionDriftRoot),
  });
  assertDiagnostics('version drift fixture', versionDrift.diagnostics, [
    '[PACKAGE_VERSION_DRIFT] lockstep train versions 1.0.0-alpha.3 (core), 1.0.0-alpha.4 (app): catalog packages do not share one version. Remediation: run one whole-train bump.',
  ]);

  const optionalPeerDrift = architectureWithManifest(valid, 'app', manifest => ({
    ...manifest,
    peerDependenciesMeta: {},
  }));
  assertDiagnostics('optional peer metadata', packageMetadataDiagnostics(optionalPeerDrift), [
    '[PACKAGE_PEER_METADATA] @fixture/app peer fixture-peer: peerDependenciesMeta.fixture-peer.optional is missing. Remediation: align the declaration and prove the range with the real peer.',
  ]);

  const internalOptionalPeer = {
    ...valid,
    packages: valid.packages.map(packageRecord => {
      if (packageRecord.id !== 'app') return packageRecord;
      return {
        ...packageRecord,
        manifest: {
          ...packageRecord.manifest,
          dependencies: Object.fromEntries(
            Object.entries(packageRecord.manifest.dependencies).filter(([name]) => name !== '@fixture/core'),
          ),
          devDependencies: {
            '@fixture/core': 'workspace:^',
            ...packageRecord.manifest.devDependencies,
          },
          peerDependencies: {
            '@fixture/core': 'workspace:^',
            ...packageRecord.manifest.peerDependencies,
          },
          peerDependenciesMeta: {
            '@fixture/core': {
              optional: true,
            },
            ...packageRecord.manifest.peerDependenciesMeta,
          },
        },
        policy: {
          ...packageRecord.policy,
          optionalPeerEntries: {
            ...packageRecord.policy.optionalPeerEntries,
            '@fixture/core': ['.'],
          },
        },
      };
    }),
  };
  assertDiagnostics('internal optional peer metadata', packageMetadataDiagnostics(internalOptionalPeer), []);

  const workspaceDrift = architectureWithManifest(valid, 'app', manifest => ({
    ...manifest,
    dependencies: {
      ...manifest.dependencies,
      '@fixture/core': 'workspace:*',
    },
  }));
  assertDiagnostics('workspace source range', packageMetadataDiagnostics(workspaceDrift), [
    '[PACKAGE_WORKSPACE_RANGE] @fixture/app dependency @fixture/core: measured dependencies range is "workspace:*", expected "workspace:^". Remediation: use workspace:^ in source and regenerate the publish manifest.',
  ]);

  const schemaDrift = architectureWithManifest(valid, 'app', manifest => ({
    ...manifest,
    repository: {
      ...manifest.repository,
      directory: 'packages/stale-app',
    },
    files: ['src', 'README.md'],
    exports: {
      ...manifest.exports,
      '.': './src/missing.ts',
    },
  }));
  assertDiagnostics('manifest schema drift', packageMetadataDiagnostics(schemaDrift), [
    '[PACKAGE_METADATA_INVALID] @fixture/app field exports["."]: target ./src/missing.ts does not exist. Remediation: restore the exact schema value or required file.',
    '[PACKAGE_METADATA_INVALID] @fixture/app field files: measured value is ["src","README.md"], expected ["src","README.md","LICENSE"]. Remediation: restore the exact schema value or required file.',
    '[PACKAGE_METADATA_INVALID] @fixture/app field repository: measured value is {"type":"git","url":"git+https://github.com/ambasta/zmdb.git","directory":"packages/stale-app"}, expected {"type":"git","url":"git+https://github.com/ambasta/zmdb.git","directory":"packages/app"}. Remediation: restore the exact schema value or required file.',
  ]);

  assertPublishTransform();
  console.log(
    'Package metadata self-test passed: valid, schema drift, version drift, optional-peer metadata, workspace ranges, and publish transforms.',
  );
}

class UsageError extends Error {}

function parseArguments(argv) {
  let root = ROOT;
  let rootSupplied = false;
  let selfTest = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new UsageError('--root requires a path');
      root = resolve(value);
      rootSupplied = true;
    } else if (argument === '--self-test') {
      selfTest = true;
    } else {
      throw new UsageError(`unknown argument ${String(argument)}`);
    }
  }
  if (selfTest && rootSupplied) throw new UsageError('--self-test cannot be combined with --root');
  return { root, selfTest };
}

function assertReadableRoot(root) {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new UsageError(`root is not a directory: ${root}`);
  for (const path of ['scripts/product/catalog.mjs', 'scripts/architecture/policy.mjs']) {
    if (!isFile(join(root, path))) throw new UsageError(`root is missing ${path}: ${root}`);
  }
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArguments(argv);
    if (parsed.selfTest) {
      await runSelfTest();
      return 0;
    }
    assertReadableRoot(parsed.root);
    const { loadGovernanceSnapshot } = await import('../../scripts/architecture/governance.mjs');
    const snapshot = await loadGovernanceSnapshot({ root: parsed.root, checks: ['metadata'] });
    if (snapshot.findings.length > 0) {
      for (const item of snapshot.findings) console.error(item.line);
      return 1;
    }
    const report = snapshot.queries.metadata;
    console.log(
      `Package metadata verified: ${String(report.packageCount)} catalog packages share ${String(report.version)}; source and publish manifests satisfy the canonical schema.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Usage: node .github/scripts/verify-package-metadata.mjs [--root <path> | --self-test]`);
      console.error(error.message);
      return 2;
    }
    if (isRecord(error) && Array.isArray(error.diagnostics)) {
      for (const diagnostic of error.diagnostics) console.error(diagnostic);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[PACKAGE_METADATA_INVALID] repository metadata input: ${message}. Remediation: ${METADATA_REMEDIATION}.`,
    );
    return 1;
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  process.exitCode = await main(process.argv.slice(2));
}
