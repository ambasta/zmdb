import type { CompiledQuery } from './compiled-query.js';
// @zmdb/query-compiler — implementation.
import {
  dialectName,
  dialectTraits,
  type DialectReturningSql,
  type DialectTarget,
  type ReturningStatement,
  type SqlDialect,
} from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';

export { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
export type { CompiledQuery, QueryTelemetry } from './compiled-query.js';
export {
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
  DialectCompiler,
  DialectFeature,
  DialectOutbox,
  DialectReturningColumn,
  DialectReturningContext,
  DialectReturningSql,
  DialectSqlType,
  DialectTarget,
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
  ReturningCapability,
  ReturningStatement,
  ReturningStyle,
  SchemaObjectOperation,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
} from './dialects/index.js';
export type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
  TableOptions,
  TableSnapshot,
} from './migrations/types.js';
export type {
  CatalogColumnSnapshot,
  CatalogForeignKeySnapshot,
  CatalogIndexColumn,
  CatalogIndexSnapshot,
  CatalogSchemaSnapshot,
  CatalogSelection,
  CatalogTableSnapshot,
  CatalogWarning,
} from './introspect/types.js';

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

type SelectedColumn = string | AliasedColumn | AliasedDistanceExpression;
type ReturningColumn = string | AliasedColumn;

function isAliasedColumn(column: SelectedColumn | ReturningColumn): column is AliasedColumn {
  return typeof column === 'object' && 'column' in column && 'alias' in column;
}

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
  readonly table: string;
  readonly columns?: readonly SelectedColumn[];
  readonly wheres: readonly Predicate[];
  readonly orderBys: readonly { col: string | DistanceExpression; dir: Direction }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

// ---------------------------------------------------------------------------
// Type-bounded schema helpers
// ---------------------------------------------------------------------------

export type Col<S> = S extends { columns: infer C }
  ? keyof C & string
  : [keyof S] extends [never]
    ? string
    : string extends keyof S
      ? string
      : keyof S & string;

export type Val<S, K extends string> = K extends keyof S ? S[K] : unknown;

export type ValueForOp<V, O extends string> = O extends 'in' | 'nin' | 'IN' | 'NOT IN' | 'not in'
  ? readonly V[] | SelectBuilder<unknown> | { compile(): CompiledQuery }
  : O extends 'like' | 'ilike' | 'LIKE' | 'ILIKE'
    ? string
    : O extends 'is null' | 'is not null' | 'IS NULL' | 'IS NOT NULL'
      ? null | undefined | unknown
      : V | SelectBuilder<unknown> | { compile(): CompiledQuery };

export interface SelectBuilder<S = unknown> {
  select<
    K extends Col<S> | '*' | AliasedColumn | AliasedDistanceExpression =
      | Col<S>
      | '*'
      | AliasedColumn
      | AliasedDistanceExpression,
  >(
    columns?: readonly K[],
  ): SelectBuilder<S>;
  where(predicate: SpatialPredicate): SelectBuilder<S>;
  where<K extends Col<S>, O extends Operator = '='>(col: K, op: O, value: ValueForOp<Val<S, K>, O>): SelectBuilder<S>;
  andWhere(predicate: SpatialPredicate): SelectBuilder<S>;
  andWhere<K extends Col<S>, O extends Operator = '='>(
    col: K,
    op: O,
    value: ValueForOp<Val<S, K>, O>,
  ): SelectBuilder<S>;
  orWhere(predicate: SpatialPredicate): SelectBuilder<S>;
  orWhere<K extends Col<S>, O extends Operator = '='>(col: K, op: O, value: ValueForOp<Val<S, K>, O>): SelectBuilder<S>;
  whereGroup(predicates: readonly ComparisonPredicate[]): SelectBuilder<S>;
  orWhereGroup(predicates: readonly ComparisonPredicate[]): SelectBuilder<S>;
  whereIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  andWhereIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  orWhereIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  whereNotIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  andWhereNotIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  orWhereNotIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): SelectBuilder<S>;
  whereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  andWhereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  orWhereExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  whereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  andWhereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  orWhereNotExists(subquery: SelectBuilder<unknown> | { compile(): CompiledQuery }): SelectBuilder<S>;
  orderBy<K extends Col<S> | DistanceExpression = Col<S> | DistanceExpression>(
    col: K,
    dir: Direction,
  ): SelectBuilder<S>;
  limit(n: number): SelectBuilder<S>;
  offset(n: number): SelectBuilder<S>;
  compile(): CompiledQuery;
  readonly dialect: DialectTarget;
  readonly _type?: S;
}

function makeSelect<S = unknown>(d: DialectTarget, state: SelectState, telemetry = false): SelectBuilder<S> {
  const next = (patch: Partial<SelectState>): SelectBuilder<S> => makeSelect<S>(d, { ...state, ...patch }, telemetry);
  const addWhere = (connector: 'AND' | 'OR', col: string, op: Operator, value: unknown) =>
    next({ wheres: [...state.wheres, { col, op, value, connector }] });
  const addSpatial = (connector: 'AND' | 'OR', predicate: SpatialPredicate) =>
    next({ wheres: [...state.wheres, { ...predicate, connector }] });
  const addGroup = (connector: 'AND' | 'OR', predicates: readonly ComparisonPredicate[]) =>
    next({ wheres: [...state.wheres, { kind: 'group', predicates, connector } satisfies PredicateGroup] });

  function where(predicate: SpatialPredicate): SelectBuilder<S>;
  function where(col: string, op: Operator, value: unknown): SelectBuilder<S>;
  function where(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<S> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('where(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function andWhere(predicate: SpatialPredicate): SelectBuilder<S>;
  function andWhere(col: string, op: Operator, value: unknown): SelectBuilder<S>;
  function andWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<S> {
    if (isSpatialPredicate(first)) return addSpatial('AND', first);
    if (op === undefined) throw new TypeError('andWhere(column, operator, value) requires an operator');
    return addWhere('AND', first, op, value);
  }

  function orWhere(predicate: SpatialPredicate): SelectBuilder<S>;
  function orWhere(col: string, op: Operator, value: unknown): SelectBuilder<S>;
  function orWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectBuilder<S> {
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
    compile: () => {
      const params: unknown[] = [];
      const cols =
        state.columns && state.columns.length > 0
          ? state.columns
              .map(column =>
                isAliasedColumn(column)
                  ? `${quoteColumn(d, column.column)} AS ${quoteIdentifier(d, column.alias)}`
                  : isAliasedDistanceExpression(column)
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

export interface OnConflictBuilder<S = unknown, I = S> {
  doUpdate(updateFields?: readonly Col<S>[] | unknown): InsertBuilder<S, I>;
  doNothing(): InsertBuilder<S, I>;
}

export interface InsertBuilder<S = unknown, I = S> {
  values(row: I): InsertBuilder<S, I>;
  onConflict(target?: Col<S> | readonly Col<S>[] | readonly string[]): OnConflictBuilder<S, I>;
  returning<K extends Col<S> | '*' | ReturningColumn = Col<S> | '*' | ReturningColumn>(
    cols?: readonly K[],
  ): InsertBuilder<S, I>;
  compile(): CompiledQuery;
}

export interface UpdateBuilder<S = unknown, U = S> {
  set(row: U): UpdateBuilder<S, U>;
  where<K extends Col<S>, O extends Operator = '='>(
    col: K,
    op: O,
    value: ValueForOp<Val<S, K>, O>,
  ): UpdateBuilder<S, U>;
  orWhere<K extends Col<S>, O extends Operator = '='>(
    col: K,
    op: O,
    value: ValueForOp<Val<S, K>, O>,
  ): UpdateBuilder<S, U>;
  whereGroup(predicates: readonly ComparisonPredicate[]): UpdateBuilder<S, U>;
  whereIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): UpdateBuilder<S, U>;
  whereNotIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): UpdateBuilder<S, U>;
  returning<K extends Col<S> | '*' | ReturningColumn = Col<S> | '*' | ReturningColumn>(
    cols?: readonly K[],
  ): UpdateBuilder<S, U>;
  compile(): CompiledQuery;
}

export interface DeleteBuilder<S = unknown> {
  where<K extends Col<S>, O extends Operator = '='>(col: K, op: O, value: ValueForOp<Val<S, K>, O>): DeleteBuilder<S>;
  orWhere<K extends Col<S>, O extends Operator = '='>(col: K, op: O, value: ValueForOp<Val<S, K>, O>): DeleteBuilder<S>;
  whereGroup(predicates: readonly ComparisonPredicate[]): DeleteBuilder<S>;
  whereIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): DeleteBuilder<S>;
  whereNotIn<K extends Col<S>>(col: K, values: readonly Val<S, K>[]): DeleteBuilder<S>;
  returning<K extends Col<S> | '*' | ReturningColumn = Col<S> | '*' | ReturningColumn>(
    cols?: readonly K[],
  ): DeleteBuilder<S>;
  compile(): CompiledQuery;
}

export interface QueryCompiler<S = unknown> {
  selectFrom<T = S>(table: string): SelectBuilder<T>;
  insertInto<T = S, I = T>(table: string): InsertBuilder<T, I>;
  updateTable<T = S, U = T>(table: string): UpdateBuilder<T, U>;
  deleteFrom<T = S>(table: string): DeleteBuilder<T>;
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

function makeInsert<S = unknown, I = S>(
  d: DialectTarget,
  table: string,
  row?: I,
  ret?: readonly ReturningColumn[],
  conflict?: ConflictState,
  telemetry = false,
): InsertBuilder<S, I> {
  const setConflict = (c: ConflictState) => makeInsert<S, I>(d, table, row, ret, c, telemetry);
  return {
    values: r => makeInsert<S, I>(d, table, r, ret, conflict, telemetry),
    returning: cols => makeInsert<S, I>(d, table, row, cols ?? [], conflict, telemetry),
    onConflict: target => {
      const normTarget = normalizeTarget(target);
      return {
        doUpdate: updateFields => {
          if (Array.isArray(updateFields) && updateFields.length === 0) {
            throw new Error(
              'Empty updateFields array is not allowed in doUpdate(). Omit updateFields (or pass undefined) to update all non-target columns, or use doNothing().',
            );
          }
          return setConflict({
            action: 'update',
            target: normTarget,
            // boundary: type-bounded query builder options bridge
            updateFields: updateFields as readonly string[] | Record<string, unknown> | undefined,
          });
        },
        doNothing: () => setConflict({ action: 'ignore', target: normTarget }),
      };
    },
    compile: () => {
      if (!row) throw new Error('insertInto requires values()');
      // boundary: type-bounded insert row object keys
      const rowObj = row as Record<string, unknown>;
      const keys = Object.keys(rowObj);
      const params = keys.map(k => rowObj[k]);
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
            // boundary: type-bounded conflict update fields
            setSql = Object.entries(conflict.updateFields as Record<string, unknown>)
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

function makeUpdate<S = unknown, U = S>(
  d: DialectTarget,
  table: string,
  row?: U,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): UpdateBuilder<S, U> {
  return {
    set: r => makeUpdate<S, U>(d, table, r, wheres, ret, telemetry),
    where: (col, op, value) =>
      makeUpdate<S, U>(d, table, row, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) =>
      makeUpdate<S, U>(d, table, row, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereGroup: predicates =>
      makeUpdate<S, U>(d, table, row, [...wheres, { kind: 'group', predicates, connector: 'AND' }], ret, telemetry),
    whereIn: (col, values) =>
      makeUpdate<S, U>(d, table, row, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret, telemetry),
    whereNotIn: (col, values) =>
      makeUpdate<S, U>(
        d,
        table,
        row,
        [...wheres, { col, op: 'not in', value: values, connector: 'AND' }],
        ret,
        telemetry,
      ),
    returning: cols => makeUpdate<S, U>(d, table, row, wheres, cols ?? [], telemetry),
    compile: () => {
      if (!row) throw new Error('updateTable requires set()');
      const params: unknown[] = [];
      // boundary: type-bounded update row object keys
      const rowObj = row as Record<string, unknown>;
      const sets = Object.keys(rowObj)
        .map(k => `${quoteIdentifier(d, k)} = ${setValueSql(d, table, k, rowObj[k], params, 'update')}`)
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

function makeDelete<S = unknown>(
  d: DialectTarget,
  table: string,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): DeleteBuilder<S> {
  return {
    where: (col, op, value) =>
      makeDelete<S>(d, table, [...wheres, { col, op, value, connector: 'AND' }], ret, telemetry),
    orWhere: (col, op, value) =>
      makeDelete<S>(d, table, [...wheres, { col, op, value, connector: 'OR' }], ret, telemetry),
    whereGroup: predicates =>
      makeDelete<S>(d, table, [...wheres, { kind: 'group', predicates, connector: 'AND' }], ret, telemetry),
    whereIn: (col, values) =>
      makeDelete<S>(d, table, [...wheres, { col, op: 'in', value: values, connector: 'AND' }], ret, telemetry),
    whereNotIn: (col, values) =>
      makeDelete<S>(d, table, [...wheres, { col, op: 'not in', value: values, connector: 'AND' }], ret, telemetry),
    returning: cols => makeDelete<S>(d, table, wheres, cols ?? [], telemetry),
    compile: () => {
      const params: unknown[] = [];
      const returning = returningSql(d, 'delete', 'old', ret);
      const text =
        `DELETE FROM ${quoteTable(d, table)}` + returning.inline + whereClause(d, wheres, params) + returning.suffix;
      return frozenQuery(text, params, queryTelemetry(d, 'DELETE', table, telemetry));
    },
  };
}

export function createQueryCompiler<Name extends string, S = unknown>(
  dialect: SqlDialect<Name>,
  options?: QueryCompilerOptions,
): QueryCompiler<S>;
export function createQueryCompiler<S = unknown>(
  dialect: DialectTarget,
  options?: QueryCompilerOptions,
): QueryCompiler<S>;
export function createQueryCompiler<S = unknown>(
  dialect: DialectTarget,
  options?: QueryCompilerOptions,
): QueryCompiler<S> {
  const telemetry = options?.telemetry === true;
  return {
    selectFrom: <T = S>(table: string) => makeSelect<T>(dialect, { table, wheres: [], orderBys: [] }, telemetry),
    insertInto: <T = S, I = T>(table: string) =>
      makeInsert<T, I>(dialect, table, undefined, undefined, undefined, telemetry),
    updateTable: <T = S, U = T>(table: string) => makeUpdate<T, U>(dialect, table, undefined, [], undefined, telemetry),
    deleteFrom: <T = S>(table: string) => makeDelete<T>(dialect, table, [], undefined, telemetry),
    callFunction: (name, args) => routineCall(dialect, name, args, 'function'),
    callTableFunction: (name, args) => routineCall(dialect, name, args, 'table-function'),
    callProcedure: (name, args) => routineCall(dialect, name, args, 'procedure'),
  };
}
