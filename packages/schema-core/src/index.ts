// @zmdb/schema-core — the single source of truth every other package derives
// from: column builders (#12), modifiers (#13), compile-time type derivation
// (#14) and `defineSchema` (#15).
//
// The derived-type family is only as good as the type information the builders
// carry, so `Column` and `CoreSchema` are generic in exactly that information —
// see `type-derivation.type-test.ts` for the assertions that pin it down.

// Type-only, and a cycle only on paper: `./derive` imports `./tags`, which imports
// `SqlType` from here. Nothing is imported at runtime in either direction, and Phase 9
// removes the need for the import entirely by making `./derive` the root.
import type {
  CreateDTO as TaggedCreateDTO,
  Entity as TaggedEntity,
  PrimaryKeyOf as TaggedPrimaryKeyOf,
  UpdateDTO as TaggedUpdateDTO,
} from './derive/index.ts';

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

// Optional members admit `undefined` explicitly: under `exactOptionalPropertyTypes`
// a flag map derived by `Omit<F, ...>` over a type *parameter* resolves each member
// to `F[K]` (i.e. `boolean | undefined`), which a bare `?: boolean` rejects. Since
// flag maps are threaded through the fluent builder's type (see `SetFlags`), the
// looser member type is what makes the chain typeable at all.
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

export interface SchemaOptions {
  readonly ftsTable?: string | boolean | undefined;
}

/**
 * A defined schema.
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
 * T>` a real question — an authored `defineSchema` value does not have it and takes
 * the other branch.
 *
 * Per plan D2 the branching is scaffolding. Phase 9 deletes the schema-value
 * derivations, at which point every derivation takes a tagged type and there is
 * nothing left to choose between.
 */
export interface TaggedSchema<T> extends CoreSchema<string> {
  readonly [zmdbEntity]: T;
}

/**
 * The schema value for a tagged type, generated at build time.
 *
 * The type-first replacement for `defineSchema`, and it declares nothing: `User`
 * already says the table, the columns, the keys and the constraints, so this asks for
 * that declaration as data. `@zmdb/aot-validator` replaces the call with a frozen
 * literal — `schemaFromIR` applied to the IR it read off `T` — so the schema is
 * written exactly once, in the type.
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
// oxlint-disable-next-line no-unused-vars -- `T` is the whole input; it has nowhere else to appear
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
            : C['type'] extends 'json'
              ? C extends { readonly __payload?: infer P }
                ? unknown extends P
                  ? unknown
                  : NonNullable<P>
                : unknown
              : unknown;

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
// `./derive`, which is the version that survives Phase 9. An authored `defineSchema`
// value takes the second branch, unchanged.
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

export class SchemaError extends Error {}

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

/** Overwrite flags `P` on flag map `F` (last write wins, no `never` collisions). */
type SetFlags<F extends ColumnFlags, P extends Partial<ColumnFlags>> = Omit<F, keyof P> & P;

// Chainable column: ColumnMeta + fluent modifier methods.
//
// Generic in the SQL type and the flag map so a chain preserves both: without
// this, `text().notNull()` erases to `type: SqlType`/`flags: ColumnFlags` and
// every derived type (`Entity`, `CreateDTO`, `WhereDTO`, …) degrades to
// `unknown` — the modifiers, not `defineSchema`, are where inference is lost.
//
// Note: `references` is intentionally NOT a fluent method — it would collide
// with the `ColumnMeta.references` metadata field. Use the function-style
// `references(col, target)` modifier for foreign keys.
export interface Column<T extends SqlType = SqlType, F extends ColumnFlags = ColumnFlags, P = unknown> {
  readonly type: T;
  readonly flags: F;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
  readonly __payload?: P;
  notNull(): Column<T, SetFlags<F, { nullable: false }>, P>;
  nullable(): Column<T, SetFlags<F, { nullable: true }>, P>;
  primaryKey(): Column<T, SetFlags<F, { primaryKey: true }>, P>;
  unique(): Column<T, SetFlags<F, { unique: true }>, P>;
  defaultTo(value: unknown): Column<T, SetFlags<F, { hasDefault: true }>, P>;
  validate(rule: ValidationRule): Column<T, F, P>;
  sensitive(isSensitive?: boolean): Column<T, SetFlags<F, { sensitive: boolean }>, P>;
}

// Deep-freeze a column metadata object and wrap it with fluent methods.
// Each fluent method returns a NEW frozen column (immutability preserved).
//
// Generic in the *result* column type, inferred from the caller's contextual
// return type. Every builder and modifier below declares a precise
// `Column<T, F>`, and this generic lets them `return makeColumn(...)` directly:
// previously each of the 19 of them ended in its own `as never`, because a
// non-generic `makeColumn(): Column` erases `T`/`F` on the way out. Those 19
// assertions are now this one, which is also the only place that can argue for
// its own soundness.
function makeColumn<C extends Column>(meta: ColumnMeta): C {
  const frozenFlags = Object.freeze({ ...meta.flags });
  const base: ColumnMeta = Object.freeze({
    ...meta,
    flags: frozenFlags,
    ...(meta.validation ? { validation: Object.freeze([...meta.validation]) } : {}),
  });

  const withFlag = (patch: Partial<ColumnFlags>): Column =>
    makeColumn<Column>({ ...base, flags: { ...base.flags, ...patch } });

  // Metadata is the enumerable surface (so `toEqual` compares metadata only).
  // boundary: the fluent methods are attached *below* via defineProperty (they
  // must be non-enumerable), so the object is not a `Column` until this function
  // returns; and `C`'s `type`/`flags` are exactly the literal types of the `meta`
  // the caller passed — the builders below are the only callers, and each pairs
  // its declared `Column<T, F>` with a matching literal `meta`. Neither
  // `Object.defineProperties` nor "these two literals agree" is expressible as a
  // type-changing operation, hence the one assertion here.
  const column = { ...base } as unknown as C;

  // Fluent methods are NON-enumerable: they are behavior, not metadata, so two
  // columns with equal metadata compare deep-equal regardless of build style.
  const methods: Record<string, (...args: never[]) => Column> = {
    notNull: () => withFlag({ nullable: false }),
    nullable: () => withFlag({ nullable: true }),
    primaryKey: () => withFlag({ primaryKey: true }),
    unique: () => withFlag({ unique: true }),
    defaultTo: (value: unknown) =>
      makeColumn<Column>({ ...base, default: value, flags: { ...base.flags, hasDefault: true } }),
    validate: (rule: ValidationRule) => makeColumn<Column>({ ...base, validation: [...(base.validation ?? []), rule] }),
    sensitive: (isSensitive: boolean = true) => withFlag({ sensitive: isSensitive !== false }),
  };
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(column, name, { value: fn, enumerable: false, writable: false });
  }
  return Object.freeze(column);
}

// Column builders --------------------------------------------------------
// Builders return literal-typed metadata so downstream type derivation
// (Entity/CreateDTO/UpdateDTO) can read `type` and enum literals. The runtime is
// `makeColumn` in every case; the declared `Column<T, F>` is what `makeColumn`'s
// result type parameter is inferred from, so no builder needs an assertion.

export function serial(): Column<
  'serial',
  { nullable: false; primaryKey: false; autoIncrement: true; hasDefault: true }
> {
  return makeColumn({
    type: 'serial',
    flags: { nullable: false, primaryKey: false, autoIncrement: true, hasDefault: true },
  });
}
export function integer(): Column<'integer', { nullable: false }> {
  return makeColumn({ type: 'integer', flags: { nullable: false } });
}
export function bigint(): Column<'bigint', { nullable: false }> {
  return makeColumn({ type: 'bigint', flags: { nullable: false } });
}
export function numeric(): Column<'numeric', { nullable: false }> {
  return makeColumn({ type: 'numeric', flags: { nullable: false } });
}
export function text(): Column<'text', { nullable: false }> {
  return makeColumn({ type: 'text', flags: { nullable: false } });
}
export function varchar<L extends number>(length: L): Column<'varchar', { nullable: false; length: L }> {
  return makeColumn({ type: 'varchar', flags: { nullable: false, length } });
}
export function boolean(): Column<'boolean', { nullable: false }> {
  return makeColumn({ type: 'boolean', flags: { nullable: false } });
}
export function timestamp(): Column<'timestamp', { nullable: false }> {
  return makeColumn({ type: 'timestamp', flags: { nullable: false } });
}
export function json<T = unknown>(): Column<'json', { nullable: false }, T> {
  return makeColumn({ type: 'json', flags: { nullable: false } });
}
export function jsonEnum<const V extends readonly string[]>(
  values: V,
): Column<'jsonEnum', { nullable: false; enum: V }> {
  return makeColumn({ type: 'jsonEnum', flags: { nullable: false, enum: values } });
}

// Function-style modifiers (pure; never mutate input) --------------------
// These mirror the fluent methods exactly — same `SetFlags` overwrite semantics,
// same return type — so `primaryKey(serial())` and `serial().primaryKey()` derive
// identical types (asserted in `type-derivation.type-test.ts`).
export function notNull<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
): Column<T, SetFlags<F, { nullable: false }>, P> {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: false } });
}
export function nullable<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
): Column<T, SetFlags<F, { nullable: true }>, P> {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: true } });
}
export function primaryKey<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
): Column<T, SetFlags<F, { primaryKey: true }>, P> {
  return makeColumn({ ...col, flags: { ...col.flags, primaryKey: true } });
}
export function unique<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
): Column<T, SetFlags<F, { unique: true }>, P> {
  return makeColumn({ ...col, flags: { ...col.flags, unique: true } });
}
export type ExtractColumns<T> = T extends { readonly columns: infer C }
  ? C
  : T extends { columns: infer C }
    ? C
    : T extends Record<string, ColumnMeta>
      ? T
      : Record<string, ColumnMeta>;

export type ValidateFkType<LocalCol extends ColumnMeta, TargetCol extends ColumnMeta> = [
  NonNullable<TsType<LocalCol>>,
] extends [NonNullable<TsType<TargetCol>>]
  ? [NonNullable<TsType<TargetCol>>] extends [NonNullable<TsType<LocalCol>>]
    ? true
    : false
  : false;

export function references<
  C extends ColumnMeta,
  Target extends { readonly columns: Record<string, ColumnMeta> } | Record<string, ColumnMeta>,
  K extends keyof ExtractColumns<Target> & string,
>(
  col: C,
  targetSchema: Target,
  targetColumn: K,
): ValidateFkType<C, ExtractColumns<Target>[K]> extends true
  ? C & { references: { readonly target: string } }
  : { __error: 'Referenced column type does not match' };

export function references<C extends ColumnMeta>(
  col: C,
  target: string,
  targetColumn?: string,
): C & { references: { readonly target: string } };

export function references(
  col: ColumnMeta,
  target: { table: string } | string,
  targetColumn?: string,
): ColumnMeta & { references: { readonly target: string } } {
  const tableName = typeof target === 'string' ? target : target.table;
  const targetStr = targetColumn ? `${tableName}.${targetColumn}` : tableName;
  return makeColumn<Column & { references: { readonly target: string } }>({
    ...col,
    references: { target: targetStr },
  });
}
export function defaultTo<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
  value: unknown,
): Column<T, SetFlags<F, { hasDefault: true }>, P> {
  return makeColumn({ ...col, default: value, flags: { ...col.flags, hasDefault: true } });
}
export function validate<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
  rule: ValidationRule,
): Column<T, F, P> {
  return makeColumn({ ...col, validation: [...(col.validation ?? []), rule] });
}
export function sensitive<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
  isSensitive: boolean = true,
): Column<T, SetFlags<F, { sensitive: boolean }>, P> {
  return makeColumn({ ...col, flags: { ...col.flags, sensitive: isSensitive } });
}

// defineSchema (#15) — derive primaryKey[] and references[] from column
// metadata, deeply freeze, and register. Throws SchemaError on no primary key.
const SCHEMA_REGISTRY = new Map<string, CoreSchema>();

// `C` is inferred from the argument, so the returned schema keeps the literal
// column map instead of the erased `Record<string, ColumnMeta>`. Without it the
// whole derived-type family (`Entity`, `CreateDTO`, `UpdateDTO`, and every read
// DTO) collapses to `{ [x: string]: unknown }` at the `defineSchema` seam.
export function defineSchema<T extends string, C extends ColumnsMap>(
  table: T,
  columns: C,
  options?: SchemaOptions,
): CoreSchema<T, C> {
  const primaryKeys: string[] = [];
  const refs: { column: string; target: string }[] = [];
  const frozenColumns: Record<string, ColumnMeta> = {};
  const unMarkedSerialColumns: string[] = [];

  for (const [name, col] of Object.entries(columns)) {
    if (col.flags.primaryKey === true) {
      primaryKeys.push(name);
    } else if (col.type === 'serial') {
      unMarkedSerialColumns.push(name);
    }
    if (col.references) refs.push({ column: name, target: col.references.target });
    frozenColumns[name] = Object.freeze({ ...col, flags: Object.freeze({ ...col.flags }) });
  }

  if (primaryKeys.length === 0) {
    if (unMarkedSerialColumns.length > 0) {
      throw new SchemaError(
        `serial column "${unMarkedSerialColumns[0]}" in schema "${table}" must be designated as a primary key`,
      );
    }
    throw new SchemaError(`schema "${table}" must declare at least one primary key`);
  }

  const schema: CoreSchema<T, C> = Object.freeze({
    table,
    // boundary: `frozenColumns` is built by copying every entry of `columns`, so
    // it has exactly C's keys and the same metadata per key (only the nested
    // objects are replaced by frozen copies). TS has no way to express
    // "structurally identical rebuild of a generic record", so the one assertion
    // stands in for that argument.
    columns: Object.freeze(frozenColumns) as C,
    primaryKey: Object.freeze(primaryKeys),
    references: Object.freeze(refs),
    ...(options?.ftsTable !== undefined ? { ftsTable: options.ftsTable } : {}),
  });

  SCHEMA_REGISTRY.set(table, schema);
  return schema;
}

// Compile-time-friendly registry access (explicit; no runtime reflection).
export function getRegisteredSchema(table: string): CoreSchema | undefined {
  return SCHEMA_REGISTRY.get(table);
}
export function registeredSchemas(): readonly CoreSchema[] {
  return [...SCHEMA_REGISTRY.values()];
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
