import { describe, it, expect } from 'vitest';

import { transformTypeChecks } from './index.ts';

// RED PHASE (#79 spec freeze): the AOT plugin's emitted-JS contract.

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('AOT plugin: is<T> inlining', () => {
  it('inlines a flat object type into a monomorphic check', () => {
    const out = transformTypeChecks('const ok = is<{ n: number }>(input);');
    expect(norm(out)).toContain('typeof input === "object" && input !== null && typeof input.n === "number"');
  });

  it('inlines multiple fields', () => {
    const out = transformTypeChecks('const ok = is<{ a: number; b: string }>(input);');
    const n = norm(out);
    expect(n).toContain('typeof input.a === "number"');
    expect(n).toContain('typeof input.b === "string"');
  });

  it('emitted output contains no TypeDescriptor walk / no is( call', () => {
    const out = transformTypeChecks('const ok = is<{ n: number }>(input);');
    expect(out).not.toContain('is<');
    expect(out).not.toContain('TypeDescriptor');
  });

  it('leaves code without zmdb validator calls unchanged', () => {
    const src = 'const x = 1 + 2;';
    expect(norm(transformTypeChecks(src))).toBe(norm(src));
  });
});

describe('AOT plugin: assert<T> inlining', () => {
  it('wraps the inline check and returns the input', () => {
    const out = transformTypeChecks('const v = assert<{ s: string }>(input);');
    const n = norm(out);
    expect(n).toContain('typeof input.s === "string"');
    expect(n).toContain('throw'); // structured throw on failure
  });
});
