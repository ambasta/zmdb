import { describe, it, expect } from 'vitest';
import { transformSource, validate, tags } from './index.ts';

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
});
