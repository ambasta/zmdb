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
  readonly sensitive?: boolean;
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
  sensitive(isSensitive?: boolean): Column;
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

  const withFlag = (patch: Partial<ColumnFlags>): Column => makeColumn({ ...base, flags: { ...base.flags, ...patch } });

  // boundary: Attach non-enumerable fluent methods to metadata object.
  const column = { ...base } as Column;

  // Fluent methods are NON-enumerable: they are behavior, not metadata, so two
  // columns with equal metadata compare deep-equal regardless of build style.
  const methods: Record<string, (...args: unknown[]) => Column> = {
    notNull: () => withFlag({ nullable: false }),
    nullable: () => withFlag({ nullable: true }),
    primaryKey: () => withFlag({ primaryKey: true }),
    unique: () => withFlag({ unique: true }),
    defaultTo: (value: unknown) =>
      makeColumn({ ...base, default: value, flags: { ...base.flags, hasDefault: true } }),
    validate: (rule: unknown) =>
      makeColumn({ ...base, validation: [...(base.validation ?? []), rule as ValidationRule] }),
    sensitive: (isSensitive: unknown) => withFlag({ sensitive: isSensitive !== false }),
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

export function serial(): Typed<{
  type: 'serial';
  flags: { nullable: false; primaryKey: false; autoIncrement: true; hasDefault: true };
}> {
  // boundary: Construct frozen Column for serial metadata.
  return makeColumn({
    type: 'serial',
    flags: { nullable: false, primaryKey: false, autoIncrement: true, hasDefault: true },
  }) as Typed<{
    type: 'serial';
    flags: { nullable: false; primaryKey: false; autoIncrement: true; hasDefault: true };
  }>;
}
export function integer(): Typed<{ type: 'integer'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for integer metadata.
  return makeColumn({ type: 'integer', flags: { nullable: false } }) as Typed<{
    type: 'integer';
    flags: { nullable: false };
  }>;
}
export function bigint(): Typed<{ type: 'bigint'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for bigint metadata.
  return makeColumn({ type: 'bigint', flags: { nullable: false } }) as Typed<{
    type: 'bigint';
    flags: { nullable: false };
  }>;
}
export function numeric(): Typed<{ type: 'numeric'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for numeric metadata.
  return makeColumn({ type: 'numeric', flags: { nullable: false } }) as Typed<{
    type: 'numeric';
    flags: { nullable: false };
  }>;
}
export function text(): Typed<{ type: 'text'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for text metadata.
  return makeColumn({ type: 'text', flags: { nullable: false } }) as Typed<{
    type: 'text';
    flags: { nullable: false };
  }>;
}
export function varchar(length: number): Typed<{ type: 'varchar'; flags: { nullable: false; length: number } }> {
  // boundary: Construct frozen Column for varchar metadata.
  return makeColumn({ type: 'varchar', flags: { nullable: false, length } }) as Typed<{
    type: 'varchar';
    flags: { nullable: false; length: number };
  }>;
}
export function boolean(): Typed<{ type: 'boolean'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for boolean metadata.
  return makeColumn({ type: 'boolean', flags: { nullable: false } }) as Typed<{
    type: 'boolean';
    flags: { nullable: false };
  }>;
}
export function timestamp(): Typed<{ type: 'timestamp'; flags: { nullable: false } }> {
  // boundary: Construct frozen Column for timestamp metadata.
  return makeColumn({ type: 'timestamp', flags: { nullable: false } }) as Typed<{
    type: 'timestamp';
    flags: { nullable: false };
  }>;
}
export function json(): Column {
  return makeColumn({ type: 'json', flags: { nullable: false } });
}
export function jsonEnum<const V extends readonly string[]>(
  values: V,
): Typed<{ type: 'jsonEnum'; flags: { nullable: false; enum: V } }> {
  // boundary: Construct frozen Column for jsonEnum metadata.
  return makeColumn({ type: 'jsonEnum', flags: { nullable: false, enum: values } }) as Typed<{
    type: 'jsonEnum';
    flags: { nullable: false; enum: V };
  }>;
}

// Function-style modifiers (pure; never mutate input) --------------------
// Function-style modifiers preserve the input column's literal metadata and
// merge in the new flag, so type derivation sees the narrowed result.
export function notNull<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { nullable: false } } {
  // boundary: Attach fluent methods to modified column metadata with nullable: false.
  return makeColumn({ ...col, flags: { ...col.flags, nullable: false } }) as unknown as C & {
    flags: C['flags'] & { nullable: false };
  };
}
export function nullable<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { nullable: true } } {
  // boundary: Attach fluent methods to modified column metadata with nullable: true.
  return makeColumn({ ...col, flags: { ...col.flags, nullable: true } }) as unknown as C & {
    flags: C['flags'] & { nullable: true };
  };
}
export function primaryKey<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { primaryKey: true } } {
  // boundary: Attach fluent methods to modified column metadata with primaryKey: true.
  return makeColumn({ ...col, flags: { ...col.flags, primaryKey: true } }) as unknown as C & {
    flags: C['flags'] & { primaryKey: true };
  };
}
export function unique<C extends ColumnMeta>(col: C): C & { flags: C['flags'] & { unique: true } } {
  // boundary: Attach fluent methods to modified column metadata with unique: true.
  return makeColumn({ ...col, flags: { ...col.flags, unique: true } }) as unknown as C & {
    flags: C['flags'] & { unique: true };
  };
}
export function references<C extends ColumnMeta>(col: C, target: string): C & { references: { target: string } } {
  // boundary: Attach fluent methods to modified column metadata with references target.
  return makeColumn({ ...col, references: { target } }) as unknown as C & { references: { target: string } };
}
export function defaultTo<C extends ColumnMeta>(
  col: C,
  value: unknown,
): C & { flags: C['flags'] & { hasDefault: true } } {
  // boundary: Attach fluent methods to modified column metadata with default value.
  return makeColumn({ ...col, default: value, flags: { ...col.flags, hasDefault: true } }) as unknown as C & {
    flags: C['flags'] & { hasDefault: true };
  };
}
export function validate<C extends ColumnMeta>(col: C, rule: ValidationRule): C {
  // boundary: Attach fluent methods to modified column metadata with appended validation rule.
  return makeColumn({ ...col, validation: [...(col.validation ?? []), rule] }) as unknown as C;
}
export function sensitive<C extends ColumnMeta>(
  col: C,
  isSensitive: boolean = true,
): C & { flags: C['flags'] & { sensitive: boolean } } {
  // boundary: Attach fluent methods to modified column metadata with sensitive flag.
  return makeColumn({ ...col, flags: { ...col.flags, sensitive: isSensitive } }) as unknown as C & {
    flags: C['flags'] & { sensitive: boolean };
  };
}

// defineSchema (#15) — derive primaryKey[] and references[] from column
// metadata, deeply freeze, and register. Throws SchemaError on no primary key.
const SCHEMA_REGISTRY = new Map<string, CoreSchema<string>>();

export function defineSchema<T extends string>(table: T, columns: Record<string, ColumnMeta>): CoreSchema<T> {
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

  const schema: CoreSchema<T> = Object.freeze({
    table,
    columns: Object.freeze(frozenColumns),
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
