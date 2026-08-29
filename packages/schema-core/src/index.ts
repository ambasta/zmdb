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
export function serial(): Column {
  return makeColumn({
    type: 'serial',
    flags: { nullable: false, primaryKey: false, autoIncrement: true, hasDefault: true },
  });
}
export function integer(): Column {
  return makeColumn({ type: 'integer', flags: { nullable: false } });
}
export function bigint(): Column {
  return makeColumn({ type: 'bigint', flags: { nullable: false } });
}
export function numeric(): Column {
  return makeColumn({ type: 'numeric', flags: { nullable: false } });
}
export function text(): Column {
  return makeColumn({ type: 'text', flags: { nullable: false } });
}
export function varchar(length: number): Column {
  return makeColumn({ type: 'varchar', flags: { nullable: false, length } });
}
export function boolean(): Column {
  return makeColumn({ type: 'boolean', flags: { nullable: false } });
}
export function timestamp(): Column {
  return makeColumn({ type: 'timestamp', flags: { nullable: false } });
}
export function json(): Column {
  return makeColumn({ type: 'json', flags: { nullable: false } });
}
export function jsonEnum<const V extends readonly string[]>(values: V): Column {
  return makeColumn({ type: 'jsonEnum', flags: { nullable: false, enum: values } });
}

// Function-style modifiers (pure; never mutate input) --------------------
export function notNull(col: ColumnMeta): ColumnMeta {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: false } });
}
export function nullable(col: ColumnMeta): ColumnMeta {
  return makeColumn({ ...col, flags: { ...col.flags, nullable: true } });
}
export function primaryKey(col: ColumnMeta): ColumnMeta {
  return makeColumn({ ...col, flags: { ...col.flags, primaryKey: true } });
}
export function unique(col: ColumnMeta): ColumnMeta {
  return makeColumn({ ...col, flags: { ...col.flags, unique: true } });
}
export function references(col: ColumnMeta, target: string): ColumnMeta {
  return makeColumn({ ...col, references: { target } });
}
export function defaultTo(col: ColumnMeta, value: unknown): ColumnMeta {
  return makeColumn({ ...col, default: value, flags: { ...col.flags, hasDefault: true } });
}
export function validate(col: ColumnMeta, rule: ValidationRule): ColumnMeta {
  return makeColumn({ ...col, validation: [...(col.validation ?? []), rule] });
}

// defineSchema (#15) — NOT yet implemented; tests remain red. ------------
export function defineSchema<T extends string>(
  _table: T,
  _columns: Record<string, ColumnMeta>,
): CoreSchema<T> {
  throw new Error('not implemented');
}
