import { tags } from '@zmdb/validator';
import { coerce, validateObject, type Brand } from '@zmdb/validator/advanced';
import { describe, it, expect } from 'vitest';

// #49: coercion, branded types, object strictness.

describe('coercion', () => {
  it('preserves finite numbers and accepts nonblank Number syntax', () => {
    for (const value of [0, -0, -2.5, Number.MIN_VALUE, Number.MAX_VALUE]) {
      expect(coerce.number(value)).toBe(value);
    }
    for (const [input, expected] of [
      [' 42 ', 42],
      ['-0', -0],
      ['1e3', 1000],
      ['0x10', 16],
      ['0b10', 2],
      ['0o10', 8],
      ['.5', 0.5],
    ] as const) {
      expect(coerce.number(input)).toBe(expected);
    }
  });

  it.each(
    [
      null,
      undefined,
      true,
      false,
      Symbol('number'),
      1n,
      [],
      [42],
      {},
      () => 42,
      '',
      ' \t\n',
      NaN,
      Infinity,
      -Infinity,
      'NaN',
      'Infinity',
      '-Infinity',
      '1e309',
    ].map(input => [input]),
  )('rejects nonnumeric shapes, blanks, and nonfinite values: %s', input => {
    expect(() => coerce.number(input)).toThrow(TypeError);
  });

  it.each([Symbol.toPrimitive, 'valueOf', 'toString'])('rejects objects without invoking %s', hook => {
    let calls = 0;
    const input = {
      [hook]() {
        calls++;
        return NaN;
      },
    };
    expect(() => coerce.number(input)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

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
