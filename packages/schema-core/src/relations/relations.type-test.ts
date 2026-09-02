// Compile-time type assertions for relations and foreign key constraints.
// Checked by `yarn typecheck`.

import type { Entity, Equal, Expect } from '../index.ts';
import { ProfileSchema, UserSchema } from './fixtures.ts';
import {
  manyToOne,
  oneToMany,
  oneToOne,
  type attachPopulated,
  type JoinRow,
  type PopulatedEntity,
  type RelationMeta,
  type RelationDef,
} from './index.ts';

type UserEntity = Entity<typeof UserSchema>;
type ProfileEntity = Entity<typeof ProfileSchema>;

// 1. Foreign key type checking — deleted with `references()` (plan D2).
//
// `references(integer(), UserSchema, 'id')` took a column *builder*'s output and compared its
// TypeScript type against the target column's, which needed the target schema value's literal
// column map. Four assertions lived here: a valid key, a column name that does not exist on the
// target, a type mismatch resolving to a branded `{ __error }`, and that branded object failing
// to assign to a `ColumnMeta`.
//
// The tagged spelling is `References<'users.id'>` on the column, and it does not carry the type
// comparison: it is a string, and the reflection has one table in front of it. What survives is
// `tags/serial-foreign-key.type-test.ts`, which covers the case a single declaration can state —
// a column pointing at a `Serial` primary key has to be a plain `number`. Comparing a foreign key
// against the type of the column it names is a check nothing performs today.

// 2. Relation builders column validation
// @ts-expect-error - 'bad_col' is not a column of UserSchema
manyToOne(UserSchema, 'bad_col');

// @ts-expect-error - 'missing_fk' is not a column of ProfileSchema
oneToMany(ProfileSchema, 'missing_fk');

// @ts-expect-error - 'unknown_col' is not a column of ProfileSchema
oneToOne(ProfileSchema, 'unknown_col');

// 3. PopulatedEntity type derivation and bare metadata rejection
const userRel = manyToOne(UserSchema, 'id');
const profileRel = oneToMany(ProfileSchema, 'userId');

type OrderBase = { id: number; total: number };
type Relations = {
  user: typeof userRel;
  profiles: typeof profileRel;
};

type PopulatedOrder = PopulatedEntity<OrderBase, Relations, 'user' | 'profiles'>;

export type TestPopulatedUser = Expect<Equal<PopulatedOrder['user'], UserEntity>>;
export type TestPopulatedProfiles = Expect<Equal<PopulatedOrder['profiles'], ProfileEntity[]>>;

// Bare relation metadata (without entity) resolves to never in PopulatedEntity
type BareRel = RelationMeta<unknown>;
type PopulatedBare = PopulatedEntity<OrderBase, { bare: BareRel }, 'bare'>;
export type TestBareRejected = Expect<Equal<PopulatedBare['bare'], never>>;

// --- PopulatedEntity basic shapes ------------------------------------------
interface User {
  id: number;
  name: string;
}
interface Order {
  id: number;
  total: number;
}

type UserRelations = {
  orders: RelationDef<Order> & { cardinality: 'one-to-many' };
  manager: RelationDef<User> & { cardinality: 'many-to-one' };
};

type Populated = PopulatedEntity<User, UserRelations, 'orders'>;
export type _Pop1 = Expect<Equal<Populated['orders'], Order[]>>;
export type _Pop2 = Expect<Equal<Populated['id'], number>>;
export type _Pop3 = Expect<Equal<PopulatedEntity<User, UserRelations, 'manager'>['manager'], User>>;
export type _Pop4 = Expect<Equal<keyof PopulatedEntity<User, UserRelations, never>, keyof User>>;

interface IndexedRelations {
  orders: RelationDef<Order> & { cardinality: 'one-to-many' };
  [k: string]: RelationDef<unknown>;
}
export type _Pop5 = Expect<Equal<PopulatedEntity<User, IndexedRelations, 'orders'>['orders'], Order[]>>;

// --- attachPopulated -------------------------------------------------------
type UserRow = { id: number; name: string };
export type _Attach1 = Expect<
  Equal<ReturnType<typeof attachPopulated<UserRow, 'orders', Order[]>>, UserRow & { orders: Order[] }>
>;

// --- JoinRow ---------------------------------------------------------------
interface Emp {
  id: number;
  recipient_id: number;
}
interface Recipient {
  r_id: number;
  r_name: string;
}
export type _Join1 = Expect<Equal<JoinRow<Emp, Recipient, 'left'>['r_name'], string | undefined>>;
export type _Join2 = Expect<Equal<JoinRow<Emp, Recipient, 'inner'>['r_name'], string>>;
export type _Join3 = Expect<Equal<JoinRow<Emp, Recipient>, JoinRow<Emp, Recipient, 'left'>>>;
