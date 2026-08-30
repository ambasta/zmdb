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
  | { kind: 'raw'; raw: string; alias: string };

interface Where {
  col: string;
  op: string;
  value: unknown;
}

interface OrderBy {
  col: string;
  dir: 'asc' | 'desc';
}

interface State {
  table: string;
  items: SelectItem[];
  groups: string[];
  havings: Where[];
  orderBys: OrderBy[];
  limitN?: number;
  offsetN?: number;
}

export interface AggregationBuilder {
  select(...cols: (string | readonly string[])[]): AggregationBuilder;
  count(col: string, alias: string): AggregationBuilder;
  sum(col: string, alias: string): AggregationBuilder;
  avg(col: string, alias: string): AggregationBuilder;
  min(col: string, alias: string): AggregationBuilder;
  max(col: string, alias: string): AggregationBuilder;
  expr(raw: string, alias: string): AggregationBuilder;
  groupBy(...cols: string[]): AggregationBuilder;
  having(col: string, op: string, value: unknown): AggregationBuilder;
  orderBy(col: string, dir: 'asc' | 'desc'): AggregationBuilder;
  limit(n: number): AggregationBuilder;
  offset(n: number): AggregationBuilder;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): AggregationBuilder {
  const next = (p: Partial<State>): AggregationBuilder => make(d, { ...s, ...p });
  return {
    select: (...cols) =>
      next({ items: [...s.items, ...(cols.flat() as string[]).map(col => ({ kind: 'col' as const, col }))] }),
    count: (col, alias) => next({ items: [...s.items, { kind: 'agg', fn: 'COUNT', col, alias }] }),
    sum: (col, alias) => next({ items: [...s.items, { kind: 'agg', fn: 'SUM', col, alias }] }),
    avg: (col, alias) => next({ items: [...s.items, { kind: 'agg', fn: 'AVG', col, alias }] }),
    min: (col, alias) => next({ items: [...s.items, { kind: 'agg', fn: 'MIN', col, alias }] }),
    max: (col, alias) => next({ items: [...s.items, { kind: 'agg', fn: 'MAX', col, alias }] }),
    expr: (raw, alias) => next({ items: [...s.items, { kind: 'raw', raw, alias }] }),
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

export function selectAggregations(table: string, dialect: Dialect = 'postgres'): AggregationBuilder {
  return make(dialect, { table, items: [], groups: [], havings: [], orderBys: [] });
}

export type AggregateSelect = AggregationBuilder;
export const aggregateSelectFrom = selectAggregations;
