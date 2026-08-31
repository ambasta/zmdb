import type { CoreSchema } from '@zmdb/schema-core';
import { describe, it, expect } from 'vitest';

import { BaseRepository } from './index.ts';
import { usePostgres } from './pg-fixture.ts';

// #92: aggregation repository integration + E2E on REAL PostgreSQL.

const pg = usePostgres(async pool => {
  await pool.query('DROP TABLE IF EXISTS agg_sales');
  await pool.query('CREATE TABLE agg_sales (id INT PRIMARY KEY, region TEXT NOT NULL, amount INT NOT NULL)');
  await pool.query(`INSERT INTO agg_sales (id,region,amount) VALUES
    (1,'north',10),(2,'north',20),(3,'south',5),(4,'south',5),(5,'south',15)`);
});

const SalesSchema = {
  table: 'agg_sales',
  columns: { id: { type: 'serial', flags: { nullable: false, primaryKey: true } } },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'agg_sales'>;
class SalesRepository extends BaseRepository<typeof SalesSchema> {
  static override readonly schema = SalesSchema;
}
describe('aggregation repository integration (real Postgres)', () => {
  it('grouped count + sum returns typed computed columns', async () => {
    if (!pg.reachable()) {
      console.warn('[skip] Postgres not reachable');
      return;
    }
    const repo = new SalesRepository(pg.driver(), 'postgres');
    const rows = await repo.aggregate<{ region: string; n: number; total: number }>(agg =>
      agg.select(['region']).count('id', 'n').sum('amount', 'total').groupBy('region').orderBy('region', 'asc'),
    );
    // pg returns count as bigint string + numeric-ish; compare loosely.
    const byRegion = Object.fromEntries(rows.map(r => [r.region, r]));
    const north = byRegion['north'];
    const south = byRegion['south'];
    if (!north || !south) {
      throw new Error('expected north and south region aggregations to be defined');
    }
    expect(Number(north.n)).toBe(2);
    expect(Number(north.total)).toBe(30);
    expect(Number(south.n)).toBe(3);
    expect(Number(south.total)).toBe(25);
  });

  it('having filters grouped results', async () => {
    if (!pg.reachable()) return;
    const repo = new SalesRepository(pg.driver(), 'postgres');
    const rows = await repo.aggregate<{ region: string }>(agg =>
      agg.select(['region']).count('id', 'n').groupBy('region').having('region', '=', 'north'),
    );
    expect(rows.map(r => r.region)).toEqual(['north']);
  });
});
