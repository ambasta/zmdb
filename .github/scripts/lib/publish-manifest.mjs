// The one description of what a published zmdb package looks like.
//
// Three boundaries need it and must not disagree: `repoint-dist.mjs` writes it into
// the working tree in CI right before `npm publish`, `verify-publish.mjs` stages it
// into a throwaway `node_modules`, and `verify-package-metadata.mjs` checks the pure
// source-to-publish transform before any build. If they drifted, the gate would be
// checking a manifest nobody publishes.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGovernanceSnapshot } from '../../../scripts/architecture/governance.mjs';
import { createReleasePlan } from '../../../scripts/release/model.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function releaseSnapshot(root) {
  const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
  const release = snapshot.queries.release;
  if (release === undefined) {
    throw new Error(snapshot.findings.map(item => item.line).join('\n') || 'release model is unavailable');
  }
  return { release, snapshot };
}

export async function publishCatalog(root = ROOT) {
  const { release } = await releaseSnapshot(root);
  return release.entries;
}

export async function publishTrain(root = ROOT, target) {
  const { release } = await releaseSnapshot(root);
  const plan = target === undefined ? release.plan : createReleasePlan(release, target);
  const selected = new Set(plan.packages);
  return Object.freeze({
    packages: Object.freeze(release.entries.filter(entry => selected.has(entry.npmName))),
    releaseId: plan.releaseId,
    version: plan.version,
  });
}

/**
 * `./src/ir/index.ts` → `./dist/ir/index.js`.
 *
 * `dist` mirrors `src` one file at a time (`scripts/build-package.mjs`), so this is the
 * whole mapping. It replaced a hand-written table of entry points, which had drifted:
 * by then it was missing `./tags`, `./ir`, `./derive`, `./relations` and `./openapi`
 * from schema-core alone, and each missing row is a subpath that resolves in the repo
 * and 404s for whoever installed the package.
 */
export function toDist(target, ext) {
  const match = /^\.\/src\/(.+)\.tsx?$/.exec(target);
  if (!match) throw new Error(`export target is not a source path the build mirrors: ${target}`);
  return `./dist/${match[1]}${ext}`;
}

/** The manifest that ships, given one snapshot-owned committed manifest. */
export function publishManifest(pkg) {
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`${String(pkg.name)} has no release version`);
  }
  const next = { ...pkg };

  next.exports = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'string') throw new Error(`${pkg.name} export "${subpath}" is conditional; not supported`);
    next.exports[subpath] = { types: toDist(target, '.d.ts'), import: toDist(target, '.js') };
  }
  const root = pkg.exports['.'];
  if (typeof root === 'string') {
    next.main = toDist(root, '.js');
    next.types = toDist(root, '.d.ts');
  } else {
    delete next.main;
    delete next.types;
  }
  // `src` ships alongside `dist` because both `.js.map` and `.d.ts.map` point into it: a
  // consumer stepping through a zmdb frame, or using go-to-definition on one of its types,
  // lands on the TypeScript the bug is in rather than on the line it came out as.
  next.files = ['dist', 'src', 'README.md', 'LICENSE'];
  // `sideEffects` names the executable files a bundler must retain. A source
  // allowlist left unchanged here would describe `src/*.ts` while consumers
  // execute `dist/*.js`, silently making a required polyfill tree-shakeable.
  if (Array.isArray(pkg.sideEffects)) {
    next.sideEffects = pkg.sideEffects.map(target => toDist(target, '.js'));
  }
  // An executable declared against `./src/cli/bin.ts` installs broken. Node refuses to strip
  // types from a file under `node_modules` — ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING —
  // which is also the reason `exports` cannot stay on `src`, however well it works in the
  // workspace, where `node_modules/@zmdb/*` is a symlink and the realpath is outside it.
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') {
      next.bin = toDist(pkg.bin, '.js');
    } else {
      next.bin = {};
      for (const [command, target] of Object.entries(pkg.bin)) {
        next.bin[command] = typeof target === 'string' ? toDist(target, '.js') : target;
      }
    }
  }
  // `workspace:^` is a yarn protocol; plain `npm publish` would leave it in the tarball.
  // Prereleases pin the exact version — `^1.0.0-alpha.4` is not reliably satisfied by a
  // sibling prerelease across resolvers.
  const versionWithoutBuild = pkg.version.split('+', 1)[0];
  const sameUnitRange = versionWithoutBuild.includes('-') ? pkg.version : `^${pkg.version}`;
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[section]) continue;
    next[section] = Object.fromEntries(
      Object.entries(pkg[section]).map(([dep, spec]) => [
        dep,
        typeof spec === 'string' && spec === 'workspace:^'
          ? sameUnitRange
          : typeof spec === 'string' && spec.startsWith('workspace:')
            ? spec.slice('workspace:'.length)
            : spec,
      ]),
    );
  }
  // Irrelevant to a consumer (pg, typescript, @types/pg).
  delete next.devDependencies;

  return next;
}

/** A snapshot-owned manifest for a catalog id, npm name, or repository-relative package directory. */
export function readManifest(identity, packages) {
  if (!Array.isArray(packages)) {
    throw new TypeError('readManifest requires the result of await publishCatalog(root) or publishTrain(root, target)');
  }
  const entry = packages.find(
    packageRecord =>
      packageRecord.id === identity || packageRecord.directory === identity || packageRecord.npmName === identity,
  );
  if (entry === undefined) throw new Error(`unknown catalog package ${identity}`);
  return entry.manifest;
}
