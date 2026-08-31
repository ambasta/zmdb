import { type JoinSpec, frozenQuery, havingClause, joinClauses, tailClause, whereClause } from '../clauses.ts';
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteIdentifier, quoteTable } from '../quoting.ts';

export type { JoinKind } from '../clauses.ts';

type SelectItem =
  | { kind: 'col'; col: string }
  | { kind: 'agg'; fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; col: string; alias: string }
  | { kind: 'expr'; raw: string; alias: string };

interface Comparison {
  col: string;
  op: string;
  value: unknown;
}

interface State {
  table: string;
  items: SelectItem[];
  joins: JoinSpec[];
  wheres: Comparison[];
  groups: string[];
  havings: Comparison[];
  orderBys: { col: string; dir: 'asc' | 'desc' }[];
  limitN?: number;
  offsetN?: number;
}

export interface AggregateSelect {
  select(cols: readonly string[]): AggregateSelect;
  count(expr: string, alias: string): AggregateSelect;
  sum(expr: string, alias: string): AggregateSelect;
  avg(expr: string, alias: string): AggregateSelect;
  min(expr: string, alias: string): AggregateSelect;
  max(expr: string, alias: string): AggregateSelect;
  expr(rawExpr: string, alias: string): AggregateSelect;
  innerJoin(target: string, leftCol: string, rightCol: string): AggregateSelect;
  leftJoin(target: string, leftCol: string, rightCol: string): AggregateSelect;
  rightJoin(target: string, leftCol: string, rightCol: string): AggregateSelect;
  where(col: string, op: string, value: unknown): AggregateSelect;
  groupBy(...cols: string[]): AggregateSelect;
  having(col: string, op: string, value: unknown): AggregateSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): AggregateSelect;
  limit(n: number): AggregateSelect;
  offset(n: number): AggregateSelect;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): AggregateSelect {
  const next = (p: Partial<State>): AggregateSelect => make(d, { ...s, ...p });
  const agg = (fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX', col: string, alias: string) =>
    next({ items: [...s.items, { kind: 'agg', fn, col, alias }] });
  const addJoin = (kind: JoinSpec['kind'], target: string, leftCol: string, rightCol: string) =>
    next({ joins: [...s.joins, { kind, target, leftCol, rightCol }] });

  return {
    select: cols => next({ items: [...s.items, ...cols.map((c): SelectItem => ({ kind: 'col', col: c }))] }),
    count: (e, a) => agg('COUNT', e, a),
    sum: (e, a) => agg('SUM', e, a),
    avg: (e, a) => agg('AVG', e, a),
    min: (e, a) => agg('MIN', e, a),
    max: (e, a) => agg('MAX', e, a),
    expr: (raw, alias) => next({ items: [...s.items, { kind: 'expr', raw, alias }] }),
    innerJoin: (t, l, r) => addJoin('inner', t, l, r),
    leftJoin: (t, l, r) => addJoin('left', t, l, r),
    rightJoin: (t, l, r) => addJoin('right', t, l, r),
    where: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value }] }),
    groupBy: (...cols) => next({ groups: [...s.groups, ...cols] }),
    having: (col, op, value) => next({ havings: [...s.havings, { col, op, value }] }),
    orderBy: (col, dir) => next({ orderBys: [...s.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const cols = s.items.map(it => {
        if (it.kind === 'col') {
          const m = /^(\S+)\s+as\s+(\S+)$/i.exec(it.col.trim());
          if (m && m[1] && m[2]) return `${quoteColumn(d, m[1])} AS ${quoteIdentifier(d, m[2])}`;
          if (it.col.includes('.') && !it.col.toLowerCase().startsWith(`${s.table.toLowerCase()}.`)) {
            return `${quoteColumn(d, it.col)} AS ${quoteIdentifier(d, it.col)}`;
          }
          return quoteColumn(d, it.col);
        }
        if (it.kind === 'agg') return `${it.fn}(${quoteColumn(d, it.col)}) AS ${quoteIdentifier(d, it.alias)}`;
        return `${it.raw} AS ${quoteIdentifier(d, it.alias)}`;
      });
      const groupBy = s.groups.length > 0 ? ` GROUP BY ${s.groups.map(c => quoteColumn(d, c)).join(', ')}` : '';
      const text =
        `SELECT ${cols.join(', ')} FROM ${quoteTable(d, s.table)}` +
        joinClauses(d, s.joins) +
        whereClause(d, s.wheres, params) +
        groupBy +
        havingClause(d, s.havings, params) +
        tailClause(d, s);
      return frozenQuery(text, params);
    },
  };
}

export function aggregateSelectFrom(table: string, dialect: Dialect = 'postgres'): AggregateSelect {
  return make(dialect, { table, items: [], joins: [], wheres: [], groups: [], havings: [], orderBys: [] });
}
