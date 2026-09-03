import { describe, it, expect } from 'vitest';

import { joinableSelectFrom } from './index.ts';

// RED PHASE (#84 spec freeze): join grammar + golden SQL.

describe('JOIN compilation (postgres golden)', () => {
  it('left join with qualified on-columns', () => {
    const q = joinableSelectFrom('products')
      .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
      .where('products.id', '=', 7)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" LEFT JOIN "suppliers" ON "suppliers"."id" = "products"."supplier_id" WHERE "products"."id" = $1',
    );
    expect(q.parameters).toEqual([7]);
  });

  it('self-join with aliases', () => {
    const q = joinableSelectFrom('employees as e')
      .leftJoin('employees as r', 'r.id', 'e.recipient_id')
      .where('e.id', '=', 5)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "employees" AS "e" LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id" WHERE "e"."id" = $1',
    );
    expect(q.parameters).toEqual([5]);
  });

  it('inner join basic', () => {
    const q = joinableSelectFrom('a').innerJoin('b', 'b.a_id', 'a.id').compile();
    expect(q.text).toBe('SELECT * FROM "a" INNER JOIN "b" ON "b"."a_id" = "a"."id"');
  });

  it('right-joins the target table, keeping rows with no match on the left', () => {
    const q = joinableSelectFrom('products')
      .rightJoin('suppliers', 'suppliers.id', 'products.supplier_id')
      .orderBy('suppliers.id', 'asc')
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" RIGHT JOIN "suppliers" ON "suppliers"."id" = "products"."supplier_id" ' +
        'ORDER BY "suppliers"."id" ASC',
    );
    expect(q.parameters).toEqual([]);
  });
});
