// Query-builder full-text search — API stubs (red phase, #94). Impl in #95–#97.
import type { CompiledQuery, Dialect } from '../index.ts';

const NOT_IMPL = 'not implemented';

export class UnsupportedFeatureError extends Error {
  constructor(feature: string, dialect: string) {
    super(`${feature} is not supported on dialect "${dialect}"`);
  }
}

export interface FtsSelect {
  whereMatch(column: string, term: string): FtsSelect;
  where(col: string, op: string, value: unknown): FtsSelect;
  limit(n: number): FtsSelect;
  offset(n: number): FtsSelect;
  compile(): CompiledQuery;
}

export function ftsSelectFrom(_table: string, _dialect: Dialect = 'postgres'): FtsSelect {
  throw new Error(NOT_IMPL);
}
