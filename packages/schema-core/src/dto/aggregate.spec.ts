import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, serial, integer, numeric, text } from '../index.ts';
import { describeAggregate, type AggregateResult, type AggregateSpec } from './index.ts';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  customerId: integer().notNull(),
  total: numeric().notNull(),
  status: text().notNull(),
});
type S = typeof OrderSchema;

describe('AggregateResult<S,Spec> (#198)', () => {
  it('describeAggregate lists group-key cols then computed keys', () => {
    const spec: AggregateSpec<S> = {
      groupBy: ['customerId'],
      computed: { orderCount: { fn: 'count' }, revenue: { fn: 'sum', column: 'total' } },
    };
    expect(describeAggregate(spec)).toEqual(['customerId', 'orderCount', 'revenue']);
  });

  it('describeAggregate with no groupBy ⇒ only computed', () => {
    expect(describeAggregate<S>({ computed: { n: { fn: 'count' } } })).toEqual(['n']);
  });

  it('type-level: count⇒number, sum⇒number|null, min⇒col type|null, plus group key', () => {
    type Spec = {
      groupBy: readonly ['customerId'];
      computed: {
        orderCount: { fn: 'count' };
        revenue: { fn: 'sum'; column: 'total' };
        firstStatus: { fn: 'min'; column: 'status' };
      };
    };
    type R = AggregateResult<S, Spec>;
    expectTypeOf<R['customerId']>().toEqualTypeOf<number>();
    expectTypeOf<R['orderCount']>().toEqualTypeOf<number>();
    expectTypeOf<R['revenue']>().toEqualTypeOf<number | null>();
    expectTypeOf<R['firstStatus']>().toEqualTypeOf<string | null>();
  });
});
