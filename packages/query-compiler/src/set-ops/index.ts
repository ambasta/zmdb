// Set operations (UNION/INTERSECT/EXCEPT) + Batch — see ./SPEC.md.
import type { DialectTarget } from '../dialects/index.js';
import type { CompiledQuery } from '../index.js';
import { renumberPlaceholders } from '../quoting.js';

export type SetOp = 'union' | 'unionAll' | 'intersect' | 'except';

export const SET_KEYWORD: Record<SetOp, string> = {
  union: 'UNION',
  unionAll: 'UNION ALL',
  intersect: 'INTERSECT',
  except: 'EXCEPT',
};

/**
 * Combine compiled queries with a set operator. Numbered and named placeholders
 * continue across fragments; positional `?` placeholders keep parameter-array order.
 * Single query ⇒ passthrough; empty ⇒ throw.
 */
export function setOperation(op: SetOp, queries: readonly CompiledQuery[], dialect: DialectTarget): CompiledQuery {
  const [first] = queries;
  if (!first) throw new Error('setOperation requires at least one query');
  if (queries.length === 1) return first;
  const params: unknown[] = [];
  const fragments = queries.map(q => {
    const offset = params.length;
    const text = renumberPlaceholders(q.text, offset, dialect);
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
