// Repoint each @zmdb package's exports/main/types/files to the built dist. This
// runs IN CI ONLY, right before publish — the committed package.json keeps
// exports on ./src so local dev + vitest resolve TypeScript source. Cross-package
// deps stay as `workspace:^` (yarn/npm rewrite them to ^<version> at publish).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

// entry subpath -> dist basename (matches the tsup entry keys)
const ENTRIES = {
  'schema-core': { '.': 'index', './dto': 'dto', './custom-types': 'custom-types', './seeding': 'seeding', './llm': 'llm' },
  'query-compiler': { '.': 'index', './fts': 'fts', './joins': 'joins', './aggregations': 'aggregations', './migrations': 'migrations', './set-ops': 'set-ops', './schema-objects': 'schema-objects' },
  'aot-validator': { '.': 'index', './advanced': 'advanced', './serialization': 'serialization', './utilities': 'utilities', './plugin': 'plugin' },
  repository: { '.': 'index', './transactions': 'transactions', './replicas': 'replicas', './integrations': 'integrations', './entity-modeling': 'entity-modeling' },
  web: { '.': 'index', './routing': 'routing', './context': 'context', './di': 'di', './state': 'state', './pipeline': 'pipeline', './data': 'data', './modules': 'modules', './middleware': 'middleware', './app': 'app' },
  zmdb: { '.': 'index', './dto': 'dto', './relations': 'relations', './drivers/sqlite': 'drivers-sqlite', './drivers/pg': 'drivers-pg', './web': 'web' },
};

for (const [name, entries] of Object.entries(ENTRIES)) {
  const pkgPath = join(ROOT, 'packages', name, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  const exportsMap = {};
  for (const [sub, base] of Object.entries(entries)) {
    exportsMap[sub] = { types: `./dist/${base}.d.ts`, import: `./dist/${base}.js` };
  }
  pkg.exports = exportsMap;
  pkg.main = './dist/index.js';
  pkg.types = './dist/index.d.ts';
  pkg.files = ['dist', 'README.md', 'LICENSE'];
  // Convert workspace:^ specifiers to a concrete range so plain `npm publish`
  // (which does not understand the workspace: protocol) produces a valid manifest.
  // For prerelease versions (e.g. 1.0.0-alpha.0) pin the EXACT version — a caret
  // range like ^1.0.0-alpha.0 is not reliably satisfied by a sibling prerelease
  // across resolvers. Stable versions use a caret range.
  if (pkg.dependencies) {
    const isPrerelease = /-/.test(pkg.version);
    const range = isPrerelease ? pkg.version : `^${pkg.version}`;
    for (const [dep, spec] of Object.entries(pkg.dependencies)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        pkg.dependencies[dep] = range;
      }
    }
  }
  // devDependencies (pg, tsup, typescript, @types/pg) are irrelevant to consumers
  // and are dropped from the published manifest for cleanliness.
  delete pkg.devDependencies;

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`repointed ${pkg.name} → dist (${Object.keys(entries).length} entries)`);
}
console.log('DONE — package.json now points at dist (CI publish state)');

