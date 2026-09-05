import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { normalizeType, parseDeclarations, auditHygiene, compareClasses, validateSpecs } from './validate-specs.mjs';

const ROOT = process.cwd();

describe('Specification & AST Drift Validation Script', () => {
  it('passes on the current repository specifications', () => {
    const result = execFileSync('node', ['.github/scripts/validate-specs.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result).toContain(
      'All specifications, checklist items, and AST contract signatures validated with zero drift.',
    );
  }, 20000);

  it('normalizes type strings consistently', () => {
    expect(normalizeType('  number | string  ')).toBe('number|string');
    expect(normalizeType('| "a" | "b"')).toBe('"a"|"b"');
    expect(normalizeType('Record< string , unknown >')).toBe('Record<string,unknown>');
    expect(normalizeType('readonly string[]; // comment')).toBe('readonly string[]');
  });

  it('extracts declarations and line numbers from code blocks using AST parsing', () => {
    const code = `
interface User {
  id: number;
  name: string;
}

function getUser(id: number): User;
`;
    const decls = parseDeclarations(code, 'test.ts', 10);

    expect(decls).toHaveLength(2);
    expect(decls[0]).toMatchObject({
      kind: 'interface',
      name: 'User',
      line: 11,
      properties: [
        { name: 'id', optional: false, type: 'number' },
        { name: 'name', optional: false, type: 'string' },
      ],
    });

    expect(decls[1]).toMatchObject({
      kind: 'function',
      name: 'getUser',
      line: 16,
      params: [{ name: 'id', optional: false, type: 'number' }],
      returnType: 'User',
    });
  });

  it('compares class method and property signatures against source definitions', () => {
    const specClass = {
      name: 'EventBus',
      methods: [{ name: 'fakeMethod', params: [], returnType: 'void' }],
      properties: [],
    };
    const srcClass = {
      name: 'EventBus',
      methods: [{ name: 'subscribe', params: [], returnType: 'void' }],
      properties: [],
    };
    const result = compareClasses(specClass, srcClass);
    expect(result).toBe("method 'fakeMethod' missing in source class 'EventBus'");
  });

  it('audits codebase hygiene and ARCHITECTURE §2.1 type assertion ratchet', () => {
    const hygiene = auditHygiene();
    expect(hygiene.success).toBe(true);
    expect(hygiene.errors).toEqual([]);
    // Ratchet ceiling for ARCHITECTURE §2.1 type assertion boundaries across src/.
    // Provenance: 68 is the established baseline ceiling of total documented type assertion boundaries across all package sources.
    // This limit must only ever decrease as assertions are eliminated.
    expect(hygiene.totalAssertions).toBeLessThanOrEqual(68);
    expect(hygiene.nonNullHitsCount).toBe(0);
    expect(hygiene.evalHitsCount).toBe(0);
  });

  it('detects AST undocumented non-null assertions inside temporary package structures', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'hygiene-test-'));
    try {
      const pkgSrc = join(tempDir, 'demo', 'src');
      mkdirSync(pkgSrc, { recursive: true });
      writeFileSync(
        join(pkgSrc, 'leak.ts'),
        `
// boundary: valid assertion
const valid = (x as string);
const leak2 = xs[0]!;
`,
      );

      const hygiene = auditHygiene(tempDir);
      expect(hygiene.success).toBe(false);
      expect(hygiene.nonNullHitsCount).toBe(1);
      expect(hygiene.errors.some(e => e.includes("Forbidden undocumented non-null assertion '!'"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires leading comment trivia on assertion statements rather than a line window', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'trivia-test-'));
    try {
      const pkgSrc = join(tempDir, 'demo', 'src');
      mkdirSync(pkgSrc, { recursive: true });
      writeFileSync(
        join(pkgSrc, 'index.ts'),
        `
// boundary: valid comment
const a = (p.value as string);

const sneaky = (p as { totallyUndocumented: string }).totallyUndocumented;
`,
      );

      const hygiene = auditHygiene(tempDir);
      expect(hygiene.success).toBe(false);
      expect(hygiene.missingBoundariesCount).toBe(1);
      expect(hygiene.errors.some(e => e.includes('Missing // boundary: comment'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs full verification across package specifications with zero drift', () => {
    const result = validateSpecs();
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  }, 20000);

  it('allows open checklist items in packages without source changes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'spec-val-test-'));
    try {
      const pkgDir = join(tempDir, 'packages', 'demo');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'SPEC.md'), '# Demo Spec\n\n- [ ] Unfinished task\n- [x] Finished task\n');

      const result = execFileSync('node', [join(ROOT, '.github/scripts/validate-specs.mjs')], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(result).toContain(
        'All specifications, checklist items, and AST contract signatures validated with zero drift.',
      );
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
        execFileSync('node', [join(ROOT, '.github/scripts/validate-specs.mjs')], {
          cwd: tempDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 15000,
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
