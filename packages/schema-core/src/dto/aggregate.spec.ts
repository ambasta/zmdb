import { describe, it, expect } from 'vitest';

import { type OrderS as S } from './fixtures.ts';
import { describeAggregate, type AggregateSpec } from './index.ts';

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
