#!/usr/bin/env node
import { execSync } from 'node:child_process';
/**
 * Specification Validation Script
 * Verifies specification presence, structure, and checklist tracking alignment across packages.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');

let errors = [];
let checkedSpecsCount = 0;

console.log('=== Specification Validation ===');

// 1. Locate all packages
if (!existsSync(PACKAGES_DIR)) {
  console.error('Error: packages directory not found');
  process.exit(1);
}

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

// Function to find all SPEC.md files in a directory recursively
function findSpecFiles(dir) {
  let results = [];
  const items = readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.git') continue;
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(findSpecFiles(fullPath));
    } else if (item.isFile() && item.name === 'SPEC.md') {
      results.push(fullPath);
    }
  }
  return results;
}

// 2. Determine changed files in git if available
let changedFiles = new Set();
try {
  // Check diff against origin/main, or HEAD~1, or staged/unstaged changes
  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --name-only origin/main...HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    try {
      diffOutput = execSync('git diff --name-only HEAD~1 HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      diffOutput = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    }
  }
  diffOutput
    .split('\n')
    .map(l => l.trim().replace(/^..\s+/, ''))
    .filter(Boolean)
    .forEach(f => changedFiles.add(f));
} catch (e) {
  console.warn('Note: Could not run git diff check:', e.message);
}

console.log(`Discovered packages: ${packages.join(', ')}`);
if (changedFiles.size > 0) {
  console.log(`Detected ${changedFiles.size} changed file(s) in git workspace.`);
}

// 3. Verify each package has SPEC.md and check all SPEC.md files
for (const pkg of packages) {
  const pkgDir = join(PACKAGES_DIR, pkg);
  const rootSpecPath = join(pkgDir, 'SPEC.md');

  if (!existsSync(rootSpecPath)) {
    errors.push(`Package '@zmdb/${pkg}' is missing root specification file (packages/${pkg}/SPEC.md)`);
    continue;
  }

  const specFiles = findSpecFiles(pkgDir);
  for (const specPath of specFiles) {
    checkedSpecsCount++;
    const relPath = specPath.replace(ROOT + '/', '');
    const content = readFileSync(specPath, 'utf8');

    if (!content.trim()) {
      errors.push(`Specification file is empty: ${relPath}`);
      continue;
    }

    // Check minimum structural requirements
    if (!content.includes('# ')) {
      errors.push(`Specification file missing main title (# ...): ${relPath}`);
    }

    // Check if package source code was changed without updating spec or with unverified spec checklist
    const lines = content.split('\n');
    const pkgSrcPrefix = `packages/${pkg}/src/`;
    const pkgHasChanges = Array.from(changedFiles).some(f => f.startsWith(pkgSrcPrefix));
    if (pkgHasChanges) {
      // Ensure the package spec is valid and doesn't contain unchecked items
      const uncheckedInSpec = lines.filter(l => l.trim().startsWith('- [ ]'));
      if (uncheckedInSpec.length > 0) {
        errors.push(
          `Package '@zmdb/${pkg}' has source changes but ${relPath} contains ${uncheckedInSpec.length} unverified checklist item(s)`,
        );
      }
    }
  }
}

console.log(`Checked ${checkedSpecsCount} specification file(s).`);

if (errors.length > 0) {
  console.error('\nSpecification Validation Failed:');
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
} else {
  console.log('All specifications and checklist items validated successfully.');
  process.exit(0);
}
