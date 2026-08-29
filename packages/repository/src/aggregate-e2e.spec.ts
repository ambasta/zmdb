import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { BaseRepository, type Driver } from './index.ts';
import type { CoreSchema } from '@zmdb/schema-core';

// #92: aggregation repository integration + E2E on REAL PostgreSQL.

const CONN = process.env.ZMDB_PG || 'postgres://postgres:postgres@localhost:55432/bench';
let pool: pg.Pool | undefined;
let reachable = false;

beforeAll(async () => {
  try {
    pool = new pg.Pool({ connectionString: CONN, max: 2 });
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS agg_sales');
    await pool.query('CREATE TABLE agg_sales (id INT PRIMARY KEY, region TEXT NOT NULL, amount INT NOT NULL)');
    await pool.query(`INSERT INTO agg_sales (id,region,amount) VALUES
      (1,'north',10),(2,'north',20),(3,'south',5),(4,'south',5),(5,'south',15)`);
    reachable = true;
  } catch {
    reachable = false;
  }
});
afterAll(async () => { await pool?.end(); });

const SalesSchema = {
  table: 'agg_sales',
  columns: { id: { type: 'serial', flags: { nullable: false, primaryKey: true } } },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'agg_sales'>;
class SalesRepository extends BaseRepository<typeof SalesSchema> {
  static override readonly schema = SalesSchema;
}
const driver = (p: pg.Pool): Driver => ({ execute: async (q) => (await p.query(q.text, q.parameters as unknown[])).rows });

describe('aggregation repository integration (real Postgres)', () => {
  it('grouped count + sum returns typed computed columns', async () => {
    if (!reachable) { console.warn('[skip] Postgres not reachable'); return; }
    const repo = new SalesRepository(driver(pool!), 'postgres');
    const rows = await repo.aggregate<{ region: string; n: number; total: number }>((agg) =>
      agg.select(['region']).count('id', 'n').sum('amount', 'total').groupBy('region').orderBy('region', 'asc'),
    );
    // pg returns count as bigint string + numeric-ish; compare loosely.
    const byRegion = Object.fromEntries(rows.map((r) => [r.region, r]));
    expect(Number(byRegion.north!.n)).toBe(2);
    expect(Number(byRegion.north!.total)).toBe(30);
    expect(Number(byRegion.south!.n)).toBe(3);
    expect(Number(byRegion.south!.total)).toBe(25);
  });

  it('having filters grouped results', async () => {
    if (!reachable) return;
    const repo = new SalesRepository(driver(pool!), 'postgres');
    const rows = await repo.aggregate<{ region: string }>((agg) =>
      agg.select(['region']).count('id', 'n').groupBy('region').having('region', '=', 'north'),
    );
    expect(rows.map((r) => r.region)).toEqual(['north']);
  });
});
