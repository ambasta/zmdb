// Query-builder aggregations — implementation (#90). count/sum/avg/min/max +
// expr() computed columns + groupBy + having, dialect-aware, parameterized.
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteIdentifier, quoteTable } from '../quoting.ts';

const PLACEHOLDER: Record<Dialect, (n: number) => string> = {
  postgres: n => `$${n}`,
  mysql: () => '?',
  sqlite: () => '?',
};

type SelectItem =
  | { kind: 'col'; col: string }
  | { kind: 'agg'; fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; col: string; alias: string }
  | { kind: 'expr'; raw: string; alias: string };

interface State {
  table: string;
  items: SelectItem[];
  groups: string[];
  havings: { col: string; op: string; value: unknown }[];
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
  return {
    select: cols => next({ items: [...s.items, ...cols.map(c => ({ kind: 'col', col: c }) as SelectItem)] }),
    count: (e, a) => agg('COUNT', e, a),
    sum: (e, a) => agg('SUM', e, a),
    avg: (e, a) => agg('AVG', e, a),
    min: (e, a) => agg('MIN', e, a),
    max: (e, a) => agg('MAX', e, a),
    expr: (raw, alias) => next({ items: [...s.items, { kind: 'expr', raw, alias }] }),
    groupBy: (...cols) => next({ groups: [...s.groups, ...cols] }),
    having: (col, op, value) => next({ havings: [...s.havings, { col, op, value }] }),
    orderBy: (col, dir) => next({ orderBys: [...s.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const cols = s.items.map(it => {
        if (it.kind === 'col') return quoteColumn(d, it.col);
        if (it.kind === 'agg') return `${it.fn}(${quoteColumn(d, it.col)}) AS ${quoteIdentifier(d, it.alias)}`;
        return `${it.raw} AS ${quoteIdentifier(d, it.alias)}`;
      });
      let text = `SELECT ${cols.join(', ')} FROM ${quoteTable(d, s.table)}`;
      if (s.groups.length > 0) text += ` GROUP BY ${s.groups.map(c => quoteColumn(d, c)).join(', ')}`;
      if (s.havings.length > 0) {
        const parts = s.havings.map(h => {
          params.push(h.value);
          return `${quoteColumn(d, h.col)} ${h.op} ${PLACEHOLDER[d](params.length)}`;
        });
        text += ` HAVING ${parts.join(' AND ')}`;
      }
      if (s.orderBys.length > 0) {
        text += ` ORDER BY ${s.orderBys.map(o => `${quoteColumn(d, o.col)} ${o.dir.toUpperCase()}`).join(', ')}`;
      }
      if (s.limitN !== undefined) text += ` LIMIT ${s.limitN}`;
      if (s.offsetN !== undefined) text += ` OFFSET ${s.offsetN}`;
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

export function aggregateSelectFrom(table: string, dialect: Dialect = 'postgres'): AggregateSelect {
  return make(dialect, { table, items: [], groups: [], havings: [], orderBys: [] });
}
