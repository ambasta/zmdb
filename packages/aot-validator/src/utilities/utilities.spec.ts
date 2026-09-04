import { describe, it, expect } from 'vitest';

import {
  is,
  isShallow,
  assert,
  assertShallow,
  validate,
  validateShallow,
  equals,
  failWith,
  issuesFor,
  random,
  AssertError,
  type TypeIR,
} from './index.js';

// RED PHASE (#56 spec freeze): validator utility surface.

const user: TypeIR = {
  kind: 'object',
  properties: [
    {
      name: 'id',
      type: { kind: 'scalar', scalar: 'number', constraints: { minimum: 0 } },
      optional: false,
      readonly: false,
    },
    {
      name: 'email',
      type: { kind: 'scalar', scalar: 'string', constraints: { maxLength: 255 } },
      optional: false,
      readonly: false,
    },
    {
      name: 'role',
      type: {
        kind: 'union',
        members: [
          { kind: 'literal', value: 'admin' },
          { kind: 'literal', value: 'user' },
        ],
      },
      optional: false,
      readonly: false,
    },
  ],
};

const nested: TypeIR = {
  kind: 'object',
  properties: [
    {
      name: 'user',
      type: {
        kind: 'object',
        properties: [
          {
            name: 'id',
            type: { kind: 'scalar', scalar: 'number' },
            optional: false,
            readonly: false,
          },
        ],
      },
      optional: false,
      readonly: false,
    },
  ],
};

describe('is<T>', () => {
  it('returns true for valid, false for invalid', () => {
    expect(is({ id: 1, email: 'a@b.com', role: 'user' }, user)).toBe(true);
    expect(is({ id: -1, email: 'a@b.com', role: 'user' }, user)).toBe(false);
  });
});

describe('assert<T>', () => {
  it('returns input when valid', () => {
    const v = { id: 1, email: 'a@b.com', role: 'user' };
    expect(assert(v, user)).toBe(v);
  });

  it('throws AssertError with exact path when invalid', () => {
    try {
      assert({ id: -1, email: 'a@b.com', role: 'user' }, user);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AssertError);
      expect((e as AssertError).issues[0]?.path).toBe('input.id');
    }
  });
});

describe('failWith', () => {
  // The one function emitted code imports at runtime, so what it throws is the AOT path's
  // whole error contract: `assert<T>` inlined by the transformer and `assert(x, ir)` walked
  // here have to be indistinguishable to a `catch` (REQ-AV-4).
  it('throws the same error the walker does, from the issues it is handed', () => {
    const issues = issuesFor({ id: -1, email: 'a@b.com', role: 'user' }, user);
    expect(() => failWith(issues)).toThrow(AssertError);
    try {
      failWith(issues);
    } catch (e) {
      expect(e).toBeInstanceOf(AssertError);
      // The first issue supplies the message, and every issue is still reachable — a
      // handler that renders a form needs all of them, not the one that happened to be first.
      expect((e as AssertError).message).toBe(issues[0]?.message);
      expect((e as AssertError).issues).toEqual(issues);
      expect((e as Error).name).toBe('AssertError');
    }
  });

  it('still throws when there is nothing to say', () => {
    // Reachable: an emitted check answers false and a caller asks for the issues in a
    // configuration that does not collect them. Throwing nothing would turn a rejected value
    // into an accepted one, which is the only outcome worse than an unhelpful message.
    try {
      failWith([]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AssertError);
      expect((e as AssertError).message).toBe('validation failed');
      expect((e as AssertError).issues).toEqual([]);
    }
  });
});

describe('validate<T>', () => {
  it('collects all failures without throwing', () => {
    const r = validate({ id: -1, email: 123, role: 'nope' }, user);
    expect(r.success).toBe(false);
    expect(r.errors?.length).toBe(3);
  });
});

describe('shallow validator fallback', () => {
  it('throws the untransformed-build error for every shallow entry point', () => {
    for (const call of [
      () => isShallow<{ user: { id: number } }>({ user: { id: 1 } }),
      () => assertShallow<{ user: { id: number } }>({ user: { id: 1 } }),
      () => validateShallow<{ user: { id: number } }>({ user: { id: 1 } }),
    ]) {
      expect(call).toThrow('runtime type witness required in test/fallback mode');
    }
  });

  it('walks the explicit witness only to the supplied depth', () => {
    const malformedBelowLimit = { user: { id: 'not a number' } };
    expect(isShallow<{ user: { id: number } }, 1>(malformedBelowLimit, nested, 1)).toBe(true);
    expect(isShallow<{ user: { id: number } }, 2>(malformedBelowLimit, nested, 2)).toBe(false);
    expect(assertShallow<{ user: { id: number } }, 1>(malformedBelowLimit, nested, 1)).toBe(malformedBelowLimit);
    expect(validateShallow<{ user: { id: number } }, 1>(malformedBelowLimit, nested, 1)).toEqual({
      success: true,
      data: malformedBelowLimit,
    });
    expect(validateShallow<{ user: { id: number } }, 2>(malformedBelowLimit, nested, 2)).toEqual({
      success: false,
      errors: [
        {
          path: 'input.user.id',
          expected: 'number',
          value: 'not a number',
          message: 'expected number',
        },
      ],
    });
    expect(isShallow({ user: 'not an object' }, nested, 1)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses invalid fallback depth %s', depth => {
    expect(() => isShallow({ user: { id: 1 } }, nested, depth)).toThrow(
      'shallow validation fallback depth must be a positive integer',
    );
  });
});

describe('equals<T> excess-property strictness', () => {
  it('is() passes but equals() fails on excess keys', () => {
    const v = { id: 1, email: 'a@b.com', role: 'user', extra: true };
    expect(is(v, user)).toBe(true);
    expect(equals(v, user)).toBe(false);
  });
});

describe('random<T>', () => {
  it('generates values that satisfy is<T>', () => {
    for (let i = 0; i < 20; i++) {
      const v = random(user);
      expect(is(v, user)).toBe(true);
    }
  });
});
