import { trustedTable, createQueryCompiler } from '@zmdb/sql';
import { describe, expect, it } from 'vitest';

import { mysqlDialect, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

describe('Unified SelectBuilder & Facade Integration', () => {
  it('combines joins, aggregations, and full-text search in a single method chain', () => {
    const qb = createQueryCompiler(postgresDialect);
    const q = qb
      .selectFrom(trustedTable('orders'))
      .innerJoin(trustedTable('users'), 'users', [{ leftCol: 'orders.user_id', rightCol: 'users.id' }])
      .leftJoin(trustedTable('order_items'), 'order_items', [
        { leftCol: 'orders.id', rightCol: 'order_items.order_id' },
      ])
      .count('order_items.id', 'item_count')
      .sum('order_items.price', 'total_price')
      .whereMatch('users.bio', 'frequent buyer')
      .where('orders.status', '=', 'completed')
      .groupBy('orders.id', 'users.id')
      .having('total_price', '>', 100)
      .orderBy('total_price', 'desc')
      .limit(10)
      .offset(20)
      .compile();

    expect(q.text).toBe(
      'SELECT COUNT("order_items"."id") AS "item_count", SUM("order_items"."price") AS "total_price" ' +
        'FROM "orders" ' +
        'INNER JOIN "users" ON "orders"."user_id" = "users"."id" ' +
        'LEFT JOIN "order_items" ON "orders"."id" = "order_items"."order_id" ' +
        'WHERE to_tsvector(\'english\', "users"."bio") @@ to_tsquery(\'english\', $1) AND "orders"."status" = $2 ' +
        'GROUP BY "orders"."id", "users"."id" ' +
        'HAVING SUM("order_items"."price") > $3 ' +
        'ORDER BY "total_price" DESC LIMIT 10 OFFSET 20',
    );
    expect(q.parameters).toEqual(['frequent buyer', 'completed', 100]);
  });

  it('preserves configured dialect throughout query compilation (MySQL & SQLite)', () => {
    // MySQL
    const mysqlQb = createQueryCompiler(mysqlDialect);
    const mysqlQuery = mysqlQb
      .selectFrom(trustedTable('users as u'))
      .innerJoin(trustedTable('roles'), 'r', [{ leftCol: 'u.role_id', rightCol: 'r.id' }])
      .count('u.id', 'user_count')
      .whereMatch('u.name', 'john')
      .whereIn('r.name', ['admin', 'manager'])
      .groupBy('r.id')
      .compile();

    expect(mysqlQuery.text).toBe(
      'SELECT COUNT(`u`.`id`) AS `user_count` ' +
        'FROM `users` AS `u` ' +
        'INNER JOIN `roles` AS `r` ON `u`.`role_id` = `r`.`id` ' +
        'WHERE MATCH(`u`.`name`) AGAINST(? IN NATURAL LANGUAGE MODE) AND `r`.`name` IN (?, ?)' +
        ' GROUP BY `r`.`id`',
    );
    expect(mysqlQuery.parameters).toEqual(['john', 'admin', 'manager']);

    // SQLite
    const sqliteQb = createQueryCompiler(sqliteDialect);
    const sqliteQuery = sqliteQb
      .selectFrom(trustedTable('documents as d', { ftsTable: 'documents_fts' }))
      .leftJoin(trustedTable('categories'), 'c', [{ leftCol: 'd.category_id', rightCol: 'c.id' }])
      .whereMatch('d.content', 'search term')
      .where('c.active', '=', 1)
      .limit(5)
      .compile();

    expect(sqliteQuery.text).toBe(
      'SELECT * FROM "documents" AS "d" ' +
        'LEFT JOIN "categories" AS "c" ON "d"."category_id" = "c"."id" ' +
        'INNER JOIN "documents_fts" AS "d_fts" ON "d"."rowid" = "d_fts"."rowid" ' +
        'WHERE "d_fts"."content" MATCH ? AND "c"."active" = ? ' +
        'LIMIT 5',
    );
    expect(sqliteQuery.parameters).toEqual(['"search term"', 1]);
  });

  it('supports existential condition methods on joined and aggregated queries', () => {
    const qb = createQueryCompiler(postgresDialect);
    const subquery = qb.selectFrom(trustedTable('blacklists')).select(['user_id']).where('active', '=', true);

    const q = qb
      .selectFrom(trustedTable('users'))
      .innerJoin(trustedTable('orders'), 'orders', [{ leftCol: 'users.id', rightCol: 'orders.user_id' }])
      .count('orders.id', 'order_cnt')
      .whereNotExists(subquery)
      .andWhereExists(qb.selectFrom(trustedTable('verifications')).where('verified', '=', true))
      .groupBy('users.id')
      .compile();

    expect(q.text).toBe(
      'SELECT COUNT("orders"."id") AS "order_cnt" ' +
        'FROM "users" INNER JOIN "orders" ON "users"."id" = "orders"."user_id" ' +
        'WHERE NOT EXISTS (SELECT "user_id" FROM "blacklists" WHERE "active" = $1) ' +
        'AND EXISTS (SELECT * FROM "verifications" WHERE "verified" = $2) ' +
        'GROUP BY "users"."id"',
    );
    expect(q.parameters).toEqual([true, true]);
  });

  it('maintains builder immutability across all method calls', () => {
    const qb = createQueryCompiler(postgresDialect);
    const base = qb.selectFrom(trustedTable('users'));

    const joined = base.innerJoin(trustedTable('orders'), 'orders', [
      { leftCol: 'users.id', rightCol: 'orders.user_id' },
    ]);
    const aggregated = base.count('id', 'total_users');
    const filtered = base.where('active', '=', true);
    const fts = base.whereMatch('bio', 'engineer');

    // Confirm that base builder is untouched
    expect(base.compile().text).toBe('SELECT * FROM "users"');
    expect(joined.compile().text).toBe(
      'SELECT * FROM "users" INNER JOIN "orders" ON "users"."id" = "orders"."user_id"',
    );
    expect(aggregated.compile().text).toBe('SELECT COUNT("id") AS "total_users" FROM "users"');
    expect(filtered.compile().text).toBe('SELECT * FROM "users" WHERE "active" = $1');
    expect(fts.compile().text).toBe(
      'SELECT * FROM "users" WHERE to_tsvector(\'english\', "bio") @@ to_tsquery(\'english\', $1)',
    );
  });
});
