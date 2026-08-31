import { describe, it, expect } from 'vitest';

import { defineType, encodeValue, decodeValue } from './index.ts';

// The codec's TS-side/DB-side types are asserted in `custom-types.type-test.ts`.
// (This file used to build its fixture inside a try/catch that fell back to a
// hand-cast `CustomType` "during red phase, when defineType throws" — a
// placeholder that outlived the red phase and would have silently swallowed a
// real `defineType` failure.)
describe('custom types & codecs (#133)', () => {
  it('defineType returns a frozen descriptor', () => {
    const t = defineType<number, string>({ sqlType: 'text', toDb: String, fromDb: Number });
    expect(t.sqlType).toBe('text');
    expect(Object.isFrozen(t)).toBe(true);
  });

  it('encode/decode round-trip', () => {
    const t = defineType<Record<string, unknown>, string>({
      sqlType: 'jsonb',
      toDb: v => JSON.stringify(v),
      fromDb: r => JSON.parse(r),
    });
    const v = { a: 1, b: [2, 3] };
    expect(decodeValue(t, encodeValue(t, v))).toEqual(v);
  });
});
