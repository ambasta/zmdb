import { createQueryCompiler, type DialectTarget, type QueryCompilerOptions, type SelectBuilder } from '../index.js';

export type { JoinCondition, JoinKind } from '../clauses.js';

export type AggregateSelect<T = unknown> = SelectBuilder<T>;

export function aggregateSelectFrom<T = unknown>(
  table: string,
  dialect: DialectTarget,
  options?: QueryCompilerOptions,
): SelectBuilder<T> {
  return createQueryCompiler(dialect, options).selectFrom<T>(table);
}
