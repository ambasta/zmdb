// Join query builder (#91). innerJoin / leftJoin / rightJoin + table aliasing.
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteTable } from '../quoting.ts';

export type JoinKind = 'inner' | 'left' | 'right';

const PLACEHOLDER: Record<Dialect, (n: number) => string> = {
  postgres: n => `$${n}`,
  mysql: () => '?',
  sqlite: () => '?',
};

interface Join {
  kind: JoinKind;
  target: string;
  leftCol: string;
  rightCol: string;
}

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
  joins: Join[];
  wheres: Where[];
  orderBys: OrderBy[];
  limitN?: number;
  offsetN?: number;
}

export interface JoinBuilder {
  innerJoin(target: string, leftCol: string, rightCol: string): JoinBuilder;
  leftJoin(target: string, leftCol: string, rightCol: string): JoinBuilder;
  rightJoin(target: string, leftCol: string, rightCol: string): JoinBuilder;
  where(col: string, op: string, value: unknown): JoinBuilder;
  orderBy(col: string, dir: 'asc' | 'desc'): JoinBuilder;
  limit(n: number): JoinBuilder;
  offset(n: number): JoinBuilder;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): JoinBuilder {
  const next = (p: Partial<State>): JoinBuilder => make(d, { ...s, ...p });
  return {
    innerJoin: (target, leftCol, rightCol) =>
      next({ joins: [...s.joins, { kind: 'inner', target, leftCol, rightCol }] }),
    leftJoin: (target, leftCol, rightCol) => next({ joins: [...s.joins, { kind: 'left', target, leftCol, rightCol }] }),
    rightJoin: (target, leftCol, rightCol) =>
      next({ joins: [...s.joins, { kind: 'right', target, leftCol, rightCol }] }),
    where: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value }] }),
    orderBy: (col, dir) => next({ orderBys: [...s.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      let text = `SELECT * FROM ${quoteTable(d, s.table)}`;
      for (const j of s.joins) {
        const kw = j.kind === 'inner' ? 'INNER JOIN' : j.kind === 'left' ? 'LEFT JOIN' : 'RIGHT JOIN';
        text += ` ${kw} ${quoteTable(d, j.target)} ON ${quoteColumn(d, j.leftCol)} = ${quoteColumn(d, j.rightCol)}`;
      }
      if (s.wheres.length > 0) {
        const parts = s.wheres.map(w => {
          params.push(w.value);
          return `${quoteColumn(d, w.col)} ${w.op} ${PLACEHOLDER[d](params.length)}`;
        });
        text += ` WHERE ${parts.join(' AND ')}`;
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

export function selectWithJoins(table: string, dialect: Dialect = 'postgres'): JoinBuilder {
  return make(dialect, { table, joins: [], wheres: [], orderBys: [] });
}

export type JoinableSelect = JoinBuilder;
export const joinableSelectFrom = selectWithJoins;
