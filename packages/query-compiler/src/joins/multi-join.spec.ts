import { describe, it, expect } from 'vitest';

import { joinableSelectFrom } from './index.js';

// #86: self-join + multi-join + aliasing.

describe('multi-join (2+ chained joins)', () => {
  it('chains two joins in order with correct ON clauses', () => {
    const q = joinableSelectFrom('order_details')
      .innerJoin('orders', 'orders.id', 'order_details.order_id')
      .innerJoin('customers', 'customers.id', 'orders.customer_id')
      .where('customers.id', '=', 7)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "order_details"' +
        ' INNER JOIN "orders" ON "orders"."id" = "order_details"."order_id"' +
        ' INNER JOIN "customers" ON "customers"."id" = "orders"."customer_id"' +
        ' WHERE "customers"."id" = $1',
    );
    expect(q.parameters).toEqual([7]);
  });

  it('mixes left + inner joins with aliases', () => {
    const q = joinableSelectFrom('products as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .innerJoin('categories as c', 'c.id', 'p.category_id')
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" AS "p"' +
        ' LEFT JOIN "suppliers" AS "s" ON "s"."id" = "p"."supplier_id"' +
        ' INNER JOIN "categories" AS "c" ON "c"."id" = "p"."category_id"',
    );
  });

  it('self-join with alias still compiles (regression from #85)', () => {
    const q = joinableSelectFrom('employees as e')
      .leftJoin('employees as r', 'r.id', 'e.recipient_id')
      .where('e.id', '=', 5)
      .compile();
    expect(q.text).toContain('LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"');
  });
});
