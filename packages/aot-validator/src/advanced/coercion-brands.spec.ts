import { describe, it, expect } from 'vitest';

import { tags } from '../index.js';
import { coerce, validateObject, type Brand } from './index.js';

// #49: coercion, branded types, object strictness.

describe('coercion', () => {
  it('coerce.number converts numeric strings and throws on NaN', () => {
    expect(coerce.number('42')).toBe(42);
    expect(() => coerce.number('nope')).toThrow(TypeError);
  });
});

// Nominality is asserted in `brands.type-test.ts`; what a *runtime* test can show
// is the other half of the claim: a brand has no runtime footprint at all.
describe('branded types (compile-time nominal)', () => {
  it('a branded value is its base value at runtime — zero footprint', () => {
    type UserId = Brand<number, 'UserId'>;
    const uid = 1 as UserId;
    const asNumber: number = uid;
    expect(asNumber).toBe(1);
    expect(Object.keys(Object(uid))).toEqual([]); // no brand property exists
  });
});

describe('object strictness modes', () => {
  it('strict rejects excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strict');
    expect(r.success).toBe(false);
  });
  it('strip accepts excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strip');
    expect(r.success).toBe(true);
  });
  it('passthrough accepts excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'passthrough');
    expect(r.success).toBe(true);
  });
});
