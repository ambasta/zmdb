import { type JoinSpec, frozenQuery, joinClauses, tailClause, whereClause } from '../clauses.ts';
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteTable } from '../quoting.ts';

export type { JoinKind } from '../clauses.ts';

interface State {
  table: string;
  joins: JoinSpec[];
  wheres: { col: string; op: string; value: unknown }[];
  orderBys: { col: string; dir: 'asc' | 'desc' }[];
  limitN?: number;
  offsetN?: number;
}

export interface JoinableSelect {
  innerJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  leftJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  rightJoin(target: string, leftCol: string, rightCol: string): JoinableSelect;
  where(col: string, op: string, value: unknown): JoinableSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): JoinableSelect;
  limit(n: number): JoinableSelect;
  offset(n: number): JoinableSelect;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): JoinableSelect {
  const next = (patch: Partial<State>): JoinableSelect => make(d, { ...s, ...patch });
  const addJoin = (kind: JoinSpec['kind'], target: string, leftCol: string, rightCol: string) =>
    next({ joins: [...s.joins, { kind, target, leftCol, rightCol }] });
  return {
    innerJoin: (t, l, r) => addJoin('inner', t, l, r),
    leftJoin: (t, l, r) => addJoin('left', t, l, r),
    rightJoin: (t, l, r) => addJoin('right', t, l, r),
    where: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value }] }),
    orderBy: (col, dir) => next({ orderBys: [...s.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const text =
        `SELECT * FROM ${quoteTable(d, s.table)}` +
        joinClauses(d, s.joins) +
        whereClause(d, s.wheres, params) +
        tailClause(d, s);
      return frozenQuery(text, params);
    },
  };
}

export function joinableSelectFrom(table: string, dialect: Dialect = 'postgres'): JoinableSelect {
  return make(dialect, { table, joins: [], wheres: [], orderBys: [] });
}
