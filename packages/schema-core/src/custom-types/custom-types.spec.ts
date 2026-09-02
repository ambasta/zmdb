import { describe, it, expect } from 'vitest';

import { defineType, encodeValue, decodeValue, wireCodec } from './index.ts';

// The codec's TS-side/DB-side types are asserted in `custom-types.type-test.ts`.
// (This file used to build its fixture inside a try/catch that fell back to a
// hand-cast `CustomType` "during red phase, when defineType throws" — a
// placeholder that outlived the red phase and would have silently swallowed a
// real `defineType` failure.)
describe('custom types & codecs (#133)', () => {
  it('defineType returns a frozen descriptor', () => {
    const t = defineType<string, number, string>({
      sqlType: 'text',
      toDb: String,
      fromDb: Number,
      toWire: String,
      fromWire: Number,
    });
    expect(t.sqlType).toBe('text');
    expect(Object.isFrozen(t)).toBe(true);
  });

  it('encode/decode round-trip', () => {
    const t = defineType<Record<string, unknown>, Record<string, unknown>, string>({
      sqlType: 'jsonb',
      toDb: v => JSON.stringify(v),
      fromDb: r => JSON.parse(r),
      toWire: v => v,
      fromWire: r => r,
    });
    const v = { a: 1, b: [2, 3] };
    expect(decodeValue(t, encodeValue(t, v))).toEqual(v);
  });

  it('wireCodec adapts a custom type to the IR registry, both directions', () => {
    // A money column: cents in the database, a `{ cents }` object in the app, and a
    // decimal string on the wire, because a float is the one thing money must not be.
    const money = defineType<string, { cents: number }, number>({
      sqlType: 'integer',
      toDb: v => v.cents,
      fromDb: raw => ({ cents: raw }),
      toWire: v => (v.cents / 100).toFixed(2),
      fromWire: raw => ({ cents: Math.round(Number(raw) * 100) }),
    });

    const codec = wireCodec(money);
    expect(codec.decode('19.99')).toEqual({ cents: 1999 });
    expect(codec.encode({ cents: 1999 })).toBe('19.99');
    expect(codec.encode(codec.decode('0.05'))).toBe('0.05');
  });
});
