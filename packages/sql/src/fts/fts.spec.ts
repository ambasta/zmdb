import { trustedTable, createQueryCompiler, escapeFts5Term, UnsupportedFeatureError } from '@zmdb/sql';
import { describe, expect, it } from 'vitest';

import {
  mysqlDialect,
  postgresDialect,
  singlestoreDialect,
  sqliteDialect,
} from '../testing/official-dialects.fixture.js';
import { QueryPostSchema } from '../testing/query-schema.fixture.js';

describe('full-text search compilation', () => {
  it('postgres to_tsvector/@@/to_tsquery (parameterized)', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('customers'))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(q.text).toBe(
      `SELECT * FROM "customers" WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)`,
    );
    expect(q.parameters).toEqual(['ltd']);
  });

  it('mysql MATCH ... AGAINST', () => {
    const q = createQueryCompiler(mysqlDialect)
      .selectFrom(trustedTable('customers'))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(q.text).toBe('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(? IN NATURAL LANGUAGE MODE)');
  });

  it('singlestore MATCH ... AGAINST omits MySQL natural-language mode', () => {
    const q = createQueryCompiler(singlestoreDialect)
      .selectFrom(trustedTable('customers'))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(q.text).toBe('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(?)');
    expect(q.parameters).toEqual(['ltd']);
  });

  it('sqlite whereMatch on plain column throws UnsupportedFeatureError', () => {
    expect(() =>
      createQueryCompiler(sqliteDialect)
        .selectFrom(trustedTable('customers'))
        .whereMatch('company_name', 'ltd')
        .compile(),
    ).toThrow(UnsupportedFeatureError);
  });

  it('sqlite FTS5 virtual table join compilation with explicit ftsTable option (golden SQL)', () => {
    const q = createQueryCompiler(sqliteDialect)
      .selectFrom(trustedTable('customers', { ftsTable: 'customers_fts' }))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" INNER JOIN "customers_fts" ON "customers"."rowid" = "customers_fts"."rowid" WHERE "customers_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });

  it('sqlite FTS5 escapes special characters and punctuation when ftsTable enabled', () => {
    const rawTerm = 'foo-bar (baz) : 100% "quoted" AND or NOT + * ~ ^';
    const q = createQueryCompiler(sqliteDialect)
      .selectFrom(trustedTable('customers', { ftsTable: true }))
      .whereMatch('company_name', rawTerm)
      .compile();
    expect(q.parameters).toEqual(['"foo-bar (baz) : 100% ""quoted"" AND or NOT + * ~ ^"']);
    expect(escapeFts5Term('hello "world"')).toBe('"hello ""world"""');
  });

  it('sqlite FTS5 supports dot-qualified column identifiers with ftsTable option', () => {
    const q = createQueryCompiler(sqliteDialect)
      .selectFrom(trustedTable('customers', { ftsTable: 'customers_fts' }))
      .whereMatch('customers.company_name', 'ltd')
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" INNER JOIN "customers_fts" ON "customers"."rowid" = "customers_fts"."rowid" WHERE "customers_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });

  it('sqlite FTS5 supports table aliasing with ftsTable option', () => {
    const q = createQueryCompiler(sqliteDialect)
      .selectFrom(trustedTable('customers AS c', { ftsTable: 'customers_fts' }))
      .whereMatch('c.company_name', 'ltd')
      .compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" AS "c" INNER JOIN "customers_fts" AS "c_fts" ON "c"."rowid" = "c_fts"."rowid" WHERE "c_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });

  it('keeps telemetry absent from the default compiled query', () => {
    const q = createQueryCompiler(postgresDialect)
      .selectFrom(trustedTable('customers'))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(Object.keys(q)).toEqual(['text', 'parameters', 'operation', 'isWrite', 'returnsRows']);
    expect(q.telemetry).toBeUndefined();
  });

  it('attaches the compile-known SELECT and primary table when opted in', () => {
    const q = createQueryCompiler(postgresDialect, { telemetry: true })
      .selectFrom(trustedTable('customers'))
      .whereMatch('company_name', 'ltd')
      .compile();
    expect(q.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'customers',
    });
  });
});

it('composes FTS, projection, predicates and ordering on the canonical schema builder', () => {
  const query = createQueryCompiler(postgresDialect)
    .selectFrom(QueryPostSchema)
    .select(['id'])
    .whereMatch('title', 'orm')
    .where('views', '>', 10)
    .orderBy('id', 'asc');
  expect(query.compile()).toEqual({
    text: `SELECT "post_id" AS "id" FROM "blog_posts" WHERE to_tsvector('english', "post_title") @@ to_tsquery('english', $1) AND "view_count" > $2 ORDER BY "post_id" ASC`,
    parameters: ['orm', 10],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
  expect(
    createQueryCompiler(sqliteDialect)
      .selectFrom(QueryPostSchema)
      .select(['id'])
      .whereMatch('title', 'orm')
      .where('views', '>', 10)
      .orderBy('id', 'asc')
      .compile(),
  ).toEqual({
    text: 'SELECT "blog_posts"."post_id" AS "id" FROM "blog_posts" INNER JOIN "blog_search" ON "blog_posts"."rowid" = "blog_search"."rowid" WHERE "blog_search"."post_title" MATCH ? AND "blog_posts"."view_count" > ? ORDER BY "blog_posts"."post_id" ASC',
    parameters: ['"orm"', 10],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
});

it('qualifies the default root projection and earlier predicates for a generated FTS join', () => {
  const query = createQueryCompiler(sqliteDialect)
    .selectFrom(QueryPostSchema)
    .where('views', '>', 0)
    .whereMatch('title', 'orm');
  expect(query.compile()).toEqual({
    text: 'SELECT "blog_posts"."post_id" AS "id", "blog_posts"."author_id" AS "userId", "blog_posts"."post_title" AS "title", "blog_posts"."view_count" AS "views" FROM "blog_posts" INNER JOIN "blog_search" ON "blog_posts"."rowid" = "blog_search"."rowid" WHERE "blog_posts"."view_count" > ? AND "blog_search"."post_title" MATCH ?',
    parameters: [0, '"orm"'],
    operation: 'select',
    isWrite: false,
    returnsRows: true,
  });
});
