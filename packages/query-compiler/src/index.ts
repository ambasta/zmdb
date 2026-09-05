// @zmdb/query-compiler — implementation.
import { TRAITS, type Dialect } from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';

export { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
export { DIALECTS, TRAITS } from './dialects/index.js';
export type {
  Dialect,
  DialectFeature,
  DialectSqlType,
  DialectTraits,
  DialectTypeMap,
  PaginationTail,
  PlaceholderStyle,
  ResolvedTraits,
} from './dialects/index.js';

// #17 SELECT compilation implemented (+ shared dialect quoting/placeholders,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

import {
  frozenQuery,
  queryTelemetry,
  tailClause,
  tailMethods,
  whereClause,
  type ComparisonPredicate,
  type Predicate,
} from './clauses.js';
import { emitColumnExpr, isColumnExpr } from './expressions/index.js';
import {
  isAliasedDistanceExpression,
  isDistanceExpression,
  isSpatialPredicate,
  renderAliasedDistanceExpression,
  renderDistanceExpression,
  type AliasedDistanceExpression,
  type DistanceExpression,
  type SpatialPredicate,
} from './extensions/index.js';
import { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable, renumberPlaceholders } from './quoting.js';

export { EXPR, coalesce, concat, dec, inc, mul, not, proposed } from './expressions/index.js';
export type { ColumnExpr, SetValue } from './expressions/index.js';
export { DISTANCE_OPERATORS, distance, stContains, stDWithin } from './extensions/index.js';
export type {
  AliasedDistanceExpression,
  DistanceExpression,
  DistanceOp,
  ExtensionColumnOf,
  GeoJsonGeometry,
  GeometryColumnOf,
  GeometryValueOf,
  SpatialPredicate,
  VectorColumnOf,
} from './extensions/index.js';
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

export { OP_MAP } from './clauses.js';

export type Direction = 'asc' | 'desc';

/**
 * Heuristic element-count chunk thresholds per SQL dialect for IN-list expansion.
 * These conservative limits (2,000 for SQL Server, 30,000 for SQLite, and 60,000
 * for Postgres/MySQL) serve as
 * list-length heuristics, leaving headroom below maximum driver parameter limits
 * (32,766 for SQLite, 65,535 for Postgres/MySQL) for any additional query parameters.
 */
export const DIALECT_PARAM_LIMITS: Readonly<Record<Dialect, number>> = Object.freeze({
  postgres: TRAITS.postgres.paramLimit,
  mysql: TRAITS.mysql.paramLimit,
  sqlite: TRAITS.sqlite.paramLimit,
  mssql: TRAITS.mssql.paramLimit,
});

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
  readonly telemetry?: QueryTelemetry;
}

/** Compile-time database attributes consumed by tracing and metrics. */
export interface QueryTelemetry {
  readonly system: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}

export { appendComment, serializeComment, withComments } from './comments/index.js';
export type { CommentKey, CommentKeys, CommentPairs } from './comments/index.js';

/** Optional compiler features that would otherwise change every query shape. */
export interface QueryCompilerOptions {
  readonly telemetry?: true;
}

interface SelectState {
  readonly table: string;
  readonly columns?: readonly (string | AliasedDistanceExpression)[];
  readonly wheres: readonly Predicate[];
  readonly orderBys: readonly { col: string | DistanceExpression; dir: Direction }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

export interface SelectBuilder<T = unknown> {
  select(columns?: readonly (string | AliasedDistanceExpression)[]): SelectBuilder<T>;
  where(predicate: SpatialPredicate): SelectBuilder<T>;
  where(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  andWhere(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
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
  orderBy(col: string | DistanceExpression, dir: Direction): SelectBuilder<T>;
  limit(n: number): SelectBuilder<T>;
  offset(n: number): SelectBuilder<T>;
  compile(): CompiledQuery;
  readonly dialect: Dialect;
  readonly _type?: T;
}

function makeSelect<T = unknown>(d: Dialect, state: SelectState, telemetry: boolean): SelectBuilder<T> {
  const next = (patch: Partial<SelectState>): SelectBuilder<T> => makeSelect(d, { ...state, ...patch }, telemetry);
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator, value: unknown) =>
    next({ wheres: [...state.wheres, { col, op, value, connector }] });
  const addSpatial = (connector: 'AND' | 'OR', predicate: SpatialPredicate) =>
    next({ wheres: [...state.wheres, { ...predicate, connector }] });

  function where(predicate: SpatialPredicate): SelectBuilder<T>;
  function where(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  function where(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('where(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function andWhere(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  function andWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('andWhere(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function orWhere(col: string, op: Operator, value: unknown): SelectBuilder<T>;
  function orWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('OR', first);
    if (op === undefined) throw new TypeError('orWhere(column, operator, value) requires an operator');
    return addWhere('OR', first, op, value);
  }

  return {
    ...tailMethods(state, next),
    dialect: d,
    select: columns => (columns === undefined ? next({}) : next({ columns })),
    where,
    andWhere,
    orWhere,
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
        state.columns && state.columns.length > 0
          ? state.columns
              .map(column =>
                isAliasedDistanceExpression(column)
                  ? renderAliasedDistanceExpression(d, column, params)
                  : quoteColumn(d, column),
              )
              .join(', ')
          : '*';
      const predicates = whereClause(d, state.wheres, params);
      const orderBy =
        state.orderBys.length === 0
          ? ''
          : ` ORDER BY ${state.orderBys
              .map(order => {
                const expression = isDistanceExpression(order.col)
                  ? renderDistanceExpression(d, order.col, params)
                  : quoteColumn(d, order.col);
                return `${expression} ${order.dir.toUpperCase()}`;
              })
              .join(', ')}`;
      const text =
        `SELECT ${cols} FROM ${quoteTable(d, state.table)}` +
        predicates +
        orderBy +
        tailClause(d, {
          limitN: state.limitN,
          offsetN: state.offsetN,
          ordered: state.orderBys.length > 0,
        });
      return frozenQuery(text, params, queryTelemetry(d, 'SELECT', state.table, telemetry));
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
  whereIn(col: string, values: readonly unknown[]): UpdateBuilder;
  whereNotIn(col: string, values: readonly unknown[]): UpdateBuilder;
  returning(cols?: readonly string[]): UpdateBuilder;
  compile(): CompiledQuery;
}
export interface DeleteBuilder {
  where(col: string, op: Operator, value: unknown): DeleteBuilder;
  orWhere(col: string, op: Operator, value: unknown): DeleteBuilder;
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
  callFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
}

function routineCall(
  dialect: Dialect,
  name: string,
  args: readonly unknown[],
  kind: 'function' | 'table-function' | 'procedure',
): CompiledQuery {
  if (dialect === 'sqlite' || dialect === 'mssql') {
    throw new UnsupportedFeatureError(`stored routine "${name}"`, dialect);
  }
  if (kind === 'table-function' && dialect !== 'postgres') {
    throw new UnsupportedFeatureError(`set-returning function "${name}"`, dialect);
  }

  const placeholders = args.map((_, index) => formatPlaceholder(dialect, index + 1)).join(', ');
  const routine = quoteIdentifier(dialect, name);
  const text =
    kind === 'procedure'
      ? `CALL ${routine}(${placeholders})`
      : kind === 'table-function'
        ? `SELECT * FROM ${routine}(${placeholders})`
        : `SELECT ${routine}(${placeholders}) AS ${quoteIdentifier(dialect, 'result')}`;
  return frozenQuery(text, args);
}

function returningClause(d: Dialect, cols?: readonly string[]): string {
  if (!cols || cols.length === 0) return '';
  const returning = TRAITS[d].returning;
  if (returning === 'none') throw new UnsupportedFeatureError('returning', d);
  if (returning === 'output') return '';
  return ` RETURNING ${cols.map(c => (c === '*' ? '*' : quoteColumn(d, c))).join(', ')}`;
}

function outputClause(d: Dialect, pseudoTable: 'INSERTED' | 'DELETED', cols?: readonly string[]): string {
  if (!cols || cols.length === 0) return '';
  const returning = TRAITS[d].returning;
  if (returning === 'none') throw new UnsupportedFeatureError('returning', d);
  if (returning !== 'output') return '';

  // SQL Server rejects OUTPUT without INTO when the target has an enabled trigger
  // for the statement's DML action. The compiler cannot inspect triggers, and
  // OUTPUT INTO would require a table variable plus a second statement.
  return ` OUTPUT ${cols
    .map(column => (column === '*' ? `${pseudoTable}.*` : `${pseudoTable}.${quoteColumn(d, column)}`))
    .join(', ')}`;
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
function upsertSetSql(d: Dialect, cols: readonly string[], upsert: 'onConflict' | 'onDuplicateKey'): string {
  const value = (c: string) =>
    upsert === 'onDuplicateKey' ? `VALUES(${quoteIdentifier(d, c)})` : `EXCLUDED.${quoteIdentifier(d, c)}`;
  return cols.map(c => `${quoteIdentifier(d, c)} = ${value(c)}`).join(', ');
}

function setValueSql(
  d: Dialect,
  table: string,
  column: string,
  value: unknown,
  params: unknown[],
  scope: 'update' | 'upsert',
  references?: {
    readonly current: string;
    readonly proposed: string;
  },
): string {
  if (!isColumnExpr(value)) {
    params.push(value);
    return formatPlaceholder(d, params.length);
  }

  const emitted = emitColumnExpr(value, {
    dialect: d,
    table,
    column,
    parameterIndex: params.length + 1,
    scope,
    ...(references === undefined
      ? {}
      : {
          currentReference: references.current,
          proposedReference: references.proposed,
        }),
  });
  params.push(...emitted.params);
  return emitted.sql;
}

function mssqlMergeSql(
  d: Dialect,
  table: string,
  keys: readonly string[],
  placeholders: string,
  params: unknown[],
  conflict: ConflictState,
  ret?: readonly string[],
): string {
  const target = conflict.target;
  if (!target || target.length === 0) {
    throw new UnsupportedFeatureError(
      'upsert without a conflict target',
      d,
      'MERGE needs an explicit join predicate; pass the conflicting column(s) to onConflict(...).',
    );
  }

  const keySet = new Set(keys);
  for (const column of target) {
    if (!keySet.has(column)) {
      throw new TypeError(`MERGE conflict target ${JSON.stringify(column)} is not present in values()`);
    }
  }

  const quoted = (column: string) => quoteIdentifier(d, column);
  const source = (column: string) => `src.${quoted(column)}`;
  const current = (column: string) => `tgt.${quoted(column)}`;
  const sourceColumns = keys.map(quoted).join(', ');
  const predicate = target.map(column => `${current(column)} = ${source(column)}`).join(' AND ');
  let matched = '';

  if (conflict.action === 'update') {
    let setSql: string;
    if (Array.isArray(conflict.updateFields)) {
      for (const column of conflict.updateFields) {
        if (!keySet.has(column)) {
          throw new TypeError(`MERGE update field ${JSON.stringify(column)} is not present in values()`);
        }
      }
      setSql = conflict.updateFields.map(column => `${quoted(column)} = ${source(column)}`).join(', ');
    } else if (conflict.updateFields) {
      const entries = Object.entries(conflict.updateFields);
      if (entries.length === 0) throw new TypeError('MERGE doUpdate() requires at least one update field');
      setSql = entries
        .map(([column, value]) => {
          if (isColumnExpr(value) && value.op === 'proposed' && !keySet.has(column)) {
            throw new TypeError(`MERGE proposed field ${JSON.stringify(column)} is not present in values()`);
          }
          return (
            `${quoted(column)} = ` +
            setValueSql(d, table, column, value, params, 'upsert', {
              current: current(column),
              proposed: source(column),
            })
          );
        })
        .join(', ');
    } else {
      const targetSet = new Set(target);
      const nonTarget = keys.filter(column => !targetSet.has(column));
      const updateColumns = nonTarget.length > 0 ? nonTarget : keys;
      setSql = updateColumns.map(column => `${quoted(column)} = ${source(column)}`).join(', ');
    }
    matched = ` WHEN MATCHED THEN UPDATE SET ${setSql}`;
  }

  // HOLDLOCK is deliberate: without a serializable range lock, concurrent
  // MERGE statements can both observe an absent key and race into INSERT.
  return (
    `MERGE ${quoteTable(d, table)} WITH (HOLDLOCK) AS tgt ` +
    `USING (VALUES (${placeholders})) AS src (${sourceColumns}) ON ${predicate}` +
    matched +
    ` WHEN NOT MATCHED THEN INSERT (${sourceColumns}) VALUES (${keys.map(source).join(', ')})` +
    `${outputClause(d, 'INSERTED', ret)};`
  );
}

function makeInsert(
  d: Dialect,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly string[],
  conflict?: ConflictState,
  telemetry = false,
): InsertBuilder {
  const setConflict = (c: ConflictState) => makeInsert(d, table, row, ret, c, telemetry);
  return {
    values: r => makeInsert(d, table, r, ret, conflict, telemetry),
    returning: cols => makeInsert(d, table, row, cols ?? [], conflict, telemetry),
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
      const insert =
        `INSERT INTO ${quoteTable(d, table)} (${cols})` +
        `${outputClause(d, 'INSERTED', ret)} VALUES (${placeholders})`;
      let text: string;

      if (!conflict) {
        text = insert;
      } else {
        const upsert = TRAITS[d].upsert;
        if (upsert === 'none') throw new UnsupportedFeatureError('upsert', d);
        if (upsert === 'merge') {
          text = mssqlMergeSql(d, table, keys, placeholders, params, conflict, ret);
        } else if (conflict.action === 'ignore') {
          text =
            upsert === 'onDuplicateKey'
              ? `INSERT IGNORE INTO ${quoteTable(d, table)} (${cols}) VALUES (${placeholders})`
              : `${insert} ON CONFLICT${conflictTarget(d, conflict.target)} DO NOTHING`;
        } else {
          let setSql: string;

          if (Array.isArray(conflict.updateFields)) {
            setSql = upsertSetSql(d, conflict.updateFields, upsert);
          } else if (conflict.updateFields) {
            setSql = Object.entries(conflict.updateFields)
              .map(([k, val]) => `${quoteIdentifier(d, k)} = ${setValueSql(d, table, k, val, params, 'upsert')}`)
              .join(', ');
          } else {
            const targetSet = new Set(conflict.target ?? []);
            const nonTarget = keys.filter(k => !targetSet.has(k));
            // If every inserted column is a conflict target, nonTarget is empty and
            // the SET list would be empty SQL. Setting them all back to what the
            // INSERT carried is a valid no-op.
            setSql = upsertSetSql(d, nonTarget.length > 0 ? nonTarget : keys, upsert);
          }

          text =
            upsert === 'onDuplicateKey'
              ? `${insert} ON DUPLICATE KEY UPDATE ${setSql}`
              : `${insert} ON CONFLICT${conflictTarget(d, conflict.target)} DO UPDATE SET ${setSql}`;
        }
      }

      text += returningClause(d, ret);
      return frozenQuery(text, params, queryTelemetry(d, 'INSERT', table, telemetry));
    },
  };
}

function makeUpdate(
  d: Dialect,
  table: string,
  row?: Record<string, unknown>,
  wheres: readonly ComparisonPredicate[] = [],
  ret?: readonly string[],
  telemetry = false,
): UpdateBuilder {
  return {
    set: r => makeUpdate(d, table, r, wheres, ret, telemetry),
    where: (col, op, value) =>
      makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) =>
      makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereIn: (col, values) =>
      makeUpdate(d, table, row, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret, telemetry),
    whereNotIn: (col, values) =>
      makeUpdate(d, table, row, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret, telemetry),
    returning: cols => makeUpdate(d, table, row, wheres, cols ?? [], telemetry),
    compile: () => {
      if (!row) throw new Error('updateTable requires set()');
      const params: unknown[] = [];
      const sets = Object.keys(row)
        .map(k => `${quoteIdentifier(d, k)} = ${setValueSql(d, table, k, row[k], params, 'update')}`)
        .join(', ');
      const text =
        `UPDATE ${quoteTable(d, table)} SET ${sets}` +
        outputClause(d, 'INSERTED', ret) +
        whereClause(d, wheres, params) +
        returningClause(d, ret);
      return frozenQuery(text, params, queryTelemetry(d, 'UPDATE', table, telemetry));
    },
  };
}

function makeDelete(
  d: Dialect,
  table: string,
  wheres: readonly ComparisonPredicate[] = [],
  ret?: readonly string[],
  telemetry = false,
): DeleteBuilder {
  return {
    where: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret, telemetry),
    whereNotIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret, telemetry),
    returning: cols => makeDelete(d, table, wheres, cols ?? [], telemetry),
    compile: () => {
      const params: unknown[] = [];
      const text =
        `DELETE FROM ${quoteTable(d, table)}` +
        outputClause(d, 'DELETED', ret) +
        whereClause(d, wheres, params) +
        returningClause(d, ret);
      return frozenQuery(text, params, queryTelemetry(d, 'DELETE', table, telemetry));
    },
  };
}

export function createQueryCompiler(dialect: Dialect = 'postgres', options?: QueryCompilerOptions): QueryCompiler {
  const telemetry = options?.telemetry === true;
  return {
    selectFrom: table => makeSelect(dialect, { table, wheres: [], orderBys: [] }, telemetry),
    insertInto: table => makeInsert(dialect, table, undefined, undefined, undefined, telemetry),
    updateTable: table => makeUpdate(dialect, table, undefined, [], undefined, telemetry),
    deleteFrom: table => makeDelete(dialect, table, [], undefined, telemetry),
    callFunction: (name, args) => routineCall(dialect, name, args, 'function'),
    callTableFunction: (name, args) => routineCall(dialect, name, args, 'table-function'),
    callProcedure: (name, args) => routineCall(dialect, name, args, 'procedure'),
  };
}
