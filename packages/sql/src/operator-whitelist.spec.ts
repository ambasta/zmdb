import { describe, it, expect } from 'vitest';

import { aggregateSelectFrom } from './aggregations/index.js';
import { ftsSelectFrom } from './fts/index.js';
import { createQueryCompiler, InvalidOperatorError, sqlOperator, type Operator } from './index.js';
import { mysqlDialect, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

describe('Centralized Dialect-Aware Operator Whitelist Validation', () => {
  const qcPostgres = createQueryCompiler(postgresDialect);
  const qcSqlite = createQueryCompiler(sqliteDialect);
  const qcMysql = createQueryCompiler(mysqlDialect);

  describe('Core Query Compiler Whitelist & Keyword Normalization', () => {
    it('compiles standard valid comparison and symbolic operators', () => {
      const q = qcPostgres
        .selectFrom('products')
        .where('price', '>=', 100)
        .andWhere('stock', '<', 10)
        .andWhere('status', '!=', 'archived')
        .compile();

      expect(q.text).toBe('SELECT * FROM "products" WHERE "price" >= $1 AND "stock" < $2 AND "status" != $3');
      expect(q.parameters).toEqual([100, 10, 'archived']);
    });

    it('normalizes approved string operators to standardized uppercase SQL keywords', () => {
      const q = qcPostgres
        .selectFrom('users')
        .where('name', 'like', '%alice%')
        .andWhere('email', 'ilike', '%@example.com')
        .andWhere('role', 'in', ['admin', 'manager'])
        .andWhere('deleted_at', 'is null', null)
        .compile();

      expect(q.text).toBe(
        'SELECT * FROM "users" WHERE "name" LIKE $1 AND "email" ILIKE $2 AND "role" IN ($3, $4) AND "deleted_at" IS NULL',
      );
      expect(q.parameters).toEqual(['%alice%', '%@example.com', 'admin', 'manager']);
    });

    it('handles operator arity correctly for nullary (IS NULL) and range (BETWEEN) operators', () => {
      const qNull = qcPostgres.selectFrom('users').where('deleted_at', 'is null', null).compile();
      expect(qNull.text).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NULL');
      expect(qNull.parameters).toEqual([]);

      const qNotNull = qcPostgres.selectFrom('users').where('deleted_at', 'is not null', null).compile();
      expect(qNotNull.text).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NOT NULL');
      expect(qNotNull.parameters).toEqual([]);

      const qBetween = qcPostgres.selectFrom('users').where('age', 'between', [18, 65]).compile();
      expect(qBetween.text).toBe('SELECT * FROM "users" WHERE "age" BETWEEN $1 AND $2');
      expect(qBetween.parameters).toEqual([18, 65]);
    });

    it('enforces dialect-specific operator restrictions', () => {
      // Postgres-specific operators allowed on postgres
      const qPg = qcPostgres
        .selectFrom('events')
        .where('tags', '@>', ['security', 'audit'])
        .andWhere('metadata', '?', 'session_id')
        .andWhere('title', 'ilike', '%login%')
        .compile();
      expect(qPg.text).toBe('SELECT * FROM "events" WHERE "tags" @> $1 AND "metadata" ? $2 AND "title" ILIKE $3');

      // MySQL-specific operators allowed on mysql
      const qMy = qcMysql.selectFrom('users').where('name', 'rlike', '^A.*').compile();
      expect(qMy.text).toBe('SELECT * FROM `users` WHERE `name` RLIKE ?');

      // SQLite-specific operators allowed on sqlite
      const qSq = qcSqlite.selectFrom('files').where('path', 'glob', '*.ts').compile();
      expect(qSq.text).toBe('SELECT * FROM "files" WHERE "path" GLOB ?');

      // Disallowed on sqlite: placeholder collisions (?) and token-breaking shapes
      expect(() =>
        qcSqlite
          .selectFrom('events')
          .where('metadata', '?' as Operator, 'key')
          .compile(),
      ).toThrow(InvalidOperatorError);
      expect(() =>
        qcSqlite
          .selectFrom('events')
          .where('tags', ' @>' as Operator, ['a'])
          .compile(),
      ).toThrow(InvalidOperatorError);
      expect(() =>
        qcSqlite
          .selectFrom('events')
          .where('tags', '#>>' as Operator, ['a'])
          .compile(),
      ).toThrow(InvalidOperatorError);

      // Disallowed on mysql: ? (placeholder conflict)
      expect(() =>
        qcMysql
          .selectFrom('events')
          .where('metadata', '?' as Operator, 'key')
          .compile(),
      ).toThrow(InvalidOperatorError);
      expect(() =>
        qcMysql
          .selectFrom('users')
          .where('name', 'ilike --' as Operator, '%a%')
          .compile(),
      ).toThrow(InvalidOperatorError);
    });

    it('rejects invalid or unapproved operator strings in SELECT queries', () => {
      expect(() => {
        qcPostgres
          .selectFrom('users')
          .where('id', '= 1 OR 1=1 --' as unknown as Operator, 1)
          .compile();
      }).toThrow(InvalidOperatorError);

      try {
        qcPostgres
          .selectFrom('users')
          .where('id', '= 1 OR 1=1 --' as unknown as Operator, 1)
          .compile();
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidOperatorError);
        expect((err as InvalidOperatorError).operator).toBe('= 1 OR 1=1 --');
      }
    });

    it('rejects unapproved operator strings in UPDATE queries', () => {
      expect(() => {
        qcPostgres
          .updateTable('users')
          .set({ role: 'admin' })
          .where('id', 'in; DROP TABLE users' as unknown as Operator, [1])
          .compile();
      }).toThrow(InvalidOperatorError);
    });

    it('rejects unapproved operator strings in DELETE queries', () => {
      expect(() => {
        qcPostgres
          .deleteFrom('users')
          .where('id', 'IS NOT NULL OR 1=1 --' as unknown as Operator, null)
          .compile();
      }).toThrow(InvalidOperatorError);
    });

    it('guards runtime non-string input boundaries', () => {
      expect(() => sqlOperator(123 as unknown as string, postgresDialect)).toThrow(InvalidOperatorError);
    });
  });

  describe('Aggregation Query Compiler Whitelist Validation', () => {
    it('normalizes valid operators in aggregation where and having clauses', () => {
      const q = aggregateSelectFrom('orders', postgresDialect)
        .select(['user_id'])
        .count('id', 'total_orders')
        .where('status', 'in', ['completed', 'shipped'])
        .groupBy('user_id')
        .having('count(id)', '>', 5)
        .compile();

      expect(q.text).toBe(
        'SELECT "user_id", COUNT("id") AS "total_orders" FROM "orders" WHERE "status" IN ($1, $2) GROUP BY "user_id" HAVING "count(id)" > $3',
      );
      expect(q.parameters).toEqual(['completed', 'shipped', 5]);
    });

    it('rejects unapproved operators in aggregation where clauses', () => {
      expect(() => {
        aggregateSelectFrom('orders', postgresDialect)
          .select(['user_id'])
          .where('status', 'COMPLETED"; DROP TABLE orders; --' as unknown as Operator, 'val')
          .compile();
      }).toThrow(InvalidOperatorError);
    });

    it('rejects unapproved operators in aggregation having clauses', () => {
      expect(() => {
        aggregateSelectFrom('orders', postgresDialect)
          .select(['user_id'])
          .groupBy('user_id')
          .having('total', '> 0 OR 1=1' as unknown as Operator, 100)
          .compile();
      }).toThrow(InvalidOperatorError);
    });
  });

  describe('Full-Text Search Compiler Whitelist Validation', () => {
    it('normalizes valid operators in full-text search additional filters', () => {
      const q = ftsSelectFrom('articles', postgresDialect)
        .whereMatch('content', 'search term')
        .where('category', 'like', 'tech%')
        .compile();

      expect(q.text).toBe(
        `SELECT * FROM "articles" WHERE to_tsvector('english', "content") @@ to_tsquery('english', $1) AND "category" LIKE $2`,
      );
      expect(q.parameters).toEqual(['search term', 'tech%']);
    });

    it('rejects unapproved operators in full-text search where conditions', () => {
      expect(() => {
        ftsSelectFrom('articles', postgresDialect)
          .whereMatch('content', 'search term')
          .where('views', '>= 0; DELETE FROM articles; --' as unknown as Operator, 0)
          .compile();
      }).toThrow(InvalidOperatorError);
    });
  });

  describe('Structural Subquery Operators Whitelist Validation', () => {
    it('validates EXISTS and NOT EXISTS subquery operators', () => {
      const sub = qcPostgres.selectFrom('orders').where('amount', '>', 50);
      const q1 = qcPostgres.selectFrom('users').whereExists(sub).compile();
      expect(q1.text).toBe('SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "orders" WHERE "amount" > $1)');

      const q2 = qcPostgres.selectFrom('users').whereNotExists(sub).compile();
      expect(q2.text).toBe('SELECT * FROM "users" WHERE NOT EXISTS (SELECT * FROM "orders" WHERE "amount" > $1)');
    });

    it('rejects unapproved subquery operators', () => {
      const sub = qcPostgres.selectFrom('orders').where('amount', '>', 50);
      expect(() => {
        qcPostgres
          .selectFrom('users')
          .where('id', 'INVALID_OP' as unknown as Operator, sub)
          .compile();
      }).toThrow(InvalidOperatorError);
    });
  });
});
