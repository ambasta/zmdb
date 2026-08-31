import { DatabaseSync } from 'node:sqlite';

import { defineSchema, serial, integer, text, numeric, manyToOne } from '@zmdb/schema-core';
import type { AggregateSpec } from '@zmdb/schema-core/dto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BaseRepository, defineRepository, type Driver } from './index.ts';

const CategorySchema = defineSchema('categories', {
  id: serial().primaryKey(),
  name: text().notNull(),
  status: text().notNull(),
});

const ProductSchema = defineSchema('products', {
  id: serial().primaryKey(),
  name: text().notNull(),
  categoryId: integer().notNull(),
  price: numeric().notNull(),
});

class ProductRepository extends BaseRepository<typeof ProductSchema, typeof ProductRepository.relations> {
  static override readonly schema = ProductSchema;
  static readonly relations = {
    category: { rel: manyToOne('categories', 'categoryId'), entity: CategorySchema },
  } as const;
}

function recordingDriver(
  rows: Record<string, unknown>[] = [],
): Driver & { queries: { text: string; parameters: readonly unknown[] }[] } {
  const queries: { text: string; parameters: readonly unknown[] }[] = [];
  return {
    queries,
    execute: vi.fn(async q => {
      queries.push({ text: q.text, parameters: q.parameters });
      return rows;
    }),
  };
}

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = (q.parameters ?? []) as Parameters<typeof stmt.all>;
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}

describe('Relation-Aware Repository Aggregations', () => {
  it('builder joinRelation auto-resolves join metadata without manual ON clauses in a single roundtrip', async () => {
    const driver = recordingDriver([{ 'category.name': 'Electronics', count: 2, sum: 1500 }]);
    const repo = new ProductRepository(driver, 'postgres');

    const rows = await repo.aggregate(agg =>
      agg
        .joinRelation('category')
        .select(['category.name'])
        .count('id', 'count')
        .sum('price', 'sum')
        .groupBy('category.name'),
    );

    expect(driver.queries.length).toBe(1);
    expect(driver.queries[0]!.text).toBe(
      'SELECT "category"."name" AS "category.name", COUNT("id") AS "count", SUM("price") AS "sum" FROM "products" INNER JOIN "categories" AS "category" ON "products"."categoryId" = "category"."id" GROUP BY "category"."name"',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 'category.name': 'Electronics', count: 2, sum: 1500 });
  });

  it('AggregateSpec auto-resolves joins from relation references or explicit spec.joins in a single roundtrip', async () => {
    const driver = recordingDriver([{ 'category.name': 'Books', count: 1, sum: 20 }]);
    const repo = new ProductRepository(driver, 'sqlite');

    type Spec = AggregateSpec<typeof ProductSchema, typeof ProductRepository.relations>;
    const spec: Spec = {
      joins: ['category'],
      groupBy: ['category.name'],
      computed: {
        count: { fn: 'count', column: 'id' },
        sum: { fn: 'sum', column: 'price' },
      },
    };

    const rows = await repo.aggregate(spec);

    expect(driver.queries.length).toBe(1);
    expect(driver.queries[0]!.text).toBe(
      'SELECT "category"."name" AS "category.name", COUNT("id") AS "count", SUM("price") AS "sum" FROM "products" INNER JOIN "categories" AS "category" ON "products"."categoryId" = "category"."id" GROUP BY "category"."name"',
    );
    expect(rows[0]).toMatchObject({ 'category.name': 'Books', count: 1, sum: 20 });
  });

  it('throws a descriptive error when referencing an undeclared relation', async () => {
    const driver = recordingDriver();
    const repo = new ProductRepository(driver, 'postgres');

    await expect(repo.aggregate(agg => agg.joinRelation('nonExistentRelation'))).rejects.toThrow(
      'unknown relation "nonExistentRelation" on products',
    );
  });

  describe('Real in-memory SQLite E2E execution', () => {
    let db: DatabaseSync;
    let repo: BaseRepository<typeof ProductSchema>;

    beforeEach(() => {
      db = new DatabaseSync(':memory:');
      db.exec(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          categoryId INTEGER NOT NULL,
          price INTEGER NOT NULL
        );
        INSERT INTO categories (id, name, status) VALUES (1, 'Electronics', 'active'), (2, 'Books', 'active');
        INSERT INTO products (id, name, categoryId, price) VALUES
          (101, 'Laptop', 1, 1000),
          (102, 'Phone', 1, 500),
          (103, 'Novel', 2, 20);
      `);

      repo = defineRepository(ProductSchema, sqliteDriver(db), {
        dialect: 'sqlite',
        relations: {
          category: { rel: manyToOne('categories', 'categoryId'), entity: CategorySchema },
        },
      });
    });

    it('summarizes child metrics grouped by parent attributes in a single SQLite query', async () => {
      const rows = await repo.aggregate<{
        'category.name': string;
        category_name: string;
        product_count: number;
        total_price: number;
      }>(agg =>
        agg
          .joinRelation('category')
          .select(['category.name'])
          .count('products.id', 'product_count')
          .sum('products.price', 'total_price')
          .groupBy('category.name')
          .orderBy('total_price', 'desc'),
      );

      expect(rows).toHaveLength(2);
      expect(rows[0]!['category.name']).toBe('Electronics');
      expect(rows[0]!.category_name).toBe('Electronics');
      expect(Number(rows[0]!.product_count)).toBe(2);
      expect(Number(rows[0]!.total_price)).toBe(1500);

      expect(rows[1]!['category.name']).toBe('Books');
      expect(Number(rows[1]!.product_count)).toBe(1);
      expect(Number(rows[1]!.total_price)).toBe(20);
    });

    it('executes declarative AggregateSpec with parent attribute references', async () => {
      const rows = await repo.aggregate({
        groupBy: ['category.name'],
        computed: {
          total: { fn: 'sum', column: 'price' },
        },
        orderBy: [{ column: 'total', dir: 'desc' }],
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ 'category.name': 'Electronics', total: 1500 });
      expect(rows[1]).toMatchObject({ 'category.name': 'Books', total: 20 });
    });
  });
});
