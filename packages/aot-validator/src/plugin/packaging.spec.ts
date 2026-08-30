import { describe, it, expect } from 'vitest';

import { zmdbAot } from './index.ts';

// #81: packaging — an unplugin-compatible plugin object whose transform hook
// inlines is<T>()/assert<T>() calls (a "fixture build" driven through the hook).

describe('zmdbAot plugin packaging', () => {
  it('exposes an unplugin-shaped object (name + transform)', () => {
    const p = zmdbAot();
    expect(p.name).toBe('zmdb-aot');
    expect(typeof p.transform).toBe('function');
  });

  it('transform hook inlines is<T>() for .ts modules (fixture build)', () => {
    const out = zmdbAot().transform('export const ok = is<{ n: number }>(input);', '/fixture/mod.ts');
    expect(out).not.toBeNull();
    expect(out?.code).toContain('typeof input.n === "number"');
    expect(out?.code).not.toContain('is<');
  });

  it('transform hook inlines primitive tag validation calls', () => {
    const p = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };
    const out = p.transform('export const ok = validate(tags.Minimum(5), input);', '/fixture/tags.ts');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('typeof input === "number" && input >= 5');
    expect(out!.code).not.toContain('validate(');
  });

  it('transform skips non-source ids (node_modules)', () => {
    expect(zmdbAot().transform('const x=1;', '/x/node_modules/dep/index.js')).toBeNull();
  });

  it('leaves modules without validator calls untouched (returns null)', () => {
    expect(zmdbAot().transform('export const x = 1 + 2;', '/fixture/plain.ts')).toBeNull();
  });

  it('leaves types outside the supported subset untouched (never emits a wrong check)', () => {
    // A named type is not inlineable by this parser. The call must survive
    // verbatim — emitting a check for a type we could not parse would produce a
    // validator that is silently always-false.
    const src = 'export const ok = is<User>(input);';
    expect(zmdbAot().transform(src, '/fixture/named.ts')).toBeNull();
  });

  it('inlines a supported call while leaving an unsupported one alone', () => {
    const src = 'const a = is<{ n: number }>(x); const b = is<User>(y);';
    const out = zmdbAot().transform(src, '/fixture/mixed.ts');
    expect(out?.code).toContain('typeof x.n === "number"');
    expect(out?.code).toContain('is<User>(y)');
  });
});
