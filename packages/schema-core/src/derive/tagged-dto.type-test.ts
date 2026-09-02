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
  Codec,
  HasDefault,
  Length,
  ManyToOne,
  Max,
  Min,
  MinLength,
  OneToMany,
  Pattern,
  PrimaryKey,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
  WireAs,
} from '../tags/index.ts';
import type {
  ColumnKeys,
  CreateDTO,
  DefaultKeys,
  Entity,
  GetDTO,
  JoinRow,
  ListDTO,
  NullableKeys,
  OrderByDTO,
  PaginationDTO,
  Populated,
  PrimaryKeyKeys,
  PrimaryKeyOf,
  Projection,
  ReadDTO,
  RelationKeys,
  SensitiveKeys,
  SerialKeys,
  UniqueKeys,
  UpdateDTO,
  Wire,
  WireCreateDTO,
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
// `WhereDTO` admits a bare value *or* an operator bag, so the tagged type is one arm of
// a union here rather than the whole property. Excluding the operator bag is what makes
// this an exact assertion rather than "something in there is assignable".
export type _S3 = Expect<
  Equal<
    Extract<NonNullable<WhereDTO<User>['email']>, string>,
    string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>
  >
>;
export const _S4: WhereDTO<User> = { age: { gte: 18, lt: 65 }, or: [{ active: true }, { nickname: null }] };

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

// A column the library knows nothing about says its own wire form, and that beats the
// SQL-type rules: a codec may put anything on the wire and only the declaration knows
// what. `Money` here is cents in the app and a decimal string over HTTP.
interface Money {
  readonly cents: number;
}
interface Invoice extends Table<'invoices'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  amount: Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;
  refund: (Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>) | null;
  paidAt: Date & Sql<'timestamp'>;
}
export type _W4 = Expect<Equal<Entity<Invoice>['amount'], Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>>>;
export type _W5 = Expect<Equal<Wire<Invoice>['amount'], string>>;
// Nullability belongs to the column, not to the layer.
export type _W6 = Expect<Equal<Wire<Invoice>['refund'], string | null>>;
export type _W7 = Expect<Equal<Wire<Invoice>['paidAt'], string>>;
// An untagged column is its own wire type, tags and all — `WireAs` must not match a
// column that merely carries *other* tags.
export type _W8 = Expect<Equal<Wire<Invoice>['id'], number & Sql<'serial'> & Serial & PrimaryKey>>;
// The insert payload's wire shape drops the generated column and converts the rest.
export type _W9 = Expect<Equal<keyof WireCreateDTO<Invoice>, 'amount' | 'paidAt' | 'refund'>>;
export type _W10 = Expect<Equal<WireCreateDTO<Invoice>['amount'], string>>;

// --- relations: declared on the type, and not columns -----------------------
//
// A relation property is a join target, so it must not appear in the row. If it did it
// would be a column to `INSERT`, a column to `SELECT` and a JSON Schema property, none
// of which it is — and nothing would have said so out loud.

interface Comment extends Table<'comments'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  postId: number & Sql<'integer'> & References<'posts'>;
  body: string & Sql<'text'>;
}

interface Post extends Table<'posts'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'users'>;
  title: string & Sql<'varchar'> & Length<200>;
  author?: User & ManyToOne<'users', 'authorId'>;
  comments?: Comment[] & OneToMany<'comments', 'postId'>;
}

export type _N1 = Expect<Equal<RelationKeys<Post>, 'author' | 'comments'>>;
export type _N2 = Expect<Equal<ColumnKeys<Post>, 'id' | 'authorId' | 'title'>>;
export type _N3 = Expect<Equal<keyof Entity<Post>, 'id' | 'authorId' | 'title'>>;
export type _N4 = Expect<Equal<'author' extends keyof CreateDTO<Post> ? true : false, false>>;
// A type with no relations must still name every column — the filter has to be able to
// match nothing without taking the whole row with it.
export type _N5 = Expect<Equal<RelationKeys<User>, never>>;
export type _N6 = Expect<Equal<ColumnKeys<User>, keyof Entity<User>>>;

// --- Populated: cardinality comes from the declaration, not the tag ---------
export type _N7 = Expect<Equal<Populated<Post, 'author'>['author'], User & ManyToOne<'users', 'authorId'>>>;
export type _N8 = Expect<Equal<Populated<Post, 'comments'>['comments'], Comment[] & OneToMany<'comments', 'postId'>>>;
// Populating one relation must not conjure the other.
export type _N9 = Expect<Equal<'comments' extends keyof Populated<Post, 'author'> ? true : false, false>>;
// @ts-expect-error a column is not a relation and cannot be populated
export type _N10 = Populated<Post, 'title'>;

// --- JoinRow: LEFT may miss, INNER may not ----------------------------------
export type _N11 = Expect<Equal<JoinRow<Post, 'comments', 'inner'>['body'], string & Sql<'text'>>>;
export type _N12 = Expect<Equal<JoinRow<Post, 'comments'>['body'], (string & Sql<'text'>) | undefined>>;
// The base row's own columns are never optional, whichever join it was.
export type _N13 = Expect<Equal<JoinRow<Post, 'author'>['title'], string & Sql<'varchar'> & Length<200>>>;

// --- the read/query shapes are keyed off the columns ------------------------
export type _Q1 = Expect<Equal<OrderByDTO<Post>[number]['column'], 'id' | 'authorId' | 'title'>>;
export const _Q2: OrderByDTO<Post> = [{ column: 'title', dir: 'desc' }];
// @ts-expect-error a relation is not orderable
export const _Q3: OrderByDTO<Post> = [{ column: 'comments' }];
export const _Q4: PaginationDTO<Post> = { limit: 10, offset: 20 };
export const _Q5: PaginationDTO<Post> = { limit: 10, after: { id: 7 } };
export type _Q6 = Expect<Equal<keyof Projection<Post, 'id' | 'title'>, 'id' | 'title'>>;
export type _Q7 = Expect<Equal<GetDTO<Post>, Entity<Post>>>;
export type _Q8 = Expect<Equal<keyof GetDTO<Post, { select: readonly ['title'] }>, 'title'>>;
export const _Q9: ListDTO<Post> = {
  where: { title: { like: '%ts%' } },
  orderBy: [{ column: 'id' }],
  page: { limit: 5 },
};
// `populate` names relations, which is the one thing a schema *value* cannot type: it is
// `readonly string[]` in `../dto/index.ts` because a `CoreSchema` carries no relations.
export const _Q10: { populate?: readonly RelationKeys<Post>[] } = { populate: ['author', 'comments'] };
// @ts-expect-error a column is not populatable
export const _Q11: { populate?: readonly RelationKeys<Post>[] } = { populate: ['title'] };
