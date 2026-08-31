import { describe, it, expect } from 'vitest';

import { is as runtimeIs, type TypeDescriptor } from '../utilities/index.ts';
import { buildInlinedCheck, opsPerSecond } from './inline-bench.ts';

// #82: verify the AOT BUILD (the #81 unplugin transform) produces a WORKING,
// inlined validator — i.e. run the transform over a fixture module, execute the
// emitted output, and confirm behavior + that it is the inlined path (no runtime
// descriptor walk) and materially faster than the runtime validator.

// Build an executable validator from transformed source (the "AOT build").
function buildValidatorFromSource(): (input: unknown) => boolean {
  const src = 'const check = (input) => is<{ number: number; str: string; nested: { a: number } }>(input);';
  const { code, check } = buildInlinedCheck(src, '/fixture/validator.ts');
  // The emitted code has NO runtime call — it is a straight-line inline check.
  expect(code).not.toContain('is<');
  expect(code).toContain('typeof input.nested.a === "number"');
  return check;
}

const desc: TypeDescriptor = {
  kind: 'object',
  fields: {
    number: { kind: 'number' },
    str: { kind: 'string' },
    nested: { kind: 'object', fields: { a: { kind: 'number' } } },
  },
};

describe('AOT build produces a working inlined validator (#82)', () => {
  const check = buildValidatorFromSource();
  const good = { number: 1, str: 'x', nested: { a: 2 } };
  const bad = { number: 1, str: 'x', nested: { a: 'nope' } };

  it('accepts valid input, rejects invalid — behavior matches the runtime validator', () => {
    expect(check(good)).toBe(true);
    expect(check(bad)).toBe(false);
    // same verdicts as the shipped runtime validator
    expect(check(good)).toBe(runtimeIs(good, desc));
    expect(check(bad)).toBe(runtimeIs(bad, desc));
  });

  it('records real numbers: AOT-built path is materially faster than runtime', () => {
    const N = 200_000;
    const aotOps = opsPerSecond(() => void check(good), N);
    const runtimeOps = opsPerSecond(() => void runtimeIs(good, desc), N);
    console.log(
      `AOT-build ops/s=${aotOps.toLocaleString()} runtime ops/s=${runtimeOps.toLocaleString()} (${(aotOps / runtimeOps).toFixed(1)}x)`,
    );
    expect(aotOps).toBeGreaterThan(runtimeOps); // inlined path must be faster
  });
});
