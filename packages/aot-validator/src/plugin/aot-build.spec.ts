import { describe, it, expect } from 'vitest';

import { is as runtimeIs, type TypeDescriptor } from '../utilities/index.ts';
import { zmdbAot } from './index.ts';

// #82: verify the AOT BUILD (the #81 unplugin transform) produces a WORKING,
// inlined validator — i.e. run the transform over a fixture module, execute the
// emitted output, and confirm behavior + that it is the inlined path (no runtime
// descriptor walk) and materially faster than the runtime validator.

declare const performance: { now(): number };

const plugin = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };

// Build an executable validator from transformed source (the "AOT build").
function buildValidatorFromSource(): (input: unknown) => boolean {
  const src = 'const check = (input) => is<{ number: number; str: string; nested: { a: number } }>(input);';
  const out = plugin.transform(src, '/fixture/validator.ts');
  if (!out) throw new Error('transform produced no output');
  // The emitted code has NO runtime call — it is a straight-line inline check.
  expect(out.code).not.toContain('is<');
  expect(out.code).toContain('typeof input.nested.a === "number"');
  return new Function(`${out.code}; return check;`)() as (input: unknown) => boolean;
}

describe('AOT build produces a working inlined validator (#82)', () => {
  const check = buildValidatorFromSource();
  const good = { number: 1, str: 'x', nested: { a: 2 } };
  const bad = { number: 1, str: 'x', nested: { a: 'nope' } };

  it('accepts valid input, rejects invalid — behavior matches the runtime validator', () => {
    const desc: TypeDescriptor = {
      kind: 'object',
      fields: {
        number: { kind: 'number' },
        str: { kind: 'string' },
        nested: { kind: 'object', fields: { a: { kind: 'number' } } },
      },
    };
    expect(check(good)).toBe(true);
    expect(check(bad)).toBe(false);
    // same verdicts as the shipped runtime validator
    expect(check(good)).toBe(runtimeIs(good, desc));
    expect(check(bad)).toBe(runtimeIs(bad, desc));
  });

  it('records real numbers: AOT-built path is materially faster than runtime', () => {
    const desc: TypeDescriptor = {
      kind: 'object',
      fields: {
        number: { kind: 'number' },
        str: { kind: 'string' },
        nested: { kind: 'object', fields: { a: { kind: 'number' } } },
      },
    };
    const bench = (fn: () => void, n: number) => {
      const s = performance.now();
      for (let i = 0; i < n; i++) fn();
      return Math.round((n / (performance.now() - s)) * 1000);
    };
    const N = 200_000;
    const aotOps = bench(() => void check(good), N);
    const runtimeOps = bench(() => void runtimeIs(good, desc), N);
    console.log(
      `AOT-build ops/s=${aotOps.toLocaleString()} runtime ops/s=${runtimeOps.toLocaleString()} (${(aotOps / runtimeOps).toFixed(1)}x)`,
    );
    expect(aotOps).toBeGreaterThan(runtimeOps); // inlined path must be faster
  });
});
