import { trustedTable, createQueryCompiler } from '@zmdb/sql';
import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { QueryPostSchema, QueryUserSchema } from '../testing/query-schema.fixture.js';

// RED PHASE (#84 spec freeze): join grammar + golden SQL.

describe('JOIN compilation (postgres golden)', () => {
  it('left join with qualified on-columns', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('products'))
      .leftJoin(trustedTable('suppliers'), 'suppliers', [{ leftCol: 'suppliers.id', rightCol: 'products.supplier_id' }])
      .where('products.id', '=', 7)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "products" LEFT JOIN "suppliers" ON "suppliers"."id" = "products"."supplier_id" WHERE "products"."id" = $1',
    );
    expect(q.parameters).toEqual([7]);
  });

  it('self-join with aliases', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('employees as e'))
      .leftJoin(trustedTable('employees'), 'r', [{ leftCol: 'r.id', rightCol: 'e.recipient_id' }])
      .where('e.id', '=', 5)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "employees" AS "e" LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id" WHERE "e"."id" = $1',
    );
    expect(q.parameters).toEqual([5]);
  });

  it('inner join basic', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('a'))
      .innerJoin(trustedTable('b'), 'b', [{ leftCol: 'b.a_id', rightCol: 'a.id' }])
      .compile();
    expect(q.text).toBe('SELECT * FROM "a" INNER JOIN "b" ON "b"."a_id" = "a"."id"');
  });

  it('joins a relation on every column of a composite parent key', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('memberships as m'))
      .innerJoin(trustedTable('users'), 'u', [
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
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('products'))
      .rightJoin(trustedTable('suppliers'), 'suppliers', [
        { leftCol: 'suppliers.id', rightCol: 'products.supplier_id' },
      ])
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
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('products'))
      .leftJoin(trustedTable('suppliers'), 'suppliers', [{ leftCol: 'suppliers.id', rightCol: 'products.supplier_id' }])
      .compile();
    expect(Object.keys(q)).toEqual(['text', 'parameters', 'effects', 'operation', 'isWrite', 'returnsRows']);
    expect(q.telemetry).toBeUndefined();
  });

  it('attaches the compile-known SELECT and primary table when opted in', () => {
    const q = createQueryCompiler(postgresDialect, { telemetry: true })
      .selectFrom(trustedTable('products'))
      .leftJoin(trustedTable('suppliers'), 'suppliers', [{ leftCol: 'suppliers.id', rightCol: 'products.supplier_id' }])
      .compile();
    expect(q.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'products',
    });
  });
});

it('composes a schema-bound join with typed projection, physical columns and ordering', () => {
  const query = createQueryCompiler(postgresDialect)
    .selectFrom(QueryUserSchema, 'u')
    .leftJoin(QueryPostSchema, 'p', [{ leftCol: 'u.id', rightCol: 'p.userId' }])
    .select(['u.id', { column: 'p.title', alias: 'postTitle' }])
    .where('u.age', '>', 18)
    .orderBy('p.title', 'asc');
  expect(query.compile()).toMatchObject({
    text: 'SELECT "u"."user_id" AS "u.id", "p"."post_title" AS "postTitle" FROM "user_accounts" AS "u" LEFT JOIN "blog_posts" AS "p" ON "u"."user_id" = "p"."author_id" WHERE "u"."age_years" > $1 ORDER BY "p"."post_title" ASC',
    parameters: [18],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
});

it('retains root ownership for unqualified columns before and after a join', () => {
  const users = createQueryCompiler(postgresDialect).selectFrom(QueryUserSchema, 'u');
  const beforeJoin = users.select(['id']).where('id', '=', 1).orderBy('id', 'asc');
  const joined = beforeJoin.leftJoin(QueryPostSchema, 'p', [{ leftCol: 'id', rightCol: 'p.userId' }]);
  expect(joined.compile()).toMatchObject({
    text: 'SELECT "u"."user_id" AS "id" FROM "user_accounts" AS "u" LEFT JOIN "blog_posts" AS "p" ON "u"."user_id" = "p"."author_id" WHERE "u"."user_id" = $1 ORDER BY "u"."user_id" ASC',
    parameters: [1],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
  expect(
    users
      .leftJoin(QueryPostSchema, 'p', [{ leftCol: 'id', rightCol: 'p.userId' }])
      .select(['id'])
      .where('id', '=', 1)
      .orderBy('id', 'asc')
      .compile(),
  ).toEqual(joined.compile());
  expect(beforeJoin.compile()).toMatchObject({
    text: 'SELECT "user_id" AS "id" FROM "user_accounts" AS "u" WHERE "user_id" = $1 ORDER BY "user_id" ASC',
    parameters: [1],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
});
