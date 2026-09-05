// Verification script for package export manifests.
// Confirms that all declared package exports resolve to valid files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createImportGraph } from './lib/import-graph.mjs';
import {
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_BIN,
  TARGET_TOOLING_EXPORTS,
} from './verify-tooling-boundaries.mjs';

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
    const entries = readdirSync(pkgDir).toSorted();
    if (entries.length === 1 && entries[0] === 'SPEC.md') {
      console.log(`  accepted future-package specification at packages/${pkgDirName}/SPEC.md`);
      continue;
    }
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

// The three tooling manifests do not exist yet, but once any one is admitted
// its public surface is no longer "whatever the manifest happened to contain".
// #627 freezes these exact source export keys and the one executable owner.
for (const [packageName, expected] of Object.entries(TARGET_TOOLING_EXPORTS)) {
  const pkg = [...packageDirs]
    .map(directory => {
      const path = join(PACKAGES_DIR, directory, 'package.json');
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    })
    .find(manifest => manifest?.name === packageName);
  if (pkg === undefined) continue;
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
  const umbrella = JSON.parse(readFileSync(join(PACKAGES_DIR, 'zmdb', 'package.json'), 'utf8'));

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
  '@zmdb/aot-validator#./lint',
  '@zmdb/aot-validator#./metro',
  '@zmdb/aot-validator#./plugin',
  '@zmdb/aot-validator#./reflect',
  // The compiler-backed schema bridge: tests name interfaces with `schemasFrom`, while the
  // zmdb CLI passes its resolved declaration files to `schemasFromFiles`. It is a compiler
  // client by definition — that is the service — because `schemaOf<T>()` has no runtime and
  // build tools still need a checked route from tagged interfaces to schema values.
  '@zmdb/aot-validator#./testing',
  '@zmdb/aot-validator#./transformer',
  '@zmdb/aot-validator#./unplugin',
  ...TARGET_TOOLING_EXPORTS['@zmdb/compiler'].map(subpath => `@zmdb/compiler#${subpath}`),
  '@zmdb/cli#.',
  'zmdb#./cli',
  ...Object.values(TARGET_PRODUCT_TOOLING_EXPORTS).flatMap(subpaths => subpaths.map(subpath => `zmdb#${subpath}`)),
  'zmdb#./unplugin',
]);

const importGraph = createImportGraph(ROOT);

/** The chain of files from `entry` to the first one that imports `typescript`, or null. */
function pathToTypescript(entry) {
  const path = importGraph.findImportPath(entry, ({ specifier }) => /^typescript(\/|$)/.test(specifier));
  return path === null ? null : path.slice(0, -1);
}

const lintEntry = join(PACKAGES_DIR, 'aot-validator', 'src', 'lint', 'index.ts');
const lintCompilerChain = pathToTypescript(lintEntry);
if (lintCompilerChain) {
  const trail = lintCompilerChain.map(file => file.slice(ROOT.length + 1)).join(' -> ');
  console.error(
    `[ERROR] @zmdb/aot-validator/lint reaches typescript through ${trail}; ` +
      'lint rules must stay independent of the transformer/compiler runtime',
  );
  errorsCount++;
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

// The OpenTelemetry API is an optional integration peer. Only the explicit
// adapter subpath may reach it; importing the package root or the dependency-free
// observability ports must not ask a consumer to install that peer.
const webManifest = JSON.parse(readFileSync(join(PACKAGES_DIR, 'web', 'package.json'), 'utf8'));
for (const [subpath, target] of Object.entries(webManifest.exports ?? {})) {
  if (typeof target !== 'string' || subpath === './otel') continue;
  const chain = importGraph.findImportPath(
    join(PACKAGES_DIR, 'web', target),
    ({ specifier }) => specifier === '@opentelemetry/api' || specifier.startsWith('@opentelemetry/api/'),
  );
  if (chain !== null) {
    const trail = chain
      .slice(0, -1)
      .map(file => file.slice(ROOT.length + 1))
      .join(' -> ');
    console.error(`[ERROR] @zmdb/web export "${subpath}" reaches optional @opentelemetry/api: ${trail}`);
    errorsCount++;
  }
}

// Broker clients are optional integration peers. Each may be reached only from
// its explicit strategy subpath; the package root and transport-neutral
// microservices seam must remain importable without any broker installed.
const BROKER_PEERS = new Map([
  ['@nats-io/transport-node', './microservices/nats'],
  ['amqplib', './microservices/rabbitmq'],
  ['redis', './microservices/redis'],
]);

for (const [peer, allowedSubpath] of BROKER_PEERS) {
  if (webManifest.dependencies?.[peer] !== undefined) {
    console.error(`[ERROR] @zmdb/web broker client "${peer}" is a dependency instead of an optional peer`);
    errorsCount++;
  }
  if (
    webManifest.peerDependencies?.[peer] === undefined ||
    webManifest.peerDependenciesMeta?.[peer]?.optional !== true
  ) {
    console.error(`[ERROR] @zmdb/web broker client "${peer}" is not declared as an optional peer`);
    errorsCount++;
  }

  for (const [subpath, target] of Object.entries(webManifest.exports ?? {})) {
    if (typeof target !== 'string' || subpath === allowedSubpath) continue;
    const chain = importGraph.findImportPath(
      join(PACKAGES_DIR, 'web', target),
      ({ specifier }) => specifier === peer || specifier.startsWith(`${peer}/`),
    );
    if (chain !== null) {
      const trail = chain
        .slice(0, -1)
        .map(file => file.slice(ROOT.length + 1))
        .join(' -> ');
      console.error(`[ERROR] @zmdb/web export "${subpath}" reaches optional broker peer "${peer}": ${trail}`);
      errorsCount++;
    }
  }
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
for (const pkgDirName of packageDirs) {
  const pkgJsonPath = join(PACKAGES_DIR, pkgDirName, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  if (!pkg.name) continue;

  for (const subpath of Object.keys(pkg.exports ?? {})) {
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
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
  console.log('\n[SUCCESS] every export entry point resolves, imports under plain node, and stays off typescript.');
  process.exit(0);
}
