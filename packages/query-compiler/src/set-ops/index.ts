// Set operations (UNION/INTERSECT/EXCEPT) + Batch — see ./SPEC.md.
import type { CompiledQuery, Dialect } from '../index.ts';

export type SetOp = 'union' | 'unionAll' | 'intersect' | 'except';

export const SET_KEYWORD: Record<SetOp, string> = {
  union: 'UNION',
  unionAll: 'UNION ALL',
  intersect: 'INTERSECT',
  except: 'EXCEPT',
};

/**
 * Combine compiled queries with a set operator. Positional placeholders ($n)
 * are renumbered across the combined parameter list for postgres; kept as `?`
 * for mysql/sqlite. Single query ⇒ passthrough; empty ⇒ throw.
 */
export function setOperation(
  _op: SetOp,
  _queries: readonly CompiledQuery[],
  _dialect: Dialect,
): CompiledQuery {
  throw new Error('not implemented');
}

// ---- Batch (§2) ----
export interface BatchHandle {
  readonly statements: readonly CompiledQuery[];
  execute<R>(runner: (stmts: readonly CompiledQuery[]) => Promise<readonly R[]>): Promise<readonly R[]>;
}
export function batch(_statements: readonly CompiledQuery[]): BatchHandle {
  throw new Error('not implemented');
}
