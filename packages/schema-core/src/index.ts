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
  readonly references?: { readonly target: string } | undefined;
  readonly validation?: readonly ValidationRule[] | undefined;
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
  ]?: C[K] extends ColumnMeta ? TsType<C[K]> | undefined : never;
};

// UpdateDTO<S>: fully partial CreateDTO with exact optional property support.
export type UpdateDTO<S> = {
  [K in keyof CreateDTO<S>]?: CreateDTO<S>[K] | undefined;
};

export class SchemaError extends Error {}

export type UpdateFlags<F, P> = Omit<F, keyof P> & P;

export type UpdateColumnFlags<M, P extends Partial<ColumnFlags>> = Omit<M, 'flags'> & {
  flags: UpdateFlags<M extends { flags: infer F } ? F : ColumnFlags, P>;
};

export interface ColumnMethods<M extends ColumnMeta = ColumnMeta> {
  notNull(): Column<UpdateColumnFlags<M, { nullable: false }>>;
  nullable(): Column<UpdateColumnFlags<M, { nullable: true }>>;
  primaryKey(): Column<UpdateColumnFlags<M, { primaryKey: true; hasDefault: true }>>;
  unique(): Column<UpdateColumnFlags<M, { unique: true }>>;
  defaultTo<V>(value: V): Column<UpdateColumnFlags<M, { hasDefault: true }> & { default: V }>;
  validate(rule: ValidationRule): Column<M & { validation: readonly ValidationRule[] }>;
}

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
export type Column<M extends ColumnMeta = ColumnMeta> = M & ColumnMethods<M>;

// Deep-freeze a column metadata object and wrap it with fluent methods.
// Each fluent method returns a NEW frozen column (immutability preserved).
function makeColumn<M extends ColumnMeta>(meta: M): Column<M> {
  const frozenFlags = Object.freeze({ ...meta.flags });
  const base: ColumnMeta = Object.freeze({
    ...meta,
    flags: frozenFlags,
    ...(meta.validation ? { validation: Object.freeze([...meta.validation]) } : {}),
  });

  const withFlag = (patch: Partial<ColumnFlags>): unknown =>
    makeColumn({ ...base, flags: { ...base.flags, ...patch } });

  // Metadata is the enumerable surface (so `toEqual` compares metadata only).
  const column = { ...base } as unknown as Column<M>;

  // Fluent methods are NON-enumerable: they are behavior, not metadata, so two
  // columns with equal metadata compare deep-equal regardless of build style.
  const methods: Record<string, (...args: never[]) => unknown> = {
    notNull: () => withFlag({ nullable: false }),
    nullable: () => withFlag({ nullable: true }),
    primaryKey: () => withFlag({ primaryKey: true, hasDefault: true }),
    unique: () => withFlag({ unique: true }),
    defaultTo: (value: unknown) => makeColumn({ ...base, default: value, flags: { ...base.flags, hasDefault: true } }),
    validate: (rule: ValidationRule) => makeColumn({ ...base, validation: [...(base.validation ?? []), rule] }),
  };
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(column, name, { value: fn, enumerable: false, writable: false });
  }
  return Object.freeze(column);
}

// Column builders --------------------------------------------------------
// Builders return literal-typed metadata so downstream type derivation
// (Entity/CreateDTO/UpdateDTO) can read `type` and enum literals. Runtime is
// unchanged (makeColumn); the precise return type is a cast over it.
export type Typed<M extends ColumnMeta> = Column<M>;

export function serial(): Column<{
  type: 'serial';
  flags: { nullable: false; primaryKey: false; autoIncrement: true; hasDefault: true };
}> {
  return makeColumn({
    type: 'serial',
    flags: { nullable: false, primaryKey: false, autoIncrement: true, hasDefault: true },
  });
}
export function integer(): Column<{ type: 'integer'; flags: { nullable: false } }> {
  return makeColumn({ type: 'integer', flags: { nullable: false } });
}
export function bigint(): Column<{ type: 'bigint'; flags: { nullable: false } }> {
  return makeColumn({ type: 'bigint', flags: { nullable: false } });
}
export function numeric(): Column<{ type: 'numeric'; flags: { nullable: false } }> {
  return makeColumn({ type: 'numeric', flags: { nullable: false } });
}
export function text(): Column<{ type: 'text'; flags: { nullable: false } }> {
  return makeColumn({ type: 'text', flags: { nullable: false } });
}
export function varchar<L extends number>(
  length: L,
): Column<{ type: 'varchar'; flags: { nullable: false; length: L } }> {
  return makeColumn({ type: 'varchar', flags: { nullable: false, length } });
}
export function boolean(): Column<{ type: 'boolean'; flags: { nullable: false } }> {
  return makeColumn({ type: 'boolean', flags: { nullable: false } });
}
export function timestamp(): Column<{ type: 'timestamp'; flags: { nullable: false } }> {
  return makeColumn({ type: 'timestamp', flags: { nullable: false } });
}
export function json<T = unknown>(): Column<{ type: 'json'; flags: { nullable: false }; __payload?: T }> {
  return makeColumn({ type: 'json', flags: { nullable: false } });
}
export function jsonEnum<const V extends readonly string[]>(
  values: V,
): Column<{ type: 'jsonEnum'; flags: { nullable: false; enum: V } }> {
  return makeColumn({ type: 'jsonEnum', flags: { nullable: false, enum: values } });
}

// Function-style modifiers (pure; never mutate input) --------------------
// Function-style modifiers preserve the input column's literal metadata and
// merge in the new flag, so type derivation sees the narrowed result.
export function notNull<C extends ColumnMeta>(col: C): Column<UpdateColumnFlags<C, { nullable: false }>> {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: false } }) as never;
}
export function nullable<C extends ColumnMeta>(col: C): Column<UpdateColumnFlags<C, { nullable: true }>> {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: true } }) as never;
}
export function primaryKey<C extends ColumnMeta>(
  col: C,
): Column<UpdateColumnFlags<C, { primaryKey: true; hasDefault: true }>> {
  return makeColumn({ ...col, flags: { ...col.flags, primaryKey: true, hasDefault: true } }) as never;
}
export function unique<C extends ColumnMeta>(col: C): Column<UpdateColumnFlags<C, { unique: true }>> {
  return makeColumn({ ...col, flags: { ...col.flags, unique: true } }) as never;
}
export function references<C extends ColumnMeta, T extends string>(
  col: C,
  target: T,
): Column<Omit<C, 'references'> & { references: { target: T } }> {
  return makeColumn({ ...col, references: { target } }) as never;
}
export function defaultTo<C extends ColumnMeta, V>(
  col: C,
  value: V,
): Column<UpdateColumnFlags<C, { hasDefault: true }> & { default: V }> {
  return makeColumn({ ...col, default: value, flags: { ...col.flags, hasDefault: true } }) as never;
}
export function validate<C extends ColumnMeta>(
  col: C,
  rule: ValidationRule,
): Column<Omit<C, 'validation'> & { validation: readonly ValidationRule[] }> {
  return makeColumn({ ...col, validation: [...(col.validation ?? []), rule] }) as never;
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
