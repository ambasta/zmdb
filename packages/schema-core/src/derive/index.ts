// @zmdb/schema-core/derive — the DTO suite, derived from a tagged type.
//
// Implements PRD §6.7 REQ-TF-4 … REQ-TF-6. These are the same names the
// schema-value derivations in `../index.ts` use, deliberately: per plan D2 there
// is to be exactly one `Entity`/`CreateDTO`/`UpdateDTO`, and these are the ones
// that survive. They live in a separate module only so the repository, the web
// package and every fixture keep compiling while the migration runs; Phase 9
// deletes the schema-value versions and re-points the package root here.
//
// Every derivation takes a tagged type and nothing else. There is no conditional
// dispatch on `{ columns: ... }`, because backwards compatibility is not a
// requirement (plan D2) — which also means no per-use `extends` test, and no
// instantiation cost from the dispatch.

import type { AnyRelation, HasDefault, PrimaryKey, Sensitive, Serial, Sql, Unique } from '../tags/index.ts';

// ---------------------------------------------------------------------------
// Key filters.
// ---------------------------------------------------------------------------
//
// `NonNullable<T[K]>` rather than a bare `T[K]` is load-bearing. A nullable
// column with a default is declared `(string & HasDefault) | null`, and `null` is
// not assignable to a weak object type, so the union as a whole does not match
// `HasDefault`. Testing the non-nullable arm is what makes a nullable defaulted
// column optional on insert instead of required. `tagged-dto.type-test.ts` pins
// this down — it is exactly the sort of thing that silently returns `never`.
//
// `-?` strips optionality from the probe so an already-optional property is still
// examined under `exactOptionalPropertyTypes`.
//
// Symbol keys are filtered out everywhere below: entity-level tags (`Table`,
// `Fts`) arrive through `extends` and would otherwise show up in `keyof`.

export type KeysCarrying<T, Tag> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Tag ? (K extends string ? K : never) : never;
}[keyof T];

/** Columns the database generates. Omitted from `CreateDTO` outright. */
export type SerialKeys<T> = KeysCarrying<T, Serial>;
/** Columns with a database default. Optional on insert, not absent. */
export type DefaultKeys<T> = KeysCarrying<T, HasDefault>;
export type PrimaryKeyKeys<T> = KeysCarrying<T, PrimaryKey>;
export type SensitiveKeys<T> = KeysCarrying<T, Sensitive>;
export type UniqueKeys<T> = KeysCarrying<T, Unique>;
/** Columns whose declared type admits `null`. Native, not a tag (REQ-TF-2). */
export type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? (K extends string ? K : never) : never }[keyof T];

/**
 * Properties declared with a relation tag — a join target, not a column.
 *
 * These have to come out of `Entity<T>`, and therefore out of everything derived
 * from it. A relation left in would be a column to `INSERT`, a column to `SELECT`
 * and a JSON Schema property, none of which it is. `./query.ts` puts them back where
 * they belong, in `Populated<T, K>`.
 */
export type RelationKeys<T> = KeysCarrying<T, AnyRelation>;

/**
 * Everything that is a column: a data key that is not a relation.
 *
 * Spelled as its own projection rather than as a subtraction. `Exclude<AllKeys<T>,
 * RelationKeys<T>>` does not compile: for an unresolved `T` both operands normalise to
 * the same deferred expression, so the subtraction yields `never`, and then
 * `Pick<Entity<T>, DefaultKeys<T>>` is an error because nothing is a key of an entity
 * with no keys.
 */
export type ColumnKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends AnyRelation ? never : K extends string ? K : never;
}[keyof T];

// ---------------------------------------------------------------------------
// The DTO suite.
// ---------------------------------------------------------------------------

/**
 * The selectable row: every column, required, sensitive columns included, tags
 * preserved. Tags must survive here or the constraints would not survive `Omit`
 * and `Partial` downstream (REQ-TF-5).
 *
 * Relations are not columns and are not here. See `RelationKeys`.
 */
export type Entity<T> = { -readonly [K in ColumnKeys<T>]-?: T[K] };

/**
 * A tag filter's keys, narrowed to the keys `Entity<T>` actually has.
 *
 * `SerialKeys<T>` and friends are subsets of `ColumnKeys<T>` by construction — a
 * relation cannot carry `Serial` — but TypeScript will not take it on trust. Relating
 * two of these projections for an unresolved `T` works only while the *target*'s
 * template is unconditional, which `DataKeys<T>` was and `ColumnKeys<T>` is not. So the
 * subset is stated as an intersection, which is assignable to either side by
 * definition, rather than proved. Nothing changes for a concrete type.
 */
type AsColumns<T, K> = K & keyof Entity<T>;

/**
 * Insert shape. `Serial` columns are **absent** — naming one is a compile error,
 * because the database generates the value. `HasDefault` columns are **present
 * and optional**, because supplying one is legitimate. That distinction is the
 * whole reason the two tags are separate.
 *
 * A nullable column is optional for the same reason a defaulted one is: omitting it
 * inserts `NULL`, which is exactly what passing `null` does, so demanding the key adds
 * ceremony and no information. The published document has always said this — a nullable
 * column has never appeared in a `create` document's `required` — and so did the
 * repository's runtime check. Requiring `bio: null` in the type while the contract said
 * it was optional meant a client that followed the contract wrote a payload the type
 * rejected, which is the disagreement this phase exists to remove. It stays *present* and
 * optional rather than absent, because passing `null` explicitly is legitimate.
 */
export type CreateDTO<T> = Omit<Entity<T>, SerialKeys<T> | DefaultKeys<T> | NullableKeys<T>> &
  Partial<Pick<Entity<T>, AsColumns<T, DefaultKeys<T> | NullableKeys<T>>>>;

/** Patch shape: identity columns dropped, everything else optional. */
export type UpdateDTO<T> = Partial<Omit<Entity<T>, SerialKeys<T> | PrimaryKeyKeys<T>>>;

/**
 * What a read endpoint may return. `Sensitive` columns are removed from the
 * type, so a leak is a compile error rather than a serializer's responsibility
 * (REQ-TF-6).
 */
export type ReadDTO<T> = Omit<Entity<T>, SensitiveKeys<T>>;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The key value: a scalar for a single-column key, an object map for a composite
 * one, `unknown` when the type declares no primary key.
 *
 * Named `PrimaryKeyOf` so the tag can be `PrimaryKey`, which is the name typed at
 * every declaration site (plan D1).
 */
export type PrimaryKeyOf<T> = [PrimaryKeyKeys<T>] extends [never]
  ? unknown
  : IsUnion<PrimaryKeyKeys<T>> extends true
    ? { [K in PrimaryKeyKeys<T>]: Entity<T>[AsColumns<T, K>] }
    : Entity<T>[AsColumns<T, PrimaryKeyKeys<T>>];

// ---------------------------------------------------------------------------
// The wire shape (plan D3).
// ---------------------------------------------------------------------------
//
// A column has three types: wire (what arrives over HTTP), app (what handler code
// sees) and db (what the dialect declares). `Entity<T>` is the app type. `Wire<T>`
// is what a JSON body actually contains, which for a timestamp is an ISO-8601
// string, never a `Date` — a `Date` cannot survive JSON. The web pipeline decodes
// wire → app once at the boundary so handlers keep seeing `Date`.

type WireValue<V> =
  NonNullable<V> extends Sql<'timestamp'>
    ? null extends V
      ? string | null
      : string
    : NonNullable<V> extends Sql<'bigint'>
      ? null extends V
        ? string | null
        : string
      : V;

/** The over-the-wire shape of an entity: JSON-representable throughout. */
export type Wire<T> = { -readonly [K in ColumnKeys<T>]-?: WireValue<T[K]> };

/** The over-the-wire shape of an insert payload. */
export type WireCreateDTO<T> = { [K in keyof CreateDTO<T>]: WireValue<CreateDTO<T>[K]> };

// The read/query surface — `WhereDTO`, `OrderByDTO`, `PaginationDTO`, `Projection`,
// `GetDTO`, `ListDTO`, `Populated`, `JoinRow` — is in `./query.ts`, re-exported here
// so `@zmdb/schema-core/derive` is one import.
export type {
  GetDTO,
  GetOptions,
  JoinRow,
  ListDTO,
  ListResult,
  OrderByDTO,
  PaginationDTO,
  Populated,
  PopulatedEntity,
  Projection,
  WhereDTO,
} from './query.ts';
