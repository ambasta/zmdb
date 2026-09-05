import type { CompiledQuery } from './compiled-query.js';
// @zmdb/query-compiler — implementation.
import { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
import {
  TRAITS,
  dialectName,
  dialectTraits,
  type Dialect,
  type DialectTarget,
  type ReturningStatement,
  type SqlDialect,
} from './dialects/index.js';
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
  DatabaseCapabilities,
  Dialect,
  DialectFamily,
  DialectFeature,
  DialectSqlType,
  DialectTarget,
  DialectTraits,
  DialectTypeMap,
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
  isSubqueryTarget,
  queryTelemetry,
  tailClause,
  tailMethods,
  whereClause,
  type ComparisonPredicate,
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

export interface WindowProjectionNode {
  readonly kind: 'window';
  readonly functionName: string;
  readonly args?: readonly string[];
  readonly partitionBy?: readonly string[];
  readonly orderBys?: readonly { col: string; dir: Direction }[];
  readonly alias?: string;
}

export interface WindowFunctionBuilder {
  readonly kind: 'window';
  functionName(fn: string): WindowFunctionBuilder;
  args(...args: string[]): WindowFunctionBuilder;
  partitionBy(...cols: (string | readonly string[])[]): WindowFunctionBuilder;
  orderBy(col: string, dir?: Direction): WindowFunctionBuilder;
  as(alias: string): WindowFunctionBuilder;
  toNode(): WindowProjectionNode;
  compile(dialect: Dialect): string;
}

export type ProjectionItem =
  | string
  | AliasedColumn
  | WindowProjectionNode
  | WindowFunctionBuilder
  | AliasedDistanceExpression;

export type SelectedColumn = ProjectionItem;
export type ReturningColumn = string | AliasedColumn;

function isAliasedColumn(column: unknown): column is AliasedColumn {
  return typeof column === 'object' && column !== null && 'column' in column && 'alias' in column;
}

export type SubqueryInput =
  | SelectBuilder<unknown>
  | { compile(): CompiledQuery }
  | ((builder: QueryCompiler) => SelectBuilder<unknown> | { compile(): CompiledQuery });

export interface CteSpec {
  readonly name: string;
  readonly subquery: SubqueryInput;
  readonly recursive?: boolean;
}

const SUPPORTED_DIALECTS: ReadonlySet<Dialect> = new Set(['postgres', 'mysql', 'sqlite']);

export function checkDialectCapability(dialect: Dialect, feature: string): void {
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new UnsupportedFeatureError(feature, dialect);
  }
}

export function isWindowProjectionNode(value: unknown): value is WindowProjectionNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'window' &&
    'functionName' in value &&
    typeof value.functionName === 'string'
  );
}

export function isWindowFunctionBuilder(value: unknown): value is WindowFunctionBuilder {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'window' &&
    'toNode' in value &&
    typeof value.toNode === 'function'
  );
}

export function assertNoWindowFunction(value: unknown, context: string): void {
  if (isWindowProjectionNode(value) || isWindowFunctionBuilder(value)) {
    throw new QueryCompilerError(`Window functions are restricted to projection selection lists (${context})`);
  }
  if (typeof value === 'string' && /\bOVER\s*\(/i.test(value)) {
    throw new QueryCompilerError(`Window functions are restricted to projection selection lists (${context})`);
  }
}

export function renderWindowProjectionNode(d: Dialect, item: WindowProjectionNode | WindowFunctionBuilder): string {
  const node = isWindowFunctionBuilder(item) ? item.toNode() : item;
  const fnName = node.functionName.toUpperCase();

  let argsSql = '';
  if (node.args && node.args.length > 0) {
    argsSql = node.args.map(a => (a === '*' ? '*' : quoteColumn(d, a))).join(', ');
  }

  const overParts: string[] = [];
  if (node.partitionBy && node.partitionBy.length > 0) {
    const partitions = node.partitionBy.map(p => quoteColumn(d, p)).join(', ');
    overParts.push(`PARTITION BY ${partitions}`);
  }
  if (node.orderBys && node.orderBys.length > 0) {
    const orders = node.orderBys.map(o => `${quoteColumn(d, o.col)} ${o.dir.toUpperCase()}`).join(', ');
    overParts.push(`ORDER BY ${orders}`);
  }

  const overClause = overParts.length > 0 ? `OVER (${overParts.join(' ')})` : 'OVER ()';
  const sql = `${fnName}(${argsSql}) ${overClause}`;

  if (node.alias) {
    return `${sql} AS ${quoteIdentifier(d, node.alias)}`;
  }
  return sql;
}

export function windowFunction(fnName: string, args: readonly string[] = []): WindowFunctionBuilder {
  let node: WindowProjectionNode = {
    kind: 'window',
    functionName: fnName,
    args: [...args],
    partitionBy: [],
    orderBys: [],
  };

  const builder: WindowFunctionBuilder = {
    kind: 'window',
    functionName(fn: string) {
      node = { ...node, functionName: fn };
      return builder;
    },
    args(...a: string[]) {
      node = { ...node, args: a };
      return builder;
    },
    partitionBy(...cols: (string | readonly string[])[]) {
      const flattened = cols.flatMap(c => (Array.isArray(c) ? c : [c]));
      node = { ...node, partitionBy: [...(node.partitionBy ?? []), ...flattened] };
      return builder;
    },
    orderBy(col: string, dir: Direction = 'asc') {
      node = { ...node, orderBys: [...(node.orderBys ?? []), { col, dir }] };
      return builder;
    },
    as(alias: string) {
      node = { ...node, alias };
      return builder;
    },
    toNode() {
      return node;
    },
    compile(d: Dialect) {
      return renderWindowProjectionNode(d, node);
    },
  };

  return builder;
}

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

interface SelectState {
  readonly ctes?: readonly CteSpec[];
  readonly table: string;
  readonly columns?: readonly ProjectionItem[];
  readonly wheres: readonly Predicate[];
  readonly orderBys: readonly { col: string | DistanceExpression; dir: Direction }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

export interface SelectBuilder<T = unknown> {
  with(name: string, subquery: SubqueryInput): SelectBuilder<T>;
  withRecursive(name: string, subquery: SubqueryInput): SelectBuilder<T>;
  select(columns?: readonly ProjectionItem[]): SelectBuilder<T>;
  selectWindow(windowFn: WindowFunctionBuilder | WindowProjectionNode): SelectBuilder<T>;
  where(predicate: SpatialPredicate): SelectBuilder<T>;
  where(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
  andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  andWhere(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
  orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  orWhere(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
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
  orderBy(col: string | DistanceExpression, dir: Direction): SelectBuilder<T>;
  limit(n: number): SelectBuilder<T>;
  offset(n: number): SelectBuilder<T>;
  compile(): CompiledQuery;
  readonly dialect: DialectTarget;
  readonly _type?: T;
}

function makeSelect<T = unknown>(d: DialectTarget, state: SelectState, telemetry: boolean): SelectBuilder<T> {
  const next = (patch: Partial<SelectState>): SelectBuilder<T> => makeSelect(d, { ...state, ...patch }, telemetry);

  const addWhere = (connector: 'AND' | 'OR', col: string | ProjectionItem, op: Operator, value: unknown) => {
    assertNoWindowFunction(col, 'WHERE clause');
    assertNoWindowFunction(value, 'WHERE clause');
    return next({ wheres: [...state.wheres, { col: String(col), op, value, connector }] });
  };
  const addSpatial = (connector: 'AND' | 'OR', predicate: SpatialPredicate) =>
    next({ wheres: [...state.wheres, { ...predicate, connector }] });
  const addGroup = (connector: 'AND' | 'OR', predicates: readonly ComparisonPredicate[]) =>
    next({ wheres: [...state.wheres, { kind: 'group', predicates, connector } satisfies PredicateGroup] });

  function where(predicate: SpatialPredicate): SelectBuilder<T>;
  function where(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
  function where(first: string | ProjectionItem | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('where(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function andWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function andWhere(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
  function andWhere(
    first: string | ProjectionItem | SpatialPredicate,
    op?: Operator,
    value?: unknown,
  ): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('andWhere(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function orWhere(predicate: SpatialPredicate): SelectBuilder<T>;
  function orWhere(col: string | ProjectionItem, op: Operator, value: unknown): SelectBuilder<T>;
  function orWhere(
    first: string | ProjectionItem | SpatialPredicate,
    op?: Operator,
    value?: unknown,
  ): SelectBuilder<T> {
    if (isSpatialPredicate(first)) return addSpatial('OR', first);
    if (op === undefined) throw new TypeError('orWhere(column, operator, value) requires an operator');
    return addWhere('OR', first, op, value);
  }

  return {
    ...tailMethods(state, next),
    dialect: d,
    with: (name, subquery) => next({ ctes: [...(state.ctes ?? []), { name, subquery }] }),
    withRecursive: (name, subquery) => next({ ctes: [...(state.ctes ?? []), { name, subquery, recursive: true }] }),
    select: columns => (columns === undefined ? next({}) : next({ columns })),
    selectWindow: windowFn => next({ columns: [...(state.columns ?? []), windowFn] }),
    where,
    andWhere,
    orWhere,
    whereGroup: predicates => addGroup('AND', predicates),
    orWhereGroup: predicates => addGroup('OR', predicates),
    whereIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE IN clause');
      return addWhere('AND', col, 'in', values);
    },
    andWhereIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE IN clause');
      return addWhere('AND', col, 'in', values);
    },
    orWhereIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE IN clause');
      return addWhere('OR', col, 'in', values);
    },
    whereNotIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE NOT IN clause');
      return addWhere('AND', col, 'not in', values);
    },
    andWhereNotIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE NOT IN clause');
      return addWhere('AND', col, 'not in', values);
    },
    orWhereNotIn: (col, values) => {
      assertNoWindowFunction(col, 'WHERE NOT IN clause');
      return addWhere('OR', col, 'not in', values);
    },
    whereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    andWhereExists: subquery => addWhere('AND', '', 'EXISTS', subquery),
    orWhereExists: subquery => addWhere('OR', '', 'EXISTS', subquery),
    whereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    andWhereNotExists: subquery => addWhere('AND', '', 'NOT EXISTS', subquery),
    orWhereNotExists: subquery => addWhere('OR', '', 'NOT EXISTS', subquery),
    compile: () => {
      if (state.ctes && state.ctes.length > 0) {
        checkDialectCapability(d, 'common table expressions');
      }

      const params: unknown[] = [];
      let cteClause = '';

      if (state.ctes && state.ctes.length > 0) {
        const isRecursive = state.ctes.some(c => c.recursive);
        if (isRecursive) {
          checkDialectCapability(d, 'recursive common table expressions');
        }
        const cteParts: string[] = [];
        for (const cte of state.ctes) {
          let sub: CompiledQuery;
          if (typeof cte.subquery === 'function') {
            const qc = createQueryCompiler(d);
            const res = cte.subquery(qc);
            if (isSubqueryTarget(res)) {
              sub = res.compile();
            } else {
              throw new QueryCompilerError(`Invalid subquery provided for CTE "${cte.name}"`);
            }
          } else if (isSubqueryTarget(cte.subquery)) {
            sub = cte.subquery.compile();
          } else {
            throw new QueryCompilerError(`Invalid subquery provided for CTE "${cte.name}"`);
          }

          const renumberedText = renumberPlaceholders(sub.text, params.length, d);
          params.push(...sub.parameters);
          cteParts.push(`${quoteIdentifier(d, cte.name)} AS (${renumberedText})`);
        }
        const keyword = isRecursive ? 'WITH RECURSIVE' : 'WITH';
        cteClause = `${keyword} ${cteParts.join(', ')} `;
      }

      let cols = '*';
      if (state.columns && state.columns.length > 0) {
        cols = state.columns
          .map(c => {
            if (isWindowProjectionNode(c) || isWindowFunctionBuilder(c)) {
              checkDialectCapability(d, 'window functions');
              return renderWindowProjectionNode(d, c);
            }
            if (isAliasedColumn(c)) {
              return `${quoteColumn(d, c.column)} AS ${quoteIdentifier(d, c.alias)}`;
            }
            if (isAliasedDistanceExpression(c)) {
              return renderAliasedDistanceExpression(d, c, params);
            }
            if (typeof c === 'string') {
              if (/\bOVER\s*\(/i.test(c)) {
                checkDialectCapability(d, 'window functions');
              }
              const m = /^(\S+)\s+as\s+(\S+)$/i.exec(c.trim());
              if (m && m[1] && m[2]) {
                return `${quoteColumn(d, m[1])} AS ${quoteIdentifier(d, m[2])}`;
              }
              return quoteColumn(d, c);
            }
            return String(c);
          })
          .join(', ');
      }

      for (const w of state.wheres) {
        if ('col' in w && w.col) {
          assertNoWindowFunction(w.col, 'WHERE clause');
        }
        if ('value' in w && w.value) {
          assertNoWindowFunction(w.value, 'WHERE clause');
        }
      }

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
        `${cteClause}SELECT ${cols} FROM ${quoteTable(d, state.table)}` +
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
  selectFrom(table: string): SelectBuilder;
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

function outputColumn(d: DialectTarget, pseudoTable: 'INSERTED' | 'DELETED', column: ReturningColumn): string {
  if (typeof column === 'string')
    return column === '*' ? `${pseudoTable}.*` : `${pseudoTable}.${quoteColumn(d, column)}`;
  return `${pseudoTable}.${quoteColumn(d, column.column)} AS ${quoteIdentifier(d, column.alias)}`;
}

interface ReturningSql {
  readonly output: string;
  readonly suffix: string;
}

const NO_RETURNING_SQL: ReturningSql = Object.freeze({ output: '', suffix: '' });

function returningSql(
  d: DialectTarget,
  statement: ReturningStatement,
  pseudoTable: 'INSERTED' | 'DELETED',
  cols?: readonly ReturningColumn[],
): ReturningSql {
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
      output: '',
      suffix: ` RETURNING ${cols.map(column => returningColumn(d, column)).join(', ')}`,
    });
  }

  // SQL Server rejects OUTPUT without INTO when the target has an enabled trigger
  // for the statement's DML action. The compiler cannot inspect triggers, and
  // OUTPUT INTO would require a table variable plus a second statement.
  return Object.freeze({
    output: ` OUTPUT ${cols.map(column => outputColumn(d, pseudoTable, column)).join(', ')}`,
    suffix: '',
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

function mssqlMergeSql(
  d: DialectTarget,
  table: string,
  keys: readonly string[],
  placeholders: string,
  params: unknown[],
  conflict: ConflictState,
  returning: ReturningSql,
): string {
  const target = conflict.target;
  if (!target || target.length === 0) {
    throw new UnsupportedFeatureError(
      'upsert without a conflict target',
      dialectName(d),
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
    `${returning.output};`
  );
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
      const placeholders = keys.map((_, i) => formatPlaceholder(d, i + 1)).join(', ');
      const returning = returningSql(d, conflict === undefined ? 'insert' : 'upsert', 'INSERTED', ret);
      const insert = `INSERT INTO ${quoteTable(d, table)} (${cols})${returning.output} VALUES (${placeholders})`;
      let text: string;

      if (!conflict) {
        text = insert;
      } else {
        const upsert = dialectTraits(d).upsert;
        if (upsert === 'none') throw new UnsupportedFeatureError('upsert', dialectName(d));
        if (upsert === 'merge') {
          text = mssqlMergeSql(d, table, keys, placeholders, params, conflict, returning);
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
      const returning = returningSql(d, 'update', 'INSERTED', ret);
      const text =
        `UPDATE ${quoteTable(d, table)} SET ${sets}` +
        returning.output +
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
      const returning = returningSql(d, 'delete', 'DELETED', ret);
      const text =
        `DELETE FROM ${quoteTable(d, table)}` + returning.output + whereClause(d, wheres, params) + returning.suffix;
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
    selectFrom: table => makeSelect(dialect, { table, wheres: [], orderBys: [] }, telemetry),
    insertInto: table => makeInsert(dialect, table, undefined, undefined, undefined, telemetry),
    updateTable: table => makeUpdate(dialect, table, undefined, [], undefined, telemetry),
    deleteFrom: table => makeDelete(dialect, table, [], undefined, telemetry),
    callFunction: (name, args) => routineCall(dialect, name, args, 'function'),
    callTableFunction: (name, args) => routineCall(dialect, name, args, 'table-function'),
    callProcedure: (name, args) => routineCall(dialect, name, args, 'procedure'),
  };
}
