import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

describe('Specification Validation Script', () => {
  it('passes on the current repository specifications', () => {
    const result = execSync('node .github/scripts/validate-specs.mjs', { cwd: ROOT, encoding: 'utf8' });
    expect(result).toContain('All specifications and checklist items validated successfully.');
  });

  it('allows open checklist items in packages without source changes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'spec-val-test-'));
    try {
      const pkgDir = join(tempDir, 'packages', 'demo');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'SPEC.md'), '# Demo Spec\n\n- [ ] Unfinished task\n- [x] Finished task\n');

      const result = execSync(`node ${join(ROOT, '.github/scripts/validate-specs.mjs')}`, {
        cwd: tempDir,
        encoding: 'utf8',
      });
      expect(result).toContain('All specifications and checklist items validated successfully.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when a package is missing SPEC.md or SPEC.md is empty', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'spec-val-err-'));
    try {
      const pkgDir = join(tempDir, 'packages', 'demo');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'SPEC.md'), '   \n');

      let failed = false;
      try {
        execSync(`node ${join(ROOT, '.github/scripts/validate-specs.mjs')}`, {
          cwd: tempDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        failed = true;
        const stderr = String((err as { stderr?: Buffer | string }).stderr ?? '');
        expect(stderr).toContain('Specification file is empty');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
