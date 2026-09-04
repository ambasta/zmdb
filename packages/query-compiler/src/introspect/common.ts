import type { CompiledQuery } from '../index.js';
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from '../migrations/index.js';

export type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';

export type CatalogIndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

export interface CatalogForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

export interface CatalogIndexSnapshot {
  readonly name: string;
  readonly columns: readonly CatalogIndexColumn[];
  readonly unique: boolean;
  readonly method?: string;
  readonly where?: string;
}

export interface CatalogColumnSnapshot extends ColumnSnapshot {
  readonly catalogType: string;
  readonly default?: string;
}

export interface CatalogWarning {
  readonly table: string;
  readonly column?: string;
  readonly reason: string;
}

/**
 * The catalog readers already recover the fields frozen by the composite-key,
 * referential-action and expression-index epics. Their migration implementations
 * have not landed at this base, so this structural extension keeps those facts
 * available without making #431 implement their diff and DDL slices.
 */
export interface CatalogTableSnapshot extends Omit<TableSnapshot, 'columns'> {
  readonly columns: readonly CatalogColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly CatalogForeignKeySnapshot[];
  readonly indexes: readonly CatalogIndexSnapshot[];
}

export interface CatalogSchemaSnapshot extends Omit<SchemaSnapshot, 'tables'> {
  readonly tables: readonly CatalogTableSnapshot[];
  readonly extensions: readonly { readonly name: string; readonly schema?: string }[];
  readonly warnings: readonly CatalogWarning[];
}

export interface CatalogSelection {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export class CatalogRowError extends TypeError {
  readonly catalog: string;
  readonly row: number;
  readonly field: string;
  readonly expected: string;

  constructor(catalog: string, row: number, field: string, expected: string, value: unknown) {
    super(`${catalog} row ${String(row)} field "${field}" must be ${expected}; received ${describeValue(value)}`);
    this.name = 'CatalogRowError';
    this.catalog = catalog;
    this.row = row;
    this.field = field;
    this.expected = expected;
  }
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function valueAt(row: Readonly<Record<string, unknown>>, field: string): unknown {
  return Reflect.get(row, field);
}

export function textField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): string {
  const value = valueAt(row, field);
  if (typeof value !== 'string') throw new CatalogRowError(catalog, index, field, 'a string', value);
  return value;
}

export function nullableTextField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): string | null {
  const value = valueAt(row, field);
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new CatalogRowError(catalog, index, field, 'a string or null', value);
  }
  return value;
}

export function integerField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): number {
  const value = valueAt(row, field);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new CatalogRowError(catalog, index, field, 'a safe integer or decimal integer string', value);
}

export function nullableIntegerField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): number | null {
  const value = valueAt(row, field);
  if (value === null) return null;
  return integerField(row, field, catalog, index);
}

export function flagField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): boolean {
  const value = integerField(row, field, catalog, index);
  if (value === 0) return false;
  if (value === 1) return true;
  throw new CatalogRowError(catalog, index, field, '0 or 1', valueAt(row, field));
}

export function booleanField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  catalog: string,
  index: number,
): boolean {
  const value = valueAt(row, field);
  if (typeof value === 'boolean') return value;
  throw new CatalogRowError(catalog, index, field, 'a boolean', value);
}

export function query(text: string, parameters: readonly unknown[] = []): CompiledQuery {
  return { text, parameters };
}

function globExpression(glob: string): RegExp {
  let source = '^';
  for (const character of glob) {
    if (character === '*') source += '.*';
    else if (character === '?') source += '.';
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function matchesAny(name: string, globs: readonly string[]): boolean {
  return globs.some(glob => globExpression(glob).test(name));
}

export function tableSelected(name: string, selection: CatalogSelection): boolean {
  const include = selection.include;
  if (include !== undefined && include.length > 0 && !matchesAny(name, include)) return false;
  const exclude = selection.exclude ?? ['_zmdb_migrations'];
  return !matchesAny(name, exclude);
}

export function action(value: string, catalog: string, row: number, field: string): ReferentialAction {
  const normalized = value.toLowerCase().replaceAll('_', ' ');
  switch (normalized) {
    case 'no action':
    case 'restrict':
    case 'cascade':
    case 'set null':
    case 'set default':
      return normalized;
    default:
      throw new CatalogRowError(catalog, row, field, 'a referential action', value);
  }
}

export function deterministicForeignKeyName(table: string, columns: readonly string[]): string {
  return `${table}_${columns.join('_')}_fkey`;
}

export function sortByName<T extends { readonly name: string }>(values: readonly T[]): readonly T[] {
  return values.toSorted((left, right) => left.name.localeCompare(right.name));
}

export function sortWarnings(values: readonly CatalogWarning[]): readonly CatalogWarning[] {
  return values.toSorted(
    (left, right) =>
      left.table.localeCompare(right.table) ||
      (left.column ?? '').localeCompare(right.column ?? '') ||
      left.reason.localeCompare(right.reason),
  );
}

export function splitSqlList(value: string): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | '`' | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}
