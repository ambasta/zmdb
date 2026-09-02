// Type-level tests for the no-subclass wiring helper (#222/#223). No runtime
// code: a *compilation* gate run by `yarn typecheck`, and therefore by CI.
//
// The claim is that `defineRepository` loses nothing compared with a hand-written
// subclass — DTOs, entity types and populate keys all still derive. It was
// previously "checked" by `expectTypeOf` inside the E2E spec, a runtime no-op.
import type { CreateDTO, Entity, Equal, Expect, Mutual, UpdateDTO } from '@zmdb/schema-core';

import { defineRepository, type Driver } from '../index.ts';
import { UserSchema, userRelations, type Order, type User } from './fixtures.ts';

declare const driver: Driver;

// --- plain wiring ----------------------------------------------------------
const users = defineRepository(UserSchema, driver, { dialect: 'sqlite' });
export type _Dx1 = Expect<Equal<Parameters<typeof users.create>[0], CreateDTO<User>>>;
export type _Dx2 = Expect<Equal<Awaited<ReturnType<typeof users.create>>, Entity<User>>>;
export type _Dx3 = Expect<Equal<Parameters<typeof users.update>[1], UpdateDTO<User>>>;
export const _dxFindById: Promise<Entity<User> | undefined> = users.findById(1);
// @ts-expect-error — no relations were passed, so nothing can be populated.
export const _dxNoRelations = users.findById(1, { populate: ['orders'] });

// --- wiring with relations -------------------------------------------------
// `R` is inferred from the literal, so populate keys and the attached row type
// come out of the same object the caller wrote — no `typeof` plumbing needed.
const usersWithOrders = defineRepository(UserSchema, driver, {
  dialect: 'sqlite',
  relations: userRelations,
});
declare const populated: NonNullable<Awaited<ReturnType<typeof usersWithOrders.findById<'orders'>>>>;
export type _Dx4 = Expect<Equal<(typeof populated)['orders'], readonly Entity<Order>[]>>;
// `Mutual`: the fixture is a tagged type, so `total` is `number & Sql<'integer'>`. The claim
// is that the populated child is an entity and not `unknown`, which a cast-free `+ 1`
// would also show.
export type _Dx5 = Expect<Mutual<(typeof populated)['orders'][number]['total'], number>>;
export const _dxUnknownRelation = usersWithOrders.findById(1, {
  // @ts-expect-error — 'customers' is not a declared relation.
  populate: ['customers'],
});
