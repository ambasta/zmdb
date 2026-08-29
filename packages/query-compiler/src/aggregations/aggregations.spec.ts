import { describe, it, expect } from 'vitest';
import { aggregateSelectFrom } from './index.ts';

// RED PHASE (#89 spec freeze): aggregate / GROUP BY / HAVING golden SQL.

describe('aggregate compilation (postgres golden)', () => {
  it('COUNT + GROUP BY + ORDER BY + pagination', () => {
    const q = aggregateSelectFrom('orders')
      .select(['orders.id'])
      .count('order_details.product_id', 'products_count')
      .groupBy('orders.id')
      .orderBy('orders.id', 'asc')
      .limit(50)
      .offset(0)
      .compile();
    expect(q.text).toBe(
      'SELECT "orders"."id", COUNT("order_details"."product_id") AS "products_count" FROM "orders" GROUP BY "orders"."id" ORDER BY "orders"."id" ASC LIMIT 50 OFFSET 0',
    );
  });

  it('SUM + HAVING (parameterized)', () => {
    const q = aggregateSelectFrom('order_details')
      .sum('quantity', 'qty')
      .having('quantity', '>', 0)
      .groupBy('order_id')
      .compile();
    expect(q.text).toBe(
      'SELECT SUM("quantity") AS "qty" FROM "order_details" GROUP BY "order_id" HAVING "quantity" > $1',
    );
    expect(q.parameters).toEqual([0]);
  });

  it('expr() emits a raw computed expression with alias', () => {
    const q = aggregateSelectFrom('order_details')
      .expr('sum(quantity * unit_price)::real', 'total')
      .groupBy('order_id')
      .compile();
    expect(q.text).toContain('sum(quantity * unit_price)::real AS "total"');
  });
});
