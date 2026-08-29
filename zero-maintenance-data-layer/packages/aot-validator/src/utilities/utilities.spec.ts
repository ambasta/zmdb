import { describe, it, expect } from 'vitest';
import {
  is,
  assert,
  validate,
  equals,
  random,
  AssertError,
  type TypeDescriptor,
} from './index.ts';

// RED PHASE (#56 spec freeze): validator utility surface.

const userDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number', minimum: 0 },
    email: { kind: 'string', maxLength: 255 },
    role: { kind: 'enum', values: ['admin', 'user'] },
  },
};

describe('is<T>', () => {
  it('returns true for valid, false for invalid', () => {
    expect(is({ id: 1, email: 'a@b.com', role: 'user' }, userDesc)).toBe(true);
    expect(is({ id: -1, email: 'a@b.com', role: 'user' }, userDesc)).toBe(false);
  });
});

describe('assert<T>', () => {
  it('returns input when valid', () => {
    const v = { id: 1, email: 'a@b.com', role: 'user' };
    expect(assert(v, userDesc)).toBe(v);
  });

  it('throws AssertError with exact path when invalid', () => {
    try {
      assert({ id: -1, email: 'a@b.com', role: 'user' }, userDesc);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AssertError);
      expect((e as AssertError).issues[0]?.path).toBe('input.id');
    }
  });
});

describe('validate<T>', () => {
  it('collects all failures without throwing', () => {
    const r = validate({ id: -1, email: 123, role: 'nope' }, userDesc);
    expect(r.success).toBe(false);
    expect(r.errors?.length).toBe(3);
  });
});

describe('equals<T> excess-property strictness', () => {
  it('is() passes but equals() fails on excess keys', () => {
    const v = { id: 1, email: 'a@b.com', role: 'user', extra: true };
    expect(is(v, userDesc)).toBe(true);
    expect(equals(v, userDesc)).toBe(false);
  });
});

describe('random<T>', () => {
  it('generates values that satisfy is<T>', () => {
    for (let i = 0; i < 20; i++) {
      const v = random(userDesc);
      expect(is(v, userDesc)).toBe(true);
    }
  });
});
