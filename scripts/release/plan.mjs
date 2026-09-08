#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadArchitecture } from '../architecture/index.mjs';
import { createReleasePlan, currentCoreTarget, releaseModel } from './model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function releaseTargetFromTag(tag) {
  if (typeof tag !== 'string') throw new TypeError('release tag must be a string');
  const match = /^(core|[a-z0-9][a-z0-9-]*)-v(.+)$/.exec(tag);
  if (match === null) throw new TypeError(`release tag ${tag} must be <release-id>-v<version>`);
  return match[1] === 'core'
    ? Object.freeze({ kind: 'core', version: match[2] })
    : Object.freeze({ kind: 'package', id: match[1], version: match[2] });
}

export function releasePlan(root, target, options = {}) {
  const model = releaseModel(root, options);
  return createReleasePlan(model, target ?? currentCoreTarget(model));
}

function parseArguments(argv) {
  let format;
  let releaseId;
  let root = ROOT;
  let tag;
  let version;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json' || argument === '--publish-tsv') {
      if (format !== undefined) throw new TypeError('choose exactly one output format');
      format = argument;
    } else if (argument === '--release') {
      releaseId = argv[++index];
      if (releaseId === undefined) throw new TypeError('--release requires core or a catalog id');
    } else if (argument === '--tag') {
      tag = argv[++index];
      if (tag === undefined) throw new TypeError('--tag requires a value');
    } else if (argument === '--version') {
      version = argv[++index];
      if (version === undefined) throw new TypeError('--version requires a value');
    } else if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined) throw new TypeError('--root requires a path');
      root = resolve(value);
    } else {
      throw new TypeError(`unknown argument ${argument}`);
    }
  }
  if (format === undefined) throw new TypeError('choose --json or --publish-tsv');
  if (tag !== undefined && (releaseId !== undefined || version !== undefined)) {
    throw new TypeError('--tag cannot be combined with --release or --version');
  }
  if ((releaseId === undefined) !== (version === undefined)) {
    throw new TypeError('--release and --version must be supplied together');
  }
  const coordinatedVersion = /^v(.+)$/.exec(tag ?? '')?.[1];
  const target =
    tag !== undefined && coordinatedVersion === undefined
      ? releaseTargetFromTag(tag)
      : releaseId === undefined
        ? undefined
        : releaseId === 'core'
          ? { kind: 'core', version }
          : { kind: 'package', id: releaseId, version };
  return { coordinatedVersion, format, root, target };
}

async function main(argv) {
  const options = parseArguments(argv);
  const architecture = await loadArchitecture(options.root);
  const model = releaseModel(options.root, { architecture });
  let plan = createReleasePlan(model, options.target ?? currentCoreTarget(model));
  if (options.coordinatedVersion !== undefined) {
    const version = options.coordinatedVersion;
    const plans = Object.keys(model.releaseOwners).map(id =>
      createReleasePlan(model, id === 'core' ? { kind: 'core', version } : { kind: 'package', id, version }),
    );
    for (const entry of model.entries) {
      if (entry.manifest.version !== version) {
        throw new Error(`${entry.npmName} is ${entry.manifest.version}; coordinated release requires ${version}`);
      }
    }
    for (const selected of plans) {
      if (selected.changelogEntry.trim().length === 0) {
        throw new Error(`CHANGELOG.md has no entry for ${selected.releaseId}@${version}`);
      }
    }
    const packages = model.entries.map(entry => entry.npmName);
    plan = {
      releaseId: 'all',
      version,
      packages,
      publishOrder: packages,
      manifestChanges: plans.flatMap(selected => selected.manifestChanges),
      compatibilityCases: [...new Set(plans.flatMap(selected => selected.compatibilityCases))].toSorted(),
      changelogEntry: plans
        .map(selected => `## ${selected.releaseId}@${version}\n\n${selected.changelogEntry}`)
        .join('\n\n'),
    };
  }
  if (options.format === '--json') {
    console.log(JSON.stringify(plan, undefined, 2));
    return;
  }
  const byName = new Map(model.entries.map(entry => [entry.npmName, entry]));
  for (const npmName of plan.publishOrder) {
    const entry = byName.get(npmName);
    if (entry === undefined) throw new TypeError(`release plan names unknown package ${npmName}`);
    console.log(`${entry.directory}\t${entry.npmName}`);
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
