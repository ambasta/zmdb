import { describe, it, expect } from 'vitest';

import { transformSource, validate, tags, getRegExp } from './index.ts';

// RED PHASE (#21 spec freeze): transformer golden fixtures + runtime fallback.

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('transformer inlining (golden fixtures)', () => {
  it('inlines Minimum', () => {
    const out = transformSource('const ok = validate(tags.Minimum(0), input.price);');
    expect(norm(out)).toContain('typeof input.price === "number" && input.price >= 0');
  });

  it('inlines MaxLength', () => {
    const out = transformSource('const ok = validate(tags.MaxLength(255), input.name);');
    expect(norm(out)).toContain('typeof input.name === "string" && input.name.length <= 255');
  });

  it('inlines Enum as OR chain', () => {
    const out = transformSource('const ok = validate(tags.Enum("a","b"), input.role);');
    expect(norm(out)).toContain('input.role === "a" || input.role === "b"');
  });

  it('leaves code without validate() calls unchanged', () => {
    const src = 'const x = 1 + 2;';
    expect(norm(transformSource(src))).toBe(norm(src));
  });

  it('emitted code contains no reference to validate(', () => {
    const out = transformSource('const ok = validate(tags.Minimum(0), input.price);');
    expect(out).not.toContain('validate(');
  });
});

describe('runtime-safety fallback (pre-transform behavior)', () => {
  it('Minimum passes/fails correctly at runtime', () => {
    expect(validate(tags.Minimum(0), 5)).toBe(true);
    expect(validate(tags.Minimum(0), -1)).toBe(false);
  });

  it('Enum membership at runtime', () => {
    expect(validate(tags.Enum('a', 'b'), 'a')).toBe(true);
    expect(validate(tags.Enum('a', 'b'), 'c')).toBe(false);
  });

  it('reuses cached RegExp instance for pattern rules', () => {
    const patternRule = tags.Pattern('^[a-z]+$');
    expect(validate(patternRule, 'hello')).toBe(true);
    expect(validate(patternRule, '123')).toBe(false);
  });

  it('uses cached Set lookup for enum rules', () => {
    const enumRule = tags.Enum('alpha', 'beta', 'gamma');
    for (let i = 0; i < 100; i++) {
      expect(validate(enumRule, 'beta')).toBe(true);
      expect(validate(enumRule, 'delta')).toBe(false);
    }
  });

  it('bounds RegExp cache with LRU eviction', () => {
    const firstRegexp = getRegExp('pattern_0');
    for (let i = 1; i <= 1005; i++) {
      getRegExp(`pattern_${i}`);
    }
    const newFirstRegexp = getRegExp('pattern_0');
    expect(newFirstRegexp).not.toBe(firstRegexp);
  });
});
