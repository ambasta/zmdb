// @zmdb/schema-core — API stubs (red phase).
// Implementation lands in #12–#15. Everything here throws so tests fail
// on behavior rather than on import resolution.

const NOT_IMPL = 'not implemented';

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

// A chainable column: carries ColumnMeta plus fluent modifier methods.
export interface Column extends ColumnMeta {
  notNull(): Column;
  nullable(): Column;
  primaryKey(): Column;
  unique(): Column;
  references(target: string): Column;
  defaultTo(value: unknown): Column;
  validate(rule: ValidationRule): Column;
}

// Column builders --------------------------------------------------------
export function serial(): Column {
  throw new Error(NOT_IMPL);
}
export function integer(): Column {
  throw new Error(NOT_IMPL);
}
export function bigint(): Column {
  throw new Error(NOT_IMPL);
}
export function numeric(): Column {
  throw new Error(NOT_IMPL);
}
export function text(): Column {
  throw new Error(NOT_IMPL);
}
export function varchar(_length: number): Column {
  throw new Error(NOT_IMPL);
}
export function boolean(): Column {
  throw new Error(NOT_IMPL);
}
export function timestamp(): Column {
  throw new Error(NOT_IMPL);
}
export function json(): Column {
  throw new Error(NOT_IMPL);
}
export function jsonEnum<const V extends readonly string[]>(_values: V): Column {
  throw new Error(NOT_IMPL);
}

// Function-style modifiers ----------------------------------------------
export function notNull(_col: ColumnMeta): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function nullable(_col: ColumnMeta): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function primaryKey(_col: ColumnMeta): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function unique(_col: ColumnMeta): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function references(_col: ColumnMeta, _target: string): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function defaultTo(_col: ColumnMeta, _value: unknown): ColumnMeta {
  throw new Error(NOT_IMPL);
}
export function validate(_col: ColumnMeta, _rule: ValidationRule): ColumnMeta {
  throw new Error(NOT_IMPL);
}

// defineSchema -----------------------------------------------------------
export function defineSchema<T extends string>(
  _table: T,
  _columns: Record<string, ColumnMeta>,
): CoreSchema<T> {
  throw new Error(NOT_IMPL);
}
