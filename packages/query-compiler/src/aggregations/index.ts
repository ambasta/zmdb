// Query-builder aggregations — API stubs (red phase, #89). Impl in #90–#93.
import type { CompiledQuery, Dialect } from '../index.ts';

const NOT_IMPL = 'not implemented';

export interface AggregateSelect {
  select(cols: readonly string[]): AggregateSelect;
  count(expr: string, alias: string): AggregateSelect;
  sum(expr: string, alias: string): AggregateSelect;
  avg(expr: string, alias: string): AggregateSelect;
  min(expr: string, alias: string): AggregateSelect;
  max(expr: string, alias: string): AggregateSelect;
  expr(rawExpr: string, alias: string): AggregateSelect;
  groupBy(...cols: string[]): AggregateSelect;
  having(col: string, op: string, value: unknown): AggregateSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): AggregateSelect;
  limit(n: number): AggregateSelect;
  offset(n: number): AggregateSelect;
  compile(): CompiledQuery;
}

export function aggregateSelectFrom(_table: string, _dialect: Dialect = 'postgres'): AggregateSelect {
  throw new Error(NOT_IMPL);
}
