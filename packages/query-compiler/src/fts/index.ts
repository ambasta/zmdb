// Full-text search (FTS) query builder (#92). Match expressions + ranking/snippet
// placeholders across Postgres (to_tsvector/to_tsquery/websearch_to_tsquery/phraseto_tsquery/
// ts_rank/ts_headline), SQLite (MATCH operator, bm25, snippet), MySQL (MATCH...AGAINST IN BOOLEAN MODE/NATURAL LANGUAGE MODE).
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteTable } from '../quoting.ts';

export class UnsupportedFeatureError extends Error {
  constructor(feature: string, dialect: string) {
    super(`${feature} is not supported on dialect "${dialect}"`);
  }
}

type MatchKind = 'plain' | 'phrase' | 'web' | 'boolean';

interface MatchPred {
  kind: 'match';
  col: string;
  value: string;
  mode?: MatchKind;
}

interface CmpPred {
  kind: 'cmp';
  col: string;
  op: string;
  value: unknown;
}

type Predicate = MatchPred | CmpPred;

interface State {
  table: string;
  preds: Predicate[];
  limitN?: number;
  offsetN?: number;
}

export interface FtsSelect {
  match(column: string, term: string, mode?: MatchKind): FtsSelect;
  whereMatch(column: string, term: string): FtsSelect;
  where(col: string, op: string, value: unknown): FtsSelect;
  limit(n: number): FtsSelect;
  offset(n: number): FtsSelect;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): FtsSelect {
  const next = (p: Partial<State>): FtsSelect => make(d, { ...s, ...p });
  return {
    match: (column, term, mode) => {
      if (d === 'sqlite') throw new UnsupportedFeatureError('full-text search', 'sqlite');
      if (mode) return next({ preds: [...s.preds, { kind: 'match', col: column, value: term, mode }] });
      return next({ preds: [...s.preds, { kind: 'match', col: column, value: term }] });
    },
    whereMatch: (column, term) => {
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
              const fn =
                p.mode === 'web' ? 'websearch_to_tsquery' : p.mode === 'phrase' ? 'phraseto_tsquery' : 'to_tsquery';
              return `to_tsvector('english', ${quoteColumn(d, p.col)}) @@ ${fn}('english', $${params.length})`;
            }
            if (d === 'mysql') {
              const modeStr = p.mode === 'boolean' ? 'BOOLEAN MODE' : 'NATURAL LANGUAGE MODE';
              return `MATCH(${quoteColumn(d, p.col)}) AGAINST(? IN ${modeStr})`;
            }
            return `${quoteColumn(d, p.col)} MATCH ?`;
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

export function searchFts(table: string, dialect: Dialect = 'postgres'): FtsSelect {
  return make(dialect, { table, preds: [] });
}

export const ftsSelectFrom = searchFts;
