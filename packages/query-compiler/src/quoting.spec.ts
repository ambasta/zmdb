import { describe, expect, it } from 'vitest';

import { aggregateSelectFrom } from './aggregations/index.ts';
import { ftsSelectFrom } from './fts/index.ts';
import { createQueryCompiler } from './index.ts';
import { joinableSelectFrom } from './joins/index.ts';
import { emitUp } from './migrations/index.ts';
import { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable, renumberPlaceholders } from './quoting.ts';
import {
  createIndexDdl,
  createPolicyDdl,
  createSchemaDdl,
  createSequenceDdl,
  createViewDdl,
} from './schema-objects/index.ts';

describe('Centralized Identifier Quoting Engine', () => {
  describe('quoteIdentifier', () => {
    it('quotes basic identifiers for PostgreSQL and SQLite using double quotes', () => {
      expect(quoteIdentifier('postgres', 'users')).toBe('"users"');
      expect(quoteIdentifier('sqlite', 'users')).toBe('"users"');
    });

    it('quotes basic identifiers for MySQL using backticks', () => {
      expect(quoteIdentifier('mysql', 'users')).toBe('`users`');
    });

    it('escapes internal double quotes in PostgreSQL and SQLite identifiers', () => {
      expect(quoteIdentifier('postgres', 'usr"tbl')).toBe('"usr""tbl"');
      expect(quoteIdentifier('sqlite', 'usr"tbl')).toBe('"usr""tbl"');
      expect(quoteIdentifier('postgres', 'a"b"c')).toBe('"a""b""c"');
    });

    it('escapes internal backticks in MySQL identifiers', () => {
      expect(quoteIdentifier('mysql', 'usr`tbl')).toBe('`usr``tbl`');
      expect(quoteIdentifier('mysql', 'a`b`c')).toBe('`a``b``c`');
    });

    it('prevents SQL injection through quote breakout in single identifiers', () => {
      const injectionPg = 'users"; DROP TABLE users; --';
      expect(quoteIdentifier('postgres', injectionPg)).toBe('"users""; DROP TABLE users; --"');

      const injectionMySql = 'users`; DROP TABLE users; --';
      expect(quoteIdentifier('mysql', injectionMySql)).toBe('`users``; DROP TABLE users; --`');
    });
  });

  describe('quoteColumn', () => {
    it('quotes simple columns', () => {
      expect(quoteColumn('postgres', 'email')).toBe('"email"');
      expect(quoteColumn('mysql', 'email')).toBe('`email`');
    });

    it('splits and individually quotes dot-qualified column references', () => {
      expect(quoteColumn('postgres', 'users.email')).toBe('"users"."email"');
      expect(quoteColumn('postgres', 'public.users.email')).toBe('"public"."users"."email"');
      expect(quoteColumn('mysql', 'users.email')).toBe('`users`.`email`');
      expect(quoteColumn('mysql', 'mydb.users.email')).toBe('`mydb`.`users`.`email`');
    });

    it('preserves wildcard * without quoting', () => {
      expect(quoteColumn('postgres', '*')).toBe('*');
      expect(quoteColumn('postgres', 'users.*')).toBe('"users".*');
      expect(quoteColumn('mysql', 'users.*')).toBe('`users`.*');
    });

    it('escapes internal quote characters in dot-qualified references', () => {
      expect(quoteColumn('postgres', 'usr"tbl.col"name')).toBe('"usr""tbl"."col""name"');
      expect(quoteColumn('mysql', 'usr`tbl.col`name')).toBe('`usr``tbl`.`col``name`');
    });
  });

  describe('quoteTable', () => {
    it('quotes simple and dot-qualified table names', () => {
      expect(quoteTable('postgres', 'users')).toBe('"users"');
      expect(quoteTable('postgres', 'public.users')).toBe('"public"."users"');
      expect(quoteTable('mysql', 'users')).toBe('`users`');
      expect(quoteTable('mysql', 'mydb.users')).toBe('`mydb`.`users`');
    });

    it('parses and quotes table aliasing syntax with as/AS', () => {
      expect(quoteTable('postgres', 'users as u')).toBe('"users" AS "u"');
      expect(quoteTable('postgres', 'public.users AS u')).toBe('"public"."users" AS "u"');
      expect(quoteTable('mysql', 'users as u')).toBe('`users` AS `u`');
      expect(quoteTable('mysql', 'mydb.users AS u')).toBe('`mydb`.`users` AS `u`');
    });

    it('escapes quote characters in aliased table expressions', () => {
      expect(quoteTable('postgres', 'usr"tbl as u"al')).toBe('"usr""tbl" AS "u""al"');
      expect(quoteTable('mysql', 'usr`tbl as u`al')).toBe('`usr``tbl` AS `u``al`');
    });
  });

  describe('formatPlaceholder', () => {
    it('generates stateful $n placeholders for postgres', () => {
      expect(formatPlaceholder('postgres', 1)).toBe('$1');
      expect(formatPlaceholder('postgres', 5)).toBe('$5');
    });

    it('generates stateless ? placeholders for mysql and sqlite', () => {
      expect(formatPlaceholder('mysql', 1)).toBe('?');
      expect(formatPlaceholder('sqlite', 3)).toBe('?');
    });
  });

  describe('renumberPlaceholders', () => {
    it('renumbers $n placeholders by applying offset', () => {
      const sql = 'SELECT * FROM "users" WHERE "id" = $1 AND "tenant_id" = $2';
      expect(renumberPlaceholders(sql, 2)).toBe('SELECT * FROM "users" WHERE "id" = $3 AND "tenant_id" = $4');
    });
  });

  describe('Compiler Submodules Security & Quoting Integration', () => {
    it('main query compiler escapes malicious inputs in table, columns, and wheres', () => {
      const payloadPg = 'users"; DROP TABLE users; --';
      const colPayloadPg = 'col"; DROP TABLE users; --';

      const q = createQueryCompiler('postgres')
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

      const qMySql = createQueryCompiler('mysql')
        .selectFrom(payloadMySql)
        .select([colPayloadMySql])
        .where(colPayloadMySql, '=', 'val')
        .compile();

      expect(qMySql.text).toBe(
        'SELECT `col``; DROP TABLE users; --` FROM `users``; DROP TABLE users; --` WHERE `col``; DROP TABLE users; --` = ?',
      );
    });

    it('joins module escapes malicious inputs in tables, aliases, and qualified columns', () => {
      const q = joinableSelectFrom('orders"tbl as o"alias', 'postgres')
        .leftJoin('items"tbl as i"alias', 'o"alias.item"id', 'i"alias.id')
        .where('o"alias.status', '=', 'active')
        .compile();

      expect(q.text).toBe(
        'SELECT * FROM "orders""tbl" AS "o""alias" LEFT JOIN "items""tbl" AS "i""alias" ON "o""alias"."item""id" = "i""alias"."id" WHERE "o""alias"."status" = $1',
      );
    });

    it('aggregations module escapes malicious inputs in projection items and aliases', () => {
      const q = aggregateSelectFrom('sales"tbl', 'postgres')
        .count('item"id', 'count"alias')
        .groupBy('region"col')
        .having('amount"col', '>', 100)
        .compile();

      expect(q.text).toBe(
        'SELECT COUNT("item""id") AS "count""alias" FROM "sales""tbl" GROUP BY "region""col" HAVING "amount""col" > $1',
      );
    });

    it('full-text search module escapes malicious inputs in search target columns', () => {
      const qPg = ftsSelectFrom('docs"tbl', 'postgres').whereMatch('title"col', 'search_term').compile();

      expect(qPg.text).toBe(
        `SELECT * FROM "docs""tbl" WHERE to_tsvector('english', "title""col") @@ to_tsquery('english', $1)`,
      );

      const qMySql = ftsSelectFrom('docs`tbl', 'mysql').whereMatch('title`col', 'search_term').compile();

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
        },
        'postgres',
      );

      expect(ddl).toBe('CREATE TABLE "user""s" ("col""name" TEXT PRIMARY KEY)');
    });

    it('schema-objects module escapes malicious identifiers across DDL statements', () => {
      expect(createIndexDdl({ name: 'idx"1', table: 'tbl"1', columns: ['col"1', 'col"2'] }, 'postgres')).toBe(
        'CREATE INDEX "idx""1" ON "tbl""1" ("col""1", "col""2")',
      );

      expect(createViewDdl({ name: 'v"iew', select: 'SELECT 1' }, 'postgres')).toBe('CREATE VIEW "v""iew" AS SELECT 1');

      expect(createSequenceDdl({ name: 'seq"1' }, 'postgres')).toBe('CREATE SEQUENCE "seq""1"');

      expect(createSchemaDdl('sch"ema', 'postgres')).toBe('CREATE SCHEMA "sch""ema"');

      expect(createPolicyDdl({ name: 'pol"1', table: 'tbl"1', using: 'true' }, 'postgres')).toBe(
        'CREATE POLICY "pol""1" ON "tbl""1" FOR ALL USING (true)',
      );
    });
  });
});
