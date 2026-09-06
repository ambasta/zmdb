import type { CompiledQuery } from '@zmdb/query-compiler';
import type { Entity, Equal, Expect } from '@zmdb/schema-core';

import type { Driver, ExecuteOptions } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { ProductsRepo, type Product } from '../typed-methods/typed-methods.fixture.js';

// The Driver change is additive: an adapter compiled against the old one-method
// shape remains assignable without accepting or inspecting ExecuteOptions.
const oldShapeDriver = {
  dialect: postgresDialect,
  execute(_query: CompiledQuery): Promise<readonly Record<string, unknown>[]> {
    return Promise.resolve([]);
  },
} satisfies Driver;

const products = new ProductsRepo(oldShapeDriver);
const signal = new AbortController().signal;
const options: ExecuteOptions = { signal, batchSize: 64 };
void options;

export const _signalledFind: Promise<readonly Entity<Product>[]> = products.findAll({ signal });
export const _stream: AsyncIterable<Entity<Product>> & AsyncDisposable = products.stream(undefined, {
  signal,
  batchSize: 64,
});
export type _DriverStreamStaysOptional = Expect<Equal<undefined extends Driver['stream'] ? true : false, true>>;
