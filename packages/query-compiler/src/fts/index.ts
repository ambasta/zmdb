import { createQueryCompiler, type DialectTarget, type QueryCompilerOptions, type SelectBuilder } from '../index.js';
import { UnsupportedFeatureError } from '../errors.js';

export { UnsupportedFeatureError };

/**
 * An FTS5 term, quoted so that its own quotes cannot end the string.
 *
 * `unknown` rather than `string`, because a `Predicate`'s value is `unknown` — every other
 * operator takes one and binds it as a parameter — and the `String()` this always did is a
 * better answer for a caller who passes a number than an assertion at the one call site.
 */
export function escapeFts5Term(term: unknown): string {
  return `"${String(term).replace(/"/g, '""')}"`;
}

export interface FtsTableOptions {
  ftsTable?: string | boolean | undefined;
}

export interface FtsOptions extends FtsTableOptions, QueryCompilerOptions {}

export type FtsSelect<T = unknown> = SelectBuilder<T>;

export function ftsSelectFrom<T = unknown>(
  table: string,
  dialect: DialectTarget = 'postgres',
  options?: FtsOptions | string | boolean,
): SelectBuilder<T> {
  const opts = typeof options === 'object' && options !== null ? options : undefined;
  return createQueryCompiler(dialect, opts).selectFrom<T>(table, options);
}
