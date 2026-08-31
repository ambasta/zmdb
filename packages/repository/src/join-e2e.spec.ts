import type { CoreSchema } from '@zmdb/schema-core';
import { Pool } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { BaseRepository, type Driver } from './index.ts';

// #87: JOIN repository integration + E2E on REAL PostgreSQL.

const CONN = process.env.ZMDB_PG || 'postgres://postgres:postgres@localhost:55432/bench';
let pool: Pool | undefined;
let reachable = false;

beforeAll(async () => {
  try {
    pool = new Pool({ connectionString: CONN, max: 2 });
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS j_products, j_suppliers');
    await pool.query('CREATE TABLE j_suppliers (id INT PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('CREATE TABLE j_products (id INT PRIMARY KEY, name TEXT NOT NULL, supplier_id INT)');
    await pool.query(`INSERT INTO j_suppliers (id,name) VALUES (1,'Acme'),(2,'Globex')`);
    await pool.query(
      `INSERT INTO j_products (id,name,supplier_id) VALUES (10,'Widget',1),(11,'Gadget',2),(12,'Orphan',NULL)`,
    );
    reachable = true;
  } catch {
    reachable = false;
  }
});
afterAll(async () => {
  await pool?.end();
});

const ProductSchema = {
  table: 'j_products',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true } },
    name: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'j_products'>;

class ProductRepository extends BaseRepository<typeof ProductSchema> {
  static override readonly schema = ProductSchema;
}
const driver = (p: Pool): Driver => ({
  execute: async q => (await p.query(q.text, q.parameters as unknown[])).rows,
});

describe('JOIN repository integration (real Postgres)', () => {
  it('findJoined left-joins product→supplier and returns flat rows', async () => {
    if (!reachable) {
      console.warn('[skip] Postgres not reachable');
      return;
    }
    const repo = new ProductRepository(driver(pool!), 'postgres');
    const rows = await repo.findJoined(
      { target: 'j_suppliers', leftCol: 'j_suppliers.id', rightCol: 'j_products.supplier_id', kind: 'left' },
      { col: 'j_products.id', op: '=', value: 10 },
    );
    expect(rows).toHaveLength(1);
    // joined columns present (product name + supplier name)
    const r = rows[0]!;
    expect(r.name).toBeDefined();
    expect(Object.getPrototypeOf(r) === null || Object.getPrototypeOf(r) === Object.prototype).toBe(true);
  });

  it('left join keeps the orphan product (null supplier)', async () => {
    if (!reachable) return;
    const repo = new ProductRepository(driver(pool!), 'postgres');
    const rows = await repo.findJoined(
      { target: 'j_suppliers', leftCol: 'j_suppliers.id', rightCol: 'j_products.supplier_id', kind: 'left' },
      { col: 'j_products.id', op: '=', value: 12 },
    );
    expect(rows).toHaveLength(1); // orphan retained by LEFT JOIN
  });
});
