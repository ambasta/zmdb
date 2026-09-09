// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { DatabaseSync } from 'node:sqlite';

import { BaseRepository, type Driver } from '@zmdb/orm';
import { type Entity } from '@zmdb/schema';
import { encodeCursor, type ListResult } from '@zmdb/schema/dto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProductSchema, TenantProductSchema, type Product, type TenantProduct } from './keyset-cursor.fixture.js';
import { sqliteDialect } from './testing/official-dialects.fixture.js';

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    dialect: sqliteDialect,
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

class TenantProductRepository extends BaseRepository<TenantProduct> {
  static override readonly schema = TenantProductSchema;
}

class ProductRepository extends BaseRepository<Product> {
  static override readonly schema = ProductSchema;
}

let db: DatabaseSync;
let products: ProductRepository;

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER NOT NULL, category TEXT NOT NULL)',
  );
  products = new ProductRepository(sqliteDriver(db), sqliteDialect);

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
        page: { mode: 'cursor', limit: 6, after: currentCursor },
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
        page: { mode: 'cursor', limit: 4, after: currentCursor },
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
        page: { mode: 'cursor', limit: 10, after: 'invalid-base64-token!!!' },
      }),
    ).rejects.toThrow(/Invalid cursor/);
  });

  it('selects adjacent before pages and restores caller order through every boundary', async () => {
    const orderBy = [{ column: 'age', dir: 'desc' }] as const;
    const effectiveOrder = [...orderBy, { column: 'id', dir: 'asc' }] as const;
    const expected = (await products.findAll()).toSorted((a, b) => b.age - a.age || a.id - b.id);
    const last = expected.at(-1)!;
    const fetched = [last.id];
    let cursor: string | undefined = encodeCursor({ age: last.age, id: last.id }, effectiveOrder);
    let pages = 0;
    do {
      expect(++pages).toBeLessThanOrEqual(5);
      const result: ListResult<Entity<Product>> = await products.list({
        orderBy,
        page: { mode: 'cursor', limit: 6, before: cursor },
      });
      fetched.unshift(...result.items.map(item => item.id));
      cursor = result.cursor;
    } while (cursor);
    expect(fetched).toEqual(expected.map(item => item.id));
    expect(new Set(fetched).size).toBe(25);
  });

  it('keeps every composite primary-key component through forward and reverse pages', async () => {
    db.exec(
      'CREATE TABLE tenant_products (tenantId TEXT NOT NULL, productId INTEGER NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY (tenantId, productId))',
    );
    const repository = new TenantProductRepository(sqliteDriver(db));
    for (const tenantId of ['東京', 'café']) {
      for (let productId = 1; productId <= 4; productId++)
        await repository.create({ tenantId, productId, rank: productId % 2 });
    }
    const orderBy = [
      { column: 'rank', dir: 'desc' },
      { column: 'tenantId', dir: 'desc' },
    ] as const;
    const effectiveOrder = [...orderBy, { column: 'productId', dir: 'asc' }] as const;
    const expected = await repository.list({ orderBy });
    const forward: Entity<TenantProduct>[] = [];
    let after: string | undefined;
    do {
      const page: ListResult<Entity<TenantProduct>> = await repository.list({
        orderBy,
        page: { mode: 'cursor', limit: 3, after },
      });
      forward.push(...page.items);
      after = page.cursor;
    } while (after);
    expect(forward).toEqual(expected.items);
    const last = expected.items.at(-1)!;
    const backward = [last];
    let before: string | undefined = encodeCursor(last, effectiveOrder);
    let pages = 0;
    do {
      expect(++pages).toBeLessThanOrEqual(3);
      const page: ListResult<Entity<TenantProduct>> = await repository.list({
        orderBy,
        page: { mode: 'cursor', limit: 3, before },
      });
      backward.unshift(...page.items);
      before = page.cursor;
    } while (before);
    expect(backward).toEqual(expected.items);
  });

  it('rejects invalid modes and unbound cursor input before database access', async () => {
    const execute = vi.fn(sqliteDriver(db).execute);
    const repository = new ProductRepository({ dialect: sqliteDialect, execute });
    const orderBy = [{ column: 'age', dir: 'desc' }] as const;
    const effectiveOrder = [...orderBy, { column: 'id', dir: 'asc' }] as const;
    const valid = encodeCursor({ age: 30, id: 7 }, effectiveOrder);
    const wire = (values: unknown) =>
      globalThis.Buffer.from(
        JSON.stringify({
          order: [
            ['age', 'desc'],
            ['id', 'asc'],
          ],
          values,
        }),
      ).toString('base64url');
    const invalidPages = [
      { limit: 2 },
      { mode: 'cursor', limit: 2, after: valid, before: valid },
      { mode: 'cursor', limit: 2, offset: 1 },
      { mode: 'offset', limit: 2, after: valid },
      ...[
        'bad!!!',
        { age: 30, id: 7 },
        null,
        wire({ age: ['number', 30] }),
        wire({ age: ['number', 30], id: null }),
        wire({ age: ['number', 30], id: ['number', 7], extra: ['number', 1] }),
      ].map(after => ({ mode: 'cursor', limit: 2, after })),
    ];
    for (const page of invalidPages) {
      await expect(Reflect.apply(repository.list, repository, [{ orderBy, page }])).rejects.toThrow(
        /Invalid (cursor|pagination)/,
      );
    }
    await expect(
      repository.list({ orderBy: [{ column: 'age', dir: 'asc' }], page: { mode: 'cursor', limit: 2, after: valid } }),
    ).rejects.toThrow(/Invalid cursor/);
    await expect(
      repository.list({
        orderBy: [{ column: 'id' }, { column: 'age', dir: 'desc' }],
        page: { mode: 'cursor', limit: 2, after: valid },
      }),
    ).rejects.toThrow(/Invalid cursor/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('serves unpaginated or offset-based requests normally without regressions', async () => {
    const unpaginated = await products.list();
    expect(unpaginated.items).toHaveLength(25);
    expect(unpaginated.hasMore).toBe(false);
    expect(unpaginated.cursor).toBeUndefined();

    const offsetPage = await products.list({
      page: { mode: 'offset', limit: 5, offset: 10 },
    });
    expect(offsetPage.items).toHaveLength(5);
    expect(offsetPage.hasMore).toBe(true);
    expect(offsetPage.cursor).toBeUndefined();
  });
});
