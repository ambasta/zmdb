// REQ-TF-1 — the tag vocabulary covers every column fact the IR has a field for.
// A compilation gate, not a runtime test. The failure mode it guards against is
// quiet: someone adds a `SqlType` or a `ColumnFlags` member, the tagged front-end
// silently cannot express it, and a declaration loses information that reaches the
// database anyway. It was originally written against `defineSchema`'s vocabulary,
// which was the standard to meet; the tags are now the only front-end, so the IR's
// own fields are the standard, and `ColumnIR` is what the totality is read off.

import type { ColumnFlags, Equal, Expect, SqlType } from '../index.js';
import type { ColumnSqlType } from '../tags/index.js';
import type {
  ColumnIR,
  ConstraintKind,
  Constraints,
  PROTO_SCALARS,
  PropertyIR,
  ProtoScalar,
  SQL_TYPES,
  ScalarIR,
  TAG_NAMES,
  TagField,
} from './index.js';

// --- every SqlType is in SQL_TYPES, and nothing else is --------------------
//
// `satisfies readonly SqlType[]` at the declaration only catches an *extra*
// member. This catches a *missing* one, which is the direction that actually
// happens.
export type _V1 = Expect<Equal<(typeof SQL_TYPES)[number], SqlType>>;

// `Sql<T extends ColumnSqlType>` accepts every SQL type but one, and `ColumnSqlType` is
// `Exclude<SqlType, 'serial'>` — so a new member of `SqlType` becomes nameable by
// construction, and what is left to pin is the exception and the boundary.
type AcceptedBySqlTag<T> = T extends ColumnSqlType ? true : false;
export type _V2 = Expect<Equal<AcceptedBySqlTag<Exclude<SqlType, 'serial'>>, true>>;

// `serial` is the one deliberate hole, and it is a hole for the same reason nullability
// is: a serial column is `number & Sql<'integer'> & Serial`, so `Serial` is the single
// place "the database generates this" lives. The reflection maps `integer` + `Serial`
// back to `sql: 'serial'`, so nothing downstream loses the fact — and tag payloads are
// invariant, which is why `Sql<'serial'>` was not merely a redundant second spelling but
// a broken one. See `ColumnSqlType`, and `serial-foreign-key.type-test.ts` for the line
// of ordinary code it used to reject.
export type _V2a = Expect<Equal<AcceptedBySqlTag<'serial'>, false>>;

// A dialect spelling must not be expressible either, because `sql` stays abstract
// (plan D3) and a `timestamptz` in the IR would force every other back-end to parse it
// back out.
export type _V3 = Expect<Equal<AcceptedBySqlTag<'timestamptz'>, false>>;

// --- every column flag has a tag and an IR field ---------------------------
//
// Keyed by `keyof Required<ColumnFlags>`, so adding a flag without deciding how a
// tagged declaration expresses it is a missing-property error here. The values are
// `keyof ColumnIR`, so naming an IR field that does not exist is an error too.
export const FLAG_TO_IR: { readonly [K in keyof Required<ColumnFlags>]: keyof ColumnIR } = {
  nullable: 'nullable',
  primaryKey: 'primaryKey',
  unique: 'unique',
  autoIncrement: 'serial',
  hasDefault: 'hasDefault',
  length: 'length',
  enum: 'enum',
  sensitive: 'sensitive',
};

// The tag each flag is spelled as. Names rather than the types themselves because
// the tags are parameterised differently (`Length<N>` takes an argument,
// `Serial` does not) and a heterogeneous map of them is not writable.
export const FLAG_TO_TAG: { readonly [K in keyof Required<ColumnFlags>]: string } = {
  nullable: 'Nullable<T>',
  primaryKey: 'PrimaryKey',
  unique: 'Unique',
  autoIncrement: 'Serial',
  hasDefault: 'HasDefault',
  length: 'Length<N>',
  enum: "Sql<'jsonEnum'> + a literal union",
  sensitive: 'Sensitive',
};

// --- every interpreted constraint kind has a tag and a Constraints field ---
//
// `KNOWN_CONSTRAINT_KINDS` and `Constraints` are declared separately, so this
// asserts they have not drifted. The drift is what produced the original bug:
// `TypeDescriptor` carried `minimum` and `maxLength` but not `maximum` or
// `minLength`, so those two checks were simply never emitted.
export type _V4 = Expect<Equal<ConstraintKind, keyof Required<Constraints>>>;

export const CONSTRAINT_TO_TAG: { readonly [K in ConstraintKind]: string } = {
  minimum: 'Min<N>',
  maximum: 'Max<N>',
  minLength: 'MinLength<N>',
  maxLength: 'MaxLength<N>',
  pattern: 'Pattern<S>',
};

// --- the reflection can find every tag it needs -----------------------------
//
// `TAG_NAMES` is how `@zmdb/aot-validator`'s reflection recognises a tag: `../tags` is
// types-only, so the reflection matches on the escaped symbol name (`__@zmdbSerial@1`)
// instead of importing the tag. `Ext` is the one frozen structural marker and normalises
// `__zmdbExt` to the same table entry. A tag with no entry there is a tag the reflection
// cannot see, and the resulting IR is quietly missing a flag — which is the *exact*
// failure the IR was introduced to end.
//
// Every constraint kind must be reachable, and so must every IR field a column flag
// maps to. Nullability is the one exception, and it is deliberate (REQ-TF-2): `| null`
// is how you say it, so there is no tag and there must not be one.
export type _V5 = Expect<Equal<Extract<ConstraintKind, TagField>, ConstraintKind>>;
export const FLAG_TAG_REACHABLE: {
  readonly [K in Exclude<keyof Required<ColumnFlags>, 'nullable' | 'enum'>]: TagField;
} = {
  primaryKey: 'primaryKey',
  unique: 'unique',
  autoIncrement: 'serial',
  hasDefault: 'hasDefault',
  length: 'length',
  sensitive: 'sensitive',
};

// Every recogniser name keeps the `zmdb*` prefix. Spelled as a prefix check rather than
// a list because the unique-symbol declarations are invisible outside `../tags`, while
// the structural `__zmdbExt` marker is normalised before lookup.
type StartsWithZmdb<S extends string> = S extends `zmdb${string}` ? true : false;
export type _V6 = Expect<Equal<StartsWithZmdb<(typeof TAG_NAMES)[TagField]>, true>>;

// --- protobuf tags survive into the serialisable IR -----------------------

export type _V7 = Expect<Equal<(typeof PROTO_SCALARS)[number], ProtoScalar>>;
export type _V8 = Expect<Equal<NonNullable<PropertyIR['protoField']>, number>>;
export type _V9 = Expect<Equal<NonNullable<ScalarIR['proto']>, ProtoScalar>>;
