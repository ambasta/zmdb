import { describe, it, expect } from 'vitest';

import { type Order } from './fixtures.js';
import { describeAggregate, type AggregateSpec } from './index.js';

describe('AggregateResult<Order,Spec> (#198)', () => {
  it('describeAggregate lists group-key cols then computed keys', () => {
    const spec: AggregateSpec<Order> = {
      groupBy: ['customerId'],
      computed: { orderCount: { fn: 'count' }, revenue: { fn: 'sum', column: 'total' } },
    };
    expect(describeAggregate(spec)).toEqual(['customerId', 'orderCount', 'revenue']);
  });

  it('describeAggregate with no groupBy ⇒ only computed', () => {
    expect(describeAggregate<Order>({ computed: { n: { fn: 'count' } } })).toEqual(['n']);
  });
});
