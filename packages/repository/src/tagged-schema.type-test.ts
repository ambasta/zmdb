// REQ-TF-10, from the caller's side: `defineRepository(schemaOf<User>(), driver)` derives
// its whole surface from the *declaration*, not from the columns of a value.
//
// The sibling `generated-schema.spec.ts` proves the runtime half — the generated value
// compiles the same SQL as the authored one. This file proves the half a runtime test
// cannot see: that the repository's methods take and return `Entity<User>`,
// `CreateDTO<User>` and `PrimaryKeyOf<User>` as `@zmdb/schema-core/derive` defines them,
// with no edit to this package. `schemaOf<T>()` returns a `TaggedSchema<T>`, `Entity<S>`
// and friends branch on that brand, and the read DTOs are all built out of `Entity<S>`,
// so the four conditionals in schema-core are the entire mechanism.
//
// No runtime code — a compilation gate, run by `yarn typecheck` and therefore by CI.
// `schemaOf` is never called here: it is compiled away at build time, and calling it in a
// test that is not transformed would throw.

import { schemaOf, type Equal, type Expect, type Extends } from '@zmdb/schema-core';
import type {
  CreateDTO as TaggedCreateDTO,
  Entity as TaggedEntity,
  PrimaryKeyOf as TaggedPrimaryKeyOf,
  UpdateDTO as TaggedUpdateDTO,
} from '@zmdb/schema-core/derive';
import type { ListResult, WhereDTO } from '@zmdb/schema-core/dto';
import type {
  HasDefault,
  Max,
  Min,
  PrimaryKey,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
} from '@zmdb/schema-core/tags';

import { defineRepository, type Driver } from './index.ts';

interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
}

interface Membership extends Table<'memberships'> {
  userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;
  groupId: number & Sql<'integer'> & PrimaryKey & References<'groups.id'>;
}

declare const driver: Driver;

const users = defineRepository(schemaOf<User>(), driver);
const memberships = defineRepository(schemaOf<Membership>(), driver);

type Users = typeof users;

// --- reads -----------------------------------------------------------------
export type _Read1 = Expect<Equal<Awaited<ReturnType<Users['findAll']>>, readonly TaggedEntity<User>[]>>;
export type _Read2 = Expect<Equal<Parameters<Users['findOne']>[0], WhereDTO<ReturnType<typeof schemaOf<User>>>>>;
export type _Read3 = Expect<Equal<Awaited<ReturnType<Users['list']>>, ListResult<TaggedEntity<User>>>>;
// Overloaded, so probe at the value level — `ReturnType` would resolve the last overload
// whatever the arguments are.
export const _readById: Promise<TaggedEntity<User> | undefined> = users.findById(1);

// A `Sensitive` column stays on the entity: the row that comes back is the row the
// database has, and dropping it is `ReadDTO`'s job at the HTTP boundary, not the
// repository's. The tags ride along on the property type — they are optional phantoms, so
// the value is still a `string` to every caller — which is why this is an `Extends`.
type Row = Awaited<ReturnType<Users['findAll']>>[number];
export type _Row1 = Expect<Extends<'passwordHash', keyof Row>>;
export type _Row2 = Expect<Extends<Row['passwordHash'], string>>;
export type _Row3 = Expect<Extends<Row['createdAt'], Date>>;

// --- writes ----------------------------------------------------------------
export type _Write1 = Expect<Equal<Parameters<Users['create']>[0], TaggedCreateDTO<User>>>;
export type _Write2 = Expect<Equal<Awaited<ReturnType<Users['create']>>, TaggedEntity<User>>>;
export type _Write3 = Expect<Equal<Parameters<Users['update']>[1], TaggedUpdateDTO<User>>>;
export type _Write4 = Expect<Equal<Awaited<ReturnType<Users['update']>>, TaggedEntity<User> | undefined>>;

// The serial primary key is not in the create DTO at all, and the defaulted column is
// optional. Both facts come from the tags, and both are what a caller feels first.
export const _create: TaggedCreateDTO<User> = { email: 'a@b.com', age: 30, passwordHash: 'x' };
// @ts-expect-error — `id` is `Serial`: the database supplies it, so there is no key to set.
export const _createWithId: TaggedCreateDTO<User> = { id: 1, email: 'a@b.com', age: 30, passwordHash: 'x' };
// @ts-expect-error — `age` has no default, so it is required.
export const _createMissing: TaggedCreateDTO<User> = { email: 'a@b.com', passwordHash: 'x' };

// --- the primary key -------------------------------------------------------
// One column ⇒ the bare value; two ⇒ the object. `findById` takes whichever, which is why
// `PrimaryKeyOf` has to travel with the declaration rather than be reconstructed.
export type _Key1 = Expect<Extends<TaggedPrimaryKeyOf<User>, number>>;
export type _Key2 = Expect<Equal<keyof TaggedPrimaryKeyOf<Membership>, 'userId' | 'groupId'>>;
export const _byCompositeKey: Promise<TaggedEntity<Membership> | undefined> = memberships.findById({
  userId: 1,
  groupId: 2,
});
// @ts-expect-error — a composite key is not a scalar.
export const _byScalarKey = memberships.findById(1);
