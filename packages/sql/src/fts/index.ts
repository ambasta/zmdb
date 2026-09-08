import { UnsupportedFeatureError } from '../errors.js';
import {
  createQueryCompiler,
  trustedTable,
  type DialectTarget,
  type QueryCompilerOptions,
  type SelectBuilder,
  type TrustedTable,
} from '../index.js';

export { UnsupportedFeatureError };

export function escapeFts5Term(term: unknown): string {
  if (term === null || term === undefined) return '""';
  return `"${String(term).replace(/"/g, '""')}"`;
}

export interface FtsTableOptions {
  ftsTable?: string | boolean | undefined;
}

export interface FtsOptions extends FtsTableOptions, QueryCompilerOptions {}

export type FtsSelect = SelectBuilder;

export function ftsSelectFrom(
  table: string | TrustedTable,
  dialect: DialectTarget,
  options?: FtsOptions | string | boolean,
): SelectBuilder {
  const opts = typeof options === 'object' && options !== null ? options : undefined;
  const target = typeof table === 'string' ? trustedTable(table) : table;
  return createQueryCompiler(dialect, opts).selectFrom(target);
}
