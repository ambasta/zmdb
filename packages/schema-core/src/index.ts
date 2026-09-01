// @zmdb/schema-core — the vocabulary a table is described in, and the derivations
// every other package reads off it.
//
// There is no builder DSL any more — `defineSchema`, the ten column builders and the
// eight function-style modifiers were deleted with the last of their callers, and
// `schemaOf<T>()` is what produces a schema value now. A table is declared once, as a
// type, in the tags of `./tags`; `@zmdb/compiler` reflects that declaration into a
// `SchemaIR` and `schemaFromIR` turns the IR into the value the query compiler reads. So
// what is left in this file is the *data model* — `SqlType`, `ColumnFlags`, `ColumnMeta`,
// `CoreSchema` — plus the derived-type family and the type-level assertion helpers.
//
// The derived types have one spelling each, and it takes the declared type. See the
// DTO suite below.

// Type-only, and a cycle only on paper: `./derive` imports `./tags`, which imports
// `SqlType` from here, and `./ir` imports `ColumnMeta` and `CoreSchema`. Nothing is
// imported at runtime in either direction.
import type { DeclaredTable, UpdateDTO } from './derive/index.js';
import type { ExtensionType, SchemaIR } from './ir/index.js';

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
  readonly type: SqlType | ExtensionType;
  readonly flags: ColumnFlags;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}

export type ColumnsMap = Readonly<Record<string, ColumnMeta>>;

/**
 * A schema value: a table described in physical SQL names, for the code that runs.
 *
 * There is no type parameter for the column map, and its absence is the point. It used to
 * carry the *literal* map so that `Entity<S>` could read property types out of it; every
 * derivation now takes the declared type instead, so a literal map would be a parameter
 * nothing reads. `table`, `columns`, `primaryKey` and the local side of `references` are
 * in database vocabulary. The carried IR keeps declared names for derived types,
 * validation, payloads and result aliases.
 */
export interface CoreSchema<T extends string = string> {
  readonly table: T;
  readonly columns: ColumnsMap;
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
 * declaration still has to become a `CoreSchema` — but a `CoreSchema` has erased which
 * type it came from, and a column map cannot be read back into one: it has a `SqlType`
 * and a flag bag, and nowhere to put a json payload's shape. This phantom keeps the
 * answer instead of reconstructing it. `schemaOf<User>()` is a `TaggedSchema<User>`, so
 * anything holding the value can recover `User` and derive from the declaration.
 *
 * The slot is a `unique symbol` like every tag in `./tags`, and for the same reason:
 * un-forgeable, and it erases, so no generated literal carries it at runtime. It is
 * *required* rather than optional, which is what makes it inferrable: a function that
 * wants the declared type asks for a `TaggedSchema<T>` and gets `T` from the argument,
 * which is how `defineRepository`, `defineEntityStateMachine` and `findJoined` are
 * parameterised on a declaration while still being handed a value.
 */
export interface TaggedSchema<T> extends CoreSchema<string> {
  readonly [zmdbEntity]: T;
}

/**
 * The schema value for a tagged type, generated at build time.
 *
 * The only way to get one, and it declares nothing: `User` already says the table, the
 * columns, the keys and the constraints, so this asks for that declaration as data.
 * `@zmdb/compiler` replaces the call with a frozen literal — `schemaFromIR` applied
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
    'schemaOf<T>() was not replaced at build time. It is compiled away by @zmdb/compiler ' +
      '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
      'be read at runtime, so there is nothing to fall back to.',
  );
}

// ---------------------------------------------------------------------------
// The DTO suite (REQ-TF-4)
// ---------------------------------------------------------------------------
//
// Re-exported, not defined. `./derive` reads the declared type, and there is no second
// spelling any more: each of these used to have a column-map twin here, with every
// derivation choosing between them by asking `S extends TaggedSchema<infer T>`.
//
// Both halves of that had to go. The column-map walk could not answer some of the
// questions — a `json` column came out `unknown`, because a payload's shape is a type
// and a `ColumnMeta` has nowhere to put one — so the two branches did not merely differ
// in spelling, they differed in what they knew. And the dispatch meant every derivation
// asked a question about its argument before it could begin, which is the inversion this
// design exists to remove: the declaration is the source, and a value generated from it
// is downstream.
//
// What takes the place of the dispatch is inference, once, at the boundary where a value
// actually arrives: a function that is handed a generated schema declares the parameter
// `TaggedSchema<T>` and gets `T` from it (`defineRepository`, `findJoined`,
// `defineEntityStateMachine`, `repositoryToken`). Everything after that point is
// parameterised on the declared type. `schema-of.type-test.ts` pins the crossing.
export type { CreateDTO, DeclaredTable, Entity, PrimaryKeyOf, ReadDTO, UpdateDTO } from './derive/index.js';

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

// Relations: resolution and the two row helpers. `Populated`/`PopulatedEntity` come from
// `./derive`, which reads the relation off the declared type — there is no relations map to
// derive them from any more, and no `manyToOne`/`oneToMany`/`oneToOne`/`manyToMany` builder
// to write one with.
export { compilePopulate, resolveRelation, attachPopulated, aliasRow } from './relations/index.js';
export type { PopulateDialect, PopulateQuery, ResolvedRelation, JoinRow } from './relations/index.js';
export type { Populated, PopulatedEntity } from './derive/index.js';

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
  T extends DeclaredTable,
  StateField extends string,
  FromState extends string,
  Transitions,
  AllowedFields extends keyof UpdateDTO<T> = keyof UpdateDTO<T>,
> = Pick<UpdateDTO<T>, Exclude<AllowedFields, StateField>> & {
  [P in StateField]?: AllowedTargetStates<Transitions, FromState>;
};

/** What a transition out of `From` is allowed to patch: the declared restriction if there is one, otherwise every updatable field. */
type PatchableFields<
  T extends DeclaredTable,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] },
  From extends keyof Transitions & string,
> = FieldRestrictions[From] extends readonly (keyof UpdateDTO<T>)[]
  ? FieldRestrictions[From][number]
  : keyof UpdateDTO<T>;

/**
 * The `patch` argument of a transition out of `From`. When the only patchable
 * field is the state field itself there is nothing left to pass, so the argument
 * narrows to `Record<string, never>` and any property is a type error.
 */
type TransitionPatch<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] },
  From extends keyof Transitions & string,
> = [Exclude<PatchableFields<T, Transitions, FieldRestrictions, From>, StateField>] extends [never]
  ? Record<string, never>
  : Omit<Pick<UpdateDTO<T>, PatchableFields<T, Transitions, FieldRestrictions, From>>, StateField>;

export interface EntityStateMachineOptions<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
> {
  /**
   * The generated schema value, for inference only — nothing reads it.
   *
   * It is the whole reason this machine knows what a patch may contain: `T` is the
   * declared type, recovered from the value's phantom, and `UpdateDTO<T>` is what the
   * transitions are checked against. Passing a schema for a different table is the one
   * mistake this cannot catch, and it is the same mistake as pointing a repository at
   * the wrong table.
   */
  schema?: TaggedSchema<T>;
  stateField: StateField;
  transitions: Transitions;
  allowedFields?: FieldRestrictions | undefined;
}

export interface EntityStateMachine<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
> {
  readonly stateField: StateField;
  readonly transitions: Transitions;
  readonly allowedFields?: FieldRestrictions | undefined;
  canTransition<From extends keyof Transitions & string>(from: From, to: string): boolean;
  createUpdatePayload<From extends keyof Transitions & string, To extends Transitions[From][number]>(
    from: From,
    to: To,
    patch?: TransitionPatch<T, StateField, Transitions, FieldRestrictions, From>,
  ): StateUpdateDTO<T, StateField, From, Transitions, PatchableFields<T, Transitions, FieldRestrictions, From>>;
}

export function createStateUpdatePayload<
  T extends DeclaredTable,
  StateField extends string,
  From extends keyof Transitions & string,
  const Transitions extends Record<string, readonly string[]>,
  AllowedFields extends keyof UpdateDTO<T> = keyof UpdateDTO<T>,
>(
  stateField: StateField,
  transitions: Transitions,
  from: From,
  to: Transitions[From][number],
  patch?: Omit<Pick<UpdateDTO<T>, AllowedFields>, StateField> | Record<string, never>,
): StateUpdateDTO<T, StateField, From, Transitions, AllowedFields> {
  const allowed = transitions[from];
  if (!Array.isArray(allowed) || !allowed.includes(to)) {
    throw new Error(`Invalid state transition from "${from}" to "${to}" for field "${stateField}"`);
  }
  const payload = {
    ...patch,
    [stateField]: to,
  };
  // boundary: return value is certified as StateUpdateDTO after runtime transition validation.
  return payload as StateUpdateDTO<T, StateField, From, Transitions, AllowedFields>;
}

export function defineEntityStateMachine<
  T extends DeclaredTable,
  StateField extends string,
  const Transitions extends Record<string, readonly string[]>,
  const FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
>(
  options: EntityStateMachineOptions<T, StateField, Transitions, FieldRestrictions>,
): EntityStateMachine<T, StateField, Transitions, FieldRestrictions> {
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
      patch?: TransitionPatch<T, StateField, Transitions, FieldRestrictions, From>,
    ) {
      return createStateUpdatePayload<
        T,
        StateField,
        From,
        Transitions,
        PatchableFields<T, Transitions, FieldRestrictions, From>
      >(stateField, transitions, from, to, patch);
    },
  };
}

export type {
  WhereDTO,
  ListDTO,
  OffsetListDTO,
  KeysetListDTO,
  ListResult,
  OrderByDTO,
  KeysetOrderByDTO,
  OrderTarget,
  PaginationDTO,
  KeysetCursorPage,
  NonNullableEntityKeys,
} from './dto/index.js';
export { compileWhere, applyOrderBy, applyPagination, applyKeysetFilter, buildListResult } from './dto/index.js';
