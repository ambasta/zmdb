// @zmdb/schema-core/tags — the type-first declaration vocabulary.
//
// A domain type is declared as a plain interface plus these tags; everything else,
// the DTOs, the validators, the JSON Schema, the SQL — is derived from it.
//
//   interface User extends Table<'users'> {
//     id: number & Sql<'integer'> & Serial & PrimaryKey;
//     email: string & Sql<'varchar'> & Length<255> & Unique;
//     nickname: (string & MinLength<3>) | null;
//   }
//
// EVERY tag is an OPTIONAL unique-symbol slot, and all three parts carry weight:
//
//   - `unique symbol` is un-forgeable and cannot collide with a real data
//     property of the same name. A consumer cannot accidentally (or deliberately)
//     synthesise `Serial` by typing a property.
//   - `?` means no runtime value is ever required, so the tag erases completely.
//     Zero bytes reach the output — asserted by `erasure.spec.ts`, which compiles
//     a tagged declaration and its untagged twin and compares the emitted bytes.
//   - an all-optional (weak) object type is not assignable from an unrelated
//     type, which is what lets `T[K] extends Serial ? K : never` give an exact
//     answer rather than a false positive.
//
// A tag only has to NAME a constraint, never prove it. There are no conditional
// types, no recursion and no template-literal arithmetic in this file, which is
// what makes "zero type-level computation" true by construction instead of by
// discipline.
//
// There is deliberately NO tag for nullability, optionality, enums, arrays,
// readonly-ness or nested JSON shape: TypeScript already expresses those as
// `| null`, `?`, a literal union, `T[]`, `readonly` and a nested interface, and
// the reflection reads them off the type directly.
//
// A note on duplicate installs (plan D5).
//
// `unique symbol` identity is nominal, so two *copies* of this module produce two
// non-matching tags even though their source text is identical. A key filter then
// collapses to `never`, and `never` is assignable to anything, so `CreateDTO`
// silently stops omitting a serial column and starts requiring it. Reflection is
// name-based and therefore immune, which would make the emitted validator disagree
// with the derived type — that asymmetry is the real hazard, not the duplicate
// itself.
//
// Nothing in this file can guard against it: a runtime check here would give the
// tags a runtime cost, which is the one thing they must not have. The guard belongs
// in the reflection, which can see the escaped symbol ids (`__@zmdbSerial@1` vs
// `__@zmdbSerial@12`) that the type system distinguishes, and refuses the build
// when one tag name resolves to two declarations. Until that lands,
// `duplicate-install.type-test.ts` pins the failure mode exactly — using `Equal`
// throughout, never assignability, for the reason given there.

import type { SqlType } from '../index.ts';
import type { RelationKind } from '../ir/index.ts';

declare const zmdbTable: unique symbol;
declare const zmdbFts: unique symbol;
declare const zmdbSqlType: unique symbol;
declare const zmdbPrimaryKey: unique symbol;
declare const zmdbSerial: unique symbol;
declare const zmdbUnique: unique symbol;
declare const zmdbDefault: unique symbol;
declare const zmdbSensitive: unique symbol;
declare const zmdbReferences: unique symbol;
declare const zmdbLength: unique symbol;
declare const zmdbNumeric: unique symbol;
declare const zmdbCodec: unique symbol;
declare const zmdbWire: unique symbol;
declare const zmdbRelation: unique symbol;
declare const zmdbMin: unique symbol;
declare const zmdbMax: unique symbol;
declare const zmdbMinLength: unique symbol;
declare const zmdbMaxLength: unique symbol;
declare const zmdbPattern: unique symbol;
declare const zmdbRule: unique symbol;

// ---------------------------------------------------------------------------
// Entity-level tags — applied to the interface itself, via `extends`.
// ---------------------------------------------------------------------------

/** The table an entity maps to. `interface User extends Table<'users'>`. */
export type Table<Name extends string> = { readonly [zmdbTable]?: Name };

/** The full-text-search table backing this entity (`CoreSchema.ftsTable`). */
export type Fts<Name extends string | true> = { readonly [zmdbFts]?: Name };

// ---------------------------------------------------------------------------
// Column-level structural tags — facts the SQL layer needs that TypeScript
// cannot express. `Sql<T>` is the important one: `integer`, `bigint` and
// `numeric` are all `number` in TypeScript, so the column type has to be said.
// ---------------------------------------------------------------------------

/**
 * The SQL column types a declaration may name: every `SqlType` except `serial`.
 *
 * `serial` is not a column type. Postgres documents it as notational convenience for
 * an `integer` with a sequence default, and that is how it is spelled here —
 * `number & Sql<'integer'> & Serial` — which makes `Serial` the single place the fact
 * lives, the way `| null` is the single place nullability lives (REQ-TF-2).
 *
 * Saying it twice was not merely redundant, it was wrong, and the way it was wrong is
 * worth recording because nothing about the tags predicts it. Tag payloads are
 * invariant, so the old `Sql<'serial'>` spelling was not assignable to `Sql<'integer'>` and
 * a value read out of a serial primary key could not be written into an `integer` foreign key.
 * `orders.create({ userId: user.id })` — the most ordinary line in a relational model —
 * did not compile. With `serial` off the vocabulary the tags on `id` are
 * `Sql<'integer'> & Serial & PrimaryKey`, which drops to `Sql<'integer'>` on the way in,
 * and it does.
 *
 * The residue is honest and much smaller: two columns whose SQL types genuinely differ
 * still do not interchange, so assigning a `Sql<'varchar'>` value into a `Sql<'text'>`
 * column needs a conversion at the boundary. That is a rarer thing to write than a
 * foreign key, and unlike the serial case the two columns really are different types.
 */
export type ColumnSqlType = Exclude<SqlType, 'serial'>;

/** The abstract SQL column type. Dialects render the spelling — see `../ir`. */
export type Sql<T extends ColumnSqlType> = { readonly [zmdbSqlType]?: T };

export type PrimaryKey = { readonly [zmdbPrimaryKey]?: true };
/** Database-generated. Omitted from `CreateDTO` entirely, not made optional. */
export type Serial = { readonly [zmdbSerial]?: true };
export type Unique = { readonly [zmdbUnique]?: true };
/** Has a database default, so it is *optional* on insert rather than absent. */
export type HasDefault = { readonly [zmdbDefault]?: true };
/** Never serialised. `ReadDTO<T>` cannot name it, so a leak is a type error. */
export type Sensitive = { readonly [zmdbSensitive]?: true };
export type References<Target extends string> = { readonly [zmdbReferences]?: Target };
/** `varchar(N)`. Also emits `maxLength: N` into JSON Schema. */
export type Length<N extends number> = { readonly [zmdbLength]?: N };
/** `numeric(P, S)` precision and scale. */
export type Numeric<P extends number, S extends number> = { readonly [zmdbNumeric]?: readonly [P, S] };
/** Names a `CustomType` codec that converts between the wire, app and db types. */
export type Codec<Name extends string> = { readonly [zmdbCodec]?: Name };

/**
 * What this column looks like over the wire, when that is not what it looks like in
 * the app.
 *
 * The only tag whose payload is a *type* rather than a literal, and it has to be: a
 * codec's wire type is arbitrary — cents as a decimal string, a UUID as a string, a
 * point as `[number, number]` — so there is nothing to name it with but the type
 * itself. `Wire<T>` reads it; a column without it is its own wire type, which is
 * right for everything JSON can carry natively.
 *
 *   amount: Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;
 *
 * `Sql<'timestamp'>` and `Sql<'bigint'>` do not need it. Their wire form follows from
 * the SQL type and is built into `Wire<T>`, so writing it out would be a second place
 * for the same fact to be wrong.
 */
export type WireAs<W> = { readonly [zmdbWire]?: W };

// ---------------------------------------------------------------------------
// Relation tags — cardinality plus the column that carries the join.
// ---------------------------------------------------------------------------

/**
 * The four cardinalities. Listed once so `AnyRelation` cannot fall behind the tags — and
 * listed in `../ir`, where the same four exist as data for the reflection to check against.
 * Re-exported here because this is where a reader looking at the tags expects to find it.
 */
export type { RelationKind } from '../ir/index.ts';

/**
 * Matches a property carrying any relation tag, whatever its cardinality.
 *
 * `derive`'s `RelationKeys<T>` needs this because a relation is **not** a column:
 * `Entity<T>` has to exclude `author` and `comments` or a join target would show up
 * as something to `INSERT`. Written as `{ kind: RelationKind }` rather than
 * `unknown` on purpose — an optional slot typed `unknown` is satisfied by a tag
 * payload of any shape, including a future non-relation tag that happens to reuse
 * the symbol, and matching on `kind` keeps the four cardinalities the whole set.
 *
 * Cardinality itself is deliberately *not* read back out of the tag. The declared
 * type already says it: `author?: User & ManyToOne<…>` is to-one and
 * `comments?: Comment[] & OneToMany<…>` is to-many, natively.
 */
export type AnyRelation = { readonly [zmdbRelation]?: { readonly kind: RelationKind } };

export type ManyToOne<Target extends string, Fk extends string> = {
  readonly [zmdbRelation]?: { readonly kind: 'manyToOne'; readonly target: Target; readonly fk: Fk };
};
export type OneToMany<Target extends string, Fk extends string> = {
  readonly [zmdbRelation]?: { readonly kind: 'oneToMany'; readonly target: Target; readonly fk: Fk };
};
export type OneToOne<Target extends string, Fk extends string> = {
  readonly [zmdbRelation]?: { readonly kind: 'oneToOne'; readonly target: Target; readonly fk: Fk };
};
export type ManyToMany<Target extends string, Through extends string> = {
  readonly [zmdbRelation]?: { readonly kind: 'manyToMany'; readonly target: Target; readonly through: Through };
};

// ---------------------------------------------------------------------------
// Validation constraints. These are the whole reason the AOT can emit a real
// runtime check from a type: each one puts a literal in a type position.
// ---------------------------------------------------------------------------

export type Min<N extends number> = { readonly [zmdbMin]?: N };
export type Max<N extends number> = { readonly [zmdbMax]?: N };
export type MinLength<N extends number> = { readonly [zmdbMinLength]?: N };
export type MaxLength<N extends number> = { readonly [zmdbMaxLength]?: N };
export type Pattern<S extends string> = { readonly [zmdbPattern]?: S };

/**
 * The named escape hatch. `ValidationRule.kind` is an open `string`, so a
 * consumer can register a check the vocabulary does not model. The reflection
 * records the name and emits a call to the registered predicate — it does not
 * invent a check, and an unregistered name is a build error (plan D4).
 */
export type Rule<Name extends string> = { readonly [zmdbRule]?: Name };

// ---------------------------------------------------------------------------
// Readability aliases. Not tags — these expand to native TypeScript.
// ---------------------------------------------------------------------------

/** `Nullable<string>` is exactly `string | null`. No tag involved. */
export type Nullable<T> = T | null;
/** Non-null is the default; this exists for symmetry at the declaration site. */
export type NonNull<T> = Exclude<T, null | undefined>;
