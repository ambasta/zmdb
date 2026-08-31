// Query-builder aggregations — implementation (#90). count/sum/avg/min/max +
// expr() computed columns + groupBy + having, dialect-aware, parameterized.
import type { CompiledQuery, Dialect } from '../index.ts';

const QUOTE: Record<Dialect, string> = { postgres: '"', mysql: '`', sqlite: '"' };
const PLACEHOLDER: Record<Dialect, (n: number) => string> = {
  postgres: n => `$${n}`,
  mysql: () => '?',
  sqlite: () => '?',
};

function quoteCol(d: Dialect, col: string): string {
  const q = QUOTE[d];
  return col
    .split('.')
    .map(p => `${q}${p}${q}`)
    .join('.');
}

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
    select: cols => next({ items: [...s.items, ...cols.map((c): SelectItem => ({ kind: 'col', col: c }))] }),
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
      const q = QUOTE[d];
      const params: unknown[] = [];
      const cols = s.items.map(it => {
        if (it.kind === 'col') return quoteCol(d, it.col);
        if (it.kind === 'agg') return `${it.fn}(${quoteCol(d, it.col)}) AS ${q}${it.alias}${q}`;
        return `${it.raw} AS ${q}${it.alias}${q}`;
      });
      let text = `SELECT ${cols.join(', ')} FROM ${q}${s.table}${q}`;
      if (s.groups.length > 0) text += ` GROUP BY ${s.groups.map(c => quoteCol(d, c)).join(', ')}`;
      if (s.havings.length > 0) {
        const parts = s.havings.map(h => {
          params.push(h.value);
          return `${quoteCol(d, h.col)} ${h.op} ${PLACEHOLDER[d](params.length)}`;
        });
        text += ` HAVING ${parts.join(' AND ')}`;
      }
      if (s.orderBys.length > 0) {
        text += ` ORDER BY ${s.orderBys.map(o => `${quoteCol(d, o.col)} ${o.dir.toUpperCase()}`).join(', ')}`;
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
