// Minimal SQL query builder skeleton. Currently produces Postgres SELECT $1 (or
// $1, $2, etc. for parameterized wheres — enough to unblock tests in #18 & #19,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

import { quoteColumn, quoteIdentifier, quoteTable } from './quoting.ts';

export { quoteColumn, quoteIdentifier, quoteTable };

export type Dialect = 'postgres' | 'mysql' | 'sqlite';
export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'in';
export type Direction = 'asc' | 'desc';

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

interface DialectStrategy {
  quoteTable(spec: string): string;
  quoteCol(col: string): string;
  quoteIdent(ident: string): string;
  placeholder(index: number): string;
}

const DIALECTS: Record<Dialect, DialectStrategy> = {
  postgres: {
    quoteTable: s => quoteTable('postgres', s),
    quoteCol: c => quoteColumn('postgres', c),
    quoteIdent: i => quoteIdentifier('postgres', i),
    placeholder: n => `$${n}`,
  },
  mysql: {
    quoteTable: s => quoteTable('mysql', s),
    quoteCol: c => quoteColumn('mysql', c),
    quoteIdent: i => quoteIdentifier('mysql', i),
    placeholder: () => '?',
  },
  sqlite: {
    quoteTable: s => quoteTable('sqlite', s),
    quoteCol: c => quoteColumn('sqlite', c),
    quoteIdent: i => quoteIdentifier('sqlite', i),
    placeholder: () => '?',
  },
};

interface WhereClause {
  col: string;
  op: Operator;
  value: unknown;
  connector: 'AND' | 'OR';
}

interface OrderByClause {
  col: string;
  dir: Direction;
}

interface SelectState {
  table: string;
  columns?: readonly string[];
  wheres: WhereClause[];
  orderBys: OrderByClause[];
  limitN?: number;
  offsetN?: number;
}

export interface SelectQueryBuilder {
  select(...cols: (string | readonly string[])[]): SelectQueryBuilder;
  where(col: string, op: Operator, value: unknown): SelectQueryBuilder;
  andWhere(col: string, op: Operator, value: unknown): SelectQueryBuilder;
  orWhere(col: string, op: Operator, value: unknown): SelectQueryBuilder;
  orderBy(col: string, dir?: Direction): SelectQueryBuilder;
  limit(n: number): SelectQueryBuilder;
  offset(n: number): SelectQueryBuilder;
  compile(): CompiledQuery;
}

function makeSelect(d: DialectStrategy, state: SelectState): SelectQueryBuilder {
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator, value: unknown) =>
    makeSelect(d, { ...state, wheres: [...state.wheres, { col, op, value, connector }] });

  const next = (patch: Partial<SelectState>): SelectQueryBuilder => makeSelect(d, { ...state, ...patch });

  return {
    select: (...cols) => next({ columns: cols.flat() as string[] }),
    where: (col, op, value) => addWhere('AND', col, op, value),
    andWhere: (col, op, value) => addWhere('AND', col, op, value),
    orWhere: (col, op, value) => addWhere('OR', col, op, value),
    orderBy: (col, dir = 'asc') => next({ orderBys: [...state.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const cols = state.columns && state.columns.length > 0 ? state.columns.map(c => d.quoteCol(c)).join(', ') : '*';
      let text = `SELECT ${cols} FROM ${d.quoteTable(state.table)}`;

      if (state.wheres.length > 0) {
        const parts = state.wheres.map((w, i) => {
          params.push(w.value);
          const prefix = i === 0 ? '' : `${w.connector} `;
          return `${prefix}${d.quoteCol(w.col)} ${w.op} ${d.placeholder(params.length)}`;
        });
        text += ` WHERE ${parts.join(' ')}`;
      }

      if (state.orderBys.length > 0) {
        const ob = state.orderBys.map(o => `${d.quoteCol(o.col)} ${o.dir.toUpperCase()}`).join(', ');
        text += ` ORDER BY ${ob}`;
      }
      if (state.limitN !== undefined) text += ` LIMIT ${state.limitN}`;
      if (state.offsetN !== undefined) text += ` OFFSET ${state.offsetN}`;

      return Object.freeze({
        text,
        parameters: Object.freeze(params),
      });
    },
  };
}

export interface InsertBuilder {
  values(row: Record<string, unknown>): InsertBuilder;
  returning(cols?: readonly string[]): InsertBuilder;
  compile(): CompiledQuery;
}

export interface UpdateBuilder {
  set(row: Record<string, unknown>): UpdateBuilder;
  where(col: string, op: Operator, value: unknown): UpdateBuilder;
  returning(cols?: readonly string[]): UpdateBuilder;
  compile(): CompiledQuery;
}

export interface DeleteBuilder {
  where(col: string, op: Operator, value: unknown): DeleteBuilder;
  returning(cols?: readonly string[]): DeleteBuilder;
  compile(): CompiledQuery;
}

export interface QueryCompiler {
  selectFrom(table: string): SelectQueryBuilder;
  insertInto(table: string): InsertBuilder;
  updateTable(table: string): UpdateBuilder;
  deleteFrom(table: string): DeleteBuilder;
}

function returningClause(d: DialectStrategy, cols?: readonly string[]): string {
  if (!cols || cols.length === 0) return '';
  return ` RETURNING ${cols.map(c => (c === '*' ? '*' : d.quoteCol(c))).join(', ')}`;
}

function makeInsert(
  d: DialectStrategy,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly string[],
): InsertBuilder {
  return {
    values: r => makeInsert(d, table, r, ret),
    returning: cols => makeInsert(d, table, row, cols ?? []),
    compile: () => {
      if (!row) throw new Error('insertInto requires values()');
      const keys = Object.keys(row);
      const params = keys.map(k => row[k]);
      const cols = keys.map(k => d.quoteIdent(k)).join(', ');
      const placeholders = keys.map((_, i) => d.placeholder(i + 1)).join(', ');
      const text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders})${returningClause(d, ret)}`;
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

function makeUpdate(
  d: DialectStrategy,
  table: string,
  row?: Record<string, unknown>,
  wheres: WhereClause[] = [],
  ret?: readonly string[],
): UpdateBuilder {
  return {
    set: r => makeUpdate(d, table, r, wheres, ret),
    where: (col, op, value) => makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret),
    returning: cols => makeUpdate(d, table, row, wheres, cols ?? []),
    compile: () => {
      if (!row) throw new Error('updateTable requires set()');
      const params: unknown[] = [];
      const sets = Object.keys(row)
        .map(k => {
          params.push(row[k]);
          return `${d.quoteIdent(k)} = ${d.placeholder(params.length)}`;
        })
        .join(', ');
      let text = `UPDATE ${d.quoteTable(table)} SET ${sets}`;
      if (wheres.length > 0) {
        const parts = wheres.map((w, i) => {
          params.push(w.value);
          const prefix = i === 0 ? '' : `${w.connector} `;
          return `${prefix}${d.quoteCol(w.col)} ${w.op} ${d.placeholder(params.length)}`;
        });
        text += ` WHERE ${parts.join(' ')}`;
      }
      text += returningClause(d, ret);
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

function makeDelete(
  d: DialectStrategy,
  table: string,
  wheres: WhereClause[] = [],
  ret?: readonly string[],
): DeleteBuilder {
  return {
    where: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret),
    returning: cols => makeDelete(d, table, wheres, cols ?? []),
    compile: () => {
      const params: unknown[] = [];
      let text = `DELETE FROM ${d.quoteTable(table)}`;
      if (wheres.length > 0) {
        const parts = wheres.map((w, i) => {
          params.push(w.value);
          const prefix = i === 0 ? '' : `${w.connector} `;
          return `${prefix}${d.quoteCol(w.col)} ${w.op} ${d.placeholder(params.length)}`;
        });
        text += ` WHERE ${parts.join(' ')}`;
      }
      text += returningClause(d, ret);
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

export function createQueryCompiler(dialect: Dialect = 'postgres'): QueryCompiler {
  const d = DIALECTS[dialect];
  return {
    selectFrom: table => makeSelect(d, { table, wheres: [], orderBys: [] }),
    insertInto: table => makeInsert(d, table),
    updateTable: table => makeUpdate(d, table),
    deleteFrom: table => makeDelete(d, table),
  };
}
