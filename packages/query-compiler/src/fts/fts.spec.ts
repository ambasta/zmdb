import { describe, expect, it } from 'vitest';

import { escapeFts5Term, ftsSelectFrom } from './index.ts';

describe('full-text search compilation', () => {
  it('postgres to_tsvector/@@/to_tsquery (parameterized)', () => {
    const q = ftsSelectFrom('customers', 'postgres').whereMatch('company_name', 'ltd').compile();
    expect(q.text).toBe(
      `SELECT * FROM "customers" WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)`,
    );
    expect(q.parameters).toEqual(['ltd']);
  });

  it('mysql MATCH ... AGAINST', () => {
    const q = ftsSelectFrom('customers', 'mysql').whereMatch('company_name', 'ltd').compile();
    expect(q.text).toBe('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(? IN NATURAL LANGUAGE MODE)');
  });

  it('sqlite FTS5 virtual table join compilation (golden SQL)', () => {
    const q = ftsSelectFrom('customers', 'sqlite').whereMatch('company_name', 'ltd').compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" INNER JOIN "customers_fts" ON "customers"."rowid" = "customers_fts"."rowid" WHERE "customers_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });

  it('sqlite FTS5 escapes special characters and punctuation', () => {
    const rawTerm = 'foo-bar (baz) : 100% "quoted" AND or NOT + * ~ ^';
    const q = ftsSelectFrom('customers', 'sqlite').whereMatch('company_name', rawTerm).compile();
    expect(q.parameters).toEqual(['"foo-bar (baz) : 100% ""quoted"" AND or NOT + * ~ ^"']);
    expect(escapeFts5Term('hello "world"')).toBe('"hello ""world"""');
  });

  it('sqlite FTS5 supports dot-qualified column identifiers', () => {
    const q = ftsSelectFrom('customers', 'sqlite').whereMatch('customers.company_name', 'ltd').compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" INNER JOIN "customers_fts" ON "customers"."rowid" = "customers_fts"."rowid" WHERE "customers_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });

  it('sqlite FTS5 supports table aliasing', () => {
    const q = ftsSelectFrom('customers AS c', 'sqlite').whereMatch('c.company_name', 'ltd').compile();
    expect(q.text).toBe(
      'SELECT * FROM "customers" AS "c" INNER JOIN "customers_fts" AS "c_fts" ON "c"."rowid" = "c_fts"."rowid" WHERE "c_fts"."company_name" MATCH ?',
    );
    expect(q.parameters).toEqual(['"ltd"']);
  });
});
