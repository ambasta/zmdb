// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// REQ-TF-10, from the caller's side: `defineRepository(schemaOf<User>(), driver)` derives
// its whole surface from the *declaration*, not from the columns of a value.
//
// The sibling `tagged-to-ddl.spec.ts` covers the runtime half — a declaration reaching the
// database as the table it named, in all three dialects. This file covers the half a runtime
// test cannot see: that the repository's methods take and return `Entity<User>`,
// `CreateDTO<User>` and `PrimaryKeyOf<User>` as `@zmdb/schema/derive` defines them,
// with no edit to this package. There is no conditional anywhere in that path: every
// derivation takes the declared type, and the only crossing from a value to a type happens
// once, by inference, where `defineRepository` is handed a `TaggedSchema<T>`.
//
// No runtime code — a compilation gate, run by `yarn typecheck` and therefore by CI.
// `schemaOf` is never called here: it is compiled away at build time, and calling it in a
// test that is not transformed would throw.

import { createLoaderScope, defineRepository, type Driver, type UpdatePatch } from '@zmdb/orm';
import { schemaOf, type Equal, type Expect, type Extends } from '@zmdb/schema';
import { type CreateDTO, type Entity, type PrimaryKeyOf } from '@zmdb/schema/derive';
import { type ListResult, type WhereDTO } from '@zmdb/schema/dto';
import {
  type HasDefault,
  type Max,
  type Min,
  type PrimaryKey,
  type References,
  type Sensitive,
  type Serial,
  type Sql,
  type Table,
} from '@zmdb/schema/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
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
export type _Read1 = Expect<Equal<Awaited<ReturnType<Users['findAll']>>, readonly Entity<User>[]>>;
export type _Read2 = Expect<Equal<Parameters<Users['findOne']>[0], WhereDTO<User>>>;
export type _Read3 = Expect<Equal<Awaited<ReturnType<Users['list']>>, ListResult<Entity<User>>>>;
// Overloaded, so probe at the value level — `ReturnType` would resolve the last overload
// whatever the arguments are.
export const _readById: Promise<Entity<User> | undefined> = users.findById(1);

// A `Sensitive` column stays on the entity: the row that comes back is the row the
// database has, and dropping it is `ReadDTO`'s job at the HTTP boundary, not the
// repository's. The tags ride along on the property type — they are optional phantoms, so
// the value is still a `string` to every caller — which is why this is an `Extends`.
type Row = Awaited<ReturnType<Users['findAll']>>[number];
export type _Row1 = Expect<Extends<'passwordHash', keyof Row>>;
export type _Row2 = Expect<Extends<Row['passwordHash'], string>>;
export type _Row3 = Expect<Extends<Row['createdAt'], Date>>;

// --- writes ----------------------------------------------------------------
export type _Write1 = Expect<Equal<Parameters<Users['create']>[0], CreateDTO<User>>>;
export type _Write2 = Expect<Equal<Awaited<ReturnType<Users['create']>>, Entity<User>>>;
export type _Write3 = Expect<Equal<Parameters<Users['update']>[1], UpdatePatch<User>>>;
export type _Write4 = Expect<Equal<Awaited<ReturnType<Users['update']>>, Entity<User> | undefined>>;

// The serial primary key is not in the create DTO at all, and the defaulted column is
// optional. Both facts come from the tags, and both are what a caller feels first.
export const _create: CreateDTO<User> = { email: 'a@b.com', age: 30, passwordHash: 'x' };
// @ts-expect-error — `id` is `Serial`: the database supplies it, so there is no key to set.
export const _createWithId: CreateDTO<User> = { id: 1, email: 'a@b.com', age: 30, passwordHash: 'x' };
// @ts-expect-error — `age` has no default, so it is required.
export const _createMissing: CreateDTO<User> = { email: 'a@b.com', passwordHash: 'x' };

// --- the primary key -------------------------------------------------------
// One column ⇒ the bare value; two ⇒ the object. `findById` takes whichever, which is why
// `PrimaryKeyOf` has to travel with the declaration rather than be reconstructed.
export type _Key1 = Expect<Extends<PrimaryKeyOf<User>, number>>;
export type _Key2 = Expect<Equal<keyof PrimaryKeyOf<Membership>, 'userId' | 'groupId'>>;
export const _byCompositeKey: Promise<Entity<Membership> | undefined> = memberships.findById({
  userId: 1,
  groupId: 2,
});
// @ts-expect-error — a composite key is not a scalar.
export const _byScalarKey = memberships.findById(1);

// Keyless declarations support ordinary reads but cannot supply an entity key.
interface AuditLog extends Table<'audit_log'> {
  what: string & Sql<'text'>;
}
const auditLog = defineRepository(schemaOf<AuditLog>(), driver);
export const _keylessRows: Promise<readonly Entity<AuditLog>[]> = auditLog.findAll();
// @ts-expect-error a keyless table has no row identity
void auditLog.findById(1);
// @ts-expect-error a keyless table has no row identity
void auditLog.update(1, { what: 'updated' });
// @ts-expect-error a keyless table has no row identity
void auditLog.delete(1);
const auditLoader = createLoaderScope().loaderFor(auditLog);
// @ts-expect-error an entity loader cannot accept a key for a keyless table
void auditLoader.load(1);
