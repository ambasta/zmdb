// The one description of what a published zmdb package looks like.
//
// Two scripts need it and must not disagree: `repoint-dist.mjs` writes it into the
// working tree in CI right before `npm publish`, and `verify-publish.mjs` stages it
// into a throwaway `node_modules` and imports every subpath out of it. If they
// drifted, the gate would be checking a manifest nobody publishes.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Dependency order, so `npm publish` of a dependent finds its dependencies already on
// the registry. `publish.yml`'s loop uses the same order.
export const PACKAGES = ['query-compiler', 'schema-core', 'aot-validator', 'repository', 'web', 'zmdb'];

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

/** The manifest that ships, given the committed one. Pure — it does not read `dist`. */
export function publishManifest(pkg) {
  const next = { ...pkg };

  next.exports = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'string') throw new Error(`${pkg.name} export "${subpath}" is conditional; not supported`);
    next.exports[subpath] = { types: toDist(target, '.d.ts'), import: toDist(target, '.js') };
  }
  next.main = './dist/index.js';
  next.types = './dist/index.d.ts';
  // `src` ships alongside `dist` because both `.js.map` and `.d.ts.map` point into it: a
  // consumer stepping through a zmdb frame, or using go-to-definition on one of its types,
  // lands on the TypeScript the bug is in rather than on the line it came out as.
  next.files = ['dist', 'src', 'README.md', 'LICENSE'];
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
  if (pkg.dependencies) {
    const range = /-/.test(pkg.version) ? pkg.version : `^${pkg.version}`;
    next.dependencies = Object.fromEntries(
      Object.entries(pkg.dependencies).map(([dep, spec]) => [
        dep,
        typeof spec === 'string' && spec.startsWith('workspace:') ? range : spec,
      ]),
    );
  }
  // Irrelevant to a consumer (pg, typescript, @types/pg).
  delete next.devDependencies;

  return next;
}

/** The committed manifest for a workspace package directory name. */
export function readManifest(name) {
  return JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'));
}
