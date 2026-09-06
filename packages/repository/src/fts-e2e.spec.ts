import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/compiler/testing';
import type { Fts, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePostgres } from '../../postgres/src/testing/fixture.js';
import { BaseRepository } from './index.js';

const pg = usePostgres(async pool => {
  await pool.query('DROP TABLE IF EXISTS fts_docs');
  await pool.query('CREATE TABLE fts_docs (id INT PRIMARY KEY, company_name TEXT NOT NULL)');
  await pool.query(
    `INSERT INTO fts_docs (id, company_name) VALUES
      (1, 'Acme Trading Ltd'), (2, 'Globex Corporation'), (3, 'Initech Ltd'), (4, 'Umbrella Foods')`,
  );
});

// `Fts<'fts_docs_fts'>` names the shadow table SQLite searches through. The pair below is
// the same three columns twice, differing only in that tag, because "does full-text search
// refuse a table that has not declared one" is a question about the declaration.
export interface Doc extends Table<'fts_docs'>, Fts<'fts_docs_fts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  company_name: string & Sql<'text'>;
}

export interface PlainDoc extends Table<'fts_docs'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  company_name: string & Sql<'text'>;
}

const { Doc: DocSchema, PlainDoc: PlainDocSchema } = schemasFrom<{ Doc: Doc; PlainDoc: PlainDoc }>(import.meta.url, [
  'Doc',
  'PlainDoc',
]);

class DocRepository extends BaseRepository<Doc> {
  static override readonly schema = DocSchema;
}

class PlainDocRepository extends BaseRepository<PlainDoc> {
  static override readonly schema = PlainDocSchema;
}

/**
 * The claim both engines have to satisfy: 'ltd' matches the two Ltd companies and
 * nothing else. Postgres answers it through `to_tsquery`, SQLite through an FTS5
 * virtual-table join — one call, one answer, which is the point of asserting it
 * on both rather than trusting the compiler's dialect branch.
 */
async function expectLtdMatches(repo: DocRepository) {
  const hits = await repo.findByFullText('company_name', 'ltd');
  expect(hits.map(r => r.company_name).toSorted()).toEqual(['Acme Trading Ltd', 'Initech Ltd']);
}

describe('FTS repository integration (real Postgres)', () => {
  it('findByFullText returns rows matching the term', async () => {
    if (!pg.reachable()) {
      console.warn('[skip] Postgres not reachable');
      return;
    }
    await expectLtdMatches(new DocRepository(pg.driver(), 'postgres'));
  });

  it('findByFullText excludes non-matching rows', async () => {
    if (!pg.reachable()) return;
    const repo = new DocRepository(pg.driver(), 'postgres');
    const hits = await repo.findByFullText('company_name', 'globex');
    expect(hits.map(r => r.company_name)).toEqual(['Globex Corporation']);
  });
});

describe('FTS repository integration (real SQLite with FTS5)', () => {
  let sqliteDb: DatabaseSync;
  let repo: DocRepository;

  beforeEach(() => {
    sqliteDb = new DatabaseSync(':memory:');
    sqliteDb.exec('CREATE TABLE fts_docs (id INTEGER PRIMARY KEY, company_name TEXT NOT NULL)');
    sqliteDb.exec('CREATE VIRTUAL TABLE fts_docs_fts USING fts5(company_name, content="fts_docs", content_rowid="id")');
    sqliteDb.exec(
      `INSERT INTO fts_docs (id, company_name) VALUES
        (1, 'Acme Trading Ltd'), (2, 'Globex Corporation'), (3, 'Initech Ltd'), (4, 'Umbrella Foods (Special - 100%)')`,
    );
    sqliteDb.exec('INSERT INTO fts_docs_fts(rowid, company_name) SELECT id, company_name FROM fts_docs');
    repo = new DocRepository(sqliteDriver(sqliteDb), 'sqlite');
  });

  it('findByFullText returns rows matching the term via FTS5 virtual table join', async () => {
    await expectLtdMatches(repo);
  });

  it('findByFullText handles search query containing special characters without syntax errors', async () => {
    const hits = await repo.findByFullText('company_name', 'Special - 100% (Foods) : "Umbrella" + * AND NOT');
    // Should execute safely without SQLite syntax error.
    expect(Array.isArray(hits)).toBe(true);
  });

  it('findByFullText works with dot-qualified column names', async () => {
    const hits = await repo.findByFullText('fts_docs.company_name', 'globex');
    expect(hits.map(r => r.company_name)).toEqual(['Globex Corporation']);
  });

  it('findByFullText on plain SQLite table without ftsTable declared throws UnsupportedFeatureError', async () => {
    const plainRepo = new PlainDocRepository(sqliteDriver(sqliteDb), 'sqlite');
    await expect(plainRepo.findByFullText('company_name', 'ltd')).rejects.toThrow(
      'full-text search is not supported on dialect "sqlite"',
    );
  });
});
