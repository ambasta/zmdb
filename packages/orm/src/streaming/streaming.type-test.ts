// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Driver, type ExecuteOptions } from '@zmdb/orm';
import { type Entity, type Equal, type Expect } from '@zmdb/schema';
import { type CompiledQuery } from '@zmdb/sql';

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
