// Verification script for package export manifests.
// Confirms that all declared package exports resolve to valid files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES_DIR = join(ROOT, 'packages');

let errorsCount = 0;

console.log('Validating export manifest resolution across all monorepo packages...');

const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

for (const pkgDirName of packageDirs) {
  const pkgDir = join(PACKAGES_DIR, pkgDirName);
  const pkgJsonPath = join(pkgDir, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    console.error(`[ERROR] Package manifest missing at ${pkgJsonPath}`);
    errorsCount++;
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

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

// The umbrella surface (REQ-UM-3). `zmdb` is the package consumers actually import,
// so every symbol it publishes must be enumerated and must come from a workspace
// package. A bare `export *` there would let a sibling widen the public API without
// anyone touching `zmdb`, which is how a curated surface stops being curated.
//
// `export * as ns` is allowed: the namespace is named, so the surface is still
// explicit at this level.
const UMBRELLA_SRC = join(PACKAGES_DIR, 'zmdb', 'src');
if (existsSync(UMBRELLA_SRC)) {
  const umbrella = JSON.parse(readFileSync(join(PACKAGES_DIR, 'zmdb', 'package.json'), 'utf8'));

  for (const [subpath, target] of Object.entries(umbrella.exports)) {
    if (typeof target !== 'string') continue;
    const source = readFileSync(join(PACKAGES_DIR, 'zmdb', target), 'utf8');

    if (/^\s*export\s+\*\s+from\s/m.test(source)) {
      console.error(`[ERROR] zmdb export "${subpath}" (${target}) uses a bare "export *" — enumerate the symbols`);
      errorsCount++;
    }

    for (const [, specifier] of source.matchAll(/^\s*(?:export|import)\s+(?:type\s+)?[^;]*?from\s+'([^']+)'/gm)) {
      if (!specifier.startsWith('@zmdb/') && !specifier.startsWith('./')) {
        console.error(`[ERROR] zmdb export "${subpath}" re-exports from "${specifier}", which is not a zmdb package`);
        errorsCount++;
      }
    }
  }
}

// The runtime/build-time split (REQ-TF-8's other half). `typescript@7` is a Go binary with
// a JS client; importing it from a module that ends up in someone's application bundle
// means shipping a compiler to the browser, or — more likely — a bundler error about a
// child process. So every export except the ones listed here must be reachable without it.
//
// The listed subpaths are the build-time surface, and their reason for existing is that
// they talk to the compiler. Adding to this list is a decision about what a consumer's
// bundle contains, which is why it is spelled out rather than inferred.
const BUILD_TIME_ENTRIES = new Set([
  '@zmdb/aot-validator#./codegen',
  '@zmdb/aot-validator#./plugin',
  '@zmdb/aot-validator#./reflect',
  '@zmdb/aot-validator#./transformer',
  '@zmdb/aot-validator#./unplugin',
  'zmdb#./unplugin',
]);

/** Workspace package name -> directory, so a `@zmdb/*` import can be followed. */
const WORKSPACE = new Map();
for (const pkgDirName of packageDirs) {
  const manifest = join(PACKAGES_DIR, pkgDirName, 'package.json');
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (pkg.name) WORKSPACE.set(pkg.name, { dir: join(PACKAGES_DIR, pkgDirName), exports: pkg.exports ?? {} });
}

/**
 * The file a specifier points at, or null when it leaves the workspace.
 *
 * `@zmdb/*` is followed rather than stopped at, because the umbrella package is the one
 * consumers actually import: a guard that gave up at the package boundary would miss the
 * only import graph that matters.
 */
function resolveSpecifier(file, specifier) {
  if (specifier.startsWith('.')) return join(dirname(file), specifier);
  const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(\/.*)?$/.exec(specifier);
  const target = match && WORKSPACE.get(match[1]);
  if (!target) return null;
  const entry = target.exports[`.${match[2] ?? ''}`];
  return typeof entry === 'string' ? join(target.dir, entry) : null;
}

/** Every import in `source`, paired with the file it resolves to. */
function importsOf(file, source) {
  const specifiers = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier);
  }
  return specifiers.map(specifier => ({ specifier, resolved: resolveSpecifier(file, specifier) }));
}

/** The chain of files from `entry` to the first one that imports `typescript`, or null. */
function pathToTypescript(entry) {
  const seen = new Set();
  const queue = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift();
    const file = chain.at(-1);
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const { specifier, resolved } of importsOf(file, source)) {
      if (/^typescript(\/|$)/.test(specifier)) return chain;
      if (resolved) queue.push([...chain, resolved]);
    }
  }
  return null;
}

for (const pkgDirName of packageDirs) {
  const pkgDir = join(PACKAGES_DIR, pkgDirName);
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target !== 'string') continue;
    if (BUILD_TIME_ENTRIES.has(`${pkg.name}#${subpath}`)) continue;
    const chain = pathToTypescript(join(pkgDir, target));
    if (chain) {
      const trail = chain.map(file => file.slice(ROOT.length + 1)).join(' -> ');
      console.error(`[ERROR] ${pkg.name} export "${subpath}" reaches typescript at build-time-only cost: ${trail}`);
      errorsCount++;
    }
  }
}

if (errorsCount > 0) {
  console.error(`\nExport manifest validation failed with ${errorsCount} error(s).`);
  process.exit(1);
} else {
  console.log('\n[SUCCESS] 100% of package export entry points resolve to valid files!');
  process.exit(0);
}
