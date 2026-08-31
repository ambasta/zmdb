import type { Equal, Expect } from '@zmdb/schema-core';

import type { Driver } from '../index.ts';
import { ProductsRepo, TenantUsersRepo } from './fixtures.ts';

declare const driver: Driver;
const compRepo = new TenantUsersRepo(driver);
const prodRepo = new ProductsRepo(driver);

// 1. Composite key repo findById / delete parameter types
export type _testCompFind = Expect<
  Equal<Parameters<typeof compRepo.findById>[0], { tenantId: string; userId: number }>
>;
export type _testCompDelete = Expect<
  Equal<Parameters<typeof compRepo.delete>[0], { tenantId: string; userId: number }>
>;

// 2. Single key repo findById / delete parameter types
export type _testSingleFind = Expect<Equal<Parameters<typeof prodRepo.findById>[0], number>>;
export type _testSingleDelete = Expect<Equal<Parameters<typeof prodRepo.delete>[0], number>>;
