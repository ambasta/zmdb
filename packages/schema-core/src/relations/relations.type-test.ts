// Compile-time type assertions for relations and foreign key constraints.
// Checked by `yarn typecheck`.

import {
  defineSchema,
  serial,
  text,
  integer,
  references,
  type ColumnMeta,
  type Entity,
  type Equal,
  type Expect,
} from '../index.ts';
import {
  manyToOne,
  oneToMany,
  oneToOne,
  attachPopulated,
  type JoinRow,
  type PopulatedEntity,
  type RelationMeta,
  type RelationDef,
} from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

const ProfileSchema = defineSchema('profiles', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  bio: text(),
});

type UserEntity = Entity<typeof UserSchema>;
type ProfileEntity = Entity<typeof ProfileSchema>;

// 1. Foreign key type checking with references(...)
const validFk = references(integer(), UserSchema, 'id');
type TestValidFk = Expect<typeof validFk['references'] extends { target: string } ? true : false>;

// @ts-expect-error - 'invalid_col' does not exist on UserSchema
references(integer(), UserSchema, 'invalid_col');

// Foreign key type mismatch returns branded error object
const textCol = text();
const mismatchRef = references(textCol, UserSchema, 'id');
type TestMismatchError = Expect<Equal<typeof mismatchRef, { __error: 'Referenced column type does not match' }>>;

// Assigning a mismatched reference to a ColumnMeta property fails type check
// @ts-expect-error - Referenced column type does not match
const _invalidRefCol: ColumnMeta = references(textCol, UserSchema, 'id');

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

type TestPopulatedUser = Expect<Equal<PopulatedOrder['user'], UserEntity>>;
type TestPopulatedProfiles = Expect<Equal<PopulatedOrder['profiles'], ProfileEntity[]>>;

// Bare relation metadata (without entity) resolves to never in PopulatedEntity
type BareRel = RelationMeta<unknown>;
type PopulatedBare = PopulatedEntity<OrderBase, { bare: BareRel }, 'bare'>;
type TestBareRejected = Expect<Equal<PopulatedBare['bare'], never>>;

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
  orders: { meta: RelationMeta; entity: Order; cardinality: 'one-to-many' };
  manager: { meta: RelationMeta; entity: User; cardinality: 'many-to-one' };
};

type Populated = PopulatedEntity<User, UserRelations, 'orders'>;
export type _Pop1 = Expect<Equal<Populated['orders'], Order[]>>;
export type _Pop2 = Expect<Equal<Populated['id'], number>>;
export type _Pop3 = Expect<Equal<PopulatedEntity<User, UserRelations, 'manager'>['manager'], User>>;
export type _Pop4 = Expect<Equal<keyof PopulatedEntity<User, UserRelations, never>, keyof User>>;

interface IndexedRelations {
  orders: RelationDef & { cardinality: 'one-to-many'; entity: Order };
  [k: string]: RelationDef;
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
