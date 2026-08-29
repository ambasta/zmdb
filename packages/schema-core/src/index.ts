// @zmdb/schema-core — implementation.
// #12 column builders + #13 modifiers implemented. #14 derivation (types)
// and #15 defineSchema remain unimplemented (their tests stay red).

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

export interface ColumnFlags {
  readonly nullable: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly autoIncrement?: boolean;
  readonly hasDefault?: boolean;
  readonly length?: number;
  readonly enum?: readonly string[];
}

export interface ColumnMeta {
  readonly type: SqlType;
  readonly flags: ColumnFlags;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}

export interface CoreSchema<T extends string> {
  readonly table: T;
  readonly columns: Readonly<Record<string, ColumnMeta>>;
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
            : unknown;

// Apply nullability.
type TsType<C extends ColumnMeta> = C['flags'] extends { nullable: true }
  ? BaseTsType<C> | null
  : BaseTsType<C>;

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
  [K in keyof C as K extends AutoIncrementKeys<C> ? never : K extends DefaultKeys<C> ? never : K]: C[K] extends ColumnMeta
    ? TsType<C[K]>
    : never;
} & {
  // optional: has a default (and not auto-increment)
  [K in keyof C as K extends AutoIncrementKeys<C> ? never : K extends DefaultKeys<C> ? K : never]?: C[K] extends ColumnMeta
    ? TsType<C[K]>
    : never;
};

// UpdateDTO<S>: fully partial CreateDTO.
export type UpdateDTO<S> = Partial<CreateDTO<S>>;

export class SchemaError extends Error {}

// Chainable column: ColumnMeta + fluent modifier methods.
// Note: `references` is intentionally NOT a fluent method — it would collide
// with the `ColumnMeta.references` metadata field. Use the function-style
// `references(col, target)` modifier for foreign keys.
export interface Column extends ColumnMeta {
  notNull(): Column;
  nullable(): Column;
  primaryKey(): Column;
  unique(): Column;
  defaultTo(value: unknown): Column;
  validate(rule: ValidationRule): Column;
}

// Deep-freeze a column metadata object and wrap it with fluent methods.
// Each fluent method returns a NEW frozen column (immutability preserved).
function makeColumn(meta: ColumnMeta): Column {
  const frozenFlags = Object.freeze({ ...meta.flags });
  const base: ColumnMeta = Object.freeze({
    ...meta,
    flags: frozenFlags,
    ...(meta.validation ? { validation: Object.freeze([...meta.validation]) } : {}),
  });

  const withFlag = (patch: Partial<ColumnFlags>): Column =>
    makeColumn({ ...base, flags: { ...base.flags, ...patch } });

  // Metadata is the enumerable surface (so `toEqual` compares metadata only).
  const column = { ...base } as unknown as Column;

  // Fluent methods are NON-enumerable: they are behavior, not metadata, so two
  // columns with equal metadata compare deep-equal regardless of build style.
  const methods: Record<string, (...args: never[]) => Column> = {
    notNull: () => withFlag({ nullable: false }),
    nullable: () => withFlag({ nullable: true }),
    primaryKey: () => withFlag({ primaryKey: true }),
    unique: () => withFlag({ unique: true }),
    defaultTo: ((value: unknown) =>
      makeColumn({ ...base, default: value, flags: { ...base.flags, hasDefault: true } })) as never,
    validate: ((rule: ValidationRule) =>
      makeColumn({ ...base, validation: [...(base.validation ?? []), rule] })) as never,
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
type Typed<M extends ColumnMeta> = Column & M;

export function serial(): Typed<{ type: 'serial'; flags: { nullable: false; primaryKey: false; autoIncrement: true; hasDefault: true } }> {
  return makeColumn({
    type: 'serial',
    flags: { nullable: false, primaryKey: false, autoIncrement: true, hasDefault: true },
  }) as never;
}
export function integer(): Typed<{ type: 'integer'; flags: { nullable: false } }> {
  return makeColumn({ type: 'integer', flags: { nullable: false } }) as never;
}
export function bigint(): Typed<{ type: 'bigint'; flags: { nullable: false } }> {
  return makeColumn({ type: 'bigint', flags: { nullable: false } }) as never;
}
export function numeric(): Typed<{ type: 'numeric'; flags: { nullable: false } }> {
  return makeColumn({ type: 'numeric', flags: { nullable: false } }) as never;
}
export function text(): Typed<{ type: 'text'; flags: { nullable: false } }> {
  return makeColumn({ type: 'text', flags: { nullable: false } }) as never;
}
export function varchar(length: number): Typed<{ type: 'varchar'; flags: { nullable: false; length: number } }> {
  return makeColumn({ type: 'varchar', flags: { nullable: false, length } }) as never;
}
export function boolean(): Typed<{ type: 'boolean'; flags: { nullable: false } }> {
  return makeColumn({ type: 'boolean', flags: { nullable: false } }) as never;
}
export function timestamp(): Typed<{ type: 'timestamp'; flags: { nullable: false } }> {
  return makeColumn({ type: 'timestamp', flags: { nullable: false } }) as never;
}
export function json(): Column {
  return makeColumn({ type: 'json', flags: { nullable: false } });
}
export function jsonEnum<const V extends readonly string[]>(
  values: V,
): Typed<{ type: 'jsonEnum'; flags: { nullable: false; enum: V } }> {
  return makeColumn({ type: 'jsonEnum', flags: { nullable: false, enum: values } }) as never;
}

// Function-style modifiers (pure; never mutate input) --------------------
// Function-style modifiers preserve the input column's literal metadata and
// merge in the new flag, so type derivation sees the narrowed result.
export function notNull<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { nullable: false } } {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: false } }) as never;
}
export function nullable<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { nullable: true } } {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: true } }) as never;
}
export function primaryKey<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { primaryKey: true } } {
  return makeColumn({ ...col, flags: { ...col.flags, primaryKey: true } }) as never;
}
export function unique<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { unique: true } } {
  return makeColumn({ ...col, flags: { ...col.flags, unique: true } }) as never;
}
export function references<C extends ColumnMeta>(col: C, target: string): C & { references: { target: string } } {
  return makeColumn({ ...col, references: { target } }) as never;
}
export function defaultTo<C extends ColumnMeta>(col: C, value: unknown): C & { flags: C['flags'] & { hasDefault: true } } {
  return makeColumn({ ...col, default: value, flags: { ...col.flags, hasDefault: true } }) as never;
}
export function validate<C extends ColumnMeta>(col: C, rule: ValidationRule): C {
  return makeColumn({ ...col, validation: [...(col.validation ?? []), rule] }) as never;
}

// defineSchema (#15) — derive primaryKey[] and references[] from column
// metadata, deeply freeze, and register. Throws SchemaError on no primary key.
const SCHEMA_REGISTRY = new Map<string, CoreSchema<string>>();

export function defineSchema<T extends string>(
  table: T,
  columns: Record<string, ColumnMeta>,
): CoreSchema<T> {
  const primaryKey: string[] = [];
  const references: { column: string; target: string }[] = [];
  const frozenColumns: Record<string, ColumnMeta> = {};

  for (const [name, col] of Object.entries(columns)) {
    if (col.flags.primaryKey === true) primaryKey.push(name);
    if (col.references) references.push({ column: name, target: col.references.target });
    frozenColumns[name] = Object.freeze({ ...col, flags: Object.freeze({ ...col.flags }) });
  }

  if (primaryKey.length === 0) {
    throw new SchemaError(`schema "${table}" must declare at least one primary key`);
  }

  const schema: CoreSchema<T> = Object.freeze({
    table,
    columns: Object.freeze(frozenColumns),
    primaryKey: Object.freeze(primaryKey),
    references: Object.freeze(references),
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
