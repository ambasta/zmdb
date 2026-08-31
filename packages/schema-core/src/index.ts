// @zmdb/schema-core — the single source of truth every other package derives
// from: column builders (#12), modifiers (#13), compile-time type derivation
// (#14) and `defineSchema` (#15).
//
// The derived-type family is only as good as the type information the builders
// carry, so `Column` and `CoreSchema` are generic in exactly that information —
// see `type-derivation.type-test.ts` for the assertions that pin it down.

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
}

export interface ColumnMeta {
  readonly type: SqlType;
  readonly flags: ColumnFlags;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
  readonly __payload?: unknown;
}

/** Erased view of a column map — the default `CoreSchema` argument. */
export type ColumnsMap = Readonly<Record<string, ColumnMeta>>;

/**
 * A defined schema.
 *
 * `C` carries the *literal* column map, which is what makes `Entity<S>`,
 * `CreateDTO<S>`, `WhereDTO<S>` &c. derive real property types. It defaults to
 * the erased `ColumnsMap` so `CoreSchema<string>` still means "any schema" for
 * code that does not care about the columns (repositories, OpenAPI, seeding).
 */
export interface CoreSchema<T extends string, C extends ColumnsMap = ColumnsMap> {
  readonly table: T;
  readonly columns: C;
  readonly primaryKey: readonly string[];
  readonly references: readonly { readonly column: string; readonly target: string }[];
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
type TsType<C extends ColumnMeta> = C['flags'] extends { nullable: true } ? BaseTsType<C> | null : BaseTsType<C>;

type ColumnsOf<S> = S extends { columns: infer C } ? C : never;

// Keys of columns that are auto-increment (stripped from CreateDTO).
type AutoIncrementKeys<C> = {
  [K in keyof C]: C[K] extends { flags: { autoIncrement: true } } ? K : never;
}[keyof C];

// Keys of columns that have a default (optional in CreateDTO).
type DefaultKeys<C> = {
  [K in keyof C]: C[K] extends { flags: { hasDefault: true } } ? K : never;
}[keyof C];

// Entity<S>: full row type — every column mapped to its TS type.
export type Entity<S> = {
  [K in keyof ColumnsOf<S>]: ColumnsOf<S>[K] extends ColumnMeta ? TsType<ColumnsOf<S>[K]> : never;
};

// CreateDTO<S>: omit auto-increment columns; columns with defaults are optional.
export type CreateDTO<S, C = ColumnsOf<S>> = {
  // required: not auto-increment, no default
  [
    K in keyof C as K extends AutoIncrementKeys<C> ? never : K extends DefaultKeys<C> ? never : K
  ]: C[K] extends ColumnMeta ? TsType<C[K]> : never;
} & {
  // optional: has a default (and not auto-increment)
  [
    K in keyof C as K extends AutoIncrementKeys<C> ? never : K extends DefaultKeys<C> ? K : never
  ]?: C[K] extends ColumnMeta ? TsType<C[K]> : never;
};

// UpdateDTO<S>: fully partial CreateDTO.
export type UpdateDTO<S> = Partial<CreateDTO<S>>;

export class SchemaError extends Error {}

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
export function varchar(length: number): Column<'varchar', { nullable: false; length: number }> {
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
export function references<T extends SqlType, F extends ColumnFlags, P>(
  col: Column<T, F, P>,
  target: string,
): Column<T, F, P> & { readonly references: { readonly target: string } } {
  return makeColumn({ ...col, references: { target } });
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

// defineSchema (#15) — derive primaryKey[] and references[] from column
// metadata, deeply freeze, and register. Throws SchemaError on no primary key.
const SCHEMA_REGISTRY = new Map<string, CoreSchema<string>>();

// `C` is inferred from the argument, so the returned schema keeps the literal
// column map instead of the erased `Record<string, ColumnMeta>`. Without it the
// whole derived-type family (`Entity`, `CreateDTO`, `UpdateDTO`, and every read
// DTO) collapses to `{ [x: string]: unknown }` at the `defineSchema` seam.
export function defineSchema<T extends string, C extends ColumnsMap>(table: T, columns: C): CoreSchema<T, C> {
  const primaryKeys: string[] = [];
  const refs: { column: string; target: string }[] = [];
  const frozenColumns: Record<string, ColumnMeta> = {};

  for (const [name, col] of Object.entries(columns)) {
    if (col.flags.primaryKey === true) primaryKeys.push(name);
    if (col.references) refs.push({ column: name, target: col.references.target });
    frozenColumns[name] = Object.freeze({ ...col, flags: Object.freeze({ ...col.flags }) });
  }

  if (primaryKeys.length === 0) {
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
  });

  SCHEMA_REGISTRY.set(table, schema);
  return schema;
}

// Compile-time-friendly registry access (explicit; no runtime reflection).
export function getRegisteredSchema(table: string): CoreSchema<string> | undefined {
  return SCHEMA_REGISTRY.get(table);
}
export function registeredSchemas(): readonly CoreSchema<string>[] {
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
