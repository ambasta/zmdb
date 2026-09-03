import { describe, it, expect } from 'vitest';

import type { ColumnMeta, CoreSchema } from '../index.js';
import { defineType, encodeValue, decodeValue, wireCodec } from './index.js';

// The codec's TS-side/DB-side types are asserted in `custom-types.type-test.ts`.
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

  it('attaches customType metadata to schema columns', () => {
    interface Money {
      amount: number;
      currency: string;
    }
    const MoneyType = defineType<string, Money, string>({
      sqlType: 'varchar(50)',
      toDb: m => `${m.amount}:${m.currency}`,
      fromDb: s => {
        const [amount, currency] = s.split(':');
        return { amount: Number(amount), currency: currency ?? 'USD' };
      },
      toWire: m => `${m.amount}:${m.currency}`,
      fromWire: s => {
        const [amount, currency] = s.split(':');
        return { amount: Number(amount), currency: currency ?? 'USD' };
      },
      validate: m => {
        if (typeof m !== 'object' || m === null) return 'must be object';
        const money = m as Money;
        return money.amount > 0 || 'amount must be positive';
      },
    });

    const priceCol: ColumnMeta = {
      type: 'text',
      flags: { nullable: false },
      customType: MoneyType,
    };
    expect(priceCol.customType?.sqlType).toBe('varchar(50)');
    expect(priceCol.customType?.toDb).toBe(MoneyType.toDb);

    const schema: CoreSchema = {
      table: 'orders',
      columns: {
        id: { type: 'text', flags: { nullable: false, primaryKey: true } },
        price: priceCol,
      },
      primaryKey: ['id'],
      references: [],
      ir: { table: 'orders', columns: [], primaryKey: ['id'], relations: [] },
    };
    expect(schema.columns['price']?.customType?.sqlType).toBe('varchar(50)');
    expect(schema.columns['price']?.customType?.toDb).toBe(MoneyType.toDb);
  });
});
