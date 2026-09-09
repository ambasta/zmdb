import { tags } from '@zmdb/validator';
import { coerce, validateObject, type Brand } from '@zmdb/validator/advanced';
import { describe, it, expect } from 'vitest';

// #49: coercion, branded types, object strictness.

describe('coercion', () => {
  it('coerce.number accepts finite numbers and nonblank numeric strings', () => {
    expect(coerce.number(42)).toBe(42);
    expect(coerce.number(0)).toBe(0);
    expect(coerce.number(-3.14)).toBe(-3.14);
    expect(coerce.number('42')).toBe(42);
    expect(coerce.number('  123.45  ')).toBe(123.45);
    expect(coerce.number('1e3')).toBe(1000);
  });

  it('coerce.number throws TypeError on non-finite numbers and invalid strings', () => {
    expect(() => coerce.number(NaN)).toThrow(TypeError);
    expect(() => coerce.number(Infinity)).toThrow(TypeError);
    expect(() => coerce.number(-Infinity)).toThrow(TypeError);
    expect(() => coerce.number('nope')).toThrow(TypeError);
    expect(() => coerce.number('')).toThrow(TypeError);
    expect(() => coerce.number('   ')).toThrow(TypeError);
    expect(() => coerce.number('Infinity')).toThrow(TypeError);
  });

  it('coerce.number throws TypeError on nullish, booleans, collections, objects, symbols, and functions', () => {
    expect(() => coerce.number(null)).toThrow(TypeError);
    expect(() => coerce.number(undefined)).toThrow(TypeError);
    expect(() => coerce.number(true)).toThrow(TypeError);
    expect(() => coerce.number(false)).toThrow(TypeError);
    expect(() => coerce.number(Symbol('test'))).toThrow(TypeError);
    expect(() => coerce.number(BigInt(100))).toThrow(TypeError);
    expect(() => coerce.number([])).toThrow(TypeError);
    expect(() => coerce.number([1, 2])).toThrow(TypeError);
    expect(() => coerce.number({})).toThrow(TypeError);
    expect(() => coerce.number(() => 42)).toThrow(TypeError);
  });

  it('coerce.number rejects objects without executing user conversion hooks (valueOf / toString)', () => {
    let valueOfCalls = 0;
    let toStringCalls = 0;
    const objWithHooks = {
      valueOf() {
        valueOfCalls++;
        return 42;
      },
      toString() {
        toStringCalls++;
        return '42';
      },
    };

    expect(() => coerce.number(objWithHooks)).toThrow(TypeError);
    expect(valueOfCalls).toBe(0);
    expect(toStringCalls).toBe(0);
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
