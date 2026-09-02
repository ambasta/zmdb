// What `findById` and `delete` ask for, which is a question about the primary key:
// a scalar when there is one key column, an object keyed by all of them when there
// are several.
//
// Asserted with `Mutual` rather than `Equal` because the fixtures are tagged types
// and a tag survives the derivation: `tenantId` is `string & Sql<'text'>`, so the
// caller can pass a plain string and read one back, but the two spellings are not
// invariantly equal. `Equal<keyof …>` alongside pins the key set, which is the other
// half of the claim.
import type { Equal, Expect, Mutual } from '@zmdb/schema-core';

import type { Driver } from '../index.ts';
import { ProductsRepo, TenantUsersRepo } from './fixtures.ts';

declare const driver: Driver;
const compRepo = new TenantUsersRepo(driver);
const prodRepo = new ProductsRepo(driver);

// 1. Composite key repo findById / delete parameter types
export type _testCompFind = Expect<
  Mutual<Parameters<typeof compRepo.findById>[0], { tenantId: string; userId: number }>
>;
export type _testCompFindKeys = Expect<Equal<keyof Parameters<typeof compRepo.findById>[0], 'tenantId' | 'userId'>>;
export type _testCompDelete = Expect<
  Mutual<Parameters<typeof compRepo.delete>[0], { tenantId: string; userId: number }>
>;
export type _testCompDeleteKeys = Expect<Equal<keyof Parameters<typeof compRepo.delete>[0], 'tenantId' | 'userId'>>;

// 2. Single key repo findById / delete parameter types
export type _testSingleFind = Expect<Mutual<Parameters<typeof prodRepo.findById>[0], number>>;
export type _testSingleDelete = Expect<Mutual<Parameters<typeof prodRepo.delete>[0], number>>;
