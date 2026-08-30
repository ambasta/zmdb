import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineType, encodeValue, decodeValue, type CustomType } from './index.ts';

// A jsonb codec: TS object <-> JSON string in the DB.
const jsonType = defineTypeSafe();
function defineTypeSafe() {
  try {
    return defineType<Record<string, unknown>, string>({
      sqlType: 'jsonb',
      toDb: (v) => JSON.stringify(v),
      fromDb: (raw) => JSON.parse(raw),
    });
  } catch {
    // during red phase defineType throws; return a placeholder for module load
    return { sqlType: 'jsonb', toDb: JSON.stringify, fromDb: JSON.parse } as CustomType<Record<string, unknown>, string>;
  }
}

describe('custom types & codecs (#133)', () => {
  it('defineType returns a frozen descriptor', () => {
    const t = defineType<number, string>({ sqlType: 'text', toDb: String, fromDb: Number });
    expect(t.sqlType).toBe('text');
    expect(Object.isFrozen(t)).toBe(true);
  });

  it('encode/decode round-trip', () => {
    const t = defineType<Record<string, unknown>, string>({
      sqlType: 'jsonb', toDb: (v) => JSON.stringify(v), fromDb: (r) => JSON.parse(r),
    });
    const v = { a: 1, b: [2, 3] };
    expect(decodeValue(t, encodeValue(t, v))).toEqual(v);
  });

  it('type-level: codec TS/DB types flow', () => {
    expectTypeOf(jsonType.toDb).parameter(0).toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf(jsonType.fromDb).returns.toEqualTypeOf<Record<string, unknown>>();
  });
});
