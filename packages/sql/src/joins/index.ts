import {
  createQueryCompiler,
  trustedTable,
  type DialectTarget,
  type QueryCompilerOptions,
  type SelectBuilder,
  type TrustedTable,
} from '../index.js';

export type { JoinCondition, JoinKind } from '../clauses.js';

export type JoinableSelect = SelectBuilder;

export function joinableSelectFrom(
  table: string | TrustedTable,
  dialect: DialectTarget,
  options?: QueryCompilerOptions,
): SelectBuilder {
  const target = typeof table === 'string' ? trustedTable(table) : table;
  return createQueryCompiler(dialect, options).selectFrom(target);
}
