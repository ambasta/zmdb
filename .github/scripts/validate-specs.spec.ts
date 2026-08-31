import { execSync } from 'node:child_process';

import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

describe('Specification Validation Script', () => {
  it('passes on the current repository specifications', () => {
    const result = execSync('node .github/scripts/validate-specs.mjs', { cwd: ROOT, encoding: 'utf8' });
    expect(result).toContain('All specifications and checklist items validated successfully.');
  });
});
