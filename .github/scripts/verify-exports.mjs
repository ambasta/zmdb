// Verification script for package export manifests.
// Confirms that all declared package exports resolve to valid files.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { inspectConfigContract } from './verify-config-contract.mjs';
import { TARGET_TOOLING_BIN, TARGET_TOOLING_EXPORTS } from './verify-tooling-boundaries.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES_DIR = join(ROOT, 'packages');
const NEXT_SERVER_SPECIFIER = '@zmdb/next/server';
const SERVER_ONLY_MESSAGE = 'This module cannot be imported from a Client Component module';
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: ['runtime'] });
if (GOVERNANCE.architecture === null) throw new Error('governance snapshot has no architecture');
const packageRecords = GOVERNANCE.packages;

let errorsCount = 0;

console.log('Validating export manifest resolution across all monorepo packages...');

for (const packageRecord of packageRecords) {
  const pkgDir = packageRecord.directoryPath;
  const pkgDirName = packageRecord.directory.split('/').at(-1);
  const pkg = packageRecord.manifest;

  if (!pkg.exports || Object.keys(pkg.exports).length === 0) {
    console.error(`[ERROR] Package ${pkg.name || pkgDirName} missing "exports" field in package.json`);
    errorsCount++;
    continue;
  }

  // Verify top-level entry fields if present
  for (const field of ['main', 'module', 'types']) {
    if (pkg[field]) {
      const targetPath = join(pkgDir, pkg[field]);
      if (!existsSync(targetPath)) {
        console.error(`[ERROR] ${pkg.name} "${field}" field points to missing file: ${pkg[field]}`);
        errorsCount++;
      }
    }
  }

  // Verify package.json exports resolve to existing target files
  for (const [subpath, exportValue] of Object.entries(pkg.exports)) {
    if (typeof exportValue === 'string') {
      const targetPath = join(pkgDir, exportValue);
      if (!existsSync(targetPath)) {
        console.error(`[ERROR] ${pkg.name} export "${subpath}" points to missing file: ${exportValue}`);
        errorsCount++;
      }
    } else if (typeof exportValue === 'object' && exportValue !== null) {
      for (const [condition, target] of Object.entries(exportValue)) {
        if (typeof target === 'string') {
          const targetPath = join(pkgDir, target);
          if (!existsSync(targetPath)) {
            console.error(`[ERROR] ${pkg.name} export "${subpath}" (${condition}) points to missing file: ${target}`);
            errorsCount++;
          }
        }
      }
    }
  }
}

// The three tooling manifests do not exist yet, but once any one is admitted
// its public surface is no longer "whatever the manifest happened to contain".
// #627 freezes these exact source export keys and the one executable owner.
for (const [packageName, expected] of Object.entries(TARGET_TOOLING_EXPORTS)) {
  const packageRecord = packageRecords.find(candidate => candidate.npmName === packageName);
  if (packageRecord === undefined) continue;
  const pkg = packageRecord.manifest;
  const observed = Object.keys(pkg.exports ?? {}).toSorted();
  if (JSON.stringify(observed) !== JSON.stringify([...expected].toSorted())) {
    console.error(`[ERROR] ${packageName} exports ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`);
    errorsCount++;
  }
  if (packageName === TARGET_TOOLING_BIN.packageName) {
    const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
    if (JSON.stringify(Object.keys(bins)) !== JSON.stringify([TARGET_TOOLING_BIN.command])) {
      console.error(
        `[ERROR] ${packageName} owns ${JSON.stringify(Object.keys(bins))}, expected only ${TARGET_TOOLING_BIN.command}`,
      );
      errorsCount++;
    }
  }
}

// The umbrella surface (REQ-UM-3). `zmdb` is the package consumers actually import,
// so every symbol it publishes must be enumerated and must come from a workspace
// package. A bare `export *` there would let a sibling widen the public API without
// anyone touching `zmdb`, which is how a curated surface stops being curated.
//
// `export * as ns` is allowed: the namespace is named, so the surface is still
// explicit at this level.
const UMBRELLA_SRC = join(PACKAGES_DIR, 'zmdb', 'src');
if (existsSync(UMBRELLA_SRC)) {
  const umbrella = packageRecords.find(packageRecord => packageRecord.id === 'zmdb')?.manifest;
  if (umbrella === undefined) throw new Error('governance snapshot omitted the zmdb facade');

  for (const [subpath, target] of Object.entries(umbrella.exports)) {
    if (typeof target !== 'string') continue;
    const source = readFileSync(join(PACKAGES_DIR, 'zmdb', target), 'utf8');

    if (/^\s*export\s+\*\s+from\s/m.test(source)) {
      console.error(`[ERROR] zmdb export "${subpath}" (${target}) uses a bare "export *" — enumerate the symbols`);
      errorsCount++;
    }

    for (const [, specifier] of source.matchAll(/^\s*(?:export|import)\s+(?:type\s+)?[^;]*?from\s+'([^']+)'/gm)) {
      if (!specifier.startsWith('@zmdb/') && !specifier.startsWith('./') && !specifier.startsWith('node:')) {
        console.error(`[ERROR] zmdb export "${subpath}" re-exports from "${specifier}", which is not a zmdb package`);
        errorsCount++;
      }
    }
  }
}

const configContract = inspectConfigContract(ROOT, new Map(), { architecture: GOVERNANCE.architecture });
for (const problem of configContract.problems) {
  console.error(`[ERROR] ${problem}`);
  errorsCount++;
}
if (configContract.problems.length === 0) {
  console.log(`  project config authoring ${configContract.authoringOwner}; loader ${configContract.owner}`);
}

// Keep the historical export verifier entry point responsible for manifest
// resolution and source importability. Reachability belongs to the canonical
// architecture-policy gate, and delegation here preserves compatibility for
// callers that still run only `verify:exports`.
const reachability = GOVERNANCE.queries.runtime;
if (reachability === undefined) throw new Error('governance snapshot omitted runtime reachability');
for (const diagnostic of reachability.diagnostics) {
  console.error(diagnostic);
  errorsCount++;
}

// Every subpath actually loads, under `node`, with no bundler and no transform.
//
// This is a check on the *source*, and it is worth being precise about that, because the
// obvious reading of it is wrong. Every `exports` target here is a `.ts` file, so what runs
// below is Node reading our TypeScript and stripping the types — which works only because
// `node_modules/@zmdb/*` is a symlink in a workspace and Node resolves the realpath out of
// it. Installed for real, the same manifest fails with
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. So the published form is a different question,
// answered by `yarn verify:publish`, and nothing here should be read as covering it.
//
// One thing is not plain about the `node` this runs under: `yarn verify:exports` passes
// `--import ./scripts/ts-specifier-hook.mjs`, because the sources name their siblings as
// `./x.js` and Node will not map that to `./x.ts` on its own. That hook resolves specifiers
// and nothing else — it compiles no code and rewrites no source, so what loads below is still
// the file as committed.
//
// What this covers, then, is loading the source, which the tests, the dev loop, the examples
// and the consumer fixtures all do. Two things break that while resolving and typechecking
// perfectly:
//
//   * a relative specifier that names neither a real file nor a `.ts` sibling — a stale path,
//     or a `.js` target that was deleted. `tsc` and vitest are more forgiving about the shape
//     of a specifier than Node's resolver plus the hook are, so the whole test suite can pass
//     with an import Node cannot follow.
//   * syntax that is not type syntax. Decorators are the case that bit us — a single
//     `@Controller` in a benchmark helper made `import '@zmdb/web'` a SyntaxError, because the
//     root index re-exported it. `target: ESNext` means such a decorator would also survive
//     the emit into `dist`, so this catches it on both routes.
//
// Neither is visible to a test run, which is exactly why it belongs in a gate.
function probeSourceImport(specifier, conditions = []) {
  return spawnSync(
    process.execPath,
    [
      ...conditions.map(condition => `--conditions=${condition}`),
      `--import=${join(ROOT, 'scripts', 'ts-specifier-hook.mjs')}`,
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(specifier)})`,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

for (const packageRecord of packageRecords) {
  const pkg = packageRecord.manifest;
  if (!pkg.name) continue;

  for (const subpath of Object.keys(pkg.exports ?? {})) {
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    if (specifier === NEXT_SERVER_SPECIFIER) {
      const guarded = probeSourceImport(specifier);
      if (guarded.status === 0 || !guarded.stderr.includes(SERVER_ONLY_MESSAGE)) {
        console.error(
          `[ERROR] import('${specifier}') did not enforce its plain-node server-only guard: ${guarded.stderr.trim()}`,
        );
        errorsCount++;
      }
      const server = probeSourceImport(specifier, ['react-server']);
      if (server.status !== 0) {
        console.error(`[ERROR] import('${specifier}') fails under the react-server condition: ${server.stderr.trim()}`);
        errorsCount++;
      }
      continue;
    }
    try {
      await import(specifier);
    } catch (error) {
      console.error(`[ERROR] import('${specifier}') fails under plain node: ${error.message}`);
      errorsCount++;
    }
  }
}

if (errorsCount > 0) {
  console.error(`\nExport manifest validation failed with ${errorsCount} error(s).`);
  process.exit(1);
} else {
  console.log(
    '\n[SUCCESS] every export entry point resolves, imports under its qualified node condition, and satisfies architecture reachability policy.',
  );
  process.exit(0);
}
