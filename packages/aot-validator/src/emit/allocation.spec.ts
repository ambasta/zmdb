// REQ-AV-7: structured issues, and nothing paid for them until one is needed.
//
// Both validators can say *where* a value went wrong, with a path and an expected string.
// The requirement is that this costs nothing when the value is fine — which is almost
// always — so a valid input must not build an issue list, an issue object, or an error.
//
// The measurement is a counting `Array.prototype.push`. Every issue in both
// implementations reaches its list through a `push` whose argument is the freshly built
// issue object, so "never pushed" is a faithful stand-in for "never built one", and unlike
// a heap-size delta it is deterministic. What it does not see is the bare `const _e = []`
// ahead of the early return, which is why `emit.spec.ts` also asserts that the generated
// text does not contain one.

import { afterAll, describe, expect, it } from 'vitest';

import { assert, assertEquals, equals, is, validate } from '../utilities/index.ts';
import { FixtureProject } from './__testing__/project.ts';

const project = FixtureProject.open({
  declarations: `  interface User { id: number & Min<1>; email: string; tags: string[] }
  interface Wrapper { user: User; count: number }`,
});
afterAll(() => project.close());

/**
 * Run `work` with a counting `Array.prototype.push` installed.
 *
 * The patch is global, so the window is as small as it can be and the restore is in a
 * `finally`: leaking a wrapped `push` into the rest of the run would be a very confusing
 * way to fail some unrelated test.
 */
function countPushes(work: () => void): number {
  const original = Array.prototype.push;
  let pushes = 0;
  // oxlint-disable-next-line no-extend-native -- patching the builtin *is* the measurement
  Array.prototype.push = function patched(this: unknown[], ...items: unknown[]): number {
    pushes += items.length;
    return original.apply(this, items);
  };
  try {
    work();
  } finally {
    // oxlint-disable-next-line no-extend-native -- putting it back
    Array.prototype.push = original;
  }
  return pushes;
}

const VALID = { id: 1, email: 'a@b', tags: ['x'] };
const INVALID = { id: 0, email: 'a@b', tags: ['x'] };

const ir = project.ir('User');
const emitted = {
  is: project.build('const check = (input) => is<User>(input);').check,
  equals: project.build('const check = (input) => equals<User>(input);').check,
  assert: project.build('const check = (input) => assert<User>(input);').check,
  assertEquals: project.build('const check = (input) => assertEquals<User>(input);').check,
  validate: project.build('const check = (input) => validate<User>(input);').check,
};

// Both paths memoise on first use — the runtime walker builds a ref table per schema, the
// regex cache fills — so everything runs once before anything is counted.
function warm(): void {
  for (const value of [VALID, INVALID]) {
    is(value, ir);
    equals(value, ir);
    validate(value, ir);
    emitted.is(value);
    emitted.equals(value);
    emitted.validate(value);
    try {
      assert(value, ir);
    } catch {
      /* expected for INVALID */
    }
    try {
      emitted.assert(value);
    } catch {
      /* expected for INVALID */
    }
  }
}
warm();

const ROUNDS = 1000;

describe('the emitted validator', () => {
  it('allocates no issue on a valid input', () => {
    expect(
      countPushes(() => {
        for (let index = 0; index < ROUNDS; index += 1) {
          emitted.is(VALID);
          emitted.equals(VALID);
          emitted.assert(VALID);
          emitted.assertEquals(VALID);
          emitted.validate(VALID);
        }
      }),
    ).toBe(0);
  });

  it('allocates one issue on an invalid input, not a list of everything it checked', () => {
    expect(
      countPushes(() => {
        emitted.validate(INVALID);
      }),
    ).toBe(1);
  });
});

describe('the runtime walker', () => {
  it('allocates no issue on a valid input', () => {
    expect(
      countPushes(() => {
        for (let index = 0; index < ROUNDS; index += 1) {
          is(VALID, ir);
          equals(VALID, ir);
          assert(VALID, ir);
          assertEquals(VALID, ir);
          validate(VALID, ir);
        }
      }),
    ).toBe(0);
  });

  it('allocates one issue on an invalid input', () => {
    expect(
      countPushes(() => {
        validate(INVALID, ir);
      }),
    ).toBe(1);
  });
});

describe('nesting does not change the answer', () => {
  it('stays allocation-free through an object, an array and a nested named type', () => {
    const nested = project.ir('Wrapper');
    const check = project.build('const check = (input) => assert<Wrapper>(input);').check;
    const value = { user: VALID, count: 2 };
    assert(value, nested);
    check(value);
    expect(
      countPushes(() => {
        for (let index = 0; index < ROUNDS; index += 1) {
          assert(value, nested);
          check(value);
        }
      }),
    ).toBe(0);
  });
});
