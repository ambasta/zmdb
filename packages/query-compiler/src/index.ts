// @zmdb/query-compiler — implementation.
export { QueryCompilerError, UnsupportedFeatureError } from './errors.ts';

// #17 SELECT compilation implemented (+ shared dialect quoting/placeholders,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

import { frozenQuery, tailClause, tailMethods, whereClause } from './clauses.ts';
import { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable, renumberPlaceholders } from './quoting.ts';

export type Dialect = 'postgres' | 'mysql' | 'sqlite';
export { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable, renumberPlaceholders };
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
  | 'nin'
  | 'exists'
  | 'not exists'
  | (string & {});

export { OP_MAP } from './clauses.ts';

export type Direction = 'asc' | 'desc';

/**
 * Heuristic element-count chunk thresholds per SQL dialect for IN-list expansion.
 * These conservative limits (30,000 for SQLite, 60,000 for Postgres/MySQL) serve as
 * list-length heuristics, leaving headroom below maximum driver parameter limits
 * (32,766 for SQLite, 65,535 for Postgres/MySQL) for any additional query parameters.
 */
export const DIALECT_PARAM_LIMITS: Record<Dialect, number> = {
  sqlite: 30000,
  postgres: 60000,
  mysql: 60000,
};

/**
 * Collection utility that deduplicates keys while preserving insertion order AND
 * filtering out `null` and `undefined` key values.
 *
 * Note: Dropping null/undefined key values is a semantic choice designed for batch key loading
 * (parent rows with a null foreign key are silently omitted from relationship loading).
 */
export function sanitizeKeys<T>(keys: readonly T[]): T[] {
  const result: T[] = [];
  const seen = new Set<T>();
  for (const k of keys) {
    if (k !== null && k !== undefined && !seen.has(k)) {
      seen.add(k);
      result.push(k);
    }
  }
  return result;
}

/**
 * Collection utility that partitions an array into contiguous chunks of at most `chunkSize` elements.
 * Used to split large batch parameter lists into parameter-safe sub-queries.
 */
export function chunkArray<T>(array: readonly T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) throw new Error('chunkSize must be greater than 0');
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

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
  whereIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
  andWhereIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
  orWhereIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
  whereNotIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
  andWhereNotIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
  orWhereNotIn(col: string, values: readonly unknown[]): SelectBuilder<T>;
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

function makeSelect<T = unknown>(d: Dialect, state: SelectState): SelectBuilder<T> {
  const next = (patch: Partial<SelectState>): SelectBuilder<T> => makeSelect(d, { ...state, ...patch });
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator | string, value: unknown) =>
    next({ wheres: [...state.wheres, { col, op, value, connector }] });

  return {
    ...tailMethods(state, next),
    dialect: d,
    select: columns => (columns === undefined ? next({}) : next({ columns })),
    where: (col, op, value) => addWhere('AND', col, op, value),
    andWhere: (col, op, value) => addWhere('AND', col, op, value),
    orWhere: (col, op, value) => addWhere('OR', col, op, value),
    whereIn: (col, values) => addWhere('AND', col, 'in', values),
    andWhereIn: (col, values) => addWhere('AND', col, 'in', values),
    orWhereIn: (col, values) => addWhere('OR', col, 'in', values),
    whereNotIn: (col, values) => addWhere('AND', col, 'not in', values),
    andWhereNotIn: (col, values) => addWhere('AND', col, 'not in', values),
    orWhereNotIn: (col, values) => addWhere('OR', col, 'not in', values),
    whereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    andWhereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    orWhereExists: subquery => addWhere('OR', '', 'EXISTS', subquery),
    whereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    andWhereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    orWhereNotExists: subquery => addWhere('OR', '', 'NOT EXISTS', subquery),
    compile: () => {
      const params: unknown[] = [];
      const cols =
        state.columns && state.columns.length > 0 ? state.columns.map(c => quoteColumn(d, c)).join(', ') : '*';
      const text =
        `SELECT ${cols} FROM ${quoteTable(d, state.table)}` +
        whereClause(d, state.wheres, params) +
        tailClause(d, state);
      return frozenQuery(text, params);
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
  where(col: string, op: Operator | string, value: unknown): UpdateBuilder;
  orWhere(col: string, op: Operator | string, value: unknown): UpdateBuilder;
  whereIn(col: string, values: readonly unknown[]): UpdateBuilder;
  whereNotIn(col: string, values: readonly unknown[]): UpdateBuilder;
  returning(cols?: readonly string[]): UpdateBuilder;
  compile(): CompiledQuery;
}
export interface DeleteBuilder {
  where(col: string, op: Operator | string, value: unknown): DeleteBuilder;
  orWhere(col: string, op: Operator | string, value: unknown): DeleteBuilder;
  whereIn(col: string, values: readonly unknown[]): DeleteBuilder;
  whereNotIn(col: string, values: readonly unknown[]): DeleteBuilder;
  returning(cols?: readonly string[]): DeleteBuilder;
  compile(): CompiledQuery;
}

export interface QueryCompiler {
  selectFrom(table: string): SelectBuilder;
  insertInto(table: string): InsertBuilder;
  updateTable(table: string): UpdateBuilder;
  deleteFrom(table: string): DeleteBuilder;
}

function returningClause(d: Dialect, cols?: readonly string[]): string {
  if (!cols || cols.length === 0) return '';
  return ` RETURNING ${cols.map(c => (c === '*' ? '*' : quoteColumn(d, c))).join(', ')}`;
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

/** ` (a, b)` for an explicit conflict target; '' when the server infers it. */
function conflictTarget(d: Dialect, target?: readonly string[]): string {
  if (!target || target.length === 0) return '';
  return ` (${target.map(t => quoteIdentifier(d, t)).join(', ')})`;
}

/**
 * `col = <the value this INSERT tried to write>` for each column. MySQL spells
 * that VALUES(col) where postgres and sqlite say EXCLUDED.col. VALUES() is
 * deprecated in MySQL 8.0.20+ in favour of a row alias (`AS new`), but keeping
 * it means servers older than that still work.
 */
function upsertSetSql(d: Dialect, cols: readonly string[]): string {
  const value = (c: string) =>
    d === 'mysql' ? `VALUES(${quoteIdentifier(d, c)})` : `EXCLUDED.${quoteIdentifier(d, c)}`;
  return cols.map(c => `${quoteIdentifier(d, c)} = ${value(c)}`).join(', ');
}

function makeInsert(
  d: Dialect,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly string[],
  conflict?: ConflictState,
): InsertBuilder {
  const setConflict = (c: ConflictState) => makeInsert(d, table, row, ret, c);
  return {
    values: r => makeInsert(d, table, r, ret, conflict),
    returning: cols => makeInsert(d, table, row, cols ?? [], conflict),
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
      const cols = keys.map(k => quoteIdentifier(d, k)).join(', ');
      const placeholders = keys.map((_, i) => formatPlaceholder(d, i + 1)).join(', ');
      const insert = `INSERT INTO ${quoteTable(d, table)} (${cols}) VALUES (${placeholders})`;
      let text: string;

      if (!conflict) {
        text = insert;
      } else if (conflict.action === 'ignore') {
        text =
          d === 'mysql'
            ? `INSERT IGNORE INTO ${quoteTable(d, table)} (${cols}) VALUES (${placeholders})`
            : `${insert} ON CONFLICT${conflictTarget(d, conflict.target)} DO NOTHING`;
      } else {
        let setSql: string;

        if (Array.isArray(conflict.updateFields)) {
          setSql = upsertSetSql(d, conflict.updateFields);
        } else if (conflict.updateFields) {
          setSql = Object.entries(conflict.updateFields)
            .map(([k, val]) => {
              params.push(val);
              return `${quoteIdentifier(d, k)} = ${formatPlaceholder(d, params.length)}`;
            })
            .join(', ');
        } else {
          const targetSet = new Set(conflict.target ?? []);
          const nonTarget = keys.filter(k => !targetSet.has(k));
          // If every inserted column is a conflict target, nonTarget is empty and
          // the SET list would be empty SQL. Setting them all back to what the
          // INSERT carried is a valid no-op.
          setSql = upsertSetSql(d, nonTarget.length > 0 ? nonTarget : keys);
        }

        text =
          d === 'mysql'
            ? `${insert} ON DUPLICATE KEY UPDATE ${setSql}`
            : `${insert} ON CONFLICT${conflictTarget(d, conflict.target)} DO UPDATE SET ${setSql}`;
      }

      text += returningClause(d, ret);
      return frozenQuery(text, params);
    },
  };
}

function makeUpdate(
  d: Dialect,
  table: string,
  row?: Record<string, unknown>,
  wheres: readonly WhereClause[] = [],
  ret?: readonly string[],
): UpdateBuilder {
  return {
    set: r => makeUpdate(d, table, r, wheres, ret),
    where: (col, op, value) => makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret),
    orWhere: (col, op, value) => makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'OR' }], ret),
    whereIn: (col, values) =>
      makeUpdate(d, table, row, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret),
    whereNotIn: (col, values) =>
      makeUpdate(d, table, row, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret),
    returning: cols => makeUpdate(d, table, row, wheres, cols ?? []),
    compile: () => {
      if (!row) throw new Error('updateTable requires set()');
      const params: unknown[] = [];
      const sets = Object.keys(row)
        .map(k => {
          params.push(row[k]);
          return `${quoteIdentifier(d, k)} = ${formatPlaceholder(d, params.length)}`;
        })
        .join(', ');
      const text =
        `UPDATE ${quoteTable(d, table)} SET ${sets}` + whereClause(d, wheres, params) + returningClause(d, ret);
      return frozenQuery(text, params);
    },
  };
}

function makeDelete(
  d: Dialect,
  table: string,
  wheres: readonly WhereClause[] = [],
  ret?: readonly string[],
): DeleteBuilder {
  return {
    where: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret),
    orWhere: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'OR' }], ret),
    whereIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret),
    whereNotIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret),
    returning: cols => makeDelete(d, table, wheres, cols ?? []),
    compile: () => {
      const params: unknown[] = [];
      const text = `DELETE FROM ${quoteTable(d, table)}` + whereClause(d, wheres, params) + returningClause(d, ret);
      return frozenQuery(text, params);
    },
  };
}

export function createQueryCompiler(dialect: Dialect = 'postgres'): QueryCompiler {
  return {
    selectFrom: table => makeSelect(dialect, { table, wheres: [], orderBys: [] }),
    insertInto: table => makeInsert(dialect, table),
    updateTable: table => makeUpdate(dialect, table),
    deleteFrom: table => makeDelete(dialect, table),
  };
}
