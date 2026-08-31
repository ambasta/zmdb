import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ROOT = process.cwd();
const SITE_DIR = join(ROOT, 'site');

describe('Documentation Site Generator with Fallback Assets', () => {
  beforeEach(() => {
    if (existsSync(SITE_DIR)) {
      rmSync(SITE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Re-run build to leave site directory populated
    try {
      execFileSync('node', ['docs-site/build.mjs'], { cwd: ROOT, stdio: 'pipe' });
    } catch {}
  });

  it('generates site including docs and fallback benchmark assets when benchmark site files are missing', () => {
    // Build docs site
    execFileSync('node', ['docs-site/build.mjs'], { cwd: ROOT, stdio: 'pipe' });

    expect(existsSync(join(SITE_DIR, 'index.html'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'docs', 'quick-start.html'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'benchmarks', 'index.html'))).toBe(true);

    const valMatrixPath = join(SITE_DIR, 'benchmarks', 'validation-matrix.json');
    const ormResultsPath = join(SITE_DIR, 'benchmarks', 'orm-results.json');

    expect(existsSync(valMatrixPath)).toBe(true);
    expect(existsSync(ormResultsPath)).toBe(true);

    const valMatrix = JSON.parse(readFileSync(valMatrixPath, 'utf8'));
    const ormResults = JSON.parse(readFileSync(ormResultsPath, 'utf8'));

    expect(valMatrix).toBeDefined();
    expect(ormResults).toBeDefined();
  });

  it('extracts section and script elements including uppercase tags and tags with attributes', () => {
    const dashDir = join(ROOT, 'benchmarks', 'site');
    const dashIndex = join(dashDir, 'index.html');
    mkdirSync(dashDir, { recursive: true });

    const htmlContent = `<!DOCTYPE html><html><body>
      <SECTION id="test-sec"><h2>Test Section</h2></SECTION>
      <SCRIPT type="text/javascript">console.log("hello");</SCRIPT>
    </body></html>`;

    writeFileSync(dashIndex, htmlContent, 'utf8');

    try {
      execFileSync('node', ['docs-site/build.mjs'], { cwd: ROOT, stdio: 'pipe' });

      const builtBmHtml = readFileSync(join(SITE_DIR, 'benchmarks', 'index.html'), 'utf8');
      expect(builtBmHtml).toContain('Test Section');
      expect(builtBmHtml).toContain('console.log("hello")');
    } finally {
      if (existsSync(dashIndex)) {
        rmSync(dashIndex, { force: true });
      }
    }
  });
});
