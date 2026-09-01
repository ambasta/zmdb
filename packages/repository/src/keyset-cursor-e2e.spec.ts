import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/compiler/testing';
import type { Entity } from '@zmdb/schema-core';
import type { ListResult } from '@zmdb/schema-core/dto';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, beforeEach } from 'vitest';

import { BaseRepository, type Driver } from './index.js';

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as readonly unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return (stmt.all as (...args: readonly unknown[]) => unknown[])(...params) as Record<string, unknown>[];
      }
      (stmt.run as (...args: readonly unknown[]) => void)(...params);
      return [];
    },
  };
}

export interface Product extends Table<'products'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  category: string & Sql<'text'>;
}

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  description: (string & Sql<'text'>) | null;
}

const { Product: ProductSchema, Article: ArticleSchema } = schemasFrom<{ Product: Product; Article: Article }>(
  import.meta.url,
  ['Product', 'Article'],
);

class ProductRepository extends BaseRepository<Product> {
  static override readonly schema = ProductSchema;
}

class ArticleRepository extends BaseRepository<Article> {
  static override readonly schema = ArticleSchema;
}

let db: DatabaseSync;
let products: ProductRepository;

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER NOT NULL, category TEXT NOT NULL)',
  );
  products = new ProductRepository(sqliteDriver(db), 'sqlite');

  // Insert 25 items with non-unique age values to test composite ordering & PK tie-breaker
  for (let i = 1; i <= 25; i++) {
    const age = (i % 5) * 10; // age values will be 0, 10, 20, 30, 40 repeated
    const category = i % 2 === 0 ? 'electronics' : 'books';
    await products.create({ name: `Product ${i}`, age, category });
  }
});

describe('Composite Keyset Cursor Pipeline E2E', () => {
  it('paginates forward across custom sorted datasets with zero duplication or omission', async () => {
    const allFetchedIds: number[] = [];
    let pageCount = 0;
    let currentCursor: string | undefined = undefined;

    do {
      pageCount++;
      const res: ListResult<Entity<Product>> = await products.list({
        orderBy: [{ column: 'age', dir: 'desc' }],
        page: { limit: 6, after: currentCursor },
      });

      expect(res.items.length).toBeGreaterThan(0);
      for (const item of res.items) {
        allFetchedIds.push(item.id);
      }

      if (res.hasMore) {
        expect(res.cursor).toBeDefined();
        expect(typeof res.cursor).toBe('string');
      } else {
        expect(res.cursor).toBeUndefined();
      }

      currentCursor = res.cursor;
    } while (currentCursor);

    // Verify all 25 items were fetched with zero duplicates or missing items
    expect(allFetchedIds).toHaveLength(25);
    const uniqueIds = new Set(allFetchedIds);
    expect(uniqueIds.size).toBe(25);
    expect(pageCount).toBe(5); // 25 items / 6 per page = 5 pages (6, 6, 6, 6, 1)

    // Verify sorting order: age DESC, then id ASC
    const allItems = await products.findAll();
    const sortedExpected = allItems.toSorted((a, b) => {
      if (b.age !== a.age) return b.age - a.age;
      return a.id - b.id;
    });
    const expectedIds = sortedExpected.map(p => p.id);
    expect(allFetchedIds).toEqual(expectedIds);
  });

  it('filters with user where condition during cursor pagination', async () => {
    const allFetchedIds: number[] = [];
    let currentCursor: string | undefined = undefined;

    do {
      const res: ListResult<Entity<Product>> = await products.list({
        where: { category: 'electronics' },
        orderBy: [{ column: 'age', dir: 'asc' }],
        page: { limit: 4, after: currentCursor },
      });

      for (const item of res.items) {
        allFetchedIds.push(item.id);
      }
      currentCursor = res.cursor;
    } while (currentCursor);

    // 12 electronics items total
    expect(allFetchedIds).toHaveLength(12);
    expect(new Set(allFetchedIds).size).toBe(12);
  });

  it('handles malformed cursor parameter gracefully by throwing a clear validation error', async () => {
    await expect(
      products.list({
        page: { limit: 10, after: 'invalid-base64-token!!!' },
      }),
    ).rejects.toThrow(/Invalid cursor/);
  });

  it('serves unpaginated or offset-based requests normally without regressions', async () => {
    const unpaginated = await products.list();
    expect(unpaginated.items).toHaveLength(25);
    expect(unpaginated.hasMore).toBe(false);
    expect(unpaginated.cursor).toBeUndefined();

    const offsetPage = await products.list({
      page: { limit: 5, offset: 10 },
    });
    expect(offsetPage.items).toHaveLength(5);
    expect(offsetPage.hasMore).toBe(true);
  });

  it('throws descriptive runtime error when keyset cursor pagination uses a nullable sort column', async () => {
    db.exec('CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT)');
    const articles = new ArticleRepository(sqliteDriver(db), 'sqlite');

    await articles.create({ title: 'Article 1', description: 'desc 1' });
    await articles.create({ title: 'Article 2', description: null });

    // Keyset pagination on nullable 'description' must throw explicit runtime error.
    // Casting with `as unknown as Parameters<typeof articles.list>[0]` simulates untrusted client DTO input at runtime where compile-time types do not apply.
    await expect(
      articles.list({
        orderBy: [{ column: 'description', dir: 'asc' }],
        page: { limit: 10, after: 'eyJkZXNjcmlwdGlvbiI6ImRlc2MgMSIsImlkIjoxfQ' },
      } as unknown as Parameters<typeof articles.list>[0]),
    ).rejects.toThrow(/Invalid keyset sort column "description": column is nullable/);

    // Offset pagination sorting on the nullable 'description' field continues to work cleanly
    const offsetRes = await articles.list({
      orderBy: [{ column: 'description', dir: 'asc' }],
      page: { limit: 10, offset: 0 },
    });
    expect(offsetRes.items).toHaveLength(2);
  });
});
