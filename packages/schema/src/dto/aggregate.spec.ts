// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describeAggregate, type AggregateSpec } from '@zmdb/schema/dto';
import { describe, it, expect } from 'vitest';

import { type Order } from './fixtures.js';

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
