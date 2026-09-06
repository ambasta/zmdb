import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/compiler/testing';
import type { AggregateSpec } from '@zmdb/schema-core/dto';
import type { ManyToOne, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BaseRepository, defineRepository, type Driver, type FilterDef } from './index.js';
import { postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

export interface Category extends Table<'categories'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  status: string & Sql<'text'>;
}

export interface Product extends Table<'products'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  categoryId: number & Sql<'integer'> & References<'categories.id'>;
  price: number & Sql<'numeric'>;
  category?: Category & ManyToOne<'categories', 'categoryId'>;
}

export interface Account extends Table<'accounts'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  id: number & Sql<'integer'> & PrimaryKey;
  name: string & Sql<'text'>;
  active: boolean & Sql<'boolean'>;
}

export interface Membership extends Table<'memberships'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: string & Sql<'text'> & References<'accounts.tenantId'>;
  userId: number & Sql<'integer'> & References<'accounts.id'>;
  account?: Account & ManyToOne<'accounts', 'tenantId,userId'>;
}

const {
  Product: ProductSchema,
  Account: AccountSchema,
  Membership: MembershipSchema,
} = schemasFrom<{
  Category: Category;
  Product: Product;
  Account: Account;
  Membership: Membership;
}>(import.meta.url, ['Category', 'Product', 'Account', 'Membership']);

class ProductRepository extends BaseRepository<Product> {
  static override readonly schema = ProductSchema;
}

const activeAccountFilter = {
  name: 'activeAccount',
  table: 'accounts',
  schema: AccountSchema,
  where: (_params: void) => [{ col: 'active', op: '=', value: true }] as const,
} as const satisfies FilterDef;

class MembershipRepository extends BaseRepository<Membership> {
  static override readonly schema = MembershipSchema;
  static readonly filters = [activeAccountFilter] as const;
}

function recordingDriver(
  rows: Record<string, unknown>[] = [],
): Driver & { queries: { text: string; parameters: readonly unknown[] }[] } {
  const queries: { text: string; parameters: readonly unknown[] }[] = [];
  return {
    dialect: postgresDialect,
    queries,
    execute: vi.fn(async q => {
      queries.push({ text: q.text, parameters: q.parameters });
      return rows;
    }),
  };
}

/**
 * The one grouped, joined SELECT both aggregate entry points — the builder
 * callback and a declarative `AggregateSpec` — have to compile to. They are two
 * front doors onto the same query; asserting the same string twice is the point.
 */
const GROUPED_JOIN_SQL =
  'SELECT "category"."name" AS "category.name", COUNT("id") AS "count", SUM("price") AS "sum" FROM "products" INNER JOIN "categories" AS "category" ON "products"."categoryId" = "category"."id" GROUP BY "category"."name"';

/** Asserts the aggregate took exactly one roundtrip, with that SQL. */
function expectOneQuery(driver: { queries: { text: string }[] }, sql: string) {
  expect(driver.queries.map(q => q.text)).toEqual([sql]);
}

function onlyRow<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('expected exactly one row');
  return row;
}

describe('Relation-Aware Repository Aggregations', () => {
  it('builder joinRelation auto-resolves join metadata without manual ON clauses in a single roundtrip', async () => {
    const driver = recordingDriver([{ 'category.name': 'Electronics', count: 2, sum: 1500 }]);
    const repo = new ProductRepository(driver, postgresDialect);

    const rows = await repo.aggregate(agg =>
      agg
        .joinRelation('category')
        .select(['category.name'])
        .count('id', 'count')
        .sum('price', 'sum')
        .groupBy('category.name'),
    );

    expectOneQuery(driver, GROUPED_JOIN_SQL);
    expect(onlyRow(rows)).toMatchObject({ 'category.name': 'Electronics', count: 2, sum: 1500 });
  });

  it('AggregateSpec auto-resolves joins from relation references or explicit spec.joins in a single roundtrip', async () => {
    const driver = recordingDriver([{ 'category.name': 'Books', count: 1, sum: 20 }]);
    const repo = new ProductRepository(driver, sqliteDialect);

    const spec: AggregateSpec<Product> = {
      joins: ['category'],
      groupBy: ['category.name'],
      computed: {
        count: { fn: 'count', column: 'id' },
        sum: { fn: 'sum', column: 'price' },
      },
    };

    const rows = await repo.aggregate(spec);

    expectOneQuery(driver, GROUPED_JOIN_SQL);
    expect(onlyRow(rows)).toMatchObject({ 'category.name': 'Books', count: 1, sum: 20 });
  });

  it('conjoins every composite relation pair in one aggregate join', async () => {
    const driver = recordingDriver([{ count: 1 }]);
    const repo = new MembershipRepository(driver, postgresDialect);

    await repo.aggregate(aggregate => aggregate.joinRelation('account').count('memberships.id', 'count'));

    expectOneQuery(
      driver,
      'SELECT COUNT("memberships"."id") AS "count" FROM "memberships" ' +
        'INNER JOIN "accounts" AS "account" ON "memberships"."tenantId" = "account"."tenantId" ' +
        'AND "memberships"."userId" = "account"."id" AND "account"."active" = $1',
    );
    expect(driver.queries[0]?.parameters).toEqual([true]);
  });

  it('throws a descriptive error when referencing an undeclared relation', async () => {
    const driver = recordingDriver();
    const repo = new ProductRepository(driver, postgresDialect);

    await expect(repo.aggregate(agg => agg.joinRelation('nonExistentRelation'))).rejects.toThrow(
      'unknown relation "nonExistentRelation" on products',
    );
  });

  describe('Real in-memory SQLite E2E execution', () => {
    let db: DatabaseSync;
    let repo: BaseRepository<Product>;

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

      repo = defineRepository(ProductSchema, sqliteDriver(db), { dialect: sqliteDialect });
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
      const r0 = rows[0];
      const r1 = rows[1];
      if (!r0 || !r1) throw new Error('Expected 2 rows');
      expect(r0['category.name']).toBe('Electronics');
      expect(r0.category_name).toBe('Electronics');
      expect(Number(r0.product_count)).toBe(2);
      expect(Number(r0.total_price)).toBe(1500);

      expect(r1['category.name']).toBe('Books');
      expect(Number(r1.product_count)).toBe(1);
      expect(Number(r1.total_price)).toBe(20);
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
      const r0 = rows[0];
      const r1 = rows[1];
      if (!r0 || !r1) throw new Error('Expected 2 rows');
      expect(r0).toMatchObject({ 'category.name': 'Electronics', total: 1500 });
      expect(r1).toMatchObject({ 'category.name': 'Books', total: 20 });
    });
  });
});
