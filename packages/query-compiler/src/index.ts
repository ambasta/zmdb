import type { CompiledQuery } from './compiled-query.js';
// @zmdb/query-compiler — implementation.
import {
  TRAITS,
  dialectName,
  dialectTraits,
  type Dialect,
  type BuiltInDialect,
  type DialectReturningSql,
  type DialectTarget,
  type ReturningStatement,
  type SqlDialect,
} from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';

export { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
export type { CompiledQuery, QueryTelemetry } from './compiled-query.js';
export {
  DIALECTS,
  TRAITS,
  defineSqlDialect,
  dialectCapabilities,
  dialectFamily,
  dialectName,
  dialectSupportsReturning,
  dialectTraits,
  extendSqlDialect,
  isSqlDialect,
} from './dialects/index.js';
export type {
  AppliedMigration,
  BuiltInDialect,
  DatabaseCapabilities,
  Dialect,
  DialectCompiler,
  DialectFamily,
  DialectFeature,
  DialectOutbox,
  DialectReturningColumn,
  DialectReturningContext,
  DialectReturningSql,
  DialectSqlType,
  DialectTarget,
  DialectTraits,
  DialectTypeMap,
  DialectUpsertConflict,
  DialectUpsertContext,
  DialectUpsertReferences,
  IntrospectionDriver,
  Introspector,
  IntrospectOptions,
  MigrationConnection,
  MigrationDialect,
  MigrationDriver,
  MigrationPlan,
  MigrationTableOptions,
  PaginationTail,
  PlaceholderStyle,
  ResolvedDialectTraits,
  ResolvedTraits,
  ReturningCapability,
  ReturningStatement,
  ReturningStyle,
  SchemaObjectOperation,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
} from './dialects/index.js';

// #17 SELECT compilation implemented (+ shared dialect quoting/placeholders,
// which also satisfies the SELECT-based dialect tests of #19). Write builders
// (#18 INSERT/UPDATE/DELETE) remain unimplemented; their tests stay red.

import {
  frozenQuery,
  havingClause,
  joinClauses,
  joinMethods,
  queryTelemetry,
  renderPredicate,
  tailClause,
  tailMethods,
  whereClause,
  type ComparisonPredicate,
  type JoinKind,
  type JoinSpec,
  type Predicate,
  type PredicateGroup,
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
import { escapeFts5Term, type FtsOptions } from './fts/index.js';
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
export type { FtsOptions, JoinKind };

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
  | 'is null'
  | 'is not null'
  | (string & {});

export { OP_MAP } from './clauses.js';
export { renderPredicate } from './clauses.js';
export type { ComparisonPredicate, Predicate, PredicateGroup } from './clauses.js';

export type Direction = 'asc' | 'desc';

/** A database column projected under an application-facing result key. */
export interface AliasedColumn {
  readonly column: string;
  readonly alias: string;
}

type SelectedColumn = string | AliasedColumn | AliasedDistanceExpression;
type ReturningColumn = string | AliasedColumn;

function isAliasedColumn(column: SelectedColumn | ReturningColumn): column is AliasedColumn {
  return typeof column === 'object' && 'column' in column && 'alias' in column;
}

/**
 * Heuristic element-count chunk thresholds per SQL dialect for IN-list expansion.
 * These conservative limits (30,000 for SQLite and 60,000 for
 * Postgres/MySQL) serve as
 * list-length heuristics, leaving headroom below maximum driver parameter limits
 * (32,766 for SQLite, 65,535 for Postgres/MySQL) for any additional query parameters.
 */
export const DIALECT_PARAM_LIMITS: Readonly<Record<BuiltInDialect, number>> = Object.freeze({
  postgres: TRAITS.postgres.paramLimit,
  mysql: TRAITS.mysql.paramLimit,
  sqlite: TRAITS.sqlite.paramLimit,
  cockroach: TRAITS.cockroach.paramLimit,
  singlestore: TRAITS.singlestore.paramLimit,
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

export { appendComment, serializeComment, withComments } from './comments/index.js';
export type { CommentKey, CommentKeys, CommentPairs } from './comments/index.js';

/** Optional compiler features that would otherwise change every query shape. */
export interface QueryCompilerOptions {
  readonly telemetry?: true;
}

export interface SelectItem {
  readonly kind: 'col' | 'agg' | 'expr';
  readonly col?: SelectedColumn | undefined;
  readonly fn?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | undefined;
  readonly alias?: string | undefined;
  readonly raw?: string | undefined;
}

export type WhereClause =
  | {
      readonly kind?: 'comparison';
      readonly col: string;
      readonly op: Operator | string;
      readonly value: unknown;
      readonly connector?: 'AND' | 'OR' | undefined;
      readonly isMatch?: boolean | undefined;
    }
  | SpatialPredicate;

export interface SelectState {
  readonly table: string;
  readonly items: readonly SelectItem[];
  readonly joins: readonly JoinSpec[];
  readonly wheres: readonly WhereClause[];
  readonly groups: readonly string[];
  readonly havings: readonly WhereClause[];
  readonly orderBys: readonly { readonly col: string | DistanceExpression; readonly dir: Direction }[];
  readonly limitN?: number | undefined;
  readonly offsetN?: number | undefined;
  readonly ftsTable?: string | boolean | undefined;
}

export interface SelectBuilder<T = unknown> {
  select(columns?: readonly SelectedColumn[]): SelectBuilder<T>;
  count(expr: string, alias: string): SelectBuilder<T>;
  sum(expr: string, alias: string): SelectBuilder<T>;
  avg(expr: string, alias: string): SelectBuilder<T>;
  min(expr: string, alias: string): SelectBuilder<T>;
  max(expr: string, alias: string): SelectBuilder<T>;
  expr(rawExpr: string, alias: string): SelectBuilder<T>;

  innerJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): SelectBuilder<T>;
  innerJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): SelectBuilder<T>;
  leftJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): SelectBuilder<T>;
  leftJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): SelectBuilder<T>;
  rightJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): SelectBuilder<T>;
  rightJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): SelectBuilder<T>;

  whereMatch(column: string, term: string, options?: FtsOptions | string | boolean): SelectBuilder<T>;
  where(predicate: SpatialPredicate): SelectBuilder<T>;
  where(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  andWhere(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  orWhere(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  whereGroup(predicates: readonly ComparisonPredicate[]): SelectBuilder<T>;
  orWhereGroup(predicates: readonly ComparisonPredicate[]): SelectBuilder<T>;
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

  groupBy(...cols: string[]): SelectBuilder<T>;
  having(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  andHaving(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  orHaving(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;

  orderBy(col: string | DistanceExpression, dir: Direction): SelectBuilder<T>;
  limit(n: number): SelectBuilder<T>;
  offset(n: number): SelectBuilder<T>;

  compile(): CompiledQuery;
  readonly dialect: DialectTarget;
  readonly _type?: T;
}

function parseTableSpec(spec: string): { baseName: string; alias?: string } {
  const m = /^(\S+)\s+(?:as\s+)?(\S+)$/i.exec(spec.trim());
  if (m && m[1] && m[2]) {
    return { baseName: m[1], alias: m[2] };
  }
  return { baseName: spec.trim() };
}

function makeSelect<T = unknown>(d: DialectTarget, state: SelectState, telemetry: boolean): SelectBuilder<T> {
  const next = (patch: Partial<SelectState>): SelectBuilder<T> => makeSelect(d, { ...state, ...patch }, telemetry);

  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator | string, value: unknown, isMatch = false) =>
    next({ wheres: [...state.wheres, { col, op, value, connector, isMatch }] });

  const addSpatial = (connector: 'AND' | 'OR', predicate: SpatialPredicate) =>
    next({ wheres: [...state.wheres, { ...predicate, connector }] });
  const addGroup = (connector: 'AND' | 'OR', predicates: readonly ComparisonPredicate[]) =>
    next({ wheres: [...state.wheres, { kind: 'group', predicates, connector } satisfies PredicateGroup] });

  function where(predicate: SpatialPredicate): SelectBuilder<T>;
  function where(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  function where(first: string | SpatialPredicate, op?: Operator | string, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('where(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function andWhere(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  function andWhere(first: string | SpatialPredicate, op?: Operator | string, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('andWhere(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function orWhere(col: string, op: Operator | string, value: unknown): SelectBuilder<T>;
  function orWhere(first: string | SpatialPredicate, op?: Operator | string, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('OR', first);
    if (op === undefined) throw new TypeError('orWhere(column, operator, value) requires an operator');
    return addWhere('OR', first, op, value);
  }
  const addHaving = (connector: 'AND' | 'OR', col: string, op: Operator | string, value: unknown) =>
    next({ havings: [...state.havings, { col, op, value, connector }] });
  const agg = (fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX', col: string, alias: string) =>
    next({ items: [...state.items, { kind: 'agg', fn, col, alias }] });

  return {
    ...tailMethods<string | DistanceExpression, SelectBuilder<T>>(state, next),
    ...joinMethods(state.joins, next),
    dialect: d,

    select: columns => {
      if (columns === undefined) return next({ items: [] });
      const nonCols = state.items.filter(it => it.kind !== 'col');
      const newCols: SelectItem[] = columns.map(c => ({ kind: 'col', col: c }));
      return next({ items: [...nonCols, ...newCols] });
    },

    count: (e, a) => agg('COUNT', e, a),
    sum: (e, a) => agg('SUM', e, a),
    avg: (e, a) => agg('AVG', e, a),
    min: (e, a) => agg('MIN', e, a),
    max: (e, a) => agg('MAX', e, a),
    expr: (raw, alias) => next({ items: [...state.items, { kind: 'expr', raw, alias }] }),

    whereMatch: (column, term, options) => {
      const ftsTable =
        (typeof options === 'string' || typeof options === 'boolean' ? options : options?.ftsTable) ?? state.ftsTable;
      return next({
        wheres: [...state.wheres, { col: column, op: 'MATCH', value: term, connector: 'AND', isMatch: true }],
        ftsTable,
      });
    },

    where,
    andWhere,
    orWhere,
    whereGroup: predicates => addGroup('AND', predicates),
    orWhereGroup: predicates => addGroup('OR', predicates),
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

    groupBy: (...cols) => next({ groups: [...state.groups, ...cols] }),

    having: (col, op, value) => addHaving('AND', col, op, value),
    andHaving: (col, op, value) => addHaving('AND', col, op, value),
    orHaving: (col, op, value) => addHaving('OR', col, op, value),

    compile: () => {
      const params: unknown[] = [];
      // 1. SELECT items
      let colsSql: string;
      if (state.items.length === 0) {
        colsSql = '*';
      } else {
        colsSql = state.items
          .map(it => {
            if (it.kind === 'col') {
              if (isAliasedColumn(it.col!)) {
                return `${quoteColumn(d, it.col.column)} AS ${quoteIdentifier(d, it.col.alias)}`;
              }
              if (typeof it.col === 'object' && it.col !== null && isAliasedDistanceExpression(it.col)) {
                return renderAliasedDistanceExpression(d, it.col, params);
              }
              const colStr = it.col as string;
              const m = /^(\S+)\s+as\s+(\S+)$/i.exec(colStr.trim());
              if (m && m[1] && m[2]) return `${quoteColumn(d, m[1])} AS ${quoteIdentifier(d, m[2])}`;
              if (state.joins.length > 0 && colStr.includes('.')) {
                const prefix = colStr.slice(0, colStr.indexOf('.')).toLowerCase();
                const { baseName, alias } = parseTableSpec(state.table);
                if (prefix !== baseName.toLowerCase() && (!alias || prefix !== alias.toLowerCase())) {
                  return `${quoteColumn(d, colStr)} AS ${quoteIdentifier(d, colStr)}`;
                }
              }
              return quoteColumn(d, colStr);
            }
            if (it.kind === 'agg')
              return `${it.fn}(${quoteColumn(d, it.col as string)}) AS ${quoteIdentifier(d, it.alias!)}`;
            return `${it.raw} AS ${quoteIdentifier(d, it.alias!)}`;
          })
          .join(', ');
      }

      // 2. WHERE clause
      let whereSql = '';
      if (state.wheres.length > 0) {
        const parts = state.wheres.map((p, i) => {
          let cond: string;
          if ('isMatch' in p && p.isMatch) {
            if (d === 'sqlite') {
              const { baseName, alias } = parseTableSpec(state.table);
              const ftsTableName = typeof state.ftsTable === 'string' ? state.ftsTable : `${baseName}_fts`;
              const ftsAlias = alias ? `${alias}_fts` : undefined;
              const ftsRef = ftsAlias ? quoteIdentifier(d, ftsAlias) : quoteColumn(d, ftsTableName);
              const colName = p.col.slice(p.col.lastIndexOf('.') + 1);
              params.push(escapeFts5Term(String(p.value)));
              cond = `${ftsRef}.${quoteIdentifier(d, colName)} MATCH ${formatPlaceholder(d, params.length)}`;
            } else if (d === 'postgres') {
              params.push(p.value);
              cond = `to_tsvector('english', ${quoteColumn(d, p.col)}) @@ to_tsquery('english', ${formatPlaceholder(d, params.length)})`;
            } else {
              // mysql
              params.push(p.value);
              cond = `MATCH(${quoteColumn(d, p.col)}) AGAINST(${formatPlaceholder(d, params.length)} IN NATURAL LANGUAGE MODE)`;
            }
          } else {
            cond = renderPredicate(d, p as Predicate, params);
          }
          const connector = p.connector ?? 'AND';
          return i === 0 ? cond : `${connector} ${cond}`;
        });
        whereSql = ` WHERE ${parts.join(' ')}`;
      }

      // 3. FROM & FTS / JOIN clauses
      let fromSql = '';
      const hasMatch = state.wheres.some(w => 'isMatch' in w && w.isMatch);

      if (d === 'sqlite' && hasMatch) {
        if (!state.ftsTable) {
          throw new UnsupportedFeatureError('full-text search', 'sqlite');
        }
        const { baseName, alias } = parseTableSpec(state.table);
        const quotedBaseTable = quoteTable(d, state.table);
        const baseRef = alias ? quoteIdentifier(d, alias) : quoteColumn(d, baseName);

        const ftsTableName = typeof state.ftsTable === 'string' ? state.ftsTable : `${baseName}_fts`;
        const ftsAlias = alias ? `${alias}_fts` : undefined;
        const quotedFtsTable = ftsAlias
          ? `${quoteColumn(d, ftsTableName)} AS ${quoteIdentifier(d, ftsAlias)}`
          : quoteColumn(d, ftsTableName);

        const ftsRef = ftsAlias ? quoteIdentifier(d, ftsAlias) : quoteColumn(d, ftsTableName);

        fromSql = `FROM ${quotedBaseTable} INNER JOIN ${quotedFtsTable} ON ${baseRef}.${quoteIdentifier(d, 'rowid')} = ${ftsRef}.${quoteIdentifier(d, 'rowid')}`;
      } else {
        fromSql = `FROM ${quoteTable(d, state.table)}`;
      }

      fromSql += joinClauses(d, state.joins, params);

      // 4. GROUP BY clause
      const groupBySql =
        state.groups.length > 0 ? ` GROUP BY ${state.groups.map(c => quoteColumn(d, c)).join(', ')}` : '';

      // 5. HAVING clause
      const havingSql = havingClause(d, state.havings as readonly ComparisonPredicate[], params);

      // 6. ORDER BY / LIMIT / OFFSET
      let orderBySql = '';
      if (state.orderBys && state.orderBys.length > 0) {
        orderBySql = ` ORDER BY ${state.orderBys
          .map(order => {
            const expression = isDistanceExpression(order.col)
              ? renderDistanceExpression(d, order.col, params)
              : quoteColumn(d, order.col as string);
            return `${expression} ${order.dir.toUpperCase()}`;
          })
          .join(', ')}`;
      }
      const tailSql = orderBySql + tailClause(d, { limitN: state.limitN, offsetN: state.offsetN });

      const text = `SELECT ${colsSql} ${fromSql}${whereSql}${groupBySql}${havingSql}${tailSql}`;
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
  returning(cols?: readonly ReturningColumn[]): InsertBuilder;
  compile(): CompiledQuery;
}
export interface UpdateBuilder {
  set(row: Record<string, unknown>): UpdateBuilder;
  where(col: string, op: Operator, value: unknown): UpdateBuilder;
  orWhere(col: string, op: Operator, value: unknown): UpdateBuilder;
  whereGroup(predicates: readonly ComparisonPredicate[]): UpdateBuilder;
  whereIn(col: string, values: readonly unknown[]): UpdateBuilder;
  whereNotIn(col: string, values: readonly unknown[]): UpdateBuilder;
  returning(cols?: readonly ReturningColumn[]): UpdateBuilder;
  compile(): CompiledQuery;
}
export interface DeleteBuilder {
  where(col: string, op: Operator, value: unknown): DeleteBuilder;
  orWhere(col: string, op: Operator, value: unknown): DeleteBuilder;
  whereGroup(predicates: readonly ComparisonPredicate[]): DeleteBuilder;
  whereIn(col: string, values: readonly unknown[]): DeleteBuilder;
  whereNotIn(col: string, values: readonly unknown[]): DeleteBuilder;
  returning(cols?: readonly ReturningColumn[]): DeleteBuilder;
  compile(): CompiledQuery;
}

export interface QueryCompiler {
  selectFrom<T = unknown>(table: string, options?: FtsOptions | string | boolean): SelectBuilder<T>;
  insertInto(table: string): InsertBuilder;
  updateTable(table: string): UpdateBuilder;
  deleteFrom(table: string): DeleteBuilder;
  callFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
}

function routineCall(
  dialect: DialectTarget,
  name: string,
  args: readonly unknown[],
  kind: 'function' | 'table-function' | 'procedure',
): CompiledQuery {
  const nameOfDialect = dialectName(dialect);
  const traits = dialectTraits(dialect);
  const supported =
    kind === 'function' ? traits.functions : kind === 'procedure' ? traits.procedures : traits.tableFunctions;
  if (!supported) {
    throw new UnsupportedFeatureError(`stored routine "${name}"`, nameOfDialect);
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

function returningColumn(d: DialectTarget, column: ReturningColumn): string {
  if (typeof column === 'string') return column === '*' ? '*' : quoteColumn(d, column);
  return `${quoteColumn(d, column.column)} AS ${quoteIdentifier(d, column.alias)}`;
}

const NO_RETURNING_SQL: DialectReturningSql = Object.freeze({ inline: '', suffix: '' });

function returningSql(
  d: DialectTarget,
  statement: ReturningStatement,
  row: 'new' | 'old',
  cols?: readonly ReturningColumn[],
): DialectReturningSql {
  if (!cols || cols.length === 0) return NO_RETURNING_SQL;
  const style = dialectTraits(d).returning[statement];
  if (style === 'none') {
    const name = dialectName(d);
    throw new UnsupportedFeatureError(
      'returning',
      name,
      `returning is not supported for ${statement.toUpperCase()} on dialect "${name}"; ` +
        'omit returning() and perform an explicit read',
    );
  }
  if (style === 'suffix') {
    return Object.freeze({
      inline: '',
      suffix: ` RETURNING ${cols.map(column => returningColumn(d, column)).join(', ')}`,
    });
  }
  if (typeof d === 'string' || d.compiler === undefined) {
    throw new UnsupportedFeatureError(
      `${style} returning strategy`,
      dialectName(d),
      `dialect "${dialectName(d)}" must provide its package-owned compiler strategy`,
    );
  }
  return d.compiler.returning({
    dialect: d,
    statement,
    row,
    columns: cols,
  });
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
function conflictTarget(d: DialectTarget, target?: readonly string[]): string {
  if (!target || target.length === 0) return '';
  return ` (${target.map(t => quoteIdentifier(d, t)).join(', ')})`;
}

/**
 * `col = <the value this INSERT tried to write>` for each column. MySQL spells
 * that VALUES(col) where postgres and sqlite say EXCLUDED.col. VALUES() is
 * deprecated in MySQL 8.0.20+ in favour of a row alias (`AS new`), but keeping
 * it means servers older than that still work.
 */
function upsertSetSql(d: DialectTarget, cols: readonly string[], upsert: 'onConflict' | 'onDuplicateKey'): string {
  const value = (c: string) =>
    upsert === 'onDuplicateKey' ? `VALUES(${quoteIdentifier(d, c)})` : `EXCLUDED.${quoteIdentifier(d, c)}`;
  return cols.map(c => `${quoteIdentifier(d, c)} = ${value(c)}`).join(', ');
}

function setValueSql(
  d: DialectTarget,
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

function makeInsert(
  d: DialectTarget,
  table: string,
  row?: Record<string, unknown>,
  ret?: readonly ReturningColumn[],
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
      const placeholders = keys.map((_, i) => formatPlaceholder(d, i + 1));
      const placeholderList = placeholders.join(', ');
      const returning = returningSql(d, conflict === undefined ? 'insert' : 'upsert', 'new', ret);
      const insert = `INSERT INTO ${quoteTable(d, table)} (${cols})${returning.inline} VALUES (${placeholderList})`;
      let text: string;

      if (!conflict) {
        text = insert;
      } else {
        const upsert = dialectTraits(d).upsert;
        if (upsert === 'none') throw new UnsupportedFeatureError('upsert', dialectName(d));
        if (upsert === 'merge') {
          if (typeof d === 'string' || d.compiler === undefined) {
            throw new UnsupportedFeatureError(
              `${upsert} upsert strategy`,
              dialectName(d),
              `dialect "${dialectName(d)}" must provide its package-owned compiler strategy`,
            );
          }
          text = d.compiler.upsert({
            dialect: d,
            table,
            columns: keys,
            placeholders,
            conflict,
            returning,
            renderUpdateValue: (column, value, references) =>
              setValueSql(d, table, column, value, params, 'upsert', references),
            isProposedValue: value => isColumnExpr(value) && value.op === 'proposed',
          });
        } else if (conflict.action === 'ignore') {
          text =
            upsert === 'onDuplicateKey'
              ? `INSERT IGNORE INTO ${quoteTable(d, table)} (${cols}) VALUES (${placeholderList})`
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

      text += returning.suffix;
      return frozenQuery(text, params, queryTelemetry(d, 'INSERT', table, telemetry));
    },
  };
}

function makeUpdate(
  d: DialectTarget,
  table: string,
  row?: Record<string, unknown>,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): UpdateBuilder {
  return {
    set: r => makeUpdate(d, table, r, wheres, ret, telemetry),
    where: (col, op, value) =>
      makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) =>
      makeUpdate(d, table, row, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereGroup: predicates =>
      makeUpdate(d, table, row, [...wheres, { kind: 'group', predicates, connector: 'AND' }], ret, telemetry),
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
      const returning = returningSql(d, 'update', 'new', ret);
      const text =
        `UPDATE ${quoteTable(d, table)} SET ${sets}` +
        returning.inline +
        whereClause(d, wheres, params) +
        returning.suffix;
      return frozenQuery(text, params, queryTelemetry(d, 'UPDATE', table, telemetry));
    },
  };
}

function makeDelete(
  d: DialectTarget,
  table: string,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): DeleteBuilder {
  return {
    where: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) => makeDelete(d, table, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereGroup: predicates =>
      makeDelete(d, table, [...wheres, { kind: 'group', predicates, connector: 'AND' }], ret, telemetry),
    whereIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret, telemetry),
    whereNotIn: (col, values) =>
      makeDelete(d, table, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret, telemetry),
    returning: cols => makeDelete(d, table, wheres, cols ?? [], telemetry),
    compile: () => {
      const params: unknown[] = [];
      const returning = returningSql(d, 'delete', 'old', ret);
      const text =
        `DELETE FROM ${quoteTable(d, table)}` + returning.inline + whereClause(d, wheres, params) + returning.suffix;
      return frozenQuery(text, params, queryTelemetry(d, 'DELETE', table, telemetry));
    },
  };
}

export function createQueryCompiler<Name extends string>(
  dialect: SqlDialect<Name>,
  options?: QueryCompilerOptions,
): QueryCompiler;
export function createQueryCompiler(dialect?: Dialect, options?: QueryCompilerOptions): QueryCompiler;
export function createQueryCompiler(dialect: DialectTarget, options?: QueryCompilerOptions): QueryCompiler;
export function createQueryCompiler(
  dialect: DialectTarget = 'postgres',
  options?: QueryCompilerOptions,
): QueryCompiler {
  const telemetry = options?.telemetry === true;
  return {
    selectFrom: (table, opts) => {
      const ftsTable = typeof opts === 'string' || typeof opts === 'boolean' ? opts : opts?.ftsTable;
      return makeSelect(
        dialect,
        {
          table,
          items: [],
          joins: [],
          wheres: [],
          groups: [],
          havings: [],
          orderBys: [],
          ftsTable,
        },
        telemetry,
      );
    },
    insertInto: table => makeInsert(dialect, table, undefined, undefined, undefined, telemetry),
    updateTable: table => makeUpdate(dialect, table, undefined, [], undefined, telemetry),
    deleteFrom: table => makeDelete(dialect, table, [], undefined, telemetry),
    callFunction: (name, args) => routineCall(dialect, name, args, 'function'),
    callTableFunction: (name, args) => routineCall(dialect, name, args, 'table-function'),
    callProcedure: (name, args) => routineCall(dialect, name, args, 'procedure'),
  };
}
