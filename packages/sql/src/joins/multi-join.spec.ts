import { trustedTable, createQueryCompiler } from '@zmdb/sql';
import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';

// #86: self-join + multi-join + aliasing.

describe('multi-join (2+ chained joins)', () => {
  it('chains two joins in order with correct ON clauses', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('order_details'))
      .innerJoin(trustedTable('orders'), 'orders', [{ leftCol: 'orders.id', rightCol: 'order_details.order_id' }])
      .innerJoin(trustedTable('customers'), 'customers', [{ leftCol: 'customers.id', rightCol: 'orders.customer_id' }])
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
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('products as p'))
      .leftJoin(trustedTable('suppliers'), 's', [{ leftCol: 's.id', rightCol: 'p.supplier_id' }])
      .innerJoin(trustedTable('categories'), 'c', [{ leftCol: 'c.id', rightCol: 'p.category_id' }])
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" AS "p"' +
        ' LEFT JOIN "suppliers" AS "s" ON "s"."id" = "p"."supplier_id"' +
        ' INNER JOIN "categories" AS "c" ON "c"."id" = "p"."category_id"',
    );
  });

  it('self-join with alias still compiles (regression from #85)', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('employees as e'))
      .leftJoin(trustedTable('employees'), 'r', [{ leftCol: 'r.id', rightCol: 'e.recipient_id' }])
      .where('e.id', '=', 5)
      .compile();
    expect(q.text).toContain('LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"');
  });
});
