// Query-builder full-text search — implementation (#95). Per-dialect whereMatch:
// pg to_tsvector/@@/to_tsquery; mysql MATCH...AGAINST; sqlite = honest DNF.
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteTable } from '../quoting.ts';

export class UnsupportedFeatureError extends Error {
  constructor(feature: string, dialect: string) {
    super(`${feature} is not supported on dialect "${dialect}"`);
  }
}

interface Predicate {
  kind: 'match' | 'cmp';
  col: string;
  op?: string;
  value: unknown;
}
interface State {
  table: string;
  preds: Predicate[];
  limitN?: number;
  offsetN?: number;
}

export interface FtsSelect {
  whereMatch(column: string, term: string): FtsSelect;
  where(col: string, op: string, value: unknown): FtsSelect;
  limit(n: number): FtsSelect;
  offset(n: number): FtsSelect;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): FtsSelect {
  const next = (p: Partial<State>): FtsSelect => make(d, { ...s, ...p });
  return {
    whereMatch: (column, term) => {
      // Honest per-dialect DNF: sqlite has no arbitrary-column FTS predicate.
      if (d === 'sqlite') throw new UnsupportedFeatureError('full-text search', 'sqlite');
      return next({ preds: [...s.preds, { kind: 'match', col: column, value: term }] });
    },
    where: (col, op, value) => next({ preds: [...s.preds, { kind: 'cmp', col, op, value }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      let text = `SELECT * FROM ${quoteTable(d, s.table)}`;
      if (s.preds.length > 0) {
        const parts = s.preds.map(p => {
          params.push(p.value);
          if (p.kind === 'match') {
            if (d === 'postgres') {
              return `to_tsvector('english', ${quoteColumn(d, p.col)}) @@ to_tsquery('english', $${params.length})`;
            }
            // mysql
            return `MATCH(${quoteColumn(d, p.col)}) AGAINST(? IN NATURAL LANGUAGE MODE)`;
          }
          const ph = d === 'postgres' ? `$${params.length}` : '?';
          return `${quoteColumn(d, p.col)} ${p.op} ${ph}`;
        });
        text += ` WHERE ${parts.join(' AND ')}`;
      }
      if (s.limitN !== undefined) text += ` LIMIT ${s.limitN}`;
      if (s.offsetN !== undefined) text += ` OFFSET ${s.offsetN}`;
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

export function ftsSelectFrom(table: string, dialect: Dialect = 'postgres'): FtsSelect {
  return make(dialect, { table, preds: [] });
}
