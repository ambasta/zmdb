import { describe, it, expect } from 'vitest';

import { is, assert, validate, equals, random, AssertError, type TypeIR } from './index.ts';

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

describe('validate<T>', () => {
  it('collects all failures without throwing', () => {
    const r = validate({ id: -1, email: 123, role: 'nope' }, user);
    expect(r.success).toBe(false);
    expect(r.errors?.length).toBe(3);
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
