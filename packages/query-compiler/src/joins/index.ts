import { createQueryCompiler, type DialectTarget, type QueryCompilerOptions, type SelectBuilder } from '../index.js';

export type { JoinCondition, JoinKind } from '../clauses.js';

export type JoinableSelect<T = unknown> = SelectBuilder<T>;

export function joinableSelectFrom<T = unknown>(
  table: string,
  dialect: DialectTarget = 'postgres',
  options?: QueryCompilerOptions,
): SelectBuilder<T> {
  return createQueryCompiler(dialect, options).selectFrom<T>(table);
}
