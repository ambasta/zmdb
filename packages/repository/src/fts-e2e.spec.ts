import { DatabaseSync } from 'node:sqlite';

import type { CoreSchema } from '@zmdb/schema-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { sqliteDriver } from './drivers/sqlite.ts';
import { BaseRepository } from './index.ts';
import { usePostgres } from './pg-fixture.ts';

const pg = usePostgres(async pool => {
  await pool.query('DROP TABLE IF EXISTS fts_docs');
  await pool.query('CREATE TABLE fts_docs (id INT PRIMARY KEY, company_name TEXT NOT NULL)');
  await pool.query(
    `INSERT INTO fts_docs (id, company_name) VALUES
      (1, 'Acme Trading Ltd'), (2, 'Globex Corporation'), (3, 'Initech Ltd'), (4, 'Umbrella Foods')`,
  );
});

const docColumns = {
  id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  company_name: { type: 'text', flags: { nullable: false } },
};

const DocSchema = {
  table: 'fts_docs',
  columns: docColumns,
  primaryKey: ['id'],
  references: [],
  ftsTable: 'fts_docs_fts',
} as unknown as CoreSchema<'fts_docs'>;

// The same table with no `ftsTable`, which is what makes full-text search refuse.
const PlainDocSchema = {
  table: 'fts_docs',
  columns: docColumns,
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'fts_docs'>;

class DocRepository extends BaseRepository<typeof DocSchema> {
  static override readonly schema = DocSchema;
}

class PlainDocRepository extends BaseRepository<typeof PlainDocSchema> {
  static override readonly schema = PlainDocSchema;
}

describe('FTS repository integration (real Postgres)', () => {
  it('findByFullText returns rows matching the term', async () => {
    if (!pg.reachable()) {
      console.warn('[skip] Postgres not reachable');
      return;
    }
    const repo = new DocRepository(pg.driver(), 'postgres');
    const hits = await repo.findByFullText('company_name', 'ltd');
    const names = hits.map(r => r.company_name).toSorted();
    // 'Acme Trading Ltd' and 'Initech Ltd' match 'ltd'; others do not.
    expect(names).toEqual(['Acme Trading Ltd', 'Initech Ltd']);
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
    const hits = await repo.findByFullText('company_name', 'ltd');
    const names = hits.map(r => r.company_name).toSorted();
    expect(names).toEqual(['Acme Trading Ltd', 'Initech Ltd']);
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
