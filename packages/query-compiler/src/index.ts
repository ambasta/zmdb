// @zmdb/query-compiler — implementation.
// #17 SELECT compilation implemented (+ shared dialect quoting/placeholders,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

const NOT_IMPL = 'not implemented';

export type Dialect = 'postgres' | 'mysql' | 'sqlite';
export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'in';
export type Direction = 'asc' | 'desc';

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

interface DialectStrategy {
  quote(ident: string): string;
  placeholder(index: number): string; // 1-based
}

const DIALECTS: Record<Dialect, DialectStrategy> = {
  postgres: { quote: (i) => `"${i}"`, placeholder: (n) => `$${n}` },
  mysql: { quote: (i) => `\`${i}\``, placeholder: () => `?` },
  sqlite: { quote: (i) => `"${i}"`, placeholder: () => `?` },
};

interface WhereClause {
  readonly col: string;
  readonly op: Operator;
  readonly value: unknown;
  readonly connector: 'AND' | 'OR';
}

interface SelectState {
  readonly table: string;
  readonly columns?: readonly string[];
  readonly wheres: readonly WhereClause[];
  readonly orderBys: readonly { col: string; dir: Direction }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

export interface SelectBuilder {
  select(columns?: readonly string[]): SelectBuilder;
  where(col: string, op: Operator, value: unknown): SelectBuilder;
  andWhere(col: string, op: Operator, value: unknown): SelectBuilder;
  orWhere(col: string, op: Operator, value: unknown): SelectBuilder;
  orderBy(col: string, dir: Direction): SelectBuilder;
  limit(n: number): SelectBuilder;
  offset(n: number): SelectBuilder;
  compile(): CompiledQuery;
}

function opSql(op: Operator): string {
  return op === 'like' ? 'LIKE' : op === 'in' ? 'IN' : op.toUpperCase() === op ? op : op;
}

function makeSelect(d: DialectStrategy, state: SelectState): SelectBuilder {
  const next = (patch: Partial<SelectState>): SelectBuilder => makeSelect(d, { ...state, ...patch });
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator, value: unknown) =>
    next({ wheres: [...state.wheres, { col, op, value, connector }] });

  return {
    select: (columns) => (columns === undefined ? next({}) : next({ columns })),
    where: (col, op, value) => addWhere('AND', col, op, value),
    andWhere: (col, op, value) => addWhere('AND', col, op, value),
    orWhere: (col, op, value) => addWhere('OR', col, op, value),
    orderBy: (col, dir) => next({ orderBys: [...state.orderBys, { col, dir }] }),
    limit: (n) => next({ limitN: n }),
    offset: (n) => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const cols =
        state.columns && state.columns.length > 0
          ? state.columns.map((c) => d.quote(c)).join(', ')
          : '*';
      let text = `SELECT ${cols} FROM ${d.quote(state.table)}`;

      if (state.wheres.length > 0) {
        const parts = state.wheres.map((w, i) => {
          params.push(w.value);
          const cond = `${d.quote(w.col)} ${opSql(w.op)} ${d.placeholder(params.length)}`;
          return i === 0 ? cond : `${w.connector} ${cond}`;
        });
        text += ` WHERE ${parts.join(' ')}`;
      }

      if (state.orderBys.length > 0) {
        const ob = state.orderBys
          .map((o) => `${d.quote(o.col)} ${o.dir.toUpperCase()}`)
          .join(', ');
        text += ` ORDER BY ${ob}`;
      }
      if (state.limitN !== undefined) text += ` LIMIT ${state.limitN}`;
      if (state.offsetN !== undefined) text += ` OFFSET ${state.offsetN}`;

      return Object.freeze({ text, parameters: Object.freeze(params) });
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
  selectFrom(table: string): SelectBuilder;
  insertInto(table: string): InsertBuilder;
  updateTable(table: string): UpdateBuilder;
  deleteFrom(table: string): DeleteBuilder;
}

function returningClause(d: DialectStrategy, cols?: readonly string[]): string {
  if (!cols || cols.length === 0) return '';
  return ` RETURNING ${cols.map((c) => (c === '*' ? '*' : d.quote(c))).join(', ')}`;
}

function makeInsert(
  d: DialectStrategy,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly string[],
): InsertBuilder {
  return {
    values: (r) => makeInsert(d, table, r, ret),
    returning: (cols) => makeInsert(d, table, row, cols ?? []),
    compile: () => {
      if (!row) throw new Error('insertInto requires values()');
      const keys = Object.keys(row);
      const params = keys.map((k) => row[k]);
      const cols = keys.map((k) => d.quote(k)).join(', ');
      const placeholders = keys.map((_, i) => d.placeholder(i + 1)).join(', ');
      const text = `INSERT INTO ${d.quote(table)} (${cols}) VALUES (${placeholders})${returningClause(d, ret)}`;
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

function makeUpdate(
  d: DialectStrategy,
  table: string,
  row?: Record<string, unknown>,
  wheres: readonly WhereClause[] = [],
  ret?: readonly string[],
): UpdateBuilder {
  return {
    set: (r) => makeUpdate(d, table, r, wheres, ret),
    where: (col, op, value) =>
      makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret),
    returning: (cols) => makeUpdate(d, table, row, wheres, cols ?? []),
    compile: () => {
      if (!row) throw new Error('updateTable requires set()');
      const params: unknown[] = [];
      const sets = Object.keys(row)
        .map((k) => {
          params.push(row[k]);
          return `${d.quote(k)} = ${d.placeholder(params.length)}`;
        })
        .join(', ');
      let text = `UPDATE ${d.quote(table)} SET ${sets}`;
      if (wheres.length > 0) {
        const parts = wheres.map((w, i) => {
          params.push(w.value);
          const cond = `${d.quote(w.col)} ${opSql(w.op)} ${d.placeholder(params.length)}`;
          return i === 0 ? cond : `${w.connector} ${cond}`;
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
  wheres: readonly WhereClause[] = [],
  ret?: readonly string[],
): DeleteBuilder {
  return {
    where: (col, op, value) =>
      makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret),
    returning: (cols) => makeDelete(d, table, wheres, cols ?? []),
    compile: () => {
      const params: unknown[] = [];
      let text = `DELETE FROM ${d.quote(table)}`;
      if (wheres.length > 0) {
        const parts = wheres.map((w, i) => {
          params.push(w.value);
          const cond = `${d.quote(w.col)} ${opSql(w.op)} ${d.placeholder(params.length)}`;
          return i === 0 ? cond : `${w.connector} ${cond}`;
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
    selectFrom: (table) => makeSelect(d, { table, wheres: [], orderBys: [] }),
    insertInto: (table) => makeInsert(d, table),
    updateTable: (table) => makeUpdate(d, table),
    deleteFrom: (table) => makeDelete(d, table),
  };
}
