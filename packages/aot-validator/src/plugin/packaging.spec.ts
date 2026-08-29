import { describe, it, expect } from 'vitest';
import { zmdbAot } from './index.ts';

// #81: packaging — an unplugin-compatible plugin object whose transform hook
// inlines is<T>()/assert<T>() calls (a "fixture build" driven through the hook).

describe('zmdbAot plugin packaging', () => {
  it('exposes an unplugin-shaped object (name + transform)', () => {
    const p = zmdbAot() as { name: string; transform: unknown };
    expect(p.name).toBe('zmdb-aot');
    expect(typeof p.transform).toBe('function');
  });

  it('transform hook inlines is<T>() for .ts modules (fixture build)', () => {
    const p = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };
    const out = p.transform('export const ok = is<{ n: number }>(input);', '/fixture/mod.ts');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('typeof input.n === "number"');
    expect(out!.code).not.toContain('is<');
  });

  it('transform skips non-source ids (node_modules)', () => {
    const p = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };
    expect(p.transform('const x=1;', '/x/node_modules/dep/index.js')).toBeNull();
  });

  it('leaves modules without validator calls untouched (returns null)', () => {
    const p = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };
    expect(p.transform('export const x = 1 + 2;', '/fixture/plain.ts')).toBeNull();
  });
});
