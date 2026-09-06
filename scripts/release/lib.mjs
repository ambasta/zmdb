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
  const channel = parsed.prerelease[0];
  return channel === 'alpha' || channel === 'beta' || channel === 'rc' ? channel : undefined;
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

export function parseChangelog(source, ownerIds) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const diagnostics = [];
  const owners = new Set([...ownerIds, 'product']);
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
    const release = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (release === null) {
      diagnostics.push(
        changelogFormat(`CHANGELOG.md line ${String(index + 1)}`, `invalid release heading ${JSON.stringify(line)}`),
      );
      continue;
    }
    const version = parseSemver(release[1]);
    if (version === undefined) {
      diagnostics.push(
        changelogFormat(
          `CHANGELOG.md line ${String(index + 1)}`,
          `released heading contains invalid SemVer ${release[1]}`,
        ),
      );
      continue;
    }
    if (!validDate(release[2])) {
      diagnostics.push(
        changelogFormat(
          `CHANGELOG.md line ${String(index + 1)}`,
          `released heading contains invalid date ${release[2]}`,
        ),
      );
    }
    headings.push({ kind: 'release', index, label: release[1], version, date: release[2] });
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
  let previousVersion;
  for (const [headingIndex, heading] of headings.entries()) {
    const endLine = headings[headingIndex + 1]?.index ?? lines.length;
    const section = {
      ...heading,
      startLine: heading.index + 1,
      endLine,
      lines: lines.slice(heading.index + 1, endLine),
    };
    const bulletCount = validateSection(section, owners, diagnostics);
    const record = Object.freeze({
      label: heading.label,
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
      diagnostics.push(changelogFormat('CHANGELOG.md', `version ${heading.label} appears more than once`));
    } else {
      releases.set(heading.label, record);
    }
    if (bulletCount === 0) {
      diagnostics.push(changelogFormat(heading.label, 'released section has no release-note bullet'));
    }
    if (previousVersion !== undefined && compareSemver(previousVersion, heading.version) <= 0) {
      diagnostics.push(
        changelogFormat('CHANGELOG.md', `released version ${heading.label} is not older than the preceding section`),
      );
    }
    previousVersion = heading.version;
  }

  return Object.freeze({
    diagnostics: Object.freeze([...new Set(diagnostics)].toSorted(compareText)),
    releases,
    unreleased,
  });
}
