import { describe, it, expect, expectTypeOf } from 'vitest';
import { coerce, validateObject, type Brand } from './index.ts';
import { tags } from '../index.ts';

// #49: coercion, branded types, object strictness.

describe('coercion', () => {
  it('coerce.number converts numeric strings and throws on NaN', () => {
    expect(coerce.number('42')).toBe(42);
    expect(() => coerce.number('nope')).toThrow(TypeError);
  });
});

describe('branded types (compile-time nominal)', () => {
  it('a branded value is assignable to its base but not cross-brand', () => {
    type UserId = Brand<number, 'UserId'>;
    type OrderId = Brand<number, 'OrderId'>;
    const uid = 1 as UserId;
    const asNumber: number = uid; // brand erases to base at runtime
    expect(asNumber).toBe(1);
    // Cross-brand assignment must NOT typecheck.
    expectTypeOf<UserId>().not.toEqualTypeOf<OrderId>();
  });
});

describe('object strictness modes', () => {
  it('strict rejects excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Minimum(0) }, 'strict');
    expect(r.success).toBe(false);
  });
  it('strip accepts excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Minimum(0) }, 'strip');
    expect(r.success).toBe(true);
  });
  it('passthrough accepts excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Minimum(0) }, 'passthrough');
    expect(r.success).toBe(true);
  });
});
