// @zmdb/schema-core — the vocabulary a table is described in, and the derivations
// every other package reads off it.
//
// There is no builder DSL any more — `defineSchema`, the ten column builders and the
// eight function-style modifiers were deleted with the last of their callers, and
// `schemaOf<T>()` is what produces a schema value now. A table is declared once, as a
// type, in the tags of `./tags`; `@zmdb/aot-validator` reflects that declaration into a
// `SchemaIR` and `schemaFromIR` turns the IR into the value the query compiler reads. So
// what is left in this file is the *data model* — `SqlType`, `ColumnFlags`, `ColumnMeta`,
// `CoreSchema` — plus the derived-type family and the type-level assertion helpers.
//
// The derived types still have two spellings each, and `schema-core.type-test.ts` pins
// both. Which one applies is a question about the schema rather than the caller: see
// `Entity` below.

// Type-only, and a cycle only on paper: `./derive` imports `./tags`, which imports
// `SqlType` from here, and `./ir` imports `ColumnMeta` and `CoreSchema`. Nothing is
// imported at runtime in either direction, and Phase 9 removes the need for the first
// import entirely by making `./derive` the root.
import type {
  CreateDTO as TaggedCreateDTO,
  Entity as TaggedEntity,
  PrimaryKeyOf as TaggedPrimaryKeyOf,
  UpdateDTO as TaggedUpdateDTO,
} from './derive/index.ts';
import type { SchemaIR } from './ir/index.ts';

export type SqlType =
  | 'serial'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'varchar'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'jsonEnum';

export interface ValidationRule {
  readonly kind: string;
  readonly value?: unknown;
  readonly message?: string;
  /**
   * The argument list, for a rule that came from `@zmdb/aot-validator`'s runtime `tags`.
   *
   * Declared rather than tolerated: `ir/index.ts`'s `ruleArgument` has always read it,
   * and `openapi.spec.ts` has always passed one, so leaving it off the type meant the
   * only two writers of this field disagreed with its declaration.
   */
  readonly args?: readonly unknown[];
}

// Optional members admit `undefined` explicitly: under `exactOptionalPropertyTypes` a
// flag map rebuilt by a mapped type over a type *parameter* resolves each member to
// `F[K]` (i.e. `boolean | undefined`), which a bare `?: boolean` rejects. The builder
// chain that first forced this is gone, but `columnMetaFromIR` builds a flag map the same
// way — it sets only the flags the IR asserts — so the looser member type is still what
// makes the result assignable.
//
// `nullable` is required rather than optional, and that asymmetry is deliberate: every
// other flag is a fact a declaration opts into, while nullability is a fact every column
// has one way or the other. A missing `nullable` would read as "not stated", and there is
// nothing for that to mean.
export interface ColumnFlags {
  readonly nullable: boolean;
  readonly primaryKey?: boolean | undefined;
  readonly unique?: boolean | undefined;
  readonly autoIncrement?: boolean | undefined;
  readonly hasDefault?: boolean | undefined;
  readonly length?: number | undefined;
  readonly enum?: readonly string[] | undefined;
  readonly sensitive?: boolean | undefined;
}

export interface ColumnMeta {
  readonly type: SqlType;
  readonly flags: ColumnFlags;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}

export type ColumnsMap = Readonly<Record<string, ColumnMeta>>;

/**
 * A schema value: a table described as data, for the code that runs.
 *
 * `C` carries the *literal* column map, which is what makes `Entity<S>`,
 * `CreateDTO<S>`, `WhereDTO<S>` &c. derive real property types. It defaults to
 * the erased `ColumnsMap` so `CoreSchema<string>` still means "any schema" for
 * code that does not care about the columns (repositories, OpenAPI, seeding).
 */
export interface CoreSchema<T extends string = string, C extends ColumnsMap = ColumnsMap> {
  readonly table: T;
  readonly columns: C;
  readonly primaryKey: readonly string[];
  readonly references: readonly { readonly column: string; readonly target: string }[];
  readonly ftsTable?: string | boolean | undefined;
  /**
   * The IR this value was built from, carried rather than recomputed.
   *
   * Required, and that is the point. `columns` is a lossy projection: a `ColumnMeta` has
   * a `SqlType` and a flag map, and it has nowhere to put a json payload's shape, a
   * constraint's arguments, or the difference between a column that is `integer + Serial`
   * and one that is merely `integer`. There used to be an `irFromSchema` that guessed
   * those back — four walkers over column metadata, each reconstructing what the
   * declaration had already said, each with its own idea of the answer. Every one of them
   * now reads this field, so the DDL, the validator, the JSON Schema and the seeder are
   * looking at the same bytes.
   *
   * `schemaFromIR(schema.ir)` is `schema` (see `ir.spec.ts`), which is what makes the
   * field safe to depend on: it holds everything the value does, so nothing has to choose
   * between them.
   */
  readonly ir: SchemaIR;
}

// ---------------------------------------------------------------------------
// The generated schema value (REQ-TF-10)
// ---------------------------------------------------------------------------

declare const zmdbEntity: unique symbol;

/**
 * A schema value that remembers the type it was generated from.
 *
 * The query compiler wants the table and the column types as data, so a tagged
 * declaration still has to become a `CoreSchema` — but the *value* has erased which
 * type it came from, and every derivation below reads a schema's columns to rebuild
 * types the declaration already stated. This phantom keeps the answer instead of
 * reconstructing it: `schemaOf<User>()` is a `TaggedSchema<User>`, so `Entity<S>`,
 * `CreateDTO<S>` and everything downstream can defer to `@zmdb/schema-core/derive`
 * and read `User` directly.
 *
 * The slot is a `unique symbol` like every tag in `./tags`, and for the same reason:
 * un-forgeable, and it erases, so no generated literal carries it at runtime. It is
 * *required* rather than optional, which is what makes `S extends TaggedSchema<infer
 * T>` a real question — an erased `CoreSchema<string>` does not have it and takes the
 * other branch.
 */
export interface TaggedSchema<T> extends CoreSchema<string> {
  readonly [zmdbEntity]: T;
}

/**
 * The schema value for a tagged type, generated at build time.
 *
 * The only way to get one, and it declares nothing: `User` already says the table, the
 * columns, the keys and the constraints, so this asks for that declaration as data.
 * `@zmdb/aot-validator` replaces the call with a frozen literal — `schemaFromIR` applied
 * to the IR it read off `T` — so the schema is written exactly once, in the type.
 *
 * ```ts
 * const users = defineRepository(schemaOf<User>(), driver);
 * ```
 *
 * There is no runtime implementation and cannot be one, for the same reason
 * `toJsonSchema<T>()` has none: the answer is a function of a type argument, and type
 * arguments do not survive to runtime. A build that did not run the transform gets an
 * error saying so rather than a plausible-looking empty schema.
 */
export function schemaOf<T>(): TaggedSchema<T> {
  throw new Error(
    'schemaOf<T>() was not replaced at build time. It is compiled away by the zmdb transform ' +
      '(the unplugin, or `zmdb-codegen`), which did not run over this file — a type argument cannot ' +
      'be read at runtime, so there is nothing to fall back to.',
  );
}

// ---------------------------------------------------------------------------
// #14 — compile-time type derivation.
// Maps a column's metadata to its TypeScript type.
// ---------------------------------------------------------------------------
type BaseTsType<C extends ColumnMeta> = C['type'] extends 'serial' | 'integer' | 'numeric'
  ? number
  : C['type'] extends 'bigint'
    ? bigint
    : C['type'] extends 'text' | 'varchar'
      ? string
      : C['type'] extends 'boolean'
        ? boolean
        : C['type'] extends 'timestamp'
          ? Date
          : C['type'] extends 'jsonEnum'
            ? C['flags'] extends { enum: infer E extends readonly string[] }
              ? E[number]
              : string
            : unknown;

// A `json` column is `unknown` here, and that is the ceiling of this direction rather
// than an omission. There used to be one more branch, reading a `__payload` phantom that
// `json<Payload>()` hung on its return type; `columnMetaFromIR` has no way to set it,
// because a payload *shape* is a type and a `ColumnMeta` is data. The shape travels on
// `ColumnIR.payload` for the back-ends and on the declared type for `./derive`, and both
// of those know it exactly. See `json.type-test.ts`.

// Apply nullability.
export type TsType<C extends ColumnMeta> = C['flags'] extends { nullable: true } ? BaseTsType<C> | null : BaseTsType<C>;

type ColumnsOf<S> = S extends { columns: infer C } ? C : never;

// Keys of columns that are auto-increment (stripped from CreateDTO).
type AutoIncrementKeys<C> = {
  [K in keyof C]: C[K] extends { flags: { autoIncrement: true } } ? K : never;
}[keyof C];

// Keys of columns that have a default (optional in CreateDTO).
type DefaultKeys<C> = {
  [K in keyof C]: C[K] extends { flags: { hasDefault: true } } ? K : never;
}[keyof C];

// Keys of columns that admit null — also optional in CreateDTO, because omitting one
// inserts `NULL`, which is what passing `null` does. See `./derive`'s `CreateDTO`: the
// published document has always said this and the repository has always accepted it; the
// type was the one place that demanded the key.
type NullableKeys<C> = {
  [K in keyof C]: C[K] extends { flags: { nullable: true } } ? K : never;
}[keyof C];

// Each of the four derivations below has two spellings, and which one applies is a
// question about the schema, not about the caller: a `TaggedSchema<T>` came from a type
// that already states everything these mapped types are reconstructing, so it defers to
// `./derive`, which is the version that survives Phase 9. A schema whose entity type has
// been erased — `CoreSchema<string>`, or a value read back out of a `SchemaIR` — takes
// the second branch, which reads the column map instead.
//
// The read surface in `./dto` needs no such branch. `WhereDTO`, `OrderByDTO`,
// `PaginationDTO` and `ListDTO` are all built out of `Entity<S>`, so they follow it.

// Entity<S>: full row type — every column mapped to its TS type.
export type Entity<S> =
  S extends TaggedSchema<infer T>
    ? TaggedEntity<T>
    : {
        [K in keyof ColumnsOf<S>]: ColumnsOf<S>[K] extends ColumnMeta ? TsType<ColumnsOf<S>[K]> : never;
      };

// CreateDTO<S>: omit auto-increment columns; columns with defaults are optional.
export type CreateDTO<S, C = ColumnsOf<S>> =
  S extends TaggedSchema<infer T>
    ? TaggedCreateDTO<T>
    : {
        // required: not auto-increment, no default, not nullable
        [
          K in keyof C as K extends AutoIncrementKeys<C>
            ? never
            : K extends DefaultKeys<C> | NullableKeys<C>
              ? never
              : K
        ]: C[K] extends ColumnMeta ? TsType<C[K]> : never;
      } & {
        // optional: has a default or admits null (and not auto-increment)
        [
          K in keyof C as K extends AutoIncrementKeys<C>
            ? never
            : K extends DefaultKeys<C> | NullableKeys<C>
              ? K
              : never
        ]?: C[K] extends ColumnMeta ? TsType<C[K]> | undefined : never;
      };

// UpdateDTO<S>: fully partial CreateDTO with exact optional property support.
export type UpdateDTO<S> =
  S extends TaggedSchema<infer T>
    ? TaggedUpdateDTO<T>
    : {
        [K in keyof CreateDTO<S>]?: CreateDTO<S>[K] | undefined;
      };

type PrimaryKeyKeys<C> = {
  [K in keyof C]: C[K] extends ColumnMeta ? (C[K]['flags'] extends { primaryKey: true } ? K : never) : never;
}[keyof C];

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

// PrimaryKeyOf<S>: scalar for single-column keys, object map for composite keys, unknown if no PK.
export type PrimaryKeyOf<S, C = ColumnsOf<S>> =
  S extends TaggedSchema<infer T>
    ? TaggedPrimaryKeyOf<T>
    : [PrimaryKeyKeys<C>] extends [never]
      ? unknown
      : IsUnion<PrimaryKeyKeys<C>> extends true
        ? { [K in PrimaryKeyKeys<C>]: C[K] extends ColumnMeta ? TsType<C[K]> : never }
        : PrimaryKeyKeys<C> extends keyof C
          ? C[PrimaryKeyKeys<C>] extends ColumnMeta
            ? TsType<C[PrimaryKeyKeys<C>]>
            : unknown
          : unknown;

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly expected?: string;
  readonly value?: unknown;
}

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/**
 * Whether a thrown value claims to be about validation.
 *
 * Structural rather than `instanceof ValidationError`, because a validator a caller wrote
 * themselves throws its own error type — zod's, io-ts's, or one of their own — and the HTTP
 * adapters that ask this question have no business caring which. Carrying an `issues`
 * property is the claim; {@link validationIssuesOf} decides whether it holds up.
 */
export function claimsValidationIssues(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'issues' in error;
}

/**
 * The issues on a thrown error, or `undefined` if it carries none worth reporting.
 *
 * Every entry is checked rather than asserted. These end up in a 400 body that a client
 * reads, and "it has an `issues` property" is no evidence that the property holds issues —
 * an error whose `issues` was a string used to be serialized into the response as though it
 * were the list. An entry missing a `path` or a `message` is dropped rather than passed on
 * half-formed; a `ValidationError` with an empty list still answers with the empty list,
 * which is what tells a caller "validation, and it declined to say more".
 */
export function validationIssuesOf(error: unknown): readonly ValidationIssue[] | undefined {
  if (error === null || typeof error !== 'object' || !('issues' in error)) return undefined;
  const issues: unknown = error.issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.filter(
    (issue: unknown): issue is ValidationIssue =>
      issue !== null &&
      typeof issue === 'object' &&
      'path' in issue &&
      typeof issue.path === 'string' &&
      'message' in issue &&
      typeof issue.message === 'string',
  );
}

/**
 * True for a non-null, non-array object.
 *
 * Lives here (the DAG root) because every downstream package needs the same
 * proof before a keyed read: without it, reading `value[key]` off an `unknown`
 * requires `as Record<string, unknown>`, and those casts are exactly what
 * ARCHITECTURE §2.1 forbids on the public surface.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Type-level assertion utilities
// ---------------------------------------------------------------------------
// Used by the `*.type-test.ts` files next to each module. Those files contain no
// runtime code and are never executed: they are *compiled*, and a broken derived
// type is a typecheck failure like any other.
//
// Why not `expectTypeOf` from vitest? Because vitest only ever *runs* those files
// — `expectTypeOf(...)` is a no-op at runtime and `@ts-expect-error` is inert, so
// every such assertion in a `.spec.ts` was decoration, not a gate — doubly so
// while the package tsconfigs still excluded `**/*.spec.ts`, which also made the
// `@ts-expect-error` directives in them unchecked. Specs are inside the program
// now, and assertions written with `Expect`/`Equal` are enforced by
// `yarn typecheck`, which is what CI runs.

/**
 * Invariant type equality. Stricter than mutual assignability: it distinguishes
 * `any`/`unknown`/`never` and does not collapse optional vs `| undefined`.
 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** One-way assignability, for "at least this shape" assertions. */
export type Extends<A, B> = [A] extends [B] ? true : false;

/**
 * Two-way assignability: each side accepts the other, differences in intersection
 * spelling and union ordering included.
 *
 * This is the right tool for asserting what a derived type *means* when the columns
 * are tagged. `Entity<User>['email']` is `string & Sql<'text'>`, not `string`, because
 * a tag survives every derivation on purpose (that is how a projection or an aggregate
 * still knows the column's SQL type). `Equal` sees two different types there and is
 * correct to; `Mutual` sees that either can be used where the other is expected, which
 * is the claim such a test is usually making. Pair it with `Equal<keyof A, keyof B>`
 * when the key set and optionality matter too — assignability alone does not pin those.
 */
export type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Assert a type-level predicate. `Expect<Equal<X, Y>>` fails to compile if X ≠ Y. */
export type Expect<T extends true> = T;

/** Negative form: `ExpectNot<Equal<X, Y>>` fails to compile if X = Y. */
export type ExpectNot<T extends false> = T;

// Relation DSL builders & derivation types re-export
export {
  manyToOne,
  oneToMany,
  oneToOne,
  manyToMany,
  compilePopulate,
  attachPopulated,
  aliasRow,
} from './relations/index.ts';
export type {
  Cardinality,
  RelationMeta,
  PopulateDialect,
  PopulateQuery,
  RelationDef,
  RelationsMap,
  PopulatedEntity,
  Populated,
  JoinRow,
} from './relations/index.ts';

// ---------------------------------------------------------------------------
// Entity State Machine & State Transition Helpers
// ---------------------------------------------------------------------------

export type StateTransitions<StateValues extends string | number | symbol = string> = {
  readonly [From in StateValues]?: readonly StateValues[];
};

export function defineStateTransitions<
  StateValues extends string,
  const T extends { readonly [From in StateValues]?: readonly StateValues[] },
>(transitions: T): T {
  return transitions;
}

export type AllowedTargetStates<Transitions, From extends string> = Transitions extends {
  readonly [k in From]?: readonly (infer To extends string)[];
}
  ? To
  : never;

export type StateUpdateDTO<
  S,
  StateField extends string,
  FromState extends string,
  Transitions,
  AllowedFields extends keyof UpdateDTO<S> = keyof UpdateDTO<S>,
> = Pick<UpdateDTO<S>, Exclude<AllowedFields, StateField>> & {
  [P in StateField]?: AllowedTargetStates<Transitions, FromState>;
};

/** What a transition out of `From` is allowed to patch: the declared restriction if there is one, otherwise every updatable field. */
type PatchableFields<
  S,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<S>)[] },
  From extends keyof Transitions & string,
> = FieldRestrictions[From] extends readonly (keyof UpdateDTO<S>)[]
  ? FieldRestrictions[From][number]
  : keyof UpdateDTO<S>;

/**
 * The `patch` argument of a transition out of `From`. When the only patchable
 * field is the state field itself there is nothing left to pass, so the argument
 * narrows to `Record<string, never>` and any property is a type error.
 */
type TransitionPatch<
  S,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<S>)[] },
  From extends keyof Transitions & string,
> = [Exclude<PatchableFields<S, Transitions, FieldRestrictions, From>, StateField>] extends [never]
  ? Record<string, never>
  : Omit<Pick<UpdateDTO<S>, PatchableFields<S, Transitions, FieldRestrictions, From>>, StateField>;

export interface EntityStateMachineOptions<
  S,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<S>)[] } = {},
> {
  schema?: S;
  stateField: StateField;
  transitions: Transitions;
  allowedFields?: FieldRestrictions | undefined;
}

export interface EntityStateMachine<
  S,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<S>)[] } = {},
> {
  readonly stateField: StateField;
  readonly transitions: Transitions;
  readonly allowedFields?: FieldRestrictions | undefined;
  canTransition<From extends keyof Transitions & string>(from: From, to: string): boolean;
  createUpdatePayload<From extends keyof Transitions & string, To extends Transitions[From][number]>(
    from: From,
    to: To,
    patch?: TransitionPatch<S, StateField, Transitions, FieldRestrictions, From>,
  ): StateUpdateDTO<S, StateField, From, Transitions, PatchableFields<S, Transitions, FieldRestrictions, From>>;
}

export function createStateUpdatePayload<
  S,
  StateField extends string,
  From extends keyof Transitions & string,
  const Transitions extends Record<string, readonly string[]>,
  AllowedFields extends keyof UpdateDTO<S> = keyof UpdateDTO<S>,
>(
  stateField: StateField,
  transitions: Transitions,
  from: From,
  to: Transitions[From][number],
  patch?: Omit<Pick<UpdateDTO<S>, AllowedFields>, StateField> | Record<string, never>,
): StateUpdateDTO<S, StateField, From, Transitions, AllowedFields> {
  const allowed = transitions[from];
  if (!Array.isArray(allowed) || !allowed.includes(to)) {
    throw new Error(`Invalid state transition from "${from}" to "${to}" for field "${stateField}"`);
  }
  const payload = {
    ...patch,
    [stateField]: to,
  };
  // boundary: return value is certified as StateUpdateDTO after runtime transition validation.
  return payload as StateUpdateDTO<S, StateField, From, Transitions, AllowedFields>;
}

export function defineEntityStateMachine<
  S,
  StateField extends string,
  const Transitions extends Record<string, readonly string[]>,
  const FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<S>)[] } = {},
>(
  options: EntityStateMachineOptions<S, StateField, Transitions, FieldRestrictions>,
): EntityStateMachine<S, StateField, Transitions, FieldRestrictions> {
  const { stateField, transitions, allowedFields } = options;

  return {
    stateField,
    transitions,
    allowedFields,
    canTransition(from: keyof Transitions & string, to: string): boolean {
      const allowed = transitions[from];
      return Array.isArray(allowed) && allowed.includes(to);
    },
    createUpdatePayload<From extends keyof Transitions & string, To extends Transitions[From][number]>(
      from: From,
      to: To,
      patch?: TransitionPatch<S, StateField, Transitions, FieldRestrictions, From>,
    ) {
      return createStateUpdatePayload<
        S,
        StateField,
        From,
        Transitions,
        PatchableFields<S, Transitions, FieldRestrictions, From>
      >(stateField, transitions, from, to, patch);
    },
  };
}

export type { WhereDTO, ListDTO, ListResult, OrderByDTO, OrderTarget, PaginationDTO } from './dto/index.ts';
export { compileWhere, applyOrderBy, applyPagination, buildListResult } from './dto/index.ts';
