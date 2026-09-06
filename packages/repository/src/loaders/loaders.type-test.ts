import type { Entity, Equal, Expect, Mutual } from '@zmdb/schema-core';

import { BaseRepository, createLoaderScope, type Driver } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import {
  ProductsRepo,
  TenantUsersRepo,
  type Product,
  type TenantUser,
} from '../typed-methods/typed-methods.fixture.js';
import { type Order, type Profile, type User, UserSchema } from '../typed-populate/fixtures.js';

const driver: Driver = { dialect: postgresDialect, execute: async () => [] };
const scope = createLoaderScope();

const productLoader = scope.loaderFor(new ProductsRepo(driver));
const membershipLoader = scope.loaderFor(new TenantUsersRepo(driver));

export type _LoaderSingleKey = Expect<Mutual<Parameters<typeof productLoader.load>[0], number>>;
export type _LoaderSingleResult = Expect<
  Equal<Awaited<ReturnType<typeof productLoader.load>>, Entity<Product> | undefined>
>;
export type _LoaderCompositeKey = Expect<
  Mutual<Parameters<typeof membershipLoader.load>[0], { tenantId: string; userId: number }>
>;
export type _LoaderCompositeKeyNames = Expect<
  Equal<keyof Parameters<typeof membershipLoader.load>[0], keyof Entity<TenantUser> & ('tenantId' | 'userId')>
>;

class Users extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

const ordersLoader = scope.relationLoader(new Users(driver), 'orders');
const profileLoader = scope.relationLoader(new Users(driver), 'profile');

export type _RelationLoaderParent = Expect<Mutual<Parameters<typeof ordersLoader.load>[0], Entity<User>>>;
export type _RelationLoaderResult = Expect<
  Equal<Awaited<ReturnType<typeof ordersLoader.load>>, readonly Entity<Order>[]>
>;
export type _RelationLoaderToOneResult = Expect<
  Equal<Awaited<ReturnType<typeof profileLoader.load>>, Entity<Profile> | null>
>;
