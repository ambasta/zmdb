// Query-builder JOINs — implementation (#85). inner/left/right join + on() with
// qualified columns + table aliasing, dialect-aware, parameterized. Pure string
// compilation (no runtime type resolution).
import type { CompiledQuery, Dialect } from '../index.ts';

export type JoinKind = 'inner' | 'left' | 'right';

const QUOTE: Record<Dialect, string> = { postgres: '"', mysql: '`', sqlite: '"' };
const PLACEHOLDER: Record<Dialect, (n: number) => string> = {
  postgres: n => `$${n}`,
  mysql: () => '?',
  sqlite: () => '?',
};

// Quote a table spec that may be `table` or `table as alias`.
function quoteTable(d: Dialect, spec: string): string {
  const q = QUOTE[d];
  const m = /^(\S+)\s+as\s+(\S+)$/i.exec(spec.trim());
  if (m) return `${q}${m[1]}${q} AS ${q}${m[2]}${q}`;
  return `${q}${spec.trim()}${q}`;
}
// Quote a possibly-qualified column `x.y` → "x"."y", or `y` → "y".
function quoteCol(d: Dialect, col: string): string {
  const q = QUOTE[d];
  return col
    .split('.')
    .map(p => `${q}${p}${q}`)
    .join('.');
}

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
        text += ` ${kw} ${quoteTable(d, j.target)} ON ${quoteCol(d, j.leftCol)} = ${quoteCol(d, j.rightCol)}`;
      }
      if (s.wheres.length > 0) {
        const parts = s.wheres.map(w => {
          params.push(w.value);
          return `${quoteCol(d, w.col)} ${w.op} ${PLACEHOLDER[d](params.length)}`;
        });
        text += ` WHERE ${parts.join(' AND ')}`;
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

export function joinableSelectFrom(table: string, dialect: Dialect = 'postgres'): JoinableSelect {
  return make(dialect, { table, joins: [], wheres: [], orderBys: [] });
}
