const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function parseSemver(value) {
  if (typeof value !== 'string') return undefined;
  const match = SEMVER.exec(value);
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

  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Object.freeze(prerelease),
    source: value,
  });
}

export function compareSemver(left, right) {
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

export function releaseChannel(version) {
  const parsed = typeof version === 'string' ? parseSemver(version) : version;
  if (parsed === undefined) return undefined;
  if (parsed.prerelease.length === 0) return 'latest';
  const [channel, iteration] = parsed.prerelease;
  return parsed.prerelease.length === 2 &&
    (channel === 'alpha' || channel === 'beta' || channel === 'rc') &&
    iteration !== undefined &&
    /^\d+$/.test(iteration)
    ? channel
    : undefined;
}

function upperBoundForCaret(version) {
  if (version.major > 0) {
    return { ...version, major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (version.minor > 0) {
    return { ...version, minor: version.minor + 1, patch: 0, prerelease: [] };
  }
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

function rangeBranchFloor(branch) {
  if (branch.startsWith('^') || branch.startsWith('~')) {
    return parseSemver(branch.slice(1));
  }
  const exact = parseSemver(branch);
  if (exact !== undefined) return exact;

  const lowerBounds = [];
  for (const comparator of branch.split(/\s+/)) {
    const match = /^(<=|>=|<|>|=)?(.+)$/.exec(comparator);
    if (match === null) return undefined;
    const target = parseSemver(match[2]);
    if (target === undefined) return undefined;
    const operator = match[1] ?? '=';
    if (operator === '>') return undefined;
    if (operator === '>=' || operator === '=') lowerBounds.push(target);
  }
  if (lowerBounds.length === 0) return undefined;
  return lowerBounds.reduce((highest, candidate) => (compareSemver(candidate, highest) > 0 ? candidate : highest));
}

export function rangeFloor(range) {
  if (typeof range !== 'string' || range.trim().length === 0) return undefined;
  const floors = range
    .split('||')
    .map(branch => rangeBranchFloor(branch.trim()))
    .filter(floor => floor !== undefined);
  if (floors.length !== range.split('||').length || floors.length === 0) return undefined;
  return floors.reduce((lowest, candidate) => (compareSemver(candidate, lowest) < 0 ? candidate : lowest));
}

export function satisfiesRange(version, range) {
  const parsedVersion = typeof version === 'string' ? parseSemver(version) : version;
  if (parsedVersion === undefined || typeof range !== 'string' || range.trim().length === 0) return false;
  return range.split('||').some(branch => {
    const trimmed = branch.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'latest') return true;
    if (trimmed.startsWith('^')) {
      const lower = parseSemver(trimmed.slice(1));
      return (
        lower !== undefined &&
        compareSemver(parsedVersion, lower) >= 0 &&
        compareSemver(parsedVersion, upperBoundForCaret(lower)) < 0
      );
    }
    if (trimmed.startsWith('~')) {
      const lower = parseSemver(trimmed.slice(1));
      return (
        lower !== undefined &&
        compareSemver(parsedVersion, lower) >= 0 &&
        compareSemver(parsedVersion, upperBoundForTilde(lower)) < 0
      );
    }
    const exact = parseSemver(trimmed);
    if (exact !== undefined) return compareSemver(parsedVersion, exact) === 0;

    const comparators = trimmed.split(/\s+/);
    return (
      comparators.length > 0 &&
      comparators.every(comparator => {
        const match = /^(<=|>=|<|>|=)?(.+)$/.exec(comparator);
        if (match === null) return false;
        const target = parseSemver(match[2]);
        return target !== undefined && satisfiesComparator(parsedVersion, match[1] ?? '=', target);
      })
    );
  });
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function changelogFormat(subject, detail) {
  return `[RELEASE_CHANGELOG_FORMAT] ${subject}: ${detail}. Remediation: restore the one-project changelog shape in scripts/release/SPEC.md.`;
}

function changelogOwner(version, owner) {
  return `[RELEASE_CHANGELOG_OWNER] ${version} names ${owner}: bullet owner is neither a catalog id nor product. Remediation: prefix the bullet with the owning catalog id or product.`;
}

function validateSection(section, owners, diagnostics) {
  const allowedCategories = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
  const categories = new Map();
  let category;
  let lastBullet = false;
  let bulletCount = 0;

  for (const [offset, line] of section.lines.entries()) {
    if (line.trim().length === 0) {
      lastBullet = false;
      continue;
    }
    const categoryMatch = /^### (.+)$/.exec(line);
    if (categoryMatch !== null) {
      const name = categoryMatch[1];
      if (!allowedCategories.has(name)) {
        diagnostics.push(
          changelogFormat(
            `${section.label} line ${String(section.startLine + offset + 1)}`,
            `category ${name} is not allowed`,
          ),
        );
      } else if (categories.has(name)) {
        diagnostics.push(changelogFormat(section.label, `category ${name} appears more than once`));
      } else {
        categories.set(name, 0);
      }
      category = name;
      lastBullet = false;
      continue;
    }
    if (line.startsWith('- ')) {
      if (category === undefined || !allowedCategories.has(category)) {
        diagnostics.push(
          changelogFormat(
            `${section.label} line ${String(section.startLine + offset + 1)}`,
            'bullet has no allowed category',
          ),
        );
        continue;
      }
      const bullet = /^- \*\*([^*:]+):\*\* (.+\S)$/.exec(line);
      if (bullet === null) {
        diagnostics.push(
          changelogFormat(
            `${section.label} line ${String(section.startLine + offset + 1)}`,
            'bullet does not start with a bold owner and non-empty text',
          ),
        );
        continue;
      }
      const owner = bullet[1];
      if (!owners.has(owner)) diagnostics.push(changelogOwner(section.label, owner));
      categories.set(category, (categories.get(category) ?? 0) + 1);
      bulletCount++;
      lastBullet = true;
      continue;
    }
    if (/^\s{2,}\S/.test(line) && lastBullet) continue;
    diagnostics.push(
      changelogFormat(
        `${section.label} line ${String(section.startLine + offset + 1)}`,
        `unexpected content ${JSON.stringify(line)}`,
      ),
    );
  }

  for (const [name, count] of categories) {
    if (count === 0) diagnostics.push(changelogFormat(section.label, `category ${name} has no bullet`));
  }
  return bulletCount;
}

function releaseOwnerMap(value) {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map([['core', new Set([...value, 'product'])]]);
  return new Map(
    Object.entries(value).map(([releaseId, owners]) => [
      releaseId,
      new Set(releaseId === 'core' ? [...owners, 'product'] : owners),
    ]),
  );
}

export function parseChangelog(source, releaseOwners) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const diagnostics = [];
  const ownersByRelease = releaseOwnerMap(releaseOwners);
  const owners = new Set(['product', ...[...ownersByRelease.values()].flatMap(value => [...value])]);
  const levelOneHeadings = lines.map((line, index) => ({ index, line })).filter(item => item.line.startsWith('# '));
  if (
    levelOneHeadings.length !== 1 ||
    levelOneHeadings[0]?.index !== 0 ||
    levelOneHeadings[0]?.line !== '# Changelog'
  ) {
    diagnostics.push(changelogFormat('CHANGELOG.md', 'the sole level-one heading is not "# Changelog"'));
  }

  const headings = [];
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('## ')) continue;
    if (line === '## [Unreleased]') {
      headings.push({ kind: 'unreleased', index, label: 'Unreleased' });
      continue;
    }
    const release = /^## \[([^@\]]+)@([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (release === null) {
      diagnostics.push(
        changelogFormat(`CHANGELOG.md line ${String(index + 1)}`, `invalid release heading ${JSON.stringify(line)}`),
      );
      continue;
    }
    const releaseId = release[1];
    const version = parseSemver(release[2]);
    if (version === undefined) {
      diagnostics.push(
        changelogFormat(
          `CHANGELOG.md line ${String(index + 1)}`,
          `released heading contains invalid SemVer ${release[2]}`,
        ),
      );
      continue;
    }
    if (!ownersByRelease.has(releaseId)) {
      diagnostics.push(
        changelogFormat(
          `CHANGELOG.md line ${String(index + 1)}`,
          `released heading contains unknown release id ${releaseId}`,
        ),
      );
    }
    if (!validDate(release[3])) {
      diagnostics.push(
        changelogFormat(
          `CHANGELOG.md line ${String(index + 1)}`,
          `released heading contains invalid date ${release[3]}`,
        ),
      );
    }
    headings.push({
      kind: 'release',
      index,
      label: `${releaseId}@${version.source}`,
      releaseId,
      version,
      date: release[3],
    });
  }

  const firstHeading = headings[0]?.index ?? lines.length;
  for (let index = 1; index < firstHeading; index++) {
    if (lines[index]?.trim().length !== 0) {
      diagnostics.push(changelogFormat(`CHANGELOG.md line ${String(index + 1)}`, 'content appears before Unreleased'));
    }
  }

  const unreleasedHeadings = headings.filter(heading => heading.kind === 'unreleased');
  if (unreleasedHeadings.length !== 1) {
    diagnostics.push(
      changelogFormat('CHANGELOG.md', `Unreleased heading appears ${String(unreleasedHeadings.length)} times`),
    );
  } else if (headings[0] !== unreleasedHeadings[0]) {
    diagnostics.push(changelogFormat('CHANGELOG.md', 'Unreleased does not precede every released section'));
  }

  const releases = new Map();
  let unreleased;
  let previousReleaseDate;
  const previousVersionByRelease = new Map();
  for (const [headingIndex, heading] of headings.entries()) {
    const endLine = headings[headingIndex + 1]?.index ?? lines.length;
    const section = {
      ...heading,
      startLine: heading.index + 1,
      endLine,
      lines: lines.slice(heading.index + 1, endLine),
    };
    const sectionOwners = heading.kind === 'release' ? (ownersByRelease.get(heading.releaseId) ?? new Set()) : owners;
    const bulletCount = validateSection(section, sectionOwners, diagnostics);
    const record = Object.freeze({
      label: heading.label,
      releaseId: heading.releaseId,
      version: heading.version?.source,
      date: heading.date,
      startLine: heading.index,
      endLine,
      body: section.lines.join('\n').trim(),
      bulletCount,
    });
    if (heading.kind === 'unreleased') {
      unreleased = record;
      continue;
    }
    if (releases.has(heading.label)) {
      diagnostics.push(changelogFormat('CHANGELOG.md', `release ${heading.label} appears more than once`));
    } else {
      releases.set(heading.label, record);
    }
    if (bulletCount === 0) {
      diagnostics.push(changelogFormat(heading.label, 'released section has no release-note bullet'));
    }
    if (previousReleaseDate !== undefined && validDate(heading.date) && heading.date > previousReleaseDate) {
      diagnostics.push(
        changelogFormat(
          'CHANGELOG.md',
          `release ${heading.label} date ${heading.date} is newer than the preceding release date ${previousReleaseDate}`,
        ),
      );
    }
    if (validDate(heading.date)) previousReleaseDate = heading.date;

    const previousVersion = previousVersionByRelease.get(heading.releaseId);
    if (previousVersion !== undefined && compareSemver(previousVersion, heading.version) <= 0) {
      diagnostics.push(
        changelogFormat(
          'CHANGELOG.md',
          `release ${heading.label} is not older than the preceding ${heading.releaseId}@${previousVersion.source}`,
        ),
      );
    }
    previousVersionByRelease.set(heading.releaseId, heading.version);
  }

  return Object.freeze({
    diagnostics: Object.freeze([...new Set(diagnostics)].toSorted(compareText)),
    releases,
    unreleased,
  });
}
