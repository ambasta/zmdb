import { DatabaseSync } from 'node:sqlite';

import type { CoreSchema } from '@zmdb/schema-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository, type Driver } from './index.ts';

const CONN = process.env.ZMDB_PG || 'postgres://postgres:postgres@localhost:55432/bench';

let pool: Pool | undefined;
let reachable = false;

beforeAll(async () => {
  try {
    pool = new Pool({ connectionString: CONN, max: 2 });
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS fts_docs');
    await pool.query('CREATE TABLE fts_docs (id INT PRIMARY KEY, company_name TEXT NOT NULL)');
    await pool.query(
      `INSERT INTO fts_docs (id, company_name) VALUES
        (1, 'Acme Trading Ltd'), (2, 'Globex Corporation'), (3, 'Initech Ltd'), (4, 'Umbrella Foods')`,
    );
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await pool?.end();
});

const DocSchema = {
  table: 'fts_docs',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    company_name: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'fts_docs'>;

class DocRepository extends BaseRepository<typeof DocSchema> {
  static override readonly schema = DocSchema;
}

function pgDriver(p: Pool): Driver {
  return { execute: async q => (await p.query(q.text, q.parameters as unknown[])).rows };
}

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as Parameters<typeof stmt.all>;
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}

describe('FTS repository integration (real Postgres)', () => {
  it('findByFullText returns rows matching the term', async () => {
    if (!reachable) {
      console.warn('[skip] Postgres not reachable at ' + CONN);
      return;
    }
    const repo = new DocRepository(pgDriver(pool!), 'postgres');
    const hits = await repo.findByFullText('company_name', 'ltd');
    const names = hits.map(r => r.company_name).toSorted();
    // 'Acme Trading Ltd' and 'Initech Ltd' match 'ltd'; others do not.
    expect(names).toEqual(['Acme Trading Ltd', 'Initech Ltd']);
  });

  it('findByFullText excludes non-matching rows', async () => {
    if (!reachable) return;
    const repo = new DocRepository(pgDriver(pool!), 'postgres');
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
});
