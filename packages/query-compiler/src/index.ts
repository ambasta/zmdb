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

export function createQueryCompiler(dialect: Dialect = 'postgres'): QueryCompiler {
  const d = DIALECTS[dialect];
  return {
    selectFrom: (table) =>
      makeSelect(d, { table, wheres: [], orderBys: [] }),
    // #18 — not yet implemented; write-builder tests remain red.
    insertInto: () => {
      throw new Error(NOT_IMPL);
    },
    updateTable: () => {
      throw new Error(NOT_IMPL);
    },
    deleteFrom: () => {
      throw new Error(NOT_IMPL);
    },
  };
}
