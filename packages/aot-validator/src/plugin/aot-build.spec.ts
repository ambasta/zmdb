// #82: the build produces a validator that works, and that is actually the inlined one.
//
// The point of this test is end-to-end rather than unit: a source file goes through the
// real transform, the emitted text is evaluated as JavaScript, and the resulting function
// is asked the same questions as the runtime walker. If the emitted code did not parse, or
// still called back into the walker, or disagreed with it, this is where that shows up.

import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.ts';
import { is as runtimeIs } from '../utilities/index.ts';
import { opsPerSecond } from './inline-bench.ts';

const TYPE = '{ number: number; str: string; nested: { a: number } }';

const project = FixtureProject.open();
afterAll(() => project.close());

const { code, check } = project.build(`const check = (input) => is<${TYPE}>(input);`);
const ir = project.ir(TYPE);

const good = { number: 1, str: 'x', nested: { a: 2 } };
const bad = { number: 1, str: 'x', nested: { a: 'nope' } };

describe('AOT build produces a working inlined validator (#82)', () => {
  it('emits a straight-line check with no call back into the validator', () => {
    expect(code).not.toContain('is<');
    expect(code).toContain('typeof input.nested.a === "number"');
    expect(code).not.toContain('import');
  });

  it('accepts valid input and rejects invalid, agreeing with the runtime validator', () => {
    expect(check(good)).toBe(true);
    expect(check(bad)).toBe(false);
    expect(check(good)).toBe(runtimeIs(good, ir));
    expect(check(bad)).toBe(runtimeIs(bad, ir));
  });

  it('records real numbers: the AOT-built path is materially faster than the runtime one', () => {
    const N = 200_000;
    const aotOps = opsPerSecond(() => void check(good), N);
    const runtimeOps = opsPerSecond(() => void runtimeIs(good, ir), N);
    console.log(
      `AOT-build ops/s=${aotOps.toLocaleString()} runtime ops/s=${runtimeOps.toLocaleString()} (${(aotOps / runtimeOps).toFixed(1)}x)`,
    );
    expect(aotOps).toBeGreaterThan(runtimeOps);
  });
});
