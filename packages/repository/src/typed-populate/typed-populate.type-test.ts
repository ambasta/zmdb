// Type-level tests for typed populate (#217). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI.
//
// The acceptance criterion in SPEC.md ("`findById(1, { populate: ['orders'] })`
// result has `orders: Entity<Order>[]`; without populate it's plain `Entity<S>`")
// used to be checked by an `expectTypeOf(...).toHaveProperty('orders')` call in a
// `.spec.ts` — a runtime no-op in a file the tsconfig excluded. It was not met:
// the populate overload returned `Entity<S> & Record<string, unknown>`, so
// `user.orders` was `unknown` and every caller cast it.
import type { Entity, Equal, Expect } from '@zmdb/schema-core';
import { defineSchema, integer, serial, text } from '@zmdb/schema-core';
import { manyToOne, oneToMany } from '@zmdb/schema-core/relations';

import { BaseRepository } from '../index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
});
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});
type Order = Entity<typeof OrderSchema>;

const userRelations = {
  orders: {
    meta: oneToMany('orders', 'userId'),
    entity: OrderSchema,
    cardinality: 'one-to-many',
    childTable: 'orders',
    childFk: 'userId',
    parentKey: 'id',
  },
} as const;
const orderRelations = {
  user: {
    meta: manyToOne('users', 'userId'),
    entity: UserSchema,
    cardinality: 'many-to-one',
    childTable: 'users',
    childFk: 'id',
    parentKey: 'userId',
  },
} as const;

class Users extends BaseRepository<typeof UserSchema, typeof userRelations> {
  static override readonly schema = UserSchema;
  static readonly relations = userRelations;
}
class Orders extends BaseRepository<typeof OrderSchema, typeof orderRelations> {
  static override readonly schema = OrderSchema;
  static readonly relations = orderRelations;
}
declare const users: Users;
declare const orders: Orders;

// --- to-many: the relation is an array of the child entity ------------------
declare const populated: NonNullable<Awaited<ReturnType<typeof users.findById<'orders'>>>>;
export type _Pop1 = Expect<Equal<(typeof populated)['orders'], readonly Order[]>>;
// The base columns survive untouched.
export type _Pop2 = Expect<Equal<(typeof populated)['name'], string>>;
// The child rows are entities, not `unknown` — `o.total` needs no cast.
export type _Pop3 = Expect<Equal<(typeof populated)['orders'][number]['total'], number>>;

// --- to-one: a single child, nullable (the FK may match nothing) ------------
declare const withUser: NonNullable<Awaited<ReturnType<typeof orders.findById<'user'>>>>;
export type _Pop4 = Expect<Equal<(typeof withUser)['user'], Entity<typeof UserSchema> | null>>;

// --- find() populates every row --------------------------------------------
declare const found: Awaited<ReturnType<typeof users.find<'orders'>>>;
export type _Pop5 = Expect<Equal<(typeof found)[number]['orders'], readonly Order[]>>;

// --- unpopulated relations are absent from the type ------------------------
// This is the "no lazy getters" guarantee: an unrequested relation is not a
// property, so reading it is a compile error rather than a silent `undefined`.
// (Value-level, because `ReturnType` on an overloaded method resolves to the last
// overload — the populate one — regardless of the arguments.)
export const _plain: Promise<Entity<typeof UserSchema> | undefined> = users.findById(1);
declare const plain: Entity<typeof UserSchema>;
export type _Pop6 = Expect<Equal<keyof typeof plain, 'id' | 'name'>>;
// @ts-expect-error — `orders` was not populated.
export const _noLazy = plain.orders;
// @ts-expect-error — 'nope' is not a declared relation.
export const _unknownRelation = users.findById(1, { populate: ['nope'] });
