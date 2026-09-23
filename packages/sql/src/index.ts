// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { CoreSchema } from '@zmdb/schema';

import type { CompiledQuery } from './compiled-query.js';
import { UNKNOWN_ROW_EFFECTS, UNKNOWN_WRITE_EFFECTS, writeEffects } from './compiled-query.js';
import {
  bindTable,
  mapColumn,
  mapPredicates,
  mapProjection,
  mapRow,
  type QueryBinding,
  type TrustedTable,
} from './query-binding.js';
import type { QueryCompiler, SelectBuilder } from './query-types.js';
import { SelectQuery } from './select-builder.js';
export { trustedTable } from './query-binding.js';
export type { TrustedTable } from './query-binding.js';
export type {
  QueryCompiler,
  SelectBuilder,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
  OnConflictBuilder,
  QueryPredicate,
} from './query-types.js';
import {
  dialectName,
  dialectTraits,
  isSqlDialect,
  type DialectReturningSql,
  type DialectTarget,
  type ReturningStatement,
  type SqlDialect,
} from './dialects/index.js';
// @zmdb/sql — implementation.
import { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
export { QueryCompilerError, UnsupportedFeatureError } from './errors.js';
export type { CompiledQuery, QueryEffects, QueryTelemetry } from './compiled-query.js';
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

import { frozenQuery, queryTelemetry, whereClause, type Predicate } from './clauses.js';
import { emitColumnExpr, isColumnExpr } from './expressions/index.js';
import type { AliasedDistanceExpression } from './extensions/index.js';
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
export { escapeFts5Term } from './clauses.js';
export type { ComparisonPredicate, Predicate, PredicateGroup, JoinCondition, JoinKind } from './clauses.js';

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
  compile(dialect: DialectTarget): string;
}

export type ProjectionItem =
  | string
  | AliasedColumn
  | WindowProjectionNode
  | WindowFunctionBuilder
  | AliasedDistanceExpression;

export type SelectedColumn = ProjectionItem;
export type ReturningColumn = string | AliasedColumn;

export type SubqueryInput =
  | SelectBuilder<unknown>
  | { compile(): CompiledQuery }
  | ((builder: QueryCompiler) => SelectBuilder<unknown> | { compile(): CompiledQuery });

export interface CteSpec {
  readonly name: string;
  readonly subquery: SubqueryInput;
  readonly recursive?: boolean;
}

export function checkDialectCapability(dialect: DialectTarget, feature: string): void {
  if (!isSqlDialect(dialect)) {
    throw new UnsupportedFeatureError(feature, dialectName(dialect));
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

export function renderWindowProjectionNode(
  d: DialectTarget,
  item: WindowProjectionNode | WindowFunctionBuilder,
): string {
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
    compile(d: DialectTarget) {
      return renderWindowProjectionNode(d, node);
    },
  };

  return builder;
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
export { type CommentKey, type CommentKeys, type CommentPairs } from './comments/index.js';

/** Optional compiler features that would otherwise change every query shape. */
export interface QueryCompilerOptions {
  readonly telemetry?: true;
}

interface RuntimeOnConflictBuilder {
  doUpdate(updateFields?: readonly string[] | Record<string, unknown>): RuntimeInsertBuilder;
  doNothing(): RuntimeInsertBuilder;
}

interface RuntimeInsertBuilder {
  values(row: Record<string, unknown>): RuntimeInsertBuilder;
  onConflict(target?: string | readonly string[]): RuntimeOnConflictBuilder;
  returning(cols?: readonly ReturningColumn[]): RuntimeInsertBuilder;
  compile(): CompiledQuery;
}
interface RuntimeUpdateBuilder {
  set(row: Record<string, unknown>): RuntimeUpdateBuilder;
  where(col: string, op: Operator, value: unknown): RuntimeUpdateBuilder;
  orWhere(col: string, op: Operator, value: unknown): RuntimeUpdateBuilder;
  whereGroup(predicates: readonly Predicate[]): RuntimeUpdateBuilder;
  whereIn(col: string, values: readonly unknown[]): RuntimeUpdateBuilder;
  whereNotIn(col: string, values: readonly unknown[]): RuntimeUpdateBuilder;
  returning(cols?: readonly ReturningColumn[]): RuntimeUpdateBuilder;
  compile(): CompiledQuery;
}
interface RuntimeDeleteBuilder {
  where(col: string, op: Operator, value: unknown): RuntimeDeleteBuilder;
  orWhere(col: string, op: Operator, value: unknown): RuntimeDeleteBuilder;
  whereGroup(predicates: readonly Predicate[]): RuntimeDeleteBuilder;
  whereIn(col: string, values: readonly unknown[]): RuntimeDeleteBuilder;
  whereNotIn(col: string, values: readonly unknown[]): RuntimeDeleteBuilder;
  returning(cols?: readonly ReturningColumn[]): RuntimeDeleteBuilder;
  compile(): CompiledQuery;
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
  return frozenQuery(text, args, kind === 'procedure' ? UNKNOWN_WRITE_EFFECTS : UNKNOWN_ROW_EFFECTS);
}

function returningColumns(
  binding: QueryBinding,
  columns: readonly ReturningColumn[] = ['*'],
): readonly ReturningColumn[] {
  const names = binding.names;
  if (names === undefined) return columns;
  return columns.flatMap<ReturningColumn>(column =>
    column === '*' ? names.projection : [mapProjection(binding, column)],
  );
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
  binding: QueryBinding,
  row?: Record<string, unknown>,
  ret?: readonly ReturningColumn[],
  conflict?: ConflictState,
  telemetry = false,
): RuntimeInsertBuilder {
  const table = binding.table;
  const setConflict = (c: ConflictState) => makeInsert(d, binding, row, ret, c, telemetry);
  return {
    values: r => makeInsert(d, binding, mapRow(binding, r), ret, conflict, telemetry),
    returning: cols => makeInsert(d, binding, row, returningColumns(binding, cols), conflict, telemetry),
    onConflict: target => {
      const normTarget = normalizeTarget(target)?.map(column => mapColumn(binding, column));
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
            updateFields: Array.isArray(updateFields)
              ? updateFields.map(column => mapColumn(binding, column))
              : updateFields === undefined
                ? undefined
                : mapRow(binding, updateFields as Record<string, unknown>),
          });
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
      return frozenQuery(
        text,
        params,
        writeEffects('INSERT', ret !== undefined && ret.length > 0),
        queryTelemetry(d, 'INSERT', table, telemetry),
      );
    },
  };
}

function makeUpdate(
  d: DialectTarget,
  binding: QueryBinding,
  row?: Record<string, unknown>,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): RuntimeUpdateBuilder {
  const table = binding.table;
  return {
    set: r => makeUpdate(d, binding, mapRow(binding, r), wheres, ret, telemetry),
    where: (col, op, value) =>
      makeUpdate(
        d,
        binding,
        row,
        [...wheres, { col: mapColumn(binding, col), op, value, connector: 'AND' }],
        ret,
        telemetry,
      ),
    orWhere: (col, op, value) =>
      makeUpdate(
        d,
        binding,
        row,
        [...wheres, { col: mapColumn(binding, col), op, value, connector: 'OR' }],
        ret,
        telemetry,
      ),
    whereGroup: predicates =>
      makeUpdate(
        d,
        binding,
        row,
        [...wheres, { kind: 'group', predicates: mapPredicates(binding, predicates), connector: 'AND' }],
        ret,
        telemetry,
      ),
    whereIn: (col, values) =>
      makeUpdate(
        d,
        binding,
        row,
        [...wheres, { col: mapColumn(binding, col), op: 'in', value: values, connector: 'AND' }],
        ret,
        telemetry,
      ),
    whereNotIn: (col, values) =>
      makeUpdate(
        d,
        binding,
        row,
        [...wheres, { col: mapColumn(binding, col), op: 'not in', value: values, connector: 'AND' }],
        ret,
        telemetry,
      ),
    returning: cols => makeUpdate(d, binding, row, wheres, returningColumns(binding, cols), telemetry),
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
      return frozenQuery(
        text,
        params,
        writeEffects('UPDATE', ret !== undefined && ret.length > 0),
        queryTelemetry(d, 'UPDATE', table, telemetry),
      );
    },
  };
}

function makeDelete(
  d: DialectTarget,
  binding: QueryBinding,
  wheres: readonly Predicate[] = [],
  ret?: readonly ReturningColumn[],
  telemetry = false,
): RuntimeDeleteBuilder {
  const table = binding.table;
  return {
    where: (col, op, value) =>
      makeDelete(
        d,
        binding,
        [...wheres, { col: mapColumn(binding, col), op, value, connector: 'AND' }],
        ret,
        telemetry,
      ),
    orWhere: (col, op, value) =>
      makeDelete(d, binding, [...wheres, { col: mapColumn(binding, col), op, value, connector: 'OR' }], ret, telemetry),
    whereGroup: predicates =>
      makeDelete(
        d,
        binding,
        [...wheres, { kind: 'group', predicates: mapPredicates(binding, predicates), connector: 'AND' }],
        ret,
        telemetry,
      ),
    whereIn: (col, values) =>
      makeDelete(
        d,
        binding,
        [...wheres, { col: mapColumn(binding, col), op: 'in', value: values, connector: 'AND' }],
        ret,
        telemetry,
      ),
    whereNotIn: (col, values) =>
      makeDelete(
        d,
        binding,
        [...wheres, { col: mapColumn(binding, col), op: 'not in', value: values, connector: 'AND' }],
        ret,
        telemetry,
      ),
    returning: cols => makeDelete(d, binding, wheres, returningColumns(binding, cols), telemetry),
    compile: () => {
      const params: unknown[] = [];
      const returning = returningSql(d, 'delete', 'old', ret);
      const text =
        `DELETE FROM ${quoteTable(d, table)}` + returning.inline + whereClause(d, wheres, params) + returning.suffix;
      return frozenQuery(
        text,
        params,
        writeEffects('DELETE', ret !== undefined && ret.length > 0),
        queryTelemetry(d, 'DELETE', table, telemetry),
      );
    },
  };
}

export function createQueryCompiler<Name extends string>(
  dialect: SqlDialect<Name>,
  options?: QueryCompilerOptions,
): QueryCompiler;
export function createQueryCompiler(dialect: DialectTarget, options?: QueryCompilerOptions): QueryCompiler {
  const telemetry = options?.telemetry === true;
  // The declaration type erases here. All public overloads use this one binding and runtime implementation.
  return {
    selectFrom: (target: CoreSchema | TrustedTable, alias?: string) =>
      new SelectQuery(dialect, { binding: bindTable(target, alias) }, telemetry),
    insertInto: (target: CoreSchema | TrustedTable) =>
      makeInsert(dialect, bindTable(target), undefined, undefined, undefined, telemetry),
    updateTable: (target: CoreSchema | TrustedTable) =>
      makeUpdate(dialect, bindTable(target), undefined, [], undefined, telemetry),
    deleteFrom: (target: CoreSchema | TrustedTable) => makeDelete(dialect, bindTable(target), [], undefined, telemetry),
    callFunction: (name: string, args: readonly unknown[]) => routineCall(dialect, name, args, 'function'),
    callTableFunction: (name: string, args: readonly unknown[]) => routineCall(dialect, name, args, 'table-function'),
    callProcedure: (name: string, args: readonly unknown[]) => routineCall(dialect, name, args, 'procedure'),
  } as unknown as QueryCompiler;
}
