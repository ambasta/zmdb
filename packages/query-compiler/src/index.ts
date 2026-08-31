// @zmdb/query-compiler — implementation.
export { UnsupportedFeatureError } from './errors.ts';

// #17 SELECT compilation implemented (+ shared dialect quoting/placeholders,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

import { quoteColumn, quoteIdentifier, quoteTable } from './quoting.ts';

export { quoteColumn, quoteIdentifier, quoteTable };

export type Dialect = 'postgres' | 'mysql' | 'sqlite';
export type Operator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'like'
  | 'ilike'
  | 'in'
  | 'not in'
  | 'EXISTS'
  | 'NOT EXISTS'
  | 'exists'
  | 'not exists'
  | (string & {});
export type Direction = 'asc' | 'desc';

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

interface DialectStrategy {
  quoteTable(spec: string): string;
  quoteCol(col: string): string;
  quoteIdent(ident: string): string;
  placeholder(index: number): string; // 1-based
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

export interface SelectBuilder<T = unknown> {
  select(columns?: readonly string[]): SelectBuilder<T>;
  where(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  andWhere(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  orWhere(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  whereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  andWhereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  orWhereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  whereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  andWhereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  orWhereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<T>;
  orderBy(col: string, dir: Direction): SelectBuilder<T>;
  limit(n: number): SelectBuilder<T>;
  offset(n: number): SelectBuilder<T>;
  compile(): CompiledQuery;
  readonly dialect: Dialect;
  readonly _type?: T;
}

function opSql(op: Operator): string {
  return op === 'like' ? 'LIKE' : op === 'in' ? 'IN' : op.toUpperCase() === op ? op : op;
}

function isSubqueryTarget(val: unknown): val is { compile(): CompiledQuery } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'compile' in val &&
    typeof (val as { compile?: unknown }).compile === 'function'
  );
}

function compileWhereCondition(w: WhereClause, d: DialectStrategy, params: unknown[], i: number): string {
  const opUpper = String(w.op).toUpperCase();
  if (isSubqueryTarget(w.value)) {
    const subCompiled = w.value.compile();
    let subText = subCompiled.text;
    const offset = params.length;
    if (offset > 0 && /\$\d+/.test(subText)) {
      subText = subText.replace(/\$(\d+)\b/g, (_, num) => `$${parseInt(num, 10) + offset}`);
    }
    params.push(...subCompiled.parameters);

    let cond: string;
    if (opUpper === 'EXISTS') {
      cond = `EXISTS (${subText})`;
    } else if (opUpper === 'NOT EXISTS') {
      cond = `NOT EXISTS (${subText})`;
    } else {
      cond = `${d.quoteCol(w.col)} ${opSql(w.op)} (${subText})`;
    }
    return i === 0 ? cond : `${w.connector} ${cond}`;
  } else {
    params.push(w.value);
    const cond = `${d.quoteCol(w.col)} ${opSql(w.op)} ${d.placeholder(params.length)}`;
    return i === 0 ? cond : `${w.connector} ${cond}`;
  }
}

function makeSelect<T = unknown>(
  d: DialectStrategy,
  state: SelectState,
  dialect: Dialect = 'postgres',
): SelectBuilder<T> {
  const next = (patch: Partial<SelectState>): SelectBuilder<T> => makeSelect(d, { ...state, ...patch }, dialect);
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator, value: unknown) =>
    next({ wheres: [...state.wheres, { col, op, value, connector }] });

  return {
    dialect,
    select: columns => (columns === undefined ? next({}) : next({ columns })),
    where: (col, op, value) => addWhere('AND', col, op, value),
    andWhere: (col, op, value) => addWhere('AND', col, op, value),
    orWhere: (col, op, value) => addWhere('OR', col, op, value),
    whereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    andWhereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    orWhereExists: subquery => addWhere('OR', '', 'EXISTS', subquery),
    whereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    andWhereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    orWhereNotExists: subquery => addWhere('OR', '', 'NOT EXISTS', subquery),
    orderBy: (col, dir) => next({ orderBys: [...state.orderBys, { col, dir }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      const cols = state.columns && state.columns.length > 0 ? state.columns.map(c => d.quoteCol(c)).join(', ') : '*';
      let text = `SELECT ${cols} FROM ${d.quoteTable(state.table)}`;

      if (state.wheres.length > 0) {
        const parts = state.wheres.map((w, i) => compileWhereCondition(w, d, params, i));
        text += ` WHERE ${parts.join(' ')}`;
      }

      if (state.orderBys.length > 0) {
        const ob = state.orderBys.map(o => `${d.quoteCol(o.col)} ${o.dir.toUpperCase()}`).join(', ');
        text += ` ORDER BY ${ob}`;
      }
      if (state.limitN !== undefined) text += ` LIMIT ${state.limitN}`;
      if (state.offsetN !== undefined) text += ` OFFSET ${state.offsetN}`;

      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

export interface OnConflictBuilder {
  doUpdate(updateFields?: readonly string[] | Record<string, unknown>): InsertBuilder;
  doNothing(): InsertBuilder;
}

export interface InsertBuilder {
  values(row: Record<string, unknown>): InsertBuilder;
  onConflict(target?: string | readonly string[]): OnConflictBuilder;
  returning(cols?: readonly string[]): InsertBuilder;
  compile(): CompiledQuery;
}
export interface UpdateBuilder {
  set(row: Record<string, unknown>): UpdateBuilder;
  where(col: string, op: Operator, value: unknown): UpdateBuilder;
  orWhere(col: string, op: Operator, value: unknown): UpdateBuilder;
  returning(cols?: readonly string[]): UpdateBuilder;
  compile(): CompiledQuery;
}
export interface DeleteBuilder {
  where(col: string, op: Operator, value: unknown): DeleteBuilder;
  orWhere(col: string, op: Operator, value: unknown): DeleteBuilder;
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
  return ` RETURNING ${cols.map(c => (c === '*' ? '*' : d.quoteCol(c))).join(', ')}`;
}

interface ConflictState {
  readonly action: 'update' | 'ignore';
  readonly target?: readonly string[] | undefined;
  readonly updateFields?: readonly string[] | Record<string, unknown> | undefined;
}

function normalizeTarget(target?: string | readonly string[]): readonly string[] | undefined {
  if (!target) return undefined;
  if (typeof target === 'string') return [target];
  return target;
}

function makeInsert(
  d: DialectStrategy,
  dialect: Dialect,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly string[],
  conflict?: ConflictState,
): InsertBuilder {
  const setConflict = (c: ConflictState) => makeInsert(d, dialect, table, row, ret, c);
  return {
    values: r => makeInsert(d, dialect, table, r, ret, conflict),
    returning: cols => makeInsert(d, dialect, table, row, cols ?? [], conflict),
    onConflict: target => {
      const normTarget = normalizeTarget(target);
      return {
        doUpdate: updateFields => {
          if (Array.isArray(updateFields) && updateFields.length === 0) {
            throw new Error(
              'Empty updateFields array is not allowed in doUpdate(). Omit updateFields (or pass undefined) to update all non-target columns, or use doNothing().',
            );
          }
          return setConflict({ action: 'update', target: normTarget, updateFields });
        },
        doNothing: () => setConflict({ action: 'ignore', target: normTarget }),
      };
    },
    compile: () => {
      if (!row) throw new Error('insertInto requires values()');
      const keys = Object.keys(row);
      const params = keys.map(k => row[k]);
      const cols = keys.map(k => d.quoteIdent(k)).join(', ');
      const placeholders = keys.map((_, i) => d.placeholder(i + 1)).join(', ');
      let text: string;

      if (!conflict) {
        text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders})`;
      } else if (conflict.action === 'ignore') {
        if (dialect === 'mysql') {
          text = `INSERT IGNORE INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders})`;
        } else {
          if (conflict.target && conflict.target.length > 0) {
            const targetSql = conflict.target.map(t => d.quoteIdent(t)).join(', ');
            text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders}) ON CONFLICT (${targetSql}) DO NOTHING`;
          } else {
            text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
          }
        }
      } else {
        let setSql: string;

        if (conflict.updateFields) {
          if (Array.isArray(conflict.updateFields)) {
            const updateCols = conflict.updateFields;
            if (dialect === 'mysql') {
              // Note: VALUES(col) is used for MySQL < 8.0.20 compatibility. In MySQL 8.0.20+, VALUES() is deprecated in favor of table/row aliases (e.g. AS new).
              setSql = updateCols.map(c => `${d.quoteIdent(c)} = VALUES(${d.quoteIdent(c)})`).join(', ');
            } else {
              setSql = updateCols.map(c => `${d.quoteIdent(c)} = EXCLUDED.${d.quoteIdent(c)}`).join(', ');
            }
          } else {
            const setClauses: string[] = [];
            for (const [k, val] of Object.entries(conflict.updateFields)) {
              params.push(val);
              setClauses.push(`${d.quoteIdent(k)} = ${d.placeholder(params.length)}`);
            }
            setSql = setClauses.join(', ');
          }
        } else {
          const targetSet = new Set(conflict.target ?? []);
          let updateCols = keys.filter(k => !targetSet.has(k));
          if (updateCols.length === 0) {
            // Deliberate fallback: if every inserted column is a conflict target, updateCols would be empty,
            // resulting in invalid SQL (e.g. empty DO UPDATE SET). Updating all keys acts as a valid no-op.
            updateCols = keys;
          }

          if (dialect === 'mysql') {
            // Note: VALUES(col) is used for MySQL < 8.0.20 compatibility. In MySQL 8.0.20+, VALUES() is deprecated in favor of table/row aliases (e.g. AS new).
            setSql = updateCols.map(c => `${d.quoteIdent(c)} = VALUES(${d.quoteIdent(c)})`).join(', ');
          } else {
            setSql = updateCols.map(c => `${d.quoteIdent(c)} = EXCLUDED.${d.quoteIdent(c)}`).join(', ');
          }
        }

        if (dialect === 'mysql') {
          text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${setSql}`;
        } else {
          if (conflict.target && conflict.target.length > 0) {
            const targetSql = conflict.target.map(t => d.quoteIdent(t)).join(', ');
            text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders}) ON CONFLICT (${targetSql}) DO UPDATE SET ${setSql}`;
          } else {
            text = `INSERT INTO ${d.quoteTable(table)} (${cols}) VALUES (${placeholders}) ON CONFLICT DO UPDATE SET ${setSql}`;
          }
        }
      }

      text += returningClause(d, ret);
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
    set: r => makeUpdate(d, table, r, wheres, ret),
    where: (col, op, value) => makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret),
    orWhere: (col, op, value) => makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'OR' }], ret),
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
        const parts = wheres.map((w, i) => compileWhereCondition(w, d, params, i));
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
    where: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret),
    orWhere: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'OR' }], ret),
    returning: cols => makeDelete(d, table, wheres, cols ?? []),
    compile: () => {
      const params: unknown[] = [];
      let text = `DELETE FROM ${d.quoteTable(table)}`;
      if (wheres.length > 0) {
        const parts = wheres.map((w, i) => compileWhereCondition(w, d, params, i));
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
    selectFrom: table => makeSelect(d, { table, wheres: [], orderBys: [] }, dialect),
    insertInto: table => makeInsert(d, dialect, table),
    updateTable: table => makeUpdate(d, table),
    deleteFrom: table => makeDelete(d, table),
  };
}
