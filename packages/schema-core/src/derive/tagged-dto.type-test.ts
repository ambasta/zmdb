// Type-level tests for the tagged DTO suite (PRD §6.7 REQ-TF-4 … REQ-TF-6).
// No runtime code: this is a *compilation* gate run by `yarn typecheck`, and
// therefore by CI.
//
// Every assertion here uses `Equal`, never assignability. That is not stylistic.
// A key filter that stops matching resolves to `never`, and `never` is assignable
// to everything — so `SerialKeys<User> extends 'id'` passes even when the filter
// is completely broken. The first probe written for plan D5 was fooled by exactly
// that and reported success while no tag was matching at all. Exact identity is
// the only assertion that catches it.

import type { Equal, Expect } from '../index.ts';
import type {
  HasDefault,
  Length,
  Max,
  Min,
  MinLength,
  Pattern,
  PrimaryKey,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '../tags/index.ts';
import type {
  CreateDTO,
  DefaultKeys,
  Entity,
  NullableKeys,
  PrimaryKeyKeys,
  PrimaryKeyOf,
  ReadDTO,
  SensitiveKeys,
  SerialKeys,
  UniqueKeys,
  UpdateDTO,
  Wire,
  WhereDTO,
} from './index.ts';

interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey & Min<1>;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  // Nullable AND defaulted. The reason the key filters test `NonNullable<T[K]>`:
  // `null` is not assignable to a weak object type, so this union as a whole does
  // not match `HasDefault`, and a bare `T[K]` would make it required on insert.
  nickname: (string & Sql<'varchar'> & Length<64> & MinLength<3> & HasDefault) | null;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
  active: boolean & Sql<'boolean'>;
}

interface Membership extends Table<'memberships'> {
  tenantId: string & Sql<'varchar'> & Length<32> & PrimaryKey;
  userId: number & Sql<'integer'> & PrimaryKey;
  role: ('admin' | 'viewer') & Sql<'jsonEnum'>;
}

// --- key filters -----------------------------------------------------------
export type _K1 = Expect<Equal<SerialKeys<User>, 'id'>>;
export type _K2 = Expect<Equal<DefaultKeys<User>, 'nickname' | 'createdAt'>>;
export type _K3 = Expect<Equal<PrimaryKeyKeys<User>, 'id'>>;
export type _K4 = Expect<Equal<SensitiveKeys<User>, 'passwordHash'>>;
export type _K5 = Expect<Equal<UniqueKeys<User>, 'email'>>;
export type _K6 = Expect<Equal<NullableKeys<User>, 'nickname'>>;
export type _K7 = Expect<Equal<PrimaryKeyKeys<Membership>, 'tenantId' | 'userId'>>;

// A tag must not false-positive on a column carrying *other* tags. `email` has
// four of them and is none of these.
export type _K8 = Expect<Equal<SerialKeys<Membership>, never>>;
export type _K9 = Expect<Equal<SensitiveKeys<Membership>, never>>;

// Entity-level tags arrive via `extends` and must not leak into `keyof`.
export type _K10 = Expect<
  Equal<keyof Entity<User>, 'id' | 'email' | 'age' | 'nickname' | 'createdAt' | 'passwordHash' | 'active'>
>;

// --- CreateDTO: Serial absent, HasDefault optional -------------------------
//
// The distinction the two tags exist for. A database-generated column is *gone*,
// so naming it is a compile error; a defaulted column is *present and optional*,
// because supplying it is legitimate.
export type _C1 = Expect<Equal<'id' extends keyof CreateDTO<User> ? true : false, false>>;
export type _C2 = Expect<Equal<Extract<keyof CreateDTO<User>, 'createdAt' | 'nickname'>, 'createdAt' | 'nickname'>>;
export type _C3 = Expect<Equal<CreateDTO<User> extends { createdAt: unknown } ? true : false, false>>;
export const _C4: CreateDTO<User> = {
  email: 'a@b.co',
  age: 30,
  passwordHash: 'h',
  active: true,
};
// @ts-expect-error a database-generated column cannot be supplied on insert
export const _C5: CreateDTO<User> = { id: 1, email: 'a@b.co', age: 30, passwordHash: 'h', active: true };

// --- constraints survive Omit / Pick / Partial (REQ-TF-5) ------------------
//
// If a tag were dropped by a derivation the AOT would emit a weaker check for the
// update path than for the insert path, silently.
export type _S1 = Expect<Equal<CreateDTO<User>['age'], number & Sql<'integer'> & Min<18> & Max<120>>>;
export type _S2 = Expect<Equal<NonNullable<UpdateDTO<User>['age']>, number & Sql<'integer'> & Min<18> & Max<120>>>;
export type _S3 = Expect<
  Equal<NonNullable<WhereDTO<User>['email']>, string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>>
>;

// --- UpdateDTO: Serial and PrimaryKey dropped, rest optional ---------------
export type _U1 = Expect<Equal<'id' extends keyof UpdateDTO<User> ? true : false, false>>;
export const _U2: UpdateDTO<User> = {};
export const _U3: UpdateDTO<User> = { nickname: null };

// --- ReadDTO: sensitive columns are not nameable (REQ-TF-6) ----------------
export type _R1 = Expect<Equal<'passwordHash' extends keyof ReadDTO<User> ? true : false, false>>;
declare const read: ReadDTO<User>;
// @ts-expect-error a sensitive column must not be readable off a read DTO
export const _R2 = read.passwordHash;

// --- PrimaryKeyOf: scalar for one key, object map for a composite ----------
export type _P1 = Expect<Equal<PrimaryKeyOf<User>, number & Sql<'serial'> & Serial & PrimaryKey & Min<1>>>;
export type _P2 = Expect<
  Equal<
    PrimaryKeyOf<Membership>,
    { tenantId: string & Sql<'varchar'> & Length<32> & PrimaryKey; userId: number & Sql<'integer'> & PrimaryKey }
  >
>;

// --- Wire: the three types of a column (plan D3 / REQ-TF-13) ---------------
//
// `createdAt` is a `Date` in the app type and an ISO string on the wire, because
// a `Date` cannot survive JSON. Both are correct; each belongs to its own layer.
export type _W1 = Expect<Equal<Entity<User>['createdAt'], Date & Sql<'timestamp'> & HasDefault>>;
export type _W2 = Expect<Equal<Wire<User>['createdAt'], string>>;
export type _W3 = Expect<Equal<Wire<User>['age'], number & Sql<'integer'> & Min<18> & Max<120>>>;
