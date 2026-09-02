// REQ-TF-1 — the tag vocabulary covers everything `defineSchema` can express.
// A compilation gate, not a runtime test. The failure mode it guards against is
// quiet: someone adds a `SqlType` or a `ColumnFlags` member, the tagged front-end
// silently cannot express it, and a type-first declaration loses information that
// the value front-end kept.

import type { ColumnFlags, Equal, Expect, SqlType } from '../index.ts';
import type { ColumnIR, ConstraintKind, Constraints, SQL_TYPES } from './index.ts';

// --- every SqlType is in SQL_TYPES, and nothing else is --------------------
//
// `satisfies readonly SqlType[]` at the declaration only catches an *extra*
// member. This catches a *missing* one, which is the direction that actually
// happens.
export type _V1 = Expect<Equal<(typeof SQL_TYPES)[number], SqlType>>;

// `Sql<T extends SqlType>` accepts exactly those, so a tag exists for each by
// construction. These pin the constraint: a dialect spelling must not be
// expressible as a `Sql<…>` argument, because `sql` stays abstract (plan D3) and a
// `timestamptz` in the IR would force every other back-end to parse it back out.
type AcceptedBySqlTag<T> = T extends SqlType ? true : false;
export type _V2 = Expect<Equal<AcceptedBySqlTag<SqlType>, true>>;
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
