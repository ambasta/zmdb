// @zmdb/schema-core/tags — the type-first declaration vocabulary.
//
// Implements PRD §6.7 REQ-TF-1 … REQ-TF-3 and `DESIGN-type-first.md` §3. A domain
// type is declared as a plain interface plus these tags; everything else — the
// DTOs, the validators, the JSON Schema, the SQL — is derived from it.
//
//   interface User extends Table<'users'> {
//     id: number & Sql<'serial'> & Serial & PrimaryKey;
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
// what makes REQ-TF-3 ("zero type-level computation") true by construction
// instead of by discipline.
//
// There is deliberately NO tag for nullability, optionality, enums, arrays,
// readonly-ness or nested JSON shape: TypeScript already expresses those as
// `| null`, `?`, a literal union, `T[]`, `readonly` and a nested interface, and
// the reflection reads them off the type directly (REQ-TF-2).
//
// ---------------------------------------------------------------------------
// A note on duplicate installs (plan D5)
// ---------------------------------------------------------------------------
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

/** The abstract SQL column type. Dialects render the spelling — see `../ir`. */
export type Sql<T extends SqlType> = { readonly [zmdbSqlType]?: T };

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

// ---------------------------------------------------------------------------
// Relation tags — cardinality plus the column that carries the join.
// ---------------------------------------------------------------------------

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
// Readability aliases. Not tags — these expand to native TypeScript (REQ-TF-2).
// ---------------------------------------------------------------------------

/** `Nullable<string>` is exactly `string | null`. No tag involved. */
export type Nullable<T> = T | null;
/** Non-null is the default; this exists for symmetry at the declaration site. */
export type NonNull<T> = Exclude<T, null | undefined>;
