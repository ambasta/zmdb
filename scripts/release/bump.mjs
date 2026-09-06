#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGovernanceSnapshot } from '../architecture/governance.mjs';
import { compareSemver, parseSemver, releaseChannel } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
  if (positional.length !== 1) {
    throw new Error('usage: node scripts/release/bump.mjs <version> [--root <path>] [--date YYYY-MM-DD]');
  }
  return { date, root, version: positional[0] };
}

function bumpedChangelog(model, version, date) {
  const unreleased = model.changelog.unreleased;
  if (unreleased === undefined || unreleased.bulletCount === 0) {
    throw new Error('Unreleased must contain at least one valid release-note bullet before a bump');
  }
  if (model.changelog.releases.has(version)) {
    throw new Error(`CHANGELOG.md already contains version ${version}`);
  }
  const lines = model.changelogSource.replace(/\r\n/g, '\n').split('\n');
  const older = lines.slice(unreleased.endLine).join('\n').trim();
  return [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    `## [${version}] - ${date}`,
    '',
    unreleased.body,
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
  const target = parseSemver(options.version);
  const channel = releaseChannel(target);
  if (target === undefined || channel === undefined) {
    throw new Error(`${options.version} is not a supported stable, alpha, beta or rc SemVer`);
  }

  const model = requiredReleaseModel(await loadGovernanceSnapshot({ root: options.root, checks: ['release'] }));
  const current = parseSemver(model.plan.version);
  if (current === undefined || compareSemver(target, current) <= 0) {
    throw new Error(`${options.version} must be greater than current version ${model.plan.version}`);
  }
  const changelog = bumpedChangelog(model, options.version, options.date);
  const changelogPath = join(options.root, 'CHANGELOG.md');
  const lockfilePath = join(options.root, 'yarn.lock');
  const manifests = model.architecture.packages.map(packageRecord => packageRecord.manifestPath);
  const snapshots = snapshot([changelogPath, lockfilePath, ...manifests]);

  try {
    atomicWrite(changelogPath, changelog);
    for (const packageRecord of model.architecture.packages) {
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
    const plan = requiredReleaseModel(await loadGovernanceSnapshot({ root: options.root, checks: ['release'] })).plan;
    if (plan.version !== options.version) {
      throw new Error(`final release plan reported ${plan.version}, expected ${options.version}`);
    }
    console.log(`Prepared ${options.version} across ${String(plan.packages.length)} catalog packages.`);
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
