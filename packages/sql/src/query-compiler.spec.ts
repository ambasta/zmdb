// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Entity } from '@zmdb/schema';
import {
  OP_MAP,
  QueryCompilerError,
  chunkArray,
  concat,
  createQueryCompiler,
  distance,
  inc,
  not,
  sanitizeKeys,
  stContains,
  stDWithin,
  trustedTable,
  unsafeOperator,
  type Operator,
} from '@zmdb/sql';
import { describe, it, expect, expectTypeOf } from 'vitest';

import { mysqlDialect, officialDialects, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';
import { QueryPostSchema, QueryUserSchema, type QueryPost, type QueryUser } from './testing/query-schema.fixture.js';

// RED PHASE (#16 spec freeze): golden SQL fixtures from SPEC.md.

describe('postgres SELECT compilation', () => {
  it('aliases a physical column back to its property name in the select list', () => {
    const query = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('user_accounts'))
      .select([{ column: 'created_at', alias: 'createdAt' }, 'id'])
      .compile();

    expect(query).toMatchObject({
      text: 'SELECT "created_at" AS "createdAt", "id" FROM "user_accounts"',
      parameters: [],
    });
  });

  it('compiles where + orderBy + limit', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q = qb
      .selectFrom(trustedTable('users'))
      .where('email', '=', 'a@b.com')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('compiles andWhere with sequential placeholders', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('role', '=', 'admin')
      .andWhere('active', '=', true)
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2');
    expect(q.parameters).toEqual(['admin', true]);
  });

  it('compiles whereIn, andWhereIn, and orWhereIn', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('orders'))
      .whereIn('status', ['pending', 'shipped'])
      .orWhereIn('userId', [1, 2])
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "status" IN ($1, $2) OR "userId" IN ($3, $4)');
    expect(q.parameters).toEqual(['pending', 'shipped', 1, 2]);
  });

  it('compiles whereNotIn, andWhereNotIn, and orWhereNotIn', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('active', '=', true)
      .andWhereNotIn('role', ['banned', 'guest'])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "active" = $1 AND "role" NOT IN ($2, $3)');
    expect(q.parameters).toEqual([true, 'banned', 'guest']);
  });

  it('compiles whereNotIn filtering null and undefined values to prevent three-valued logic traps', () => {
    const q1 = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .whereNotIn('role', ['banned', null, undefined, 'guest'])
      .compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q1.parameters).toEqual(['banned', 'guest']);

    const q2 = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .whereNotIn('role', [null, undefined])
      .compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(q2.parameters).toEqual([]);
  });

  it('compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1', () => {
    const qIn = createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).whereIn('id', []).compile();
    expect(qIn.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(qIn.parameters).toEqual([]);

    const qNotIn = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .whereNotIn('id', [])
      .compile();
    expect(qNotIn.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(qNotIn.parameters).toEqual([]);
  });

  it('compile() is pure (twice → equal)', () => {
    const b = createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).where('id', '=', 1);
    expect(b.compile()).toEqual(b.compile());
  });
});

describe('aliased write results', () => {
  const returned = [{ column: 'created_at', alias: 'createdAt' }] as const;

  it('aliases RETURNING columns for the Postgres family and SQLite', () => {
    expect(
      createQueryCompiler(postgresDialect)
        .insertInto(trustedTable('users'))
        .values({ created_at: 1 })
        .returning(returned)
        .compile(),
    ).toMatchObject({
      text: 'INSERT INTO "users" ("created_at") VALUES ($1) RETURNING "created_at" AS "createdAt"',
      parameters: [1],
    });
    expect(
      createQueryCompiler(sqliteDialect)
        .updateTable(trustedTable('users'))
        .set({ created_at: 2 })
        .where('id', '=', 1)
        .returning(returned)
        .compile(),
    ).toMatchObject({
      text: 'UPDATE "users" SET "created_at" = ? WHERE "id" = ? RETURNING "created_at" AS "createdAt"',
      parameters: [2, 1],
    });
  });
});

describe('zero-operand null predicates', () => {
  // Actual at 9e6b9757:
  //   SELECT * FROM "users" WHERE "deletedAt" is null $1 AND "tenantId" = $2
  //   parameters ["ignored", 7]
  // `is not null` has the same defect: it binds its ignored value and shifts the
  // following placeholder.
  it('compiles zero-operand null predicates without shifting later parameters', () => {
    const isNull = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('deletedAt', 'is null', 'ignored')
      .andWhere('tenantId', '=', 7)
      .compile();
    const isNotNull = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('deletedAt', 'is not null', 123)
      .andWhere('active', '=', true)
      .compile();

    expect(isNull.text).toBe('SELECT * FROM "users" WHERE "deletedAt" IS NULL AND "tenantId" = $1');
    expect(isNull.parameters).toEqual([7]);
    expect(isNotNull.text).toBe('SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL AND "active" = $1');
    expect(isNotNull.parameters).toEqual([true]);
  });
});

describe('optional compile-time telemetry', () => {
  it('keeps telemetry absent from default CRUD queries', () => {
    const compiler = createQueryCompiler(postgresDialect);
    const queries = [
      compiler.selectFrom(trustedTable('users')).compile(),
      compiler.insertInto(trustedTable('users')).values({ email: 'a@b.com' }).compile(),
      compiler.updateTable(trustedTable('users')).set({ email: 'b@c.com' }).compile(),
      compiler.deleteFrom(trustedTable('users')).compile(),
    ];

    for (const query of queries) {
      expect(query.telemetry).toBeUndefined();
    }
  });

  it('attaches the dialect, operation and collection only when enabled', () => {
    const postgres = createQueryCompiler(postgresDialect, { telemetry: true });
    const mysql = createQueryCompiler(mysqlDialect, { telemetry: true });
    const sqlite = createQueryCompiler(sqliteDialect, { telemetry: true });

    expect(postgres.selectFrom(trustedTable('users')).compile().telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });
    expect(postgres.insertInto(trustedTable('orders')).values({ sku: 'A' }).compile().telemetry).toEqual({
      system: 'postgresql',
      operation: 'INSERT',
      collection: 'orders',
    });
    expect(mysql.updateTable(trustedTable('accounts')).set({ active: true }).compile().telemetry).toEqual({
      system: 'mysql',
      operation: 'UPDATE',
      collection: 'accounts',
    });
    expect(sqlite.deleteFrom(trustedTable('sessions')).compile().telemetry).toEqual({
      system: 'sqlite',
      operation: 'DELETE',
      collection: 'sessions',
    });
    expect(postgres.selectFrom(trustedTable('analytics.users as u')).compile().telemetry?.collection).toBe(
      'analytics.users',
    );
  });
});

describe('utility functions', () => {
  it('sanitizeKeys removes null/undefined and deduplicates while preserving order', () => {
    const raw = [1, 2, null, 2, undefined, 3, 1, null, 4];
    expect(sanitizeKeys(raw)).toEqual([1, 2, 3, 4]);
  });

  it('chunkArray splits an array into parameter-safe chunks', () => {
    const items = [1, 2, 3, 4, 5];
    expect(chunkArray(items, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('OP_MAP is a clean, readonly map protected against prototype lookup', () => {
    expect(OP_MAP.constructor).toBeUndefined();
    expect(Object.isFrozen(OP_MAP)).toBe(true);
    expect(OP_MAP['in']).toBe('IN');
    expect(OP_MAP['IN']).toBeUndefined();
  });
});

describe('postgres write compilation', () => {
  it('INSERT ... RETURNING', () => {
    const q = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ email: 'a@b.com', role: 'user' })
      .returning(['id'])
      .compile();
    expect(q.text).toBe('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"');
    expect(q.parameters).toEqual(['a@b.com', 'user']);
  });

  it('UPDATE ... SET ... WHERE', () => {
    const q = createQueryCompiler(postgresDialect)
      .updateTable(trustedTable('users'))
      .set({ role: 'admin' })
      .where('id', '=', 1)
      .compile();
    expect(q.text).toBe('UPDATE "users" SET "role" = $1 WHERE "id" = $2');
    expect(q.parameters).toEqual(['admin', 1]);
  });

  it('DELETE ... WHERE', () => {
    const q = createQueryCompiler(postgresDialect).deleteFrom(trustedTable('users')).where('id', '=', 1).compile();
    expect(q.text).toBe('DELETE FROM "users" WHERE "id" = $1');
    expect(q.parameters).toEqual([1]);
  });
});

describe('dialect placeholder + quoting', () => {
  it('mysql uses ? and backticks', () => {
    const q = createQueryCompiler(mysqlDialect)
      .selectFrom(trustedTable('users'))
      .where('email', '=', 'a@b.com')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('sqlite uses ? and double quotes', () => {
    const q = createQueryCompiler(sqliteDialect).selectFrom(trustedTable('users')).where('id', '=', 1).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" = ?');
    expect(q.parameters).toEqual([1]);
  });
});

describe('subquery & EXISTS compilation', () => {
  it('compiles scalar comparison and IN subqueries with sequential parameter offsets', () => {
    const qb = createQueryCompiler(postgresDialect);
    const sub = qb.selectFrom(trustedTable('orders')).select(['user_id']).where('amount', '>', 100);
    const q = qb.selectFrom(trustedTable('users')).where('status', '=', 'active').andWhere('id', 'in', sub).compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "status" = $1 AND "id" IN (SELECT "user_id" FROM "orders" WHERE "amount" > $2)',
    );
    expect(q.parameters).toEqual(['active', 100]);
  });

  it('compiles whereExists and orWhereExists clauses', () => {
    const qb = createQueryCompiler(postgresDialect);
    const sub1 = qb.selectFrom(trustedTable('orders')).where('status', '=', 'shipped');
    const sub2 = qb.selectFrom(trustedTable('logs')).where('level', '=', 'error');
    const q = qb
      .selectFrom(trustedTable('users'))
      .where('role', '=', 'admin')
      .whereExists(sub1)
      .orWhereExists(sub2)
      .compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "role" = $1 AND EXISTS (SELECT * FROM "orders" WHERE "status" = $2) OR EXISTS (SELECT * FROM "logs" WHERE "level" = $3)',
    );
    expect(q.parameters).toEqual(['admin', 'shipped', 'error']);
  });

  it('compiles multi-level nested subqueries with continuous parameter renumbering', () => {
    const qb = createQueryCompiler(postgresDialect);
    const inner = qb.selectFrom(trustedTable('payments')).select(['order_id']).where('status', '=', 'failed');
    const middle = qb
      .selectFrom(trustedTable('orders'))
      .select(['user_id'])
      .where('total', '>', 50)
      .andWhere('id', 'in', inner);
    const outer = qb
      .selectFrom(trustedTable('users'))
      .where('tenant_id', '=', 10)
      .andWhere('id', 'in', middle)
      .compile();

    expect(outer.text).toBe(
      'SELECT * FROM "users" WHERE "tenant_id" = $1 AND "id" IN (SELECT "user_id" FROM "orders" WHERE "total" > $2 AND "id" IN (SELECT "order_id" FROM "payments" WHERE "status" = $3))',
    );
    expect(outer.parameters).toEqual([10, 50, 'failed']);
  });

  it('throws QueryCompilerError when merging a subquery created for a different dialect', () => {
    const qbPg = createQueryCompiler(postgresDialect);
    const qbSqlite = createQueryCompiler(sqliteDialect);
    const subSqlite = qbSqlite.selectFrom('orders').select(['user_id']).where('amount', '>', 100);

    expect(() => {
      qbPg.selectFrom('users').where('id', 'in', subSqlite).compile();
    }).toThrow(QueryCompilerError);

    expect(() => {
      qbPg.selectFrom('users').where('id', 'in', subSqlite).compile();
    }).toThrow('Subquery dialect "sqlite" does not match parent query dialect "postgres"');
  });

  it('renumbers positional parameter placeholders consistently across join and aggregation clauses', () => {
    const qb = createQueryCompiler('postgres');
    const sub1 = qb.selectFrom(trustedTable('audit_logs')).select(['user_id']).where('action', '=', 'login');

    const joinSub = qb
      .selectFrom(trustedTable('users'))
      .innerJoin(trustedTable('roles'), 'roles', [{ leftCol: 'roles.id', rightCol: 'users.role_id' }])
      .where('role_name', '=', 'admin')
      .where('id', 'in', sub1);

    const qJoin = joinSub.compile();
    expect(qJoin.text).toBe(
      'SELECT * FROM "users" INNER JOIN "roles" ON "roles"."id" = "users"."role_id" WHERE "role_name" = $1 AND "id" IN (SELECT "user_id" FROM "audit_logs" WHERE "action" = $2)',
    );
    expect(qJoin.parameters).toEqual(['admin', 'login']);

    const sub2 = qb.selectFrom(trustedTable('payments')).select(['user_id']).where('amount', '>', 500);
    const aggSub = qb
      .selectFrom(trustedTable('users'))
      .select(['department'])
      .count('id', 'total_users')
      .where('status', '=', 'active')
      .groupBy('department')
      .having('id', 'in', sub2);

    const qAgg = aggSub.compile();
    expect(qAgg.text).toBe(
      'SELECT "department", COUNT("id") AS "total_users" FROM "users" WHERE "status" = $1 GROUP BY "department" HAVING "id" IN (SELECT "user_id" FROM "payments" WHERE "amount" > $2)',
    );
    expect(qAgg.parameters).toEqual(['active', 500]);
  });
});

describe('conflict resolution compilation (PostgreSQL, MySQL, SQLite)', () => {
  it('compiles PostgreSQL ON CONFLICT DO UPDATE (default non-target columns)', () => {
    const q = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .returning(['*'])
      .compile();
    expect(q.text).toBe(
      'INSERT INTO "users" ("id", "email", "role") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "role" = EXCLUDED."role" RETURNING *',
    );
    expect(q.parameters).toEqual([1, 'a@b.com', 'user']);
  });

  it('compiles PostgreSQL ON CONFLICT DO UPDATE with specific update columns', () => {
    const q = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate(['role'])
      .compile();
    expect(q.text).toBe(
      'INSERT INTO "users" ("id", "email", "role") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "role" = EXCLUDED."role"',
    );
    expect(q.parameters).toEqual([1, 'a@b.com', 'user']);
  });

  it('compiles PostgreSQL ON CONFLICT DO UPDATE with custom field values', () => {
    const q = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doUpdate({ role: 'admin' })
      .compile();
    expect(q.text).toBe(
      'INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "role" = $3',
    );
    expect(q.parameters).toEqual([1, 'a@b.com', 'admin']);
  });

  it('compiles PostgreSQL ON CONFLICT DO NOTHING with and without target', () => {
    const q1 = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doNothing()
      .compile();
    expect(q1.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING');

    const q2 = createQueryCompiler(postgresDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(q2.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT DO NOTHING');
  });

  it('compiles MySQL ON DUPLICATE KEY UPDATE and INSERT IGNORE', () => {
    const qUpdate = createQueryCompiler(mysqlDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .compile();
    expect(qUpdate.text).toBe(
      'INSERT INTO `users` (`id`, `email`, `role`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`), `role` = VALUES(`role`)',
    );
    expect(qUpdate.parameters).toEqual([1, 'a@b.com', 'user']);

    const qIgnore = createQueryCompiler(mysqlDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(qIgnore.text).toBe('INSERT IGNORE INTO `users` (`id`, `email`) VALUES (?, ?)');
    expect(qIgnore.parameters).toEqual([1, 'a@b.com']);
  });

  it('compiles SQLite ON CONFLICT DO UPDATE and DO NOTHING', () => {
    const qUpdate = createQueryCompiler(sqliteDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .returning(['*'])
      .compile();
    expect(qUpdate.text).toBe(
      'INSERT INTO "users" ("id", "email", "role") VALUES (?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "role" = EXCLUDED."role" RETURNING *',
    );
    expect(qUpdate.parameters).toEqual([1, 'a@b.com', 'user']);

    const qIgnore = createQueryCompiler(sqliteDialect)
      .insertInto(trustedTable('users'))
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doNothing()
      .compile();
    expect(qIgnore.text).toBe('INSERT INTO "users" ("id", "email") VALUES (?, ?) ON CONFLICT ("id") DO NOTHING');
    expect(qIgnore.parameters).toEqual([1, 'a@b.com']);
  });

  it('throws an error when doUpdate is called with an empty updateFields array', () => {
    expect(() => {
      createQueryCompiler(postgresDialect)
        .insertInto(trustedTable('users'))
        .values({ id: 1, email: 'a@b.com' })
        .onConflict('id')
        .doUpdate([]);
    }).toThrow('Empty updateFields array is not allowed in doUpdate()');
  });
});

describe('array parameter IN expansion', () => {
  it('expands array parameters into parameterized IN clauses for postgres with sequential placeholders', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('id', 'in', [10, 20, 30])
      .andWhere('status', '=', 'active')
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN ($1, $2, $3) AND "status" = $4');
    expect(q.parameters).toEqual([10, 20, 30, 'active']);
  });

  it('correctly renumbers placeholders when an IN list sits between other predicates in postgres', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('orders'))
      .where('tenantId', '=', 100)
      .whereIn('status', ['pending', 'shipped'])
      .andWhere('total', '>', 500)
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "tenantId" = $1 AND "status" IN ($2, $3) AND "total" > $4');
    expect(q.parameters).toEqual([100, 'pending', 'shipped', 500]);
  });

  it('correctly renumbers placeholders when multiple IN lists sit between standard predicates', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('orders'))
      .where('orgId', '=', 1)
      .whereIn('status', ['a', 'b'])
      .where('category', '=', 'elec')
      .whereNotIn('tag', ['x', 'y', 'z'])
      .where('active', '=', true)
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "orders" WHERE "orgId" = $1 AND "status" IN ($2, $3) AND "category" = $4 AND "tag" NOT IN ($5, $6, $7) AND "active" = $8',
    );
    expect(q.parameters).toEqual([1, 'a', 'b', 'elec', 'x', 'y', 'z', true]);
  });

  it('expands array parameters into parameterized IN clauses for mysql', () => {
    const q = createQueryCompiler(mysqlDialect).selectFrom(trustedTable('users')).whereIn('id', [10, 20]).compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `id` IN (?, ?)');
    expect(q.parameters).toEqual([10, 20]);
  });

  it('does not silently reinterpret = or != with array parameters as IN or NOT IN', () => {
    const q1 = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('id', '=', [10, 20])
      .compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "id" = $1');
    expect(q1.parameters).toEqual([[10, 20]]);

    const q2 = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('id', '!=', [10, 20])
      .compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE "id" != $1');
    expect(q2.parameters).toEqual([[10, 20]]);
  });

  it('expands array parameters into parameterized IN clauses for sqlite', () => {
    const q = createQueryCompiler(sqliteDialect)
      .selectFrom(trustedTable('users'))
      .where('id', 'in', [1, 2, 3])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN (?, ?, ?)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });

  it('handles NOT IN / nin array expansion', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('users'))
      .where('role', 'nin', ['admin', 'super'])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q.parameters).toEqual(['admin', 'super']);
  });

  it('handles empty array parameters cleanly (false / true)', () => {
    const q1 = createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).where('id', 'in', []).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(q1.parameters).toEqual([]);

    const q2 = createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).where('id', 'nin', []).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(q2.parameters).toEqual([]);
  });
});

describe('Operator validation and strict typing', () => {
  it('validates normalized canonical operators and produces expected SQL', () => {
    const qb = createQueryCompiler(postgresDialect);
    const ops: [Operator, string][] = [
      ['=', '='],
      ['!=', '!='],
      ['<', '<'],
      ['<=', '<='],
      ['>', '>'],
      ['>=', '>='],
      ['like', 'LIKE'],
      ['ilike', 'ILIKE'],
      ['in', 'IN'],
      ['not in', 'NOT IN'],
      ['nin', 'NOT IN'],
      ['is null', 'IS NULL'],
      ['is not null', 'IS NOT NULL'],
    ];

    for (const [op, expectedSqlOp] of ops) {
      if (expectedSqlOp === 'IN' || expectedSqlOp === 'NOT IN') {
        const q = qb
          .selectFrom(trustedTable('users'))
          .where('col', op, [1, 2])
          .compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} ($1, $2)`);
      } else if (expectedSqlOp === 'IS NULL' || expectedSqlOp === 'IS NOT NULL') {
        const q = qb.selectFrom(trustedTable('users')).where('col', op, null).compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp}`);
        expect(q.parameters).toEqual([]);
      } else {
        const q = qb
          .selectFrom(trustedTable('users'))
          .where('col', op, 'val')
          .compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} $1`);
      }
    }
  });

  it('renders IS NULL and IS NOT NULL without parameters regardless of value passed', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q1 = qb.selectFrom(trustedTable('users')).where('deleted_at', 'is null', true).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NULL');
    expect(q1.parameters).toEqual([]);

    const q2 = qb.selectFrom(trustedTable('users')).where('deleted_at', 'is not null', 'ignored').compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NOT NULL');
    expect(q2.parameters).toEqual([]);
  });

  it('allows raw or unmapped operators when explicitly wrapped in unsafeOperator', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q1 = qb.selectFrom(trustedTable('users')).where('tags', unsafeOperator('@>'), ['a', 'b']).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "tags" @> $1');
    expect(q1.parameters).toEqual([['a', 'b']]);

    const q2 = qb.selectFrom(trustedTable('events')).where('duration', unsafeOperator('&&'), '[2020-01-01,2020-01-02]').compile();
    expect(q2.text).toBe('SELECT * FROM "events" WHERE "duration" && $1');
    expect(q2.parameters).toEqual(['[2020-01-01,2020-01-02]']);
  });

  it('allows bounded dialect-specific operator tokens and keeps every value parameterized', () => {
    const cases = [
      {
        dialect: 'postgres',
        table: 'users',
        column: 'tags',
        operator: '@>',
        value: ['a', 'b'],
        text: 'SELECT * FROM "users" WHERE "tags" @> $1',
      },
      {
        dialect: 'postgres',
        table: 'docs',
        column: 'search',
        operator: '@@',
        value: 'typescript & database',
        text: 'SELECT * FROM "docs" WHERE "search" @@ $1',
      },
      {
        dialect: 'postgres',
        table: 'events',
        column: 'during',
        operator: '<@',
        value: '[2026-09-01,2026-10-01)',
        text: 'SELECT * FROM "events" WHERE "during" <@ $1',
      },
      {
        dialect: 'postgres',
        table: 'users',
        column: 'email',
        operator: '~*',
        value: '@example\\.com$',
        text: 'SELECT * FROM "users" WHERE "email" ~* $1',
      },
      {
        dialect: 'postgres',
        table: 'docs',
        column: 'payload',
        operator: '?|',
        value: ['status', 'kind'],
        text: 'SELECT * FROM "docs" WHERE "payload" ?| $1',
      },
      {
        dialect: 'postgres',
        table: 'docs',
        column: 'payload',
        operator: '#>>',
        value: ['customer', 'email'],
        text: 'SELECT * FROM "docs" WHERE "payload" #>> $1',
      },
      {
        dialect: 'postgres',
        table: 'events',
        column: 'duration',
        operator: '&&',
        value: '[2026-09-01,2026-10-01)',
        text: 'SELECT * FROM "events" WHERE "duration" && $1',
      },
      {
        dialect: 'cockroach',
        table: 'events',
        column: 'tags',
        operator: '@>',
        value: ['audit'],
        text: 'SELECT * FROM "events" WHERE "tags" @> $1',
      },
      {
        dialect: 'mysql',
        table: 'users',
        column: 'deletedAt',
        operator: '<=>',
        value: null,
        text: 'SELECT * FROM `users` WHERE `deletedAt` <=> ?',
      },
      {
        dialect: 'singlestore',
        table: 'users',
        column: 'deletedAt',
        operator: '<=>',
        value: null,
        text: 'SELECT * FROM `users` WHERE `deletedAt` <=> ?',
      },
      {
        dialect: 'sqlite',
        table: 'files',
        column: 'path',
        operator: 'GLOB',
        value: '*.json',
        text: 'SELECT * FROM "files" WHERE "path" GLOB ?',
      },
      {
        dialect: 'mssql',
        table: 'metrics',
        column: 'score',
        operator: '!<',
        value: 10,
        text: 'SELECT * FROM [metrics] WHERE [score] !< @p1',
      },
    ] as const;

    for (const testCase of cases) {
      const query = createQueryCompiler(officialDialects[testCase.dialect])
        .selectFrom(trustedTable(testCase.table))
        .where(testCase.column, testCase.operator, testCase.value)
        .compile();
      expect(query.text).toBe(testCase.text);
    }
  });

  it('refuses the measured request-derived operator injection before returning SQL', () => {
    const compile = () =>
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('users'))
        .where('role', "= 'x' OR 1=1 --", 1)
        .compile();

    expect(compile).toThrow(
      'invalid unmapped SQL operator "= \'x\' OR 1=1 --" for dialect "postgres"; expected one non-comment ' +
        'operator token that does not conflict with the dialect placeholder syntax',
    );
  });

  it('refuses token-breaking punctuation, whitespace and SQL comment shapes', () => {
    const invalid = ["'", ';', ' @>', '@> ', 'OR 1', '--', '@>--', '/*', '*/', '#'];

    for (const operator of invalid) {
      const compile = () =>
        createQueryCompiler(postgresDialect)
          .selectFrom(trustedTable('users'))
          .where('role', operator, 1)
          .compile();
      expect(compile, JSON.stringify(operator)).toThrow(/invalid unmapped SQL operator/);
    }
  });

  it('refuses comment and placeholder tokens on dialects where they change SQL parsing', () => {
    const collisions = [
      { dialect: 'mysql', operator: '#>>' },
      { dialect: 'mysql', operator: '?|' },
      { dialect: 'singlestore', operator: '?' },
      { dialect: 'sqlite', operator: '?&' },
      { dialect: 'mssql', operator: '@@' },
    ] as const;

    for (const { dialect, operator } of collisions) {
      const compile = () =>
        createQueryCompiler(officialDialects[dialect])
          .selectFrom(trustedTable('users'))
          .where('payload', operator, 1)
          .compile();
      expect(compile, `${dialect} ${operator}`).toThrow(/invalid unmapped SQL operator/);
    }
  });

  it('keeps OP_MAP prototype-free and refuses inherited prototype-key strings', () => {
    expect(OP_MAP.constructor).toBeUndefined();
    const prototypeKeys = ['constructor', 'toString', '__proto__'];

    for (const operator of prototypeKeys) {
      const input = Object.create({ operator });
      const inherited: unknown = Reflect.get(input, 'operator');
      if (typeof inherited !== 'string') throw new TypeError('test input carried no inherited operator string');
      const compile = () =>
        createQueryCompiler(postgresDialect)
          .selectFrom(trustedTable('users'))
          .where('col', inherited, 'val')
          .compile();
      expect(compile, operator).toThrow(/invalid unmapped SQL operator/);
    }
  });
});

type FrozenDistanceOp = 'l2' | 'cosine' | 'ip';

type VectorTag = {
  readonly __zmdbExt?: readonly [extension: 'vector', name: 'vector', args: readonly [3]];
};

type GeometryTag = {
  readonly __zmdbExt?: readonly [extension: 'postgis', name: 'geometry', args: readonly ['Point', 4326]];
};

interface Item {
  readonly id: number;
  readonly embedding: readonly number[] & VectorTag;
}

interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

interface Venue {
  readonly location: GeoJsonPoint & GeometryTag;
}

describe('distance expressions and spatial predicates (frozen: query-compiler/SPEC.md 5a)', () => {
  const queryVector = [0.1, 0.2, 0.3] as const;

  it('orders by a cosine distance with the query vector parameterised', () => {
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('items'))
        .orderBy(distance<Item>('embedding', 'cosine', queryVector), 'asc')
        .limit(10)
        .compile(),
    ).toMatchObject({
      text: 'SELECT * FROM "items" ORDER BY "embedding" <=> $1 ASC LIMIT 10',
      parameters: ['[0.1,0.2,0.3]'],
    });
  });

  it('projects a distance as a selected column with an alias', () => {
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('items'))
        .select(['id', distance<Item>('embedding', 'cosine', queryVector).as('distance')])
        .compile(),
    ).toMatchObject({
      text: 'SELECT "id", "embedding" <=> $1 AS "distance" FROM "items"',
      parameters: ['[0.1,0.2,0.3]'],
    });
  });

  it('emits ST_DWithin as a predicate with typed arguments', () => {
    const point = { type: 'Point', coordinates: [77.5946, 12.9716] } as const;
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('venues'))
        .where(stDWithin<Venue>('location', point, 500))
        .compile(),
    ).toMatchObject({
      text: 'SELECT * FROM "venues" WHERE ST_DWithin("location", ST_GeomFromGeoJSON($1), $2)',
      parameters: [point, 500],
    });
  });

  it('emits ST_Contains as the second closed spatial predicate', () => {
    const point = { type: 'Point', coordinates: [77.5946, 12.9716] } as const;
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('venues'))
        .where(stContains<Venue>('location', point))
        .compile(),
    ).toMatchObject({
      text: 'SELECT * FROM "venues" WHERE ST_Contains("location", ST_GeomFromGeoJSON($1))',
      parameters: [point],
    });
  });

  it('refuses a caller-supplied distance operator string', async () => {
    const inheritedInput: object = Object.create({ operator: 'toString' });
    const operator: unknown = Reflect.get(inheritedInput, 'operator');
    if (typeof operator !== 'string') throw new TypeError('test input carried no operator string');

    const compilerApi: object = await import('./index.js');
    const unsafeDistance: unknown = Reflect.get(compilerApi, 'distance');
    if (typeof unsafeDistance !== 'function') throw new TypeError('distance was not exported');
    const run = () => Reflect.apply(unsafeDistance, undefined, ['embedding', operator, queryVector]);
    expect(run).toThrow(/unknown distance operator "toString"/i);
    expect(run).toThrow(
      new RegExp(`expected ${(['l2', 'cosine', 'ip'] satisfies readonly FrozenDistanceOp[]).join(' \\| ')}`),
    );

    expect(() =>
      createQueryCompiler(postgresDialect)
        .selectFrom(trustedTable('items'))
        .where('embedding', 'cosine', [0.1, Number.NaN, 0.3])
        .compile(),
    ).toThrow(/pgvector query may contain only finite numbers/);
  });
});

describe('schema-bound canonical queries (#774)', () => {
  it('maps property names and keeps branch parameters immutable', () => {
    const base = createQueryCompiler(postgresDialect)
      .selectFrom(QueryUserSchema)
      .select(['id', { column: 'displayName', alias: 'label' }])
      .where('age', '>', 18);
    const branch = base
      .whereGroup([{ col: 'active', op: '=', value: true }])
      .orderBy('displayName', 'asc')
      .limit(2);
    expect(branch.compile()).toMatchObject({
      text: 'SELECT "user_id" AS "id", "display_name" AS "label" FROM "user_accounts" WHERE "age_years" > $1 AND ("active_flag" = $2) ORDER BY "display_name" ASC LIMIT 2',
      parameters: [18, true],
    });
    expect(base.compile()).toMatchObject({
      text: 'SELECT "user_id" AS "id", "display_name" AS "label" FROM "user_accounts" WHERE "age_years" > $1',
      parameters: [18],
    });
    expect(Object.isFrozen(branch.compile().parameters)).toBe(true);
    expect(branch.compile()).toEqual(branch.compile());
  });

  it('binds write payloads, conflicts, expressions and returning to application properties', () => {
    const query = createQueryCompiler(postgresDialect)
      .insertInto(QueryUserSchema)
      .values({ displayName: 'Ada', age: 30, active: true })
      .onConflict('displayName')
      .doUpdate({ age: inc(1) })
      .returning(['id', { column: 'displayName', alias: 'name' }]);
    expect(query.compile()).toMatchObject({
      text: 'INSERT INTO "user_accounts" ("display_name", "age_years", "active_flag") VALUES ($1, $2, $3) ON CONFLICT ("display_name") DO UPDATE SET "age_years" = "age_years" + $4 RETURNING "user_id" AS "id", "display_name" AS "name"',
      parameters: ['Ada', 30, true, 1],
    });
    expect(
      createQueryCompiler(postgresDialect)
        .updateTable(QueryUserSchema)
        .set({ age: inc(2) })
        .where('id', '=', 7)
        .returning(['id'])
        .compile(),
    ).toMatchObject({
      text: 'UPDATE "user_accounts" SET "age_years" = "age_years" + $1 WHERE "user_id" = $2 RETURNING "user_id" AS "id"',
      parameters: [2, 7],
    });
    expect(
      createQueryCompiler(postgresDialect).deleteFrom(QueryUserSchema).where('id', '=', 7).returning(['id']).compile(),
    ).toMatchObject({
      text: 'DELETE FROM "user_accounts" WHERE "user_id" = $1 RETURNING "user_id" AS "id"',
      parameters: [7],
    });
  });

  it('requires an explicit trusted boundary for a physical table string', () => {
    const compiler = createQueryCompiler(postgresDialect);
    expect(() => Reflect.apply(compiler.selectFrom, compiler, ['user_accounts'])).toThrow(/schema|trusted/i);
  });
});

// This exported function is compiled but never invoked: invalid calls exercise the type boundary.
export function canonicalQueryTypes(): void {
  const compiler = createQueryCompiler(postgresDialect);
  const users = compiler.selectFrom(QueryUserSchema, 'u');
  const selected = users.select(['u.id', { column: 'u.displayName', alias: 'name' }]);
  expectTypeOf(selected._type).toEqualTypeOf<
    { 'u.id': Entity<QueryUser>['id']; name: Entity<QueryUser>['displayName'] } | undefined
  >();
  const joined = users
    .leftJoin(QueryPostSchema, 'p', [{ leftCol: 'u.id', rightCol: 'p.userId' }])
    .select(['u.id', { column: 'p.title', alias: 'title' }]);
  expectTypeOf(joined._type).toEqualTypeOf<
    { 'u.id': Entity<QueryUser>['id']; title: Entity<QueryPost>['title'] | null } | undefined
  >();
  const aggregate = users.select(['u.id']).count('*', 'count').sum('u.age', 'ageSum').min('u.displayName', 'firstName');
  expectTypeOf(aggregate._type).toEqualTypeOf<
    | {
        'u.id': Entity<QueryUser>['id'];
        count: number;
        ageSum: number | null;
        firstName: Entity<QueryUser>['displayName'] | null;
      }
    | undefined
  >();
  const returned = compiler.insertInto(QueryUserSchema).values({ displayName: 'Ada' }).returning(['id']);
  expectTypeOf(returned._type).toEqualTypeOf<{ id: Entity<QueryUser>['id'] } | undefined>();
  const ids = compiler.selectFrom(QueryPostSchema).select(['userId']);
  users.where('u.id', 'in', ids);
  users.whereMatch('u.displayName', 'Ada');
  aggregate.having('count', '>', 1).orderBy('ageSum', 'desc');
  compiler.updateTable(QueryUserSchema).set({ age: inc(1), active: not(), displayName: concat('!') });
  // @ts-expect-error a bare string does not prove a table declaration
  compiler.selectFrom('users');
  // @ts-expect-error a caller cannot assign an unrelated table's declaration
  compiler.selectFrom<QueryPost>(QueryUserSchema);
  // @ts-expect-error the trusted boundary cannot acquire a caller-selected declaration
  compiler.selectFrom<QueryUser>(trustedTable('user_accounts'));
  // @ts-expect-error unknown property
  users.where('u.missing', '=', 1);
  // @ts-expect-error physical names do not bypass the property boundary
  users.where('age_years', '=', 1);
  // @ts-expect-error wrong operand type
  users.where('u.age', '=', 'old');
  // @ts-expect-error wrong IN element type
  users.whereIn('u.id', ['wrong']);
  // @ts-expect-error grouped predicates retain operand bounds
  users.whereGroup([{ col: 'u.age', op: '=', value: 'wrong' }]);
  // @ts-expect-error subquery projected values must match the compared column
  users.where('u.id', 'in', compiler.selectFrom(QueryPostSchema).select(['title']));
  // @ts-expect-error FTS columns must carry string values
  users.whereMatch('u.age', 'old');
  // @ts-expect-error selected columns must exist in scope
  users.select(['u.missing']);
  const duplicateColumns = [
    { column: 'u.id', alias: 'id' },
    { column: 'u.displayName', alias: 'id' },
  ] as const;
  // @ts-expect-error result aliases must be unique
  users.select(duplicateColumns);
  // @ts-expect-error joined table aliases cannot collide
  users.leftJoin(QueryPostSchema, 'u', [{ leftCol: 'u.id', rightCol: 'u.userId' }]);
  // @ts-expect-error a join cannot name an unselected table
  users.leftJoin(QueryPostSchema, 'p', [{ leftCol: 'other.id', rightCol: 'p.userId' }]);
  // @ts-expect-error join equality requires compatible column values
  users.leftJoin(QueryPostSchema, 'p', [{ leftCol: 'u.id', rightCol: 'p.title' }]);
  // @ts-expect-error aggregate aliases cannot overwrite selected properties
  aggregate.count('*', 'count');
  // @ts-expect-error HAVING preserves aggregate operand types
  aggregate.having('count', '>', 'many');
  // @ts-expect-error numeric aggregates reject text columns
  users.sum('u.displayName', 'sum');
  // @ts-expect-error serial properties are omitted from CreateDTO
  compiler.insertInto(QueryUserSchema).values({ id: 1, displayName: 'Ada' });
  // @ts-expect-error required CreateDTO properties remain required
  compiler.insertInto(QueryUserSchema).values({ age: 1 });
  // @ts-expect-error update values retain their declared type
  compiler.updateTable(QueryUserSchema).set({ age: 'wrong' });
  // @ts-expect-error compiler expressions must match their SET property type
  compiler.updateTable(QueryUserSchema).set({ age: concat('wrong') });
  // @ts-expect-error generated identities are not updateable
  compiler.updateTable(QueryUserSchema).set({ id: 2 });
  // @ts-expect-error conflict targets use application properties
  compiler.insertInto(QueryUserSchema).values({ displayName: 'Ada' }).onConflict('missing');
  const conflict = compiler.insertInto(QueryUserSchema).values({ displayName: 'Ada' }).onConflict('displayName');
  // @ts-expect-error upsert updates retain the same expression/value bounds
  conflict.doUpdate({ age: 'wrong' });
  // @ts-expect-error returning projections retain column bounds
  compiler.deleteFrom(QueryUserSchema).returning(['missing']);
}
