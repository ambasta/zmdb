import { emitUp } from '@zmdb/migrations';
import { describe, expect, it } from 'vitest';

import { aggregateSelectFrom } from './aggregations/index.js';
import { ftsSelectFrom } from './fts/index.js';
import { createQueryCompiler } from './index.js';
import { joinableSelectFrom } from './joins/index.js';
import { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable, renumberPlaceholders } from './quoting.js';
import {
  createIndexDdl,
  createPolicyDdl,
  createSchemaDdl,
  createSequenceDdl,
  createViewDdl,
  quoteId,
} from './schema-objects/index.js';
import { mysqlDialect, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

describe('Centralized Identifier Quoting Engine', () => {
  describe('quoteIdentifier', () => {
    it('quotes basic identifiers for PostgreSQL and SQLite using double quotes', () => {
      expect(quoteIdentifier(postgresDialect, 'users')).toBe('"users"');
      expect(quoteIdentifier(sqliteDialect, 'users')).toBe('"users"');
    });

    it('quotes basic identifiers for MySQL using backticks', () => {
      expect(quoteIdentifier(mysqlDialect, 'users')).toBe('`users`');
    });

    it('escapes internal double quotes in PostgreSQL and SQLite identifiers', () => {
      expect(quoteIdentifier(postgresDialect, 'usr"tbl')).toBe('"usr""tbl"');
      expect(quoteIdentifier(sqliteDialect, 'usr"tbl')).toBe('"usr""tbl"');
      expect(quoteIdentifier(postgresDialect, 'a"b"c')).toBe('"a""b""c"');
    });

    it('quoteId is the same function under the name the schema-object DDL publishes', () => {
      // Two exported names for one behaviour is two places a fix can land, so this pins them
      // together: `quoteId` is what a caller writing DDL by hand reaches for, and if it ever
      // stops agreeing with the engine every generated identifier is quoted twice over.
      for (const dialect of [postgresDialect, mysqlDialect, sqliteDialect] as const) {
        for (const id of ['users', 'usr"tbl', 'usr`tbl', 'a b', 'users"; DROP TABLE users; --']) {
          expect(quoteId(dialect, id)).toBe(quoteIdentifier(dialect, id));
        }
      }
    });

    it('escapes internal backticks in MySQL identifiers', () => {
      expect(quoteIdentifier(mysqlDialect, 'usr`tbl')).toBe('`usr``tbl`');
      expect(quoteIdentifier(mysqlDialect, 'a`b`c')).toBe('`a``b``c`');
    });

    it('prevents SQL injection through quote breakout in single identifiers', () => {
      const injectionPg = 'users"; DROP TABLE users; --';
      expect(quoteIdentifier(postgresDialect, injectionPg)).toBe('"users""; DROP TABLE users; --"');

      const injectionMySql = 'users`; DROP TABLE users; --';
      expect(quoteIdentifier(mysqlDialect, injectionMySql)).toBe('`users``; DROP TABLE users; --`');
    });
  });

  describe('quoteColumn', () => {
    it('quotes simple columns', () => {
      expect(quoteColumn(postgresDialect, 'email')).toBe('"email"');
      expect(quoteColumn(mysqlDialect, 'email')).toBe('`email`');
    });

    it('splits and individually quotes dot-qualified column references', () => {
      expect(quoteColumn(postgresDialect, 'users.email')).toBe('"users"."email"');
      expect(quoteColumn(postgresDialect, 'public.users.email')).toBe('"public"."users"."email"');
      expect(quoteColumn(mysqlDialect, 'users.email')).toBe('`users`.`email`');
      expect(quoteColumn(mysqlDialect, 'mydb.users.email')).toBe('`mydb`.`users`.`email`');
    });

    it('preserves wildcard * without quoting', () => {
      expect(quoteColumn(postgresDialect, '*')).toBe('*');
      expect(quoteColumn(postgresDialect, 'users.*')).toBe('"users".*');
      expect(quoteColumn(mysqlDialect, 'users.*')).toBe('`users`.*');
    });

    it('escapes internal quote characters in dot-qualified references', () => {
      expect(quoteColumn(postgresDialect, 'usr"tbl.col"name')).toBe('"usr""tbl"."col""name"');
      expect(quoteColumn(mysqlDialect, 'usr`tbl.col`name')).toBe('`usr``tbl`.`col``name`');
    });
  });

  describe('quoteTable', () => {
    it('quotes simple and dot-qualified table names', () => {
      expect(quoteTable(postgresDialect, 'users')).toBe('"users"');
      expect(quoteTable(postgresDialect, 'public.users')).toBe('"public"."users"');
      expect(quoteTable(mysqlDialect, 'users')).toBe('`users`');
      expect(quoteTable(mysqlDialect, 'mydb.users')).toBe('`mydb`.`users`');
    });

    it('parses and quotes table aliasing syntax with as/AS using various whitespace characters', () => {
      expect(quoteTable(postgresDialect, 'users as u')).toBe('"users" AS "u"');
      expect(quoteTable(postgresDialect, 'public.users AS u')).toBe('"public"."users" AS "u"');
      expect(quoteTable(postgresDialect, 'users\fas\fu')).toBe('"users" AS "u"');
      expect(quoteTable(mysqlDialect, 'users as u')).toBe('`users` AS `u`');
      expect(quoteTable(mysqlDialect, 'mydb.users AS u')).toBe('`mydb`.`users` AS `u`');
    });

    it('escapes quote characters in aliased table expressions', () => {
      expect(quoteTable(postgresDialect, 'usr"tbl as u"al')).toBe('"usr""tbl" AS "u""al"');
      expect(quoteTable(mysqlDialect, 'usr`tbl as u`al')).toBe('`usr``tbl` AS `u``al`');
    });

    it('handles long inputs with excessive whitespace in linear time without ReDoS', () => {
      const longPayload = 'users' + ' '.repeat(50000) + 'AS' + ' '.repeat(50000) + 'u';
      expect(quoteTable(postgresDialect, longPayload)).toBe('"users" AS "u"');
    });
  });

  describe('formatPlaceholder', () => {
    it('generates numbered $n placeholders for postgres', () => {
      expect(formatPlaceholder(postgresDialect, 1)).toBe('$1');
      expect(formatPlaceholder(postgresDialect, 5)).toBe('$5');
    });

    it('generates positional ? placeholders for mysql and sqlite', () => {
      expect(formatPlaceholder(mysqlDialect, 1)).toBe('?');
      expect(formatPlaceholder(sqliteDialect, 3)).toBe('?');
    });
  });

  describe('renumberPlaceholders', () => {
    it('renumbers $n placeholders by applying offset', () => {
      const sql = 'SELECT * FROM "users" WHERE "id" = $1 AND "tenant_id" = $2';
      expect(renumberPlaceholders(sql, 2, postgresDialect)).toBe(
        'SELECT * FROM "users" WHERE "id" = $3 AND "tenant_id" = $4',
      );
    });
  });

  describe('Compiler Submodules Security & Quoting Integration', () => {
    it('main query compiler escapes malicious inputs in table, columns, and wheres', () => {
      const payloadPg = 'users"; DROP TABLE users; --';
      const colPayloadPg = 'col"; DROP TABLE users; --';

      const q = createQueryCompiler(postgresDialect)
        .selectFrom(payloadPg)
        .select([colPayloadPg, 'public.user"s.email'])
        .where(colPayloadPg, '=', 'val')
        .orderBy(colPayloadPg, 'asc')
        .compile();

      expect(q.text).toBe(
        'SELECT "col""; DROP TABLE users; --", "public"."user""s"."email" FROM "users""; DROP TABLE users; --" WHERE "col""; DROP TABLE users; --" = $1 ORDER BY "col""; DROP TABLE users; --" ASC',
      );

      const payloadMySql = 'users`; DROP TABLE users; --';
      const colPayloadMySql = 'col`; DROP TABLE users; --';

      const qMySql = createQueryCompiler(mysqlDialect)
        .selectFrom(payloadMySql)
        .select([colPayloadMySql])
        .where(colPayloadMySql, '=', 'val')
        .compile();

      expect(qMySql.text).toBe(
        'SELECT `col``; DROP TABLE users; --` FROM `users``; DROP TABLE users; --` WHERE `col``; DROP TABLE users; --` = ?',
      );
    });

    it('joins module escapes malicious inputs in tables, aliases, and qualified columns', () => {
      const q = joinableSelectFrom('orders"tbl as o"alias', postgresDialect)
        .leftJoin('items"tbl as i"alias', 'o"alias.item"id', 'i"alias.id')
        .where('o"alias.status', '=', 'active')
        .compile();

      expect(q.text).toBe(
        'SELECT * FROM "orders""tbl" AS "o""alias" LEFT JOIN "items""tbl" AS "i""alias" ON "o""alias"."item""id" = "i""alias"."id" WHERE "o""alias"."status" = $1',
      );
    });

    it('aggregations module escapes malicious inputs in projection items and aliases', () => {
      const q = aggregateSelectFrom('sales"tbl', postgresDialect)
        .count('item"id', 'count"alias')
        .groupBy('region"col')
        .having('amount"col', '>', 100)
        .compile();

      expect(q.text).toBe(
        'SELECT COUNT("item""id") AS "count""alias" FROM "sales""tbl" GROUP BY "region""col" HAVING "amount""col" > $1',
      );
    });

    it('full-text search module escapes malicious inputs in search target columns', () => {
      const qPg = ftsSelectFrom('docs"tbl', postgresDialect).whereMatch('title"col', 'search_term').compile();

      expect(qPg.text).toBe(
        `SELECT * FROM "docs""tbl" WHERE to_tsvector('english', "title""col") @@ to_tsquery('english', $1)`,
      );

      const qMySql = ftsSelectFrom('docs`tbl', mysqlDialect).whereMatch('title`col', 'search_term').compile();

      expect(qMySql.text).toBe(
        'SELECT * FROM `docs``tbl` WHERE MATCH(`title``col`) AGAINST(? IN NATURAL LANGUAGE MODE)',
      );
    });

    it('migrations module escapes malicious identifiers in DDL generation', () => {
      const ddl = emitUp(
        {
          kind: 'create_table',
          table: 'user"s',
          columns: [{ name: 'col"name', type: 'TEXT', nullable: false, primaryKey: true }],
          primaryKey: ['col"name'],
          foreignKeys: [],
        },
        postgresDialect,
      );

      expect(ddl).toBe('CREATE TABLE "user""s" ("col""name" TEXT PRIMARY KEY)');
    });

    it('schema-objects module escapes malicious identifiers across DDL statements', () => {
      expect(createIndexDdl({ name: 'idx"1', table: 'tbl"1', columns: ['col"1', 'col"2'] }, postgresDialect)).toBe(
        'CREATE INDEX "idx""1" ON "tbl""1" ("col""1", "col""2")',
      );

      expect(createViewDdl({ name: 'v"iew', select: 'SELECT 1' }, postgresDialect)).toBe(
        'CREATE VIEW "v""iew" AS SELECT 1',
      );

      expect(createSequenceDdl({ name: 'seq"1' }, postgresDialect)).toBe('CREATE SEQUENCE "seq""1"');

      expect(createSchemaDdl('sch"ema', postgresDialect)).toBe('CREATE SCHEMA "sch""ema"');

      expect(createPolicyDdl({ name: 'pol"1', table: 'tbl"1', using: 'true' }, postgresDialect)).toBe(
        'CREATE POLICY "pol""1" ON "tbl""1" FOR ALL USING (true)',
      );
    });
  });
});
