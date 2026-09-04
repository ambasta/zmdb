import { describe, it, expect } from 'vitest';

import { createQueryCompiler, sanitizeKeys, chunkArray, OP_MAP } from './index.js';

// RED PHASE (#16 spec freeze): golden SQL fixtures from SPEC.md.

describe('postgres SELECT compilation', () => {
  it('compiles where + orderBy + limit', () => {
    const qb = createQueryCompiler('postgres');
    const q = qb.selectFrom('users').where('email', '=', 'a@b.com').orderBy('createdAt', 'desc').limit(10).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('compiles andWhere with sequential placeholders', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('role', '=', 'admin')
      .andWhere('active', '=', true)
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2');
    expect(q.parameters).toEqual(['admin', true]);
  });

  it('compiles whereIn, andWhereIn, and orWhereIn', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('orders')
      .whereIn('status', ['pending', 'shipped'])
      .orWhereIn('userId', [1, 2])
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "status" IN ($1, $2) OR "userId" IN ($3, $4)');
    expect(q.parameters).toEqual(['pending', 'shipped', 1, 2]);
  });

  it('compiles whereNotIn, andWhereNotIn, and orWhereNotIn', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('active', '=', true)
      .andWhereNotIn('role', ['banned', 'guest'])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "active" = $1 AND "role" NOT IN ($2, $3)');
    expect(q.parameters).toEqual([true, 'banned', 'guest']);
  });

  it('compiles whereNotIn filtering null and undefined values to prevent three-valued logic traps', () => {
    const q1 = createQueryCompiler('postgres')
      .selectFrom('users')
      .whereNotIn('role', ['banned', null, undefined, 'guest'])
      .compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q1.parameters).toEqual(['banned', 'guest']);

    const q2 = createQueryCompiler('postgres').selectFrom('users').whereNotIn('role', [null, undefined]).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(q2.parameters).toEqual([]);
  });

  it('compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1', () => {
    const qIn = createQueryCompiler('postgres').selectFrom('users').whereIn('id', []).compile();
    expect(qIn.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(qIn.parameters).toEqual([]);

    const qNotIn = createQueryCompiler('postgres').selectFrom('users').whereNotIn('id', []).compile();
    expect(qNotIn.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(qNotIn.parameters).toEqual([]);
  });

  it('compile() is pure (twice → equal)', () => {
    const b = createQueryCompiler('postgres').selectFrom('users').where('id', '=', 1);
    expect(b.compile()).toEqual(b.compile());
  });
});

describe('zero-operand null predicates', () => {
  // Actual at 9e6b9757:
  //   SELECT * FROM "users" WHERE "deletedAt" is null $1 AND "tenantId" = $2
  //   parameters ["ignored", 7]
  // `is not null` has the same defect: it binds its ignored value and shifts the
  // following placeholder.
  it.fails('compiles zero-operand null predicates without shifting later parameters', () => {
    const isNull = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('deletedAt', 'is null', 'ignored')
      .andWhere('tenantId', '=', 7)
      .compile();
    const isNotNull = createQueryCompiler('postgres')
      .selectFrom('users')
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
  it('keeps every default CRUD compiled-query object exactly two-keyed', () => {
    const compiler = createQueryCompiler('postgres');
    const queries = [
      compiler.selectFrom('users').compile(),
      compiler.insertInto('users').values({ email: 'a@b.com' }).compile(),
      compiler.updateTable('users').set({ email: 'b@c.com' }).compile(),
      compiler.deleteFrom('users').compile(),
    ];

    for (const query of queries) {
      expect(Object.keys(query)).toEqual(['text', 'parameters']);
      expect(query.telemetry).toBeUndefined();
    }
  });

  it('attaches the dialect, operation and collection only when enabled', () => {
    const postgres = createQueryCompiler('postgres', { telemetry: true });
    const mysql = createQueryCompiler('mysql', { telemetry: true });
    const sqlite = createQueryCompiler('sqlite', { telemetry: true });

    expect(postgres.selectFrom('users').compile().telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });
    expect(postgres.insertInto('orders').values({ sku: 'A' }).compile().telemetry).toEqual({
      system: 'postgresql',
      operation: 'INSERT',
      collection: 'orders',
    });
    expect(mysql.updateTable('accounts').set({ active: true }).compile().telemetry).toEqual({
      system: 'mysql',
      operation: 'UPDATE',
      collection: 'accounts',
    });
    expect(sqlite.deleteFrom('sessions').compile().telemetry).toEqual({
      system: 'sqlite',
      operation: 'DELETE',
      collection: 'sessions',
    });
    expect(postgres.selectFrom('analytics.users as u').compile().telemetry?.collection).toBe('analytics.users');
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
    const q = createQueryCompiler('postgres')
      .insertInto('users')
      .values({ email: 'a@b.com', role: 'user' })
      .returning(['id'])
      .compile();
    expect(q.text).toBe('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"');
    expect(q.parameters).toEqual(['a@b.com', 'user']);
  });

  it('UPDATE ... SET ... WHERE', () => {
    const q = createQueryCompiler('postgres').updateTable('users').set({ role: 'admin' }).where('id', '=', 1).compile();
    expect(q.text).toBe('UPDATE "users" SET "role" = $1 WHERE "id" = $2');
    expect(q.parameters).toEqual(['admin', 1]);
  });

  it('DELETE ... WHERE', () => {
    const q = createQueryCompiler('postgres').deleteFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('DELETE FROM "users" WHERE "id" = $1');
    expect(q.parameters).toEqual([1]);
  });
});

describe('dialect placeholder + quoting', () => {
  it('mysql uses ? and backticks', () => {
    const q = createQueryCompiler('mysql')
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('sqlite uses ? and double quotes', () => {
    const q = createQueryCompiler('sqlite').selectFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" = ?');
    expect(q.parameters).toEqual([1]);
  });
});

describe('subquery & EXISTS compilation', () => {
  it('compiles scalar comparison and IN subqueries with sequential parameter offsets', () => {
    const qb = createQueryCompiler('postgres');
    const sub = qb.selectFrom('orders').select(['user_id']).where('amount', '>', 100);
    const q = qb.selectFrom('users').where('status', '=', 'active').andWhere('id', 'in', sub).compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "status" = $1 AND "id" IN (SELECT "user_id" FROM "orders" WHERE "amount" > $2)',
    );
    expect(q.parameters).toEqual(['active', 100]);
  });

  it('compiles whereExists and orWhereExists clauses', () => {
    const qb = createQueryCompiler('postgres');
    const sub1 = qb.selectFrom('orders').where('status', '=', 'shipped');
    const sub2 = qb.selectFrom('logs').where('level', '=', 'error');
    const q = qb.selectFrom('users').where('role', '=', 'admin').whereExists(sub1).orWhereExists(sub2).compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "role" = $1 AND EXISTS (SELECT * FROM "orders" WHERE "status" = $2) OR EXISTS (SELECT * FROM "logs" WHERE "level" = $3)',
    );
    expect(q.parameters).toEqual(['admin', 'shipped', 'error']);
  });

  it('compiles multi-level nested subqueries with continuous parameter renumbering', () => {
    const qb = createQueryCompiler('postgres');
    const inner = qb.selectFrom('payments').select(['order_id']).where('status', '=', 'failed');
    const middle = qb.selectFrom('orders').select(['user_id']).where('total', '>', 50).andWhere('id', 'in', inner);
    const outer = qb.selectFrom('users').where('tenant_id', '=', 10).andWhere('id', 'in', middle).compile();

    expect(outer.text).toBe(
      'SELECT * FROM "users" WHERE "tenant_id" = $1 AND "id" IN (SELECT "user_id" FROM "orders" WHERE "total" > $2 AND "id" IN (SELECT "order_id" FROM "payments" WHERE "status" = $3))',
    );
    expect(outer.parameters).toEqual([10, 50, 'failed']);
  });
});

describe('conflict resolution compilation (PostgreSQL, MySQL, SQLite)', () => {
  it('compiles PostgreSQL ON CONFLICT DO UPDATE (default non-target columns)', () => {
    const q = createQueryCompiler('postgres')
      .insertInto('users')
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
    const q = createQueryCompiler('postgres')
      .insertInto('users')
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
    const q = createQueryCompiler('postgres')
      .insertInto('users')
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
    const q1 = createQueryCompiler('postgres')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doNothing()
      .compile();
    expect(q1.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING');

    const q2 = createQueryCompiler('postgres')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(q2.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT DO NOTHING');
  });

  it('compiles MySQL ON DUPLICATE KEY UPDATE and INSERT IGNORE', () => {
    const qUpdate = createQueryCompiler('mysql')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .compile();
    expect(qUpdate.text).toBe(
      'INSERT INTO `users` (`id`, `email`, `role`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`), `role` = VALUES(`role`)',
    );
    expect(qUpdate.parameters).toEqual([1, 'a@b.com', 'user']);

    const qIgnore = createQueryCompiler('mysql')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(qIgnore.text).toBe('INSERT IGNORE INTO `users` (`id`, `email`) VALUES (?, ?)');
    expect(qIgnore.parameters).toEqual([1, 'a@b.com']);
  });

  it('compiles SQLite ON CONFLICT DO UPDATE and DO NOTHING', () => {
    const qUpdate = createQueryCompiler('sqlite')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .returning(['*'])
      .compile();
    expect(qUpdate.text).toBe(
      'INSERT INTO "users" ("id", "email", "role") VALUES (?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "role" = EXCLUDED."role" RETURNING *',
    );
    expect(qUpdate.parameters).toEqual([1, 'a@b.com', 'user']);

    const qIgnore = createQueryCompiler('sqlite')
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doNothing()
      .compile();
    expect(qIgnore.text).toBe('INSERT INTO "users" ("id", "email") VALUES (?, ?) ON CONFLICT ("id") DO NOTHING');
    expect(qIgnore.parameters).toEqual([1, 'a@b.com']);
  });

  it('throws an error when doUpdate is called with an empty updateFields array', () => {
    expect(() => {
      createQueryCompiler('postgres')
        .insertInto('users')
        .values({ id: 1, email: 'a@b.com' })
        .onConflict('id')
        .doUpdate([]);
    }).toThrow('Empty updateFields array is not allowed in doUpdate()');
  });
});

describe('array parameter IN expansion', () => {
  it('expands array parameters into parameterized IN clauses for postgres with sequential placeholders', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('id', 'in', [10, 20, 30])
      .andWhere('status', '=', 'active')
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN ($1, $2, $3) AND "status" = $4');
    expect(q.parameters).toEqual([10, 20, 30, 'active']);
  });

  it('correctly renumbers placeholders when an IN list sits between other predicates in postgres', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('orders')
      .where('tenantId', '=', 100)
      .whereIn('status', ['pending', 'shipped'])
      .andWhere('total', '>', 500)
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "tenantId" = $1 AND "status" IN ($2, $3) AND "total" > $4');
    expect(q.parameters).toEqual([100, 'pending', 'shipped', 500]);
  });

  it('correctly renumbers placeholders when multiple IN lists sit between standard predicates', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('orders')
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
    const q = createQueryCompiler('mysql').selectFrom('users').whereIn('id', [10, 20]).compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `id` IN (?, ?)');
    expect(q.parameters).toEqual([10, 20]);
  });

  it('does not silently reinterpret = or != with array parameters as IN or NOT IN', () => {
    const q1 = createQueryCompiler('postgres').selectFrom('users').where('id', '=', [10, 20]).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "id" = $1');
    expect(q1.parameters).toEqual([[10, 20]]);

    const q2 = createQueryCompiler('postgres').selectFrom('users').where('id', '!=', [10, 20]).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE "id" != $1');
    expect(q2.parameters).toEqual([[10, 20]]);
  });

  it('expands array parameters into parameterized IN clauses for sqlite', () => {
    const q = createQueryCompiler('sqlite').selectFrom('users').where('id', 'in', [1, 2, 3]).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN (?, ?, ?)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });

  it('handles NOT IN / nin array expansion', () => {
    const q = createQueryCompiler('postgres').selectFrom('users').where('role', 'nin', ['admin', 'super']).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q.parameters).toEqual(['admin', 'super']);
  });

  it('handles empty array parameters cleanly (false / true)', () => {
    const q1 = createQueryCompiler('postgres').selectFrom('users').where('id', 'in', []).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(q1.parameters).toEqual([]);

    const q2 = createQueryCompiler('postgres').selectFrom('users').where('id', 'nin', []).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(q2.parameters).toEqual([]);
  });
});

describe('Operator normalization & raw operator fall-through', () => {
  it('validates normalized canonical operators and produces expected SQL', () => {
    const qb = createQueryCompiler('postgres');
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
        const q = qb.selectFrom('users').where('col', op, [1, 2]).compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} ($1, $2)`);
      } else {
        const q = qb.selectFrom('users').where('col', op, 'val').compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} $1`);
      }
    }
  });

  it('allows unmapped raw Postgres/SQL operators to fall through as-written', () => {
    const qb = createQueryCompiler('postgres');
    const q1 = qb.selectFrom('users').where('tags', '@>', ['a', 'b']).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "tags" @> $1');
    expect(q1.parameters).toEqual([['a', 'b']]);

    const q2 = qb.selectFrom('events').where('duration', '&&', '[2020-01-01,2020-01-02]').compile();
    expect(q2.text).toBe('SELECT * FROM "events" WHERE "duration" && $1');
    expect(q2.parameters).toEqual(['[2020-01-01,2020-01-02]']);
  });

  it('is safe against prototype property lookups', () => {
    const qb = createQueryCompiler('postgres');
    const q = qb.selectFrom('users').where('col', 'toString', 'val').compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "col" toString $1');
    expect(q.parameters).toEqual(['val']);
  });
});
