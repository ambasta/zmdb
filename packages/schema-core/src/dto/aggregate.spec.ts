import { describe, it, expect } from 'vitest';

import { defineSchema, serial, integer, numeric, text } from '../index.ts';
import { describeAggregate, type AggregateSpec } from './index.ts';

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
});
