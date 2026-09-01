// Set operations (UNION/INTERSECT/EXCEPT) + Batch — see ./SPEC.md.
import type { DialectTarget } from '../dialects/index.js';
import type { CompiledQuery } from '../index.js';
import { createCompiledQuery, getSegmentsForQuery } from '../internals.js';

export type SetOp = 'union' | 'unionAll' | 'intersect' | 'except';

export const SET_KEYWORD: Record<SetOp, string> = {
  union: 'UNION',
  unionAll: 'UNION ALL',
  intersect: 'INTERSECT',
  except: 'EXCEPT',
};

/**
 * Combine compiled queries with a set operator. Positional placeholders ($n)
 * are renumbered across the combined parameter list for postgres using numeric offset
 * arithmetic over pre-split segments; kept as `?` for mysql/sqlite. Single query ⇒ passthrough; empty ⇒ throw.
 */
export function setOperation(op: SetOp, queries: readonly CompiledQuery[], dialect: DialectTarget = 'postgres'): CompiledQuery {
  const [first] = queries;
  if (!first) throw new Error('setOperation requires at least one query');
  if (queries.length === 1) return first;

  const params: unknown[] = [];
  const fragments = queries.map(q => {
    let text = q.text;
    if (dialect === 'postgres') {
      const offset = params.length;
      const segments = getSegmentsForQuery(q);
      if (segments.length > 1) {
        let renumbered = segments[0] ?? '';
        for (let j = 0; j < segments.length - 1; j++) {
          renumbered += `$${offset + j + 1}${segments[j + 1] ?? ''}`;
        }
        text = renumbered;
      }
    }
    for (const p of q.parameters) params.push(p);
    return text;
  });
  const text = fragments.join(` ${SET_KEYWORD[op]} `);
  return createCompiledQuery(text, params);
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
