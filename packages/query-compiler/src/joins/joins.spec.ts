import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { joinableSelectFrom } from './index.js';

// RED PHASE (#84 spec freeze): join grammar + golden SQL.

describe('JOIN compilation (postgres golden)', () => {
  it('left join with qualified on-columns', () => {
    const q = joinableSelectFrom('products', postgresDialect)
      .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
      .where('products.id', '=', 7)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" LEFT JOIN "suppliers" ON "suppliers"."id" = "products"."supplier_id" WHERE "products"."id" = $1',
    );
    expect(q.parameters).toEqual([7]);
  });

  it('self-join with aliases', () => {
    const q = joinableSelectFrom('employees as e', postgresDialect)
      .leftJoin('employees as r', 'r.id', 'e.recipient_id')
      .where('e.id', '=', 5)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "employees" AS "e" LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id" WHERE "e"."id" = $1',
    );
    expect(q.parameters).toEqual([5]);
  });

  it('inner join basic', () => {
    const q = joinableSelectFrom('a', postgresDialect).innerJoin('b', 'b.a_id', 'a.id').compile();
    expect(q.text).toBe('SELECT * FROM "a" INNER JOIN "b" ON "b"."a_id" = "a"."id"');
  });

  it('joins a relation on every column of a composite parent key', () => {
    const q = joinableSelectFrom('memberships as m', postgresDialect)
      .innerJoin('users as u', [
        { leftCol: 'm.tenant_id', rightCol: 'u.tenant_id' },
        { leftCol: 'm.user_id', rightCol: 'u.id' },
      ])
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "memberships" AS "m" INNER JOIN "users" AS "u" ' +
        'ON "m"."tenant_id" = "u"."tenant_id" AND "m"."user_id" = "u"."id"',
    );
  });

  it('right-joins the target table, keeping rows with no match on the left', () => {
    const q = joinableSelectFrom('products', postgresDialect)
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

describe('JOIN compile-time telemetry', () => {
  it('keeps telemetry absent from the default compiled query', () => {
    const q = joinableSelectFrom('products', postgresDialect)
      .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
      .compile();
    expect(Object.keys(q)).toEqual(['text', 'parameters', 'operation', 'isWrite', 'returnsRows']);
    expect(q.telemetry).toBeUndefined();
  });

  it('attaches the compile-known SELECT and primary table when opted in', () => {
    const q = joinableSelectFrom('products', postgresDialect, { telemetry: true })
      .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
      .compile();
    expect(q.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'products',
    });
  });
});
