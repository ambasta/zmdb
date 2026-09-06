#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGovernanceSnapshot } from '../architecture/governance.mjs';
import { compareSemver, parseSemver, releaseChannel } from './lib.mjs';
import { createReleasePlan } from './model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

function atomicWrite(path, content) {
  const temporary = `${path}.zmdb-release-${String(process.pid)}`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
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

function parseArguments(argv) {
  const positional = [];
  let root = ROOT;
  let date = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined) throw new Error('--root requires a path');
      root = resolve(value);
    } else if (argument === '--date') {
      const value = argv[++index];
      if (value === undefined || !validDate(value)) {
        throw new Error('--date requires a real YYYY-MM-DD date');
      }
      date = value;
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 2) {
    throw new Error(
      'usage: node scripts/release/bump.mjs <core|catalog-id> <version> [--root <path>] [--date YYYY-MM-DD]',
    );
  }
  return { date, releaseId: positional[0], root, version: positional[1] };
}

function targetFor(releaseId, version) {
  return releaseId === 'core'
    ? Object.freeze({ kind: 'core', version })
    : Object.freeze({ kind: 'package', id: releaseId, version });
}

function selectedPackages(model, releaseId) {
  if (releaseId === 'core') {
    return model.architecture.packages.filter(packageRecord => model.releasePolicy[packageRecord.id].group === 'core');
  }
  const packageRecord = model.architecture.packages.find(candidate => candidate.id === releaseId);
  if (packageRecord === undefined) throw new Error(`unknown release target ${releaseId}`);
  if (model.releasePolicy[releaseId].group === 'core') {
    throw new Error(`${releaseId} belongs to the core release target`);
  }
  return [packageRecord];
}

function assertCleanGit(root) {
  if (!existsSync(join(root, '.git'))) return;
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (status.status !== 0) {
    throw new Error(`git status failed before release preparation: ${status.stderr.trim()}`);
  }
  if (status.stdout.trim().length > 0) {
    throw new Error('release preparation requires a clean git worktree');
  }
}

function parseUnreleasedBody(body) {
  const categories = new Map();
  let category;
  let current;
  for (const line of body.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading !== null) {
      category = heading[1];
      if (!CATEGORIES.includes(category)) throw new Error(`unsupported Unreleased category ${category}`);
      if (!categories.has(category)) categories.set(category, []);
      current = undefined;
      continue;
    }
    if (line.startsWith('- ')) {
      if (category === undefined) throw new Error('Unreleased bullet has no category');
      const owner = /^- \*\*([^*:]+):\*\*/.exec(line)?.[1];
      if (owner === undefined) throw new Error(`Unreleased bullet has no owner: ${line}`);
      current = { lines: [line], owner };
      categories.get(category).push(current);
      continue;
    }
    if (/^\s{2,}\S/.test(line) && current !== undefined) {
      current.lines.push(line);
    }
  }
  return categories;
}

function renderCategories(categories, include) {
  const sections = [];
  for (const category of CATEGORIES) {
    const bullets = (categories.get(category) ?? []).filter(include);
    if (bullets.length === 0) continue;
    sections.push(`### ${category}\n\n${bullets.map(bullet => bullet.lines.join('\n')).join('\n')}`);
  }
  return sections.join('\n\n');
}

function bumpedChangelog(model, releaseId, version, date) {
  const unreleased = model.changelog.unreleased;
  if (unreleased === undefined || unreleased.bulletCount === 0) {
    throw new Error('Unreleased must contain at least one valid release-note bullet before a bump');
  }
  const releaseKey = `${releaseId}@${version}`;
  if (model.changelog.releases.has(releaseKey)) {
    throw new Error(`CHANGELOG.md already contains release ${releaseKey}`);
  }
  const owners = new Set(model.releaseOwners[releaseId] ?? []);
  if (releaseId === 'core') owners.add('product');
  if (owners.size === 0) throw new Error(`unknown release target ${releaseId}`);

  const categories = parseUnreleasedBody(unreleased.body);
  const selected = renderCategories(categories, bullet => owners.has(bullet.owner));
  if (selected.length === 0) {
    throw new Error(`Unreleased contains no bullet owned by release target ${releaseId}`);
  }
  const remaining = renderCategories(categories, bullet => !owners.has(bullet.owner));
  const lines = model.changelogSource.replace(/\r\n/g, '\n').split('\n');
  const older = lines.slice(unreleased.endLine).join('\n').trim();
  return [
    '# Changelog',
    '',
    '## [Unreleased]',
    ...(remaining.length === 0 ? [] : ['', remaining]),
    '',
    `## [${releaseKey}] - ${date}`,
    '',
    selected,
    ...(older.length === 0 ? [] : ['', older]),
    '',
  ].join('\n');
}

function nextManifest(packageRecord, version, tag) {
  return `${JSON.stringify(
    {
      ...packageRecord.manifest,
      version,
      publishConfig: {
        ...packageRecord.manifest.publishConfig,
        tag,
      },
    },
    undefined,
    2,
  )}\n`;
}

function snapshot(paths) {
  return paths.map(path =>
    Object.freeze({
      path,
      existed: existsSync(path),
      content: existsSync(path) ? readFileSync(path) : undefined,
    }),
  );
}

function restore(snapshots) {
  for (const item of snapshots) {
    if (item.existed) atomicWrite(item.path, item.content);
    else rmSync(item.path, { force: true });
  }
}

function requiredReleaseModel(governanceSnapshot) {
  const model = governanceSnapshot.queries.release;
  if (model !== undefined) return model;
  throw new Error(governanceSnapshot.findings.map(item => item.line).join('\n') || 'release model is unavailable');
}

async function run(argv) {
  const options = parseArguments(argv);
  const targetVersion = parseSemver(options.version);
  const channel = releaseChannel(targetVersion);
  if (targetVersion === undefined || channel === undefined) {
    throw new Error(`${options.version} is not a supported stable, alpha, beta or rc SemVer`);
  }

  assertCleanGit(options.root);
  const model = requiredReleaseModel(await loadGovernanceSnapshot({ root: options.root, checks: ['release'] }));
  const packages = selectedPackages(model, options.releaseId);
  const currentVersions = new Set(packages.map(packageRecord => packageRecord.manifest.version));
  if (currentVersions.size !== 1) {
    throw new Error(`${options.releaseId} manifests do not share one current version`);
  }
  const currentSource = currentVersions.values().next().value;
  const current = parseSemver(currentSource);
  if (current === undefined || compareSemver(targetVersion, current) <= 0) {
    throw new Error(`${options.version} must be greater than current ${options.releaseId} version ${currentSource}`);
  }

  const changelog = bumpedChangelog(model, options.releaseId, options.version, options.date);
  const changelogPath = join(options.root, 'CHANGELOG.md');
  const lockfilePath = join(options.root, 'yarn.lock');
  const manifests = packages.map(packageRecord => packageRecord.manifestPath);
  const snapshots = snapshot([changelogPath, lockfilePath, ...manifests]);

  try {
    atomicWrite(changelogPath, changelog);
    for (const packageRecord of packages) {
      atomicWrite(packageRecord.manifestPath, nextManifest(packageRecord, options.version, channel));
    }

    const yarn = spawnSync('yarn', ['install', '--mode=update-lockfile'], {
      cwd: options.root,
      env: process.env,
      stdio: 'inherit',
    });
    if (yarn.status !== 0) {
      throw new Error(`yarn install --mode=update-lockfile failed with status ${String(yarn.status)}`);
    }
    const target = targetFor(options.releaseId, options.version);
    const finalModel = requiredReleaseModel(await loadGovernanceSnapshot({ root: options.root, checks: ['release'] }));
    const plan = createReleasePlan(finalModel, target);
    if (plan.version !== options.version || plan.releaseId !== options.releaseId) {
      throw new Error(
        `final release plan reported ${plan.releaseId}@${plan.version}, expected ${options.releaseId}@${options.version}`,
      );
    }
    if (plan.changelogEntry.length === 0) {
      throw new Error(`final release plan found no ${options.releaseId}@${options.version} changelog entry`);
    }
    console.log(`Prepared ${options.releaseId}@${options.version} across ${String(plan.packages.length)} package(s).`);
  } catch (error) {
    restore(snapshots);
    throw error;
  }
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
