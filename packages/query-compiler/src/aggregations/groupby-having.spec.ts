import { describe, it, expect } from 'vitest';

import { aggregateSelectFrom } from './index.ts';

// #91: groupBy + having (dedicated coverage).

describe('groupBy', () => {
  it('groups by multiple columns', () => {
    const q = aggregateSelectFrom('orders')
      .select(['customer_id', 'ship_country'])
      .count('id', 'n')
      .groupBy('customer_id', 'ship_country')
      .compile();
    expect(q.text).toBe(
      'SELECT "customer_id", "ship_country", COUNT("id") AS "n" FROM "orders" GROUP BY "customer_id", "ship_country"',
    );
  });
});

describe('joins and wheres with groupBy and having', () => {
  it('places JOIN and WHERE clauses before GROUP BY and HAVING in compiled SQL', () => {
    const q = aggregateSelectFrom('orders')
      .innerJoin('categories', 'orders.category_id', 'categories.id')
      .select(['categories.name'])
      .count('orders.id', 'n')
      .sum('orders.amount', 'total')
      .where('orders.status', '=', 'completed')
      .groupBy('categories.name')
      .having('orders.id', '>', 5)
      .orderBy('total', 'desc')
      .compile();

    expect(q.text).toBe(
      'SELECT "categories"."name" AS "categories.name", COUNT("orders"."id") AS "n", SUM("orders"."amount") AS "total" FROM "orders" INNER JOIN "categories" ON "orders"."category_id" = "categories"."id" WHERE "orders"."status" = $1 GROUP BY "categories"."name" HAVING "orders"."id" > $2 ORDER BY "total" DESC',
    );
    expect(q.parameters).toEqual(['completed', 5]);
  });
});

describe('having', () => {
  it('multiple HAVING predicates are AND-joined and parameterized', () => {
    const q = aggregateSelectFrom('order_details')
      .sum('quantity', 'qty')
      .groupBy('order_id')
      .having('order_id', '>', 100)
      .having('order_id', '<', 200)
      .compile();
    expect(q.text).toBe(
      'SELECT SUM("quantity") AS "qty" FROM "order_details" GROUP BY "order_id" HAVING "order_id" > $1 AND "order_id" < $2',
    );
    expect(q.parameters).toEqual([100, 200]);
  });

  it('groupBy + having + orderBy + pagination compose in the right order', () => {
    const q = aggregateSelectFrom('orders')
      .select(['customer_id'])
      .count('id', 'n')
      .groupBy('customer_id')
      .having('customer_id', '>', 0)
      .orderBy('customer_id', 'desc')
      .limit(10)
      .offset(5)
      .compile();
    expect(q.text).toBe(
      'SELECT "customer_id", COUNT("id") AS "n" FROM "orders" GROUP BY "customer_id" HAVING "customer_id" > $1 ORDER BY "customer_id" DESC LIMIT 10 OFFSET 5',
    );
    expect(q.parameters).toEqual([0]);
  });
});
