import { renumberPlaceholders } from '../dialect.ts';
// Set operations (UNION/INTERSECT/EXCEPT) + Batch — see ./SPEC.md.
import type { CompiledQuery, Dialect } from '../index.ts';
import { renumberPlaceholders } from '../quoting.ts';

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
export function setOperation(op: SetOp, queries: readonly CompiledQuery[], dialect: Dialect): CompiledQuery {
  const [first] = queries;
  if (!first) throw new Error('setOperation requires at least one query');
  if (queries.length === 1) return first;
  const params: unknown[] = [];
  const fragments = queries.map(q => {
    let text = q.text;
    if (dialect === 'postgres') {
      // renumber each $n in this fragment to continue the combined sequence
      const offset = params.length;
      text = renumberPlaceholders(text, offset);
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
export function batch(statements: readonly CompiledQuery[]): BatchHandle {
  return {
    statements,
    async execute(runner) {
      if (statements.length === 0) return [];
      return runner(statements);
    },
  };
}
