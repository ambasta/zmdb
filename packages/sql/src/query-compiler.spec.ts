// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from 'vitest';

import {
  trustedTable,
  inc,
  OP_MAP,
  QueryCompilerError,
  UnsupportedFeatureError,
  checkDialectCapability,
  chunkArray,
  createQueryCompiler,
  distance,
  sanitizeKeys,
  stContains,
  stDWithin,
  windowFunction,
  type DialectTarget,
} from './index.js';
import { mysqlDialect, officialDialects, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';
import { QueryUserSchema } from './testing/query-schema.fixture.js';

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

describe('Operator normalization & bounded dialect operators', () => {
  it('validates normalized canonical operators and produces expected SQL', () => {
    const qb = createQueryCompiler(postgresDialect);
    const ops: [string, string][] = [
      ['=', '='],
      ['!=', '!='],
      ['<', '<'],
      ['<=', '<='],
      ['>', '>'],
      ['>=', '>='],
      ['like', 'LIKE'],
      ['LIKE', 'LIKE'],
      ['ilike', 'ILIKE'],
      ['ILIKE', 'ILIKE'],
      ['in', 'IN'],
      ['IN', 'IN'],
      ['not in', 'NOT IN'],
      ['NOT IN', 'NOT IN'],
      ['nin', 'NOT IN'],
      ['NIN', 'NOT IN'],
    ];

    for (const [op, expectedSqlOp] of ops) {
      if (expectedSqlOp === 'IN' || expectedSqlOp === 'NOT IN') {
        const q = qb.selectFrom(trustedTable('users')).where('col', op, [1, 2]).compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} ($1, $2)`);
      } else {
        const q = qb.selectFrom(trustedTable('users')).where('col', op, 'val').compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} $1`);
      }
    }
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
      expect(query.text, `${testCase.dialect} ${testCase.operator}`).toBe(testCase.text);
      expect(query.parameters, `${testCase.dialect} ${testCase.operator}`).toEqual([testCase.value]);
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
        createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).where('role', operator, 1).compile();
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
        createQueryCompiler(postgresDialect).selectFrom(trustedTable('users')).where('col', inherited, 'val').compile();
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
});

describe('Common Table Expressions (CTEs)', () => {
  it('compiles non-recursive CTE with sequential parameter offsets on postgres', () => {
    const qb = createQueryCompiler(postgresDialect);
    const deptCte = qb.selectFrom(trustedTable('departments')).where('active', '=', true);
    const q = qb
      .selectFrom(trustedTable('dept_summary'))
      .with('dept_summary', deptCte)
      .where('min_salary', '>', 50000)
      .compile();

    expect(q.text).toBe(
      'WITH "dept_summary" AS (SELECT * FROM "departments" WHERE "active" = $1) SELECT * FROM "dept_summary" WHERE "min_salary" > $2',
    );
    expect(q.parameters).toEqual([true, 50000]);
  });

  it('compiles multiple CTEs with callback builders and sequential parameter offsets', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q = qb
      .selectFrom(trustedTable('final_view'))
      .with('active_users', b => b.selectFrom(trustedTable('users')).where('status', '=', 'active'))
      .with('top_orders', b => b.selectFrom(trustedTable('orders')).where('total', '>', 100))
      .where('id', '=', 42)
      .compile();

    expect(q.text).toBe(
      'WITH "active_users" AS (SELECT * FROM "users" WHERE "status" = $1), "top_orders" AS (SELECT * FROM "orders" WHERE "total" > $2) SELECT * FROM "final_view" WHERE "id" = $3',
    );
    expect(q.parameters).toEqual(['active', 100, 42]);
  });

  it('compiles recursive CTEs using WITH RECURSIVE for hierarchical queries', () => {
    const qb = createQueryCompiler(postgresDialect);
    const baseNav = qb.selectFrom(trustedTable('org')).where('manager_id', '=', null);
    const q = qb
      .selectFrom(trustedTable('hierarchy'))
      .withRecursive('hierarchy', baseNav)
      .where('depth', '<', 5)
      .compile();

    expect(q.text).toBe(
      'WITH RECURSIVE "hierarchy" AS (SELECT * FROM "org" WHERE "manager_id" = $1) SELECT * FROM "hierarchy" WHERE "depth" < $2',
    );
    expect(q.parameters).toEqual([null, 5]);
  });

  it('compiles CTEs correctly on MySQL and SQLite dialects with ? placeholders', () => {
    const mysqlCompiler = createQueryCompiler(mysqlDialect);
    const subMysql = mysqlCompiler.selectFrom(trustedTable('users')).where('age', '>=', 21);
    const qMysql = mysqlCompiler
      .selectFrom(trustedTable('adults'))
      .with('adults', subMysql)
      .where('city', '=', 'NYC')
      .compile();

    expect(qMysql.text).toBe(
      'WITH `adults` AS (SELECT * FROM `users` WHERE `age` >= ?) SELECT * FROM `adults` WHERE `city` = ?',
    );
    expect(qMysql.parameters).toEqual([21, 'NYC']);

    const sqliteCompiler = createQueryCompiler(sqliteDialect);
    const subSqlite = sqliteCompiler.selectFrom(trustedTable('items')).where('stock', '>', 0);
    const qSqlite = sqliteCompiler
      .selectFrom(trustedTable('available'))
      .with('available', subSqlite)
      .where('price', '<', 50)
      .compile();

    expect(qSqlite.text).toBe(
      'WITH "available" AS (SELECT * FROM "items" WHERE "stock" > ?) SELECT * FROM "available" WHERE "price" < ?',
    );
    expect(qSqlite.parameters).toEqual([0, 50]);
  });
});

describe('Window Functions & Projection AST extension', () => {
  it('compiles ROW_NUMBER, RANK, SUM window functions with PARTITION BY and ORDER BY', () => {
    const qb = createQueryCompiler(postgresDialect);

    const rowNum = windowFunction('ROW_NUMBER').partitionBy('department_id').orderBy('salary', 'desc').as('rank');
    const runningTotal = windowFunction('SUM', ['amount'])
      .partitionBy('user_id')
      .orderBy('created_at', 'asc')
      .as('running_total');

    const q = qb
      .selectFrom(trustedTable('employees'))
      .select([rowNum, runningTotal])
      .where('active', '=', true)
      .compile();

    expect(q.text).toBe(
      'SELECT ROW_NUMBER() OVER (PARTITION BY "department_id" ORDER BY "salary" DESC) AS "rank", SUM("amount") OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC) AS "running_total" FROM "employees" WHERE "active" = $1',
    );
    expect(q.parameters).toEqual([true]);
  });

  it('compiles selectWindow and window functions on MySQL and SQLite', () => {
    const mysqlQb = createQueryCompiler(mysqlDialect);
    const wfMysql = windowFunction('RANK').partitionBy(['dept', 'region']).orderBy('score', 'desc').as('dept_rank');

    const qMysql = mysqlQb.selectFrom(trustedTable('scores')).selectWindow(wfMysql).where('year', '=', 2026).compile();
    expect(qMysql.text).toBe(
      'SELECT RANK() OVER (PARTITION BY `dept`, `region` ORDER BY `score` DESC) AS `dept_rank` FROM `scores` WHERE `year` = ?',
    );
    expect(qMysql.parameters).toEqual([2026]);
  });

  it('throws QueryCompilerError when window functions are attempted outside projection selection lists', () => {
    const qb = createQueryCompiler(postgresDialect);

    expect(() => {
      qb.selectFrom(trustedTable('users'))
        .where(windowFunction('ROW_NUMBER') as unknown as string, '=', 1)
        .compile();
    }).toThrow(QueryCompilerError);

    expect(() => {
      qb.selectFrom(trustedTable('users')).where('ROW_NUMBER() OVER (ORDER BY id)', '=', 1).compile();
    }).toThrow(QueryCompilerError);

    expect(() => {
      qb.selectFrom(trustedTable('users')).whereIn('ROW_NUMBER() OVER ()', [1, 2]).compile();
    }).toThrow(QueryCompilerError);
  });

  it('throws UnsupportedFeatureError when unsupported capability is requested on restricted dialect', () => {
    expect(() => {
      checkDialectCapability({ name: 'oracle' } as unknown as DialectTarget, 'window functions');
    }).toThrow(UnsupportedFeatureError);

    expect(() => {
      checkDialectCapability({ name: 'oracle' } as unknown as DialectTarget, 'common table expressions');
    }).toThrow(UnsupportedFeatureError);
  });
});
