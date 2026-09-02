// Type-level tests for typed populate (#217). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI.
//
// The acceptance criterion in SPEC.md ("`findById(1, { populate: ['orders'] })`
// result has `orders: Entity<Order>[]`; without populate it's plain `Entity<S>`")
// used to be checked by an `expectTypeOf(...).toHaveProperty('orders')` call in a
// `.spec.ts` — a runtime no-op in a file the tsconfig excluded. It was not met:
// the populate overload returned `Entity<S> & Record<string, unknown>`, so
// `user.orders` was `unknown` and every caller cast it.
import type { Entity, Equal, Expect, Mutual } from '@zmdb/schema-core';

import { BaseRepository } from '../index.ts';
import { ProfileSchema, UserSchema, type Order, type Profile, type User } from './fixtures.ts';

// The repositories are keyed by the declared type; a *row* of one is `Entity<…>`, which is
// what the populate assertions below are about.
type OrderRow = Entity<Order>;

class Users extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}
// The to-one direction, from the side that holds the foreign key: `profiles.userId`.
class Profiles extends BaseRepository<Profile> {
  static override readonly schema = ProfileSchema;
}
declare const users: Users;
declare const profiles: Profiles;

// --- to-many: the relation is an array of the child entity ------------------
declare const populated: NonNullable<Awaited<ReturnType<typeof users.findById<'orders'>>>>;
export type _Pop1 = Expect<Equal<(typeof populated)['orders'], readonly OrderRow[]>>;
// The base columns survive untouched. `Mutual` rather than `Equal` throughout the
// bare-scalar assertions here: the fixtures are tagged types, so `name` is
// `string & Sql<'text'>` and the tag rides along by design. What matters is that the
// column is usable as a string, not that it is spelled like one.
export type _Pop2 = Expect<Mutual<(typeof populated)['name'], string>>;
// The child rows are entities, not `unknown` — `o.total` needs no cast.
export type _Pop3 = Expect<Mutual<(typeof populated)['orders'][number]['total'], number>>;

// --- to-one: a single child, nullable (the FK may match nothing) ------------
declare const withUser: NonNullable<Awaited<ReturnType<typeof profiles.findById<'user'>>>>;
export type _Pop4 = Expect<Equal<(typeof withUser)['user'], Entity<User> | null>>;

// --- find() populates every row --------------------------------------------
declare const found: Awaited<ReturnType<typeof users.find<'orders'>>>;
export type _Pop5 = Expect<Equal<(typeof found)[number]['orders'], readonly OrderRow[]>>;

// --- unpopulated relations are absent from the type ------------------------
// This is the "no lazy getters" guarantee: an unrequested relation is not a
// property, so reading it is a compile error rather than a silent `undefined`.
// (Value-level, because `ReturnType` on an overloaded method resolves to the last
// overload — the populate one — regardless of the arguments.)
export const _plain: Promise<Entity<User> | undefined> = users.findById(1);
declare const plain: Entity<User>;
export type _Pop6 = Expect<Equal<keyof typeof plain, 'id' | 'name'>>;
// @ts-expect-error — `orders` was not populated.
export const _noLazy = plain.orders;
// @ts-expect-error — 'nope' is not a declared relation.
export const _unknownRelation = users.findById(1, { populate: ['nope'] });
