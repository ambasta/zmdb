// Verification script for package export manifests.
// Confirms that all declared package exports resolve to valid files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
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

if (errorsCount > 0) {
  console.error(`\nExport manifest validation failed with ${errorsCount} error(s).`);
  process.exit(1);
} else {
  console.log('\n[SUCCESS] 100% of package export entry points resolve to valid files!');
  process.exit(0);
}
