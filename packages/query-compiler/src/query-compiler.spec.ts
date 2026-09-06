import { describe, it, expect } from 'vitest';

import { OP_MAP, chunkArray, createQueryCompiler, distance, sanitizeKeys, stContains, stDWithin } from './index.js';
import { mysqlDialect, officialDialects, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

// RED PHASE (#16 spec freeze): golden SQL fixtures from SPEC.md.

describe('postgres SELECT compilation', () => {
  it('aliases a physical column back to its property name in the select list', () => {
    const query = createQueryCompiler(postgresDialect)
      .selectFrom('user_accounts')
      .select([{ column: 'created_at', alias: 'createdAt' }, 'id'])
      .compile();

    expect(query).toEqual({
      text: 'SELECT "created_at" AS "createdAt", "id" FROM "user_accounts"',
      parameters: [],
    });
  });

  it('compiles where + orderBy + limit', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q = qb.selectFrom('users').where('email', '=', 'a@b.com').orderBy('createdAt', 'desc').limit(10).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('compiles andWhere with sequential placeholders', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('users')
      .where('role', '=', 'admin')
      .andWhere('active', '=', true)
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2');
    expect(q.parameters).toEqual(['admin', true]);
  });

  it('compiles whereIn, andWhereIn, and orWhereIn', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('orders')
      .whereIn('status', ['pending', 'shipped'])
      .orWhereIn('userId', [1, 2])
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "status" IN ($1, $2) OR "userId" IN ($3, $4)');
    expect(q.parameters).toEqual(['pending', 'shipped', 1, 2]);
  });

  it('compiles whereNotIn, andWhereNotIn, and orWhereNotIn', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('users')
      .where('active', '=', true)
      .andWhereNotIn('role', ['banned', 'guest'])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "active" = $1 AND "role" NOT IN ($2, $3)');
    expect(q.parameters).toEqual([true, 'banned', 'guest']);
  });

  it('compiles whereNotIn filtering null and undefined values to prevent three-valued logic traps', () => {
    const q1 = createQueryCompiler(postgresDialect)
      .selectFrom('users')
      .whereNotIn('role', ['banned', null, undefined, 'guest'])
      .compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q1.parameters).toEqual(['banned', 'guest']);

    const q2 = createQueryCompiler(postgresDialect).selectFrom('users').whereNotIn('role', [null, undefined]).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(q2.parameters).toEqual([]);
  });

  it('compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1', () => {
    const qIn = createQueryCompiler(postgresDialect).selectFrom('users').whereIn('id', []).compile();
    expect(qIn.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(qIn.parameters).toEqual([]);

    const qNotIn = createQueryCompiler(postgresDialect).selectFrom('users').whereNotIn('id', []).compile();
    expect(qNotIn.text).toBe('SELECT * FROM "users" WHERE 1 = 1');
    expect(qNotIn.parameters).toEqual([]);
  });

  it('compile() is pure (twice → equal)', () => {
    const b = createQueryCompiler(postgresDialect).selectFrom('users').where('id', '=', 1);
    expect(b.compile()).toEqual(b.compile());
  });
});

describe('aliased write results', () => {
  const returned = [{ column: 'created_at', alias: 'createdAt' }] as const;

  it('aliases RETURNING columns for the Postgres family and SQLite', () => {
    expect(
      createQueryCompiler(postgresDialect).insertInto('users').values({ created_at: 1 }).returning(returned).compile(),
    ).toEqual({
      text: 'INSERT INTO "users" ("created_at") VALUES ($1) RETURNING "created_at" AS "createdAt"',
      parameters: [1],
    });
    expect(
      createQueryCompiler(sqliteDialect)
        .updateTable('users')
        .set({ created_at: 2 })
        .where('id', '=', 1)
        .returning(returned)
        .compile(),
    ).toEqual({
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
      .selectFrom('users')
      .where('deletedAt', 'is null', 'ignored')
      .andWhere('tenantId', '=', 7)
      .compile();
    const isNotNull = createQueryCompiler(postgresDialect)
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
    const compiler = createQueryCompiler(postgresDialect);
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
    const postgres = createQueryCompiler(postgresDialect, { telemetry: true });
    const mysql = createQueryCompiler(mysqlDialect, { telemetry: true });
    const sqlite = createQueryCompiler(sqliteDialect, { telemetry: true });

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
    const q = createQueryCompiler(postgresDialect)
      .insertInto('users')
      .values({ email: 'a@b.com', role: 'user' })
      .returning(['id'])
      .compile();
    expect(q.text).toBe('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"');
    expect(q.parameters).toEqual(['a@b.com', 'user']);
  });

  it('UPDATE ... SET ... WHERE', () => {
    const q = createQueryCompiler(postgresDialect)
      .updateTable('users')
      .set({ role: 'admin' })
      .where('id', '=', 1)
      .compile();
    expect(q.text).toBe('UPDATE "users" SET "role" = $1 WHERE "id" = $2');
    expect(q.parameters).toEqual(['admin', 1]);
  });

  it('DELETE ... WHERE', () => {
    const q = createQueryCompiler(postgresDialect).deleteFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('DELETE FROM "users" WHERE "id" = $1');
    expect(q.parameters).toEqual([1]);
  });
});

describe('dialect placeholder + quoting', () => {
  it('mysql uses ? and backticks', () => {
    const q = createQueryCompiler(mysqlDialect)
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('sqlite uses ? and double quotes', () => {
    const q = createQueryCompiler(sqliteDialect).selectFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" = ?');
    expect(q.parameters).toEqual([1]);
  });
});

describe('subquery & EXISTS compilation', () => {
  it('compiles scalar comparison and IN subqueries with sequential parameter offsets', () => {
    const qb = createQueryCompiler(postgresDialect);
    const sub = qb.selectFrom('orders').select(['user_id']).where('amount', '>', 100);
    const q = qb.selectFrom('users').where('status', '=', 'active').andWhere('id', 'in', sub).compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "status" = $1 AND "id" IN (SELECT "user_id" FROM "orders" WHERE "amount" > $2)',
    );
    expect(q.parameters).toEqual(['active', 100]);
  });

  it('compiles whereExists and orWhereExists clauses', () => {
    const qb = createQueryCompiler(postgresDialect);
    const sub1 = qb.selectFrom('orders').where('status', '=', 'shipped');
    const sub2 = qb.selectFrom('logs').where('level', '=', 'error');
    const q = qb.selectFrom('users').where('role', '=', 'admin').whereExists(sub1).orWhereExists(sub2).compile();

    expect(q.text).toBe(
      'SELECT * FROM "users" WHERE "role" = $1 AND EXISTS (SELECT * FROM "orders" WHERE "status" = $2) OR EXISTS (SELECT * FROM "logs" WHERE "level" = $3)',
    );
    expect(q.parameters).toEqual(['admin', 'shipped', 'error']);
  });

  it('compiles multi-level nested subqueries with continuous parameter renumbering', () => {
    const qb = createQueryCompiler(postgresDialect);
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
    const q = createQueryCompiler(postgresDialect)
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
    const q = createQueryCompiler(postgresDialect)
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
    const q = createQueryCompiler(postgresDialect)
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
    const q1 = createQueryCompiler(postgresDialect)
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict('id')
      .doNothing()
      .compile();
    expect(q1.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING');

    const q2 = createQueryCompiler(postgresDialect)
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(q2.text).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2) ON CONFLICT DO NOTHING');
  });

  it('compiles MySQL ON DUPLICATE KEY UPDATE and INSERT IGNORE', () => {
    const qUpdate = createQueryCompiler(mysqlDialect)
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com', role: 'user' })
      .onConflict('id')
      .doUpdate()
      .compile();
    expect(qUpdate.text).toBe(
      'INSERT INTO `users` (`id`, `email`, `role`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`), `role` = VALUES(`role`)',
    );
    expect(qUpdate.parameters).toEqual([1, 'a@b.com', 'user']);

    const qIgnore = createQueryCompiler(mysqlDialect)
      .insertInto('users')
      .values({ id: 1, email: 'a@b.com' })
      .onConflict()
      .doNothing()
      .compile();
    expect(qIgnore.text).toBe('INSERT IGNORE INTO `users` (`id`, `email`) VALUES (?, ?)');
    expect(qIgnore.parameters).toEqual([1, 'a@b.com']);
  });

  it('compiles SQLite ON CONFLICT DO UPDATE and DO NOTHING', () => {
    const qUpdate = createQueryCompiler(sqliteDialect)
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

    const qIgnore = createQueryCompiler(sqliteDialect)
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
      createQueryCompiler(postgresDialect)
        .insertInto('users')
        .values({ id: 1, email: 'a@b.com' })
        .onConflict('id')
        .doUpdate([]);
    }).toThrow('Empty updateFields array is not allowed in doUpdate()');
  });
});

describe('array parameter IN expansion', () => {
  it('expands array parameters into parameterized IN clauses for postgres with sequential placeholders', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('users')
      .where('id', 'in', [10, 20, 30])
      .andWhere('status', '=', 'active')
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN ($1, $2, $3) AND "status" = $4');
    expect(q.parameters).toEqual([10, 20, 30, 'active']);
  });

  it('correctly renumbers placeholders when an IN list sits between other predicates in postgres', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('orders')
      .where('tenantId', '=', 100)
      .whereIn('status', ['pending', 'shipped'])
      .andWhere('total', '>', 500)
      .compile();
    expect(q.text).toBe('SELECT * FROM "orders" WHERE "tenantId" = $1 AND "status" IN ($2, $3) AND "total" > $4');
    expect(q.parameters).toEqual([100, 'pending', 'shipped', 500]);
  });

  it('correctly renumbers placeholders when multiple IN lists sit between standard predicates', () => {
    const q = createQueryCompiler(postgresDialect)
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
    const q = createQueryCompiler(mysqlDialect).selectFrom('users').whereIn('id', [10, 20]).compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `id` IN (?, ?)');
    expect(q.parameters).toEqual([10, 20]);
  });

  it('does not silently reinterpret = or != with array parameters as IN or NOT IN', () => {
    const q1 = createQueryCompiler(postgresDialect).selectFrom('users').where('id', '=', [10, 20]).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE "id" = $1');
    expect(q1.parameters).toEqual([[10, 20]]);

    const q2 = createQueryCompiler(postgresDialect).selectFrom('users').where('id', '!=', [10, 20]).compile();
    expect(q2.text).toBe('SELECT * FROM "users" WHERE "id" != $1');
    expect(q2.parameters).toEqual([[10, 20]]);
  });

  it('expands array parameters into parameterized IN clauses for sqlite', () => {
    const q = createQueryCompiler(sqliteDialect).selectFrom('users').where('id', 'in', [1, 2, 3]).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" IN (?, ?, ?)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });

  it('handles NOT IN / nin array expansion', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom('users')
      .where('role', 'nin', ['admin', 'super'])
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" NOT IN ($1, $2)');
    expect(q.parameters).toEqual(['admin', 'super']);
  });

  it('handles empty array parameters cleanly (false / true)', () => {
    const q1 = createQueryCompiler(postgresDialect).selectFrom('users').where('id', 'in', []).compile();
    expect(q1.text).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(q1.parameters).toEqual([]);

    const q2 = createQueryCompiler(postgresDialect).selectFrom('users').where('id', 'nin', []).compile();
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
        const q = qb.selectFrom('users').where('col', op, [1, 2]).compile();
        expect(q.text).toBe(`SELECT * FROM "users" WHERE "col" ${expectedSqlOp} ($1, $2)`);
      } else {
        const q = qb.selectFrom('users').where('col', op, 'val').compile();
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
        .selectFrom(testCase.table)
        .where(testCase.column, testCase.operator, testCase.value)
        .compile();
      expect(query.text, `${testCase.dialect} ${testCase.operator}`).toBe(testCase.text);
      expect(query.parameters, `${testCase.dialect} ${testCase.operator}`).toEqual([testCase.value]);
    }
  });

  it('refuses the measured request-derived operator injection before returning SQL', () => {
    const compile = () =>
      createQueryCompiler(postgresDialect).selectFrom('users').where('role', "= 'x' OR 1=1 --", 1).compile();

    expect(compile).toThrow(
      'invalid unmapped SQL operator "= \'x\' OR 1=1 --" for dialect "postgres"; expected one non-comment ' +
        'operator token that does not conflict with the dialect placeholder syntax',
    );
  });

  it('refuses token-breaking punctuation, whitespace and SQL comment shapes', () => {
    const invalid = ["'", ';', ' @>', '@> ', 'OR 1', '--', '@>--', '/*', '*/', '#'];

    for (const operator of invalid) {
      const compile = () =>
        createQueryCompiler(postgresDialect).selectFrom('users').where('role', operator, 1).compile();
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
        createQueryCompiler(officialDialects[dialect]).selectFrom('users').where('payload', operator, 1).compile();
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
        createQueryCompiler(postgresDialect).selectFrom('users').where('col', inherited, 'val').compile();
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
        .selectFrom('items')
        .orderBy(distance<Item>('embedding', 'cosine', queryVector), 'asc')
        .limit(10)
        .compile(),
    ).toEqual({
      text: 'SELECT * FROM "items" ORDER BY "embedding" <=> $1 ASC LIMIT 10',
      parameters: ['[0.1,0.2,0.3]'],
    });
  });

  it('projects a distance as a selected column with an alias', () => {
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom('items')
        .select(['id', distance<Item>('embedding', 'cosine', queryVector).as('distance')])
        .compile(),
    ).toEqual({
      text: 'SELECT "id", "embedding" <=> $1 AS "distance" FROM "items"',
      parameters: ['[0.1,0.2,0.3]'],
    });
  });

  it('emits ST_DWithin as a predicate with typed arguments', () => {
    const point = { type: 'Point', coordinates: [77.5946, 12.9716] } as const;
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom('venues')
        .where(stDWithin<Venue>('location', point, 500))
        .compile(),
    ).toEqual({
      text: 'SELECT * FROM "venues" WHERE ST_DWithin("location", ST_GeomFromGeoJSON($1), $2)',
      parameters: [point, 500],
    });
  });

  it('emits ST_Contains as the second closed spatial predicate', () => {
    const point = { type: 'Point', coordinates: [77.5946, 12.9716] } as const;
    expect(
      createQueryCompiler(postgresDialect).selectFrom('venues').where(stContains<Venue>('location', point)).compile(),
    ).toEqual({
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
        .selectFrom('items')
        .where('embedding', 'cosine', [0.1, Number.NaN, 0.3])
        .compile(),
    ).toThrow(/pgvector query may contain only finite numbers/);
  });
});
