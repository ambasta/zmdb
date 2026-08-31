import { defineSchema, text, integer, primaryKey } from '@zmdb/schema-core';
import { BaseRepository, type Driver } from '../index.ts';

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

const CompositeSchema = defineSchema('tenant_users', {
  tenantId: primaryKey(text()),
  userId: primaryKey(integer()),
  role: text().notNull(),
});
type CompositeS = typeof CompositeSchema;

const SinglePkSchema = defineSchema('products', {
  id: primaryKey(integer()),
  name: text().notNull(),
});
type SingleS = typeof SinglePkSchema;

class TenantUsersRepo extends BaseRepository<CompositeS> {
  static override readonly schema = CompositeSchema;
}

class ProductsRepo extends BaseRepository<SingleS> {
  static override readonly schema = SinglePkSchema;
}

declare const driver: Driver;
const compRepo = new TenantUsersRepo(driver);
const prodRepo = new ProductsRepo(driver);

// 1. Composite key repo findById / delete parameter types
export type _testCompFind = Expect<Equal<Parameters<typeof compRepo.findById>[0], { tenantId: string; userId: number }>>;
export type _testCompDelete = Expect<Equal<Parameters<typeof compRepo.delete>[0], { tenantId: string; userId: number }>>;

// 2. Single key repo findById / delete parameter types
export type _testSingleFind = Expect<Equal<Parameters<typeof prodRepo.findById>[0], number>>;
export type _testSingleDelete = Expect<Equal<Parameters<typeof prodRepo.delete>[0], number>>;
