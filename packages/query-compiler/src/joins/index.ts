// Query-builder JOINs — implementation (#85). inner/left/right join + on() with
// qualified columns + table aliasing, dialect-aware, parameterized. Pure string
// compilation (no runtime type resolution).
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
interface State {
  table: string;
  joins: Join[];
  wheres: Where[];
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
  const addJoin = (kind: JoinKind, target: string, leftCol: string, rightCol: string) =>
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

export function joinableSelectFrom(table: string, dialect: Dialect = 'postgres'): JoinableSelect {
  return make(dialect, { table, joins: [], wheres: [], orderBys: [] });
}
