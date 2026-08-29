// Query-builder JOINs — API stubs (red phase, #84). Impl in #85–#88.
// A join-capable select builder. Kept separate from the shipped SELECT builder
// until implemented; the tests pin the frozen grammar + golden SQL.
import type { CompiledQuery, Dialect } from '../index.ts';

const NOT_IMPL = 'not implemented';

export type JoinKind = 'inner' | 'left' | 'right';

export interface JoinableSelect {
  innerJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  leftJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  rightJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  where(col: string, op: string, value: unknown): JoinableSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): JoinableSelect;
  limit(n: number): JoinableSelect;
  offset(n: number): JoinableSelect;
  compile(): CompiledQuery;
}

export function joinableSelectFrom(_table: string, _dialect: Dialect = 'postgres'): JoinableSelect {
  throw new Error(NOT_IMPL);
}
