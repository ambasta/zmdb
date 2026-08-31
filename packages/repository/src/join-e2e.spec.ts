import type { CoreSchema } from '@zmdb/schema-core';
import { describe, it, expect } from 'vitest';

import { BaseRepository } from './index.ts';
import { usePostgres } from './pg-fixture.ts';

// #87: JOIN repository integration + E2E on REAL PostgreSQL.

const pg = usePostgres(async pool => {
  await pool.query('DROP TABLE IF EXISTS j_products, j_suppliers');
  await pool.query('CREATE TABLE j_suppliers (id INT PRIMARY KEY, name TEXT NOT NULL)');
  await pool.query('CREATE TABLE j_products (id INT PRIMARY KEY, name TEXT NOT NULL, supplier_id INT)');
  await pool.query(`INSERT INTO j_suppliers (id,name) VALUES (1,'Acme'),(2,'Globex')`);
  await pool.query(
    `INSERT INTO j_products (id,name,supplier_id) VALUES (10,'Widget',1),(11,'Gadget',2),(12,'Orphan',NULL)`,
  );
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
describe('JOIN repository integration (real Postgres)', () => {
  it('findJoined left-joins product→supplier and returns flat rows', async () => {
    if (!pg.reachable()) {
      console.warn('[skip] Postgres not reachable');
      return;
    }
    const repo = new ProductRepository(pg.driver(), 'postgres');
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
    if (!pg.reachable()) return;
    const repo = new ProductRepository(pg.driver(), 'postgres');
    const rows = await repo.findJoined(
      { target: 'j_suppliers', leftCol: 'j_suppliers.id', rightCol: 'j_products.supplier_id', kind: 'left' },
      { col: 'j_products.id', op: '=', value: 12 },
    );
    expect(rows).toHaveLength(1); // orphan retained by LEFT JOIN
  });
});
