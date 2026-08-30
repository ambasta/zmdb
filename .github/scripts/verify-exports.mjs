// Verification script for package export manifests.
// Confirms that all declared package exports resolve to valid source files in dev mode,
// and to valid generated build artifacts (.js and .d.ts in dist/) after build.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

// Expected dist entry mappings for each package (matches repoint-dist.mjs and tsup configs)
const ENTRIES = {
  'schema-core': {
    '.': 'index',
    './dto': 'dto',
    './custom-types': 'custom-types',
    './seeding': 'seeding',
    './llm': 'llm',
  },
  'query-compiler': {
    '.': 'index',
    './fts': 'fts',
    './joins': 'joins',
    './aggregations': 'aggregations',
    './migrations': 'migrations',
    './set-ops': 'set-ops',
    './schema-objects': 'schema-objects',
  },
  'aot-validator': {
    '.': 'index',
    './advanced': 'advanced',
    './serialization': 'serialization',
    './utilities': 'utilities',
    './plugin': 'plugin',
  },
  repository: {
    '.': 'index',
    './transactions': 'transactions',
    './replicas': 'replicas',
    './integrations': 'integrations',
    './entity-modeling': 'entity-modeling',
    './drivers/sqlite': 'drivers-sqlite',
    './drivers/pg': 'drivers-pg',
  },
  web: {
    '.': 'index',
    './routing': 'routing',
    './context': 'context',
    './di': 'di',
    './state': 'state',
    './pipeline': 'pipeline',
    './data': 'data',
    './modules': 'modules',
    './middleware': 'middleware',
    './app': 'app',
    './dto-pipes': 'dto-pipes',
    './openapi': 'openapi',
    './gateways': 'gateways',
  },
  zmdb: {
    '.': 'index',
    './dto': 'dto',
    './relations': 'relations',
    './drivers/sqlite': 'drivers-sqlite',
    './drivers/pg': 'drivers-pg',
    './web': 'web',
  },
};

let errorsCount = 0;

console.log('Validating export manifest resolution across all monorepo packages...');

for (const [pkgName, entries] of Object.entries(ENTRIES)) {
  const pkgDir = join(ROOT, 'packages', pkgName);
  const pkgJsonPath = join(pkgDir, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    console.error(`[ERROR] Package manifest missing at ${pkgJsonPath}`);
    errorsCount++;
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  // 1. Verify current package.json exports resolve to existing source files or dist files
  if (pkg.exports) {
    for (const [subpath, exportValue] of Object.entries(pkg.exports)) {
      if (typeof exportValue === 'string') {
        const targetPath = join(pkgDir, exportValue);
        if (!existsSync(targetPath)) {
          console.error(`[ERROR] ${pkg.name} export "${subpath}" points to missing file: ${exportValue}`);
          errorsCount++;
        }
      } else if (typeof exportValue === 'object' && exportValue !== null) {
        if (exportValue.types) {
          const typesPath = join(pkgDir, exportValue.types);
          if (!existsSync(typesPath)) {
            console.error(`[ERROR] ${pkg.name} export "${subpath}" types point to missing file: ${exportValue.types}`);
            errorsCount++;
          }
        }
        if (exportValue.import) {
          const importPath = join(pkgDir, exportValue.import);
          if (!existsSync(importPath)) {
            console.error(
              `[ERROR] ${pkg.name} export "${subpath}" import points to missing file: ${exportValue.import}`,
            );
            errorsCount++;
          }
        }
      }
    }
  } else {
    console.error(`[ERROR] Package ${pkgName} missing "exports" field in package.json`);
    errorsCount++;
  }

  // 2. Verify dist build artifacts for all expected export entry points
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir)) {
    console.error(`[ERROR] Package ${pkgName} dist/ directory does not exist. Run yarn build first.`);
    errorsCount++;
    continue;
  }

  for (const [subpath, baseName] of Object.entries(entries)) {
    const jsPath = join(distDir, `${baseName}.js`);
    const dtsPath = join(distDir, `${baseName}.d.ts`);

    if (!existsSync(jsPath)) {
      console.error(`[ERROR] ${pkg.name} (${subpath}) missing generated bundle: dist/${baseName}.js`);
      errorsCount++;
    }
    if (!existsSync(dtsPath)) {
      console.error(`[ERROR] ${pkg.name} (${subpath}) missing generated declaration: dist/${baseName}.d.ts`);
      errorsCount++;
    }
  }
}

if (errorsCount > 0) {
  console.error(`\nExport manifest validation failed with ${errorsCount} error(s).`);
  process.exit(1);
} else {
  console.log('\n[SUCCESS] 100% of package export entry points resolve to valid source and build artifacts!');
  process.exit(0);
}
