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
  op: SetOp,
  queries: readonly CompiledQuery[],
  dialect: Dialect,
): CompiledQuery {
  if (queries.length === 0) throw new Error('setOperation requires at least one query');
  if (queries.length === 1) return queries[0]!;
  const params: unknown[] = [];
  const fragments = queries.map((q) => {
    let text = q.text;
    if (dialect === 'postgres') {
      // renumber each $n in this fragment to continue the combined sequence
      const offset = params.length;
      text = text.replace(/\$(\d+)/g, (_m, n: string) => `$${offset + Number(n)}`);
    }
    for (const p of q.parameters) params.push(p);
    return text;
  });
  const text = fragments.join(` ${SET_KEYWORD[op]} `);
  return Object.freeze({ text, parameters: Object.freeze(params) });
}

// ---- Batch (§2) ----
export interface BatchHandle {
  readonly statements: readonly CompiledQuery[];
  execute<R>(runner: (stmts: readonly CompiledQuery[]) => Promise<readonly R[]>): Promise<readonly R[]>;
}
export function batch(_statements: readonly CompiledQuery[]): BatchHandle {
  throw new Error('not implemented');
}
