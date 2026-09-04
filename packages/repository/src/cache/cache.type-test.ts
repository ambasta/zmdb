import type { Entity, Equal, Expect } from '@zmdb/schema-core';

import { memoryStore, type CacheStore, type Driver } from '../index.js';
import { ProductsRepo, type Product } from '../typed-methods/fixtures.js';

const driver: Driver = { execute: async () => [] };
const store: CacheStore = memoryStore({ maxEntries: 32 });
const products = new ProductsRepo(driver, 'postgres', { cacheStore: store });

const cached = products.findById(1, { cache: { ttlMs: 1_000, tags: ['product:1'] } });
const bypassed = products.findById(1, { cache: false });
const foundOne = products.findOne({ name: 'widget' }, { cache: { ttlMs: 1_000 } });
const found = products.find({ name: 'widget' }, { cache: { ttlMs: 1_000 } });
const foundAll = products.findAll({ cache: { ttlMs: 1_000 } });
const listed = products.list(undefined, { cache: { ttlMs: 1_000 } });
const updated = products.update(1, { name: 'updated' }, { invalidateTags: ['product:1'] });

export type _CachedRead = Expect<Equal<Awaited<typeof cached>, Entity<Product> | undefined>>;
export type _BypassedRead = Expect<Equal<Awaited<typeof bypassed>, Entity<Product> | undefined>>;
export type _CachedFindOne = Expect<Equal<Awaited<typeof foundOne>, Entity<Product> | undefined>>;
export type _CachedFind = Expect<Equal<Awaited<typeof found>, readonly Entity<Product>[]>>;
export type _CachedFindAll = Expect<Equal<Awaited<typeof foundAll>, readonly Entity<Product>[]>>;
export type _CachedList = Expect<Equal<Awaited<typeof listed>['items'], readonly Entity<Product>[]>>;
export type _TaggedWrite = Expect<Equal<Awaited<typeof updated>, Entity<Product> | undefined>>;
