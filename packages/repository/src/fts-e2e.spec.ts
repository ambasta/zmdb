import type { CoreSchema } from '@zmdb/schema-core';
import { Pool } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { BaseRepository, type Driver } from './index.ts';

// #96: full-text search repository integration + E2E on REAL PostgreSQL.
// (SQLite has no arbitrary-column FTS — that path is an honest DNF — so this
// E2E requires real Postgres, per the benchmark methodology.)

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
