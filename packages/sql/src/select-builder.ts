import type { CoreSchema } from '@zmdb/schema';

import {
  frozenQuery,
  havingClause,
  joinClauses,
  queryTelemetry,
  tailClause,
  whereClause,
  type ComparisonPredicate,
  type JoinCondition,
  type JoinKind,
  type JoinSpec,
  type Predicate,
  type RenderPredicate,
} from './clauses.js';
import type { CompiledQuery } from './compiled-query.js';
import { dialectName, dialectTraits, type DialectTarget } from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';
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
import type { AliasedColumn, Direction, Operator } from './index.js';
import {
  bindTable,
  columnBinding,
  mapColumn,
  mapPredicates,
  mapProjection,
  type QueryBinding,
  type TrustedTable,
} from './query-binding.js';
import { qualifyRootColumn, quoteColumn, quoteIdentifier, quoteTable, sanitizeExpression } from './quoting.js';

type SelectedColumn = string | AliasedColumn | AliasedDistanceExpression;
type ResolvedColumn = string | (AliasedColumn & { readonly source?: string }) | AliasedDistanceExpression;
type ComputedColumn =
  | { readonly fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; readonly col: string; readonly alias: string }
  | { readonly raw: string; readonly alias: string; readonly params?: readonly unknown[] | Record<string, unknown> };
interface SelectState {
  readonly binding: QueryBinding;
  readonly columns?: readonly ResolvedColumn[];
  readonly computed?: readonly ComputedColumn[];
  readonly wheres?: readonly RenderPredicate[];
  readonly orderBys?: readonly {
    readonly col: string | DistanceExpression;
    readonly dir: Direction;
    readonly outputAlias?: true;
  }[];
  readonly joins?: readonly JoinSpec[];
  readonly targets?: readonly QueryBinding[];
  readonly ftsJoins?: readonly JoinSpec[];
  readonly groups?: readonly string[];
  readonly havings?: readonly (ComparisonPredicate & { readonly outputAlias?: true })[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

/** Shared prototype methods and sparse immutable state: optional query features allocate only when used. */
export class SelectQuery {
  readonly dialect: DialectTarget;
  private readonly state: SelectState;
  private readonly telemetry: boolean;

  constructor(dialect: DialectTarget, state: SelectState, telemetry: boolean) {
    this.dialect = dialect;
    this.state = state;
    this.telemetry = telemetry;
  }
  private next(patch: Partial<SelectState>): SelectQuery {
    return new SelectQuery(this.dialect, { ...this.state, ...patch }, this.telemetry);
  }
  private column(column: string): string {
    return mapColumn(this.state.binding, column, this.state.targets);
  }
  private projection(column: SelectedColumn): ResolvedColumn {
    if (isAliasedDistanceExpression(column))
      return { ...column, expression: { ...column.expression, column: this.column(column.expression.column) } };
    const resolved = mapProjection(this.state.binding, column, this.state.targets);
    return typeof column === 'string' && typeof resolved === 'object' ? { ...resolved, source: column } : resolved;
  }
  select(columns?: readonly SelectedColumn[]): SelectQuery {
    return columns === undefined ? this : this.next({ columns: columns.map(column => this.projection(column)) });
  }
  private predicate(
    connector: 'AND' | 'OR',
    first: string | SpatialPredicate,
    op?: Operator,
    value?: unknown,
  ): SelectQuery {
    if (isSpatialPredicate(first))
      return this.next({
        wheres: [...(this.state.wheres ?? []), { ...first, col: this.column(first.col), connector }],
      });
    if (op === undefined) throw new TypeError('where(column, operator, value) requires an operator');
    return this.next({ wheres: [...(this.state.wheres ?? []), { col: this.column(first), op, value, connector }] });
  }
  where(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectQuery {
    return this.predicate('AND', first, op, value);
  }
  andWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectQuery {
    return this.predicate('AND', first, op, value);
  }
  orWhere(first: string | SpatialPredicate, op?: Operator, value?: unknown): SelectQuery {
    return this.predicate('OR', first, op, value);
  }
  private group(connector: 'AND' | 'OR', predicates: readonly Predicate[]): SelectQuery {
    return this.next({
      wheres: [
        ...(this.state.wheres ?? []),
        { kind: 'group', predicates: mapPredicates(this.state.binding, predicates, this.state.targets), connector },
      ],
    });
  }
  whereGroup(predicates: readonly Predicate[]): SelectQuery {
    return this.group('AND', predicates);
  }
  orWhereGroup(predicates: readonly Predicate[]): SelectQuery {
    return this.group('OR', predicates);
  }
  whereIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.where(col, 'in', values);
  }
  andWhereIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.where(col, 'in', values);
  }
  orWhereIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.orWhere(col, 'in', values);
  }
  whereNotIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.where(col, 'not in', values);
  }
  andWhereNotIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.where(col, 'not in', values);
  }
  orWhereNotIn(col: string, values: readonly unknown[]): SelectQuery {
    return this.orWhere(col, 'not in', values);
  }
  whereExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.where('', 'EXISTS', query);
  }
  andWhereExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.whereExists(query);
  }
  orWhereExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.orWhere('', 'EXISTS', query);
  }
  whereNotExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.where('', 'NOT EXISTS', query);
  }
  andWhereNotExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.whereNotExists(query);
  }
  orWhereNotExists(query: { compile(): CompiledQuery }): SelectQuery {
    return this.orWhere('', 'NOT EXISTS', query);
  }
  private outputAlias(column: string): boolean {
    return (
      this.state.computed?.some(item => item.alias === column) === true ||
      this.state.columns?.some(item => typeof item === 'object' && item.alias === column && !('source' in item)) ===
        true
    );
  }
  orderBy(column: string | DistanceExpression, dir: Direction): SelectQuery {
    const outputAlias = typeof column === 'string' && this.outputAlias(column);
    const col = isDistanceExpression(column)
      ? { ...column, column: this.column(column.column) }
      : outputAlias
        ? column
        : this.column(column);
    return this.next({
      orderBys: [...(this.state.orderBys ?? []), { col, dir, ...(outputAlias ? { outputAlias: true as const } : {}) }],
    });
  }
  limit(n: number): SelectQuery {
    return this.next({ limitN: n });
  }
  offset(n: number): SelectQuery {
    return this.next({ offsetN: n });
  }
  private join(
    kind: JoinKind,
    target: CoreSchema | TrustedTable,
    alias: string,
    conditions: readonly JoinCondition[],
    on?: readonly Predicate[],
  ): SelectQuery {
    const binding = bindTable(target, alias);
    if (conditions.length === 0) throw new RangeError(`join "${binding.table}" needs at least one ON condition`);
    if (
      (this.state.binding.alias ?? this.state.binding.name) === alias ||
      this.state.targets?.some(item => (item.alias ?? item.name) === alias)
    )
      throw new TypeError(`duplicate query table alias ${JSON.stringify(alias)}`);
    const targets = [...(this.state.targets ?? []), binding];
    const mapped = conditions.map(condition => ({
      leftCol: mapColumn(this.state.binding, condition.leftCol, targets),
      rightCol: mapColumn(this.state.binding, condition.rightCol, targets),
    }));
    return this.next({
      targets,
      joins: [
        ...(this.state.joins ?? []),
        {
          kind,
          target: binding.table,
          conditions: mapped,
          ...(on === undefined ? {} : { on: mapPredicates(this.state.binding, on, targets) }),
        },
      ],
    });
  }
  innerJoin(
    target: CoreSchema | TrustedTable,
    alias: string,
    conditions: readonly JoinCondition[],
    on?: readonly Predicate[],
  ): SelectQuery {
    return this.join('inner', target, alias, conditions, on);
  }
  leftJoin(
    target: CoreSchema | TrustedTable,
    alias: string,
    conditions: readonly JoinCondition[],
    on?: readonly Predicate[],
  ): SelectQuery {
    return this.join('left', target, alias, conditions, on);
  }
  rightJoin(
    target: CoreSchema | TrustedTable,
    alias: string,
    conditions: readonly JoinCondition[],
    on?: readonly Predicate[],
  ): SelectQuery {
    return this.join('right', target, alias, conditions, on);
  }
  private aggregate(fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX', col: string, alias: string): SelectQuery {
    return this.next({ computed: [...(this.state.computed ?? []), { fn, col: this.column(col), alias }] });
  }
  count(col: string, alias: string): SelectQuery {
    return this.aggregate('COUNT', col, alias);
  }
  sum(col: string, alias: string): SelectQuery {
    return this.aggregate('SUM', col, alias);
  }
  avg(col: string, alias: string): SelectQuery {
    return this.aggregate('AVG', col, alias);
  }
  min(col: string, alias: string): SelectQuery {
    return this.aggregate('MIN', col, alias);
  }
  max(col: string, alias: string): SelectQuery {
    return this.aggregate('MAX', col, alias);
  }
  expr(raw: string, alias: string, params?: readonly unknown[] | Record<string, unknown>): SelectQuery {
    const entry: ComputedColumn = params !== undefined ? { raw, alias, params } : { raw, alias };
    return this.next({ computed: [...(this.state.computed ?? []), entry] });
  }
  groupBy(...columns: string[]): SelectQuery {
    if (columns.length === 0) return this;
    return this.next({ groups: [...(this.state.groups ?? []), ...columns.map(column => this.column(column))] });
  }
  having(column: string, op: Operator, value: unknown): SelectQuery {
    const outputAlias = this.outputAlias(column);
    return this.next({
      havings: [
        ...(this.state.havings ?? []),
        {
          col: outputAlias ? column : this.column(column),
          op,
          value,
          ...(outputAlias ? { outputAlias: true as const } : {}),
        },
      ],
    });
  }
  whereMatch(column: string, term: string): SelectQuery {
    let col = this.column(column);
    let ftsJoins = this.state.ftsJoins;
    if (dialectTraits(this.dialect).fts === 'companionTable') {
      const binding = columnBinding(this.state.binding, this.state.targets, column);
      if (!binding.ftsTable) throw new UnsupportedFeatureError('full-text search', dialectName(this.dialect));
      const table = typeof binding.ftsTable === 'string' ? binding.ftsTable : `${binding.table.split(' ')[0]}_fts`;
      const reference = binding.alias ? `${binding.alias}_fts` : table;
      const target = binding.alias ? `${table} AS ${reference}` : table;
      col = `${reference}.${col.slice(col.lastIndexOf('.') + 1)}`;
      if (!ftsJoins?.some(join => join.target === target))
        ftsJoins = [
          ...(ftsJoins ?? []),
          {
            kind: 'inner',
            target,
            conditions: [{ leftCol: `${binding.reference}.rowid`, rightCol: `${reference}.rowid` }],
          },
        ];
    }
    return this.next({
      wheres: [...(this.state.wheres ?? []), { kind: 'match', col, value: term }],
      ...(ftsJoins === undefined ? {} : { ftsJoins }),
    });
  }
  private computedSql(
    item: ComputedColumn,
    rootReference?: string,
    startingParamIndex = 0,
  ): { text: string; parameters: readonly unknown[] } {
    if ('raw' in item) {
      const sanitized = sanitizeExpression(item.raw, this.dialect, item.params, startingParamIndex);
      return { text: sanitized.text, parameters: sanitized.parameters };
    }
    return {
      text: item.fn + '(' + quoteColumn(this.dialect, qualifyRootColumn(item.col, rootReference)) + ')',
      parameters: [],
    };
  }
  private distanceSql(expression: DistanceExpression, params: unknown[], rootReference?: string): string {
    return renderDistanceExpression(
      this.dialect,
      rootReference === undefined
        ? expression
        : { ...expression, column: qualifyRootColumn(expression.column, rootReference) },
      params,
    );
  }
  compile(): CompiledQuery {
    const state = this.state;
    const dialect = this.dialect;
    const params: unknown[] = [];
    // Schema mapping established ownership at fluent input; the final SELECT context decides qualification.
    // A later ordinary or generated FTS join therefore also qualifies earlier root references.
    const rootReference =
      state.binding.names !== undefined && (state.joins !== undefined || state.ftsJoins !== undefined)
        ? state.binding.reference
        : undefined;
    let columns = state.columns;
    if (
      (columns === undefined || columns.length === 0) &&
      state.computed === undefined &&
      state.binding.names !== undefined
    ) {
      const defaults = state.binding.names.projection;
      columns =
        rootReference === undefined
          ? defaults
          : defaults.map(column =>
              typeof column === 'string'
                ? { column: `${state.binding.reference}.${column}`, alias: column }
                : { ...column, column: `${state.binding.reference}.${column.column}` },
            );
    }
    const projections = (columns ?? []).map(column =>
      isAliasedDistanceExpression(column)
        ? rootReference === undefined
          ? renderAliasedDistanceExpression(dialect, column, params)
          : `${this.distanceSql(column.expression, params, rootReference)} AS ${quoteIdentifier(dialect, column.alias)}`
        : typeof column === 'object'
          ? `${quoteColumn(dialect, qualifyRootColumn(column.column, rootReference))} AS ${quoteIdentifier(dialect, column.alias)}`
          : quoteColumn(dialect, qualifyRootColumn(column, rootReference)),
    );
    if (state.computed !== undefined)
      for (const item of state.computed) {
        const comp = this.computedSql(item, rootReference, params.length);
        params.push(...comp.parameters);
        projections.push(`${comp.text} AS ${quoteIdentifier(dialect, item.alias)}`);
      }
    const joins = state.joins === undefined ? '' : joinClauses(dialect, state.joins, params, rootReference);
    const ftsJoins = state.ftsJoins === undefined ? '' : joinClauses(dialect, state.ftsJoins, params, rootReference);
    const where = state.wheres === undefined ? '' : whereClause(dialect, state.wheres, params, rootReference);
    const group =
      state.groups === undefined
        ? ''
        : ` GROUP BY ${state.groups.map(col => quoteColumn(dialect, qualifyRootColumn(col, rootReference))).join(', ')}`;
    let having = '';
    if (state.havings !== undefined) {
      const expressions = new Map<string, string>();
      if (state.computed !== undefined)
        for (const item of state.computed) expressions.set(item.alias, this.computedSql(item, rootReference).text);
      if (state.columns !== undefined)
        for (const item of state.columns)
          if (typeof item === 'object' && !isAliasedDistanceExpression(item))
            expressions.set(item.alias, quoteColumn(dialect, qualifyRootColumn(item.column, rootReference)));
      having = havingClause(
        dialect,
        rootReference === undefined
          ? state.havings
          : state.havings.map(predicate =>
              predicate.outputAlias === true
                ? predicate
                : { ...predicate, col: qualifyRootColumn(predicate.col, rootReference) },
            ),
        params,
        expressions,
      );
    }
    const order =
      state.orderBys === undefined
        ? ''
        : ` ORDER BY ${state.orderBys.map(item => `${isDistanceExpression(item.col) ? this.distanceSql(item.col, params, rootReference) : quoteColumn(dialect, item.outputAlias === true ? item.col : qualifyRootColumn(item.col, rootReference))} ${item.dir.toUpperCase()}`).join(', ')}`;
    const text =
      `SELECT ${projections.length ? projections.join(', ') : '*'} FROM ${quoteTable(dialect, state.binding.table)}` +
      joins +
      ftsJoins +
      where +
      group +
      having +
      order +
      tailClause(dialect, { limitN: state.limitN, offsetN: state.offsetN, ordered: state.orderBys !== undefined });
    return frozenQuery(text, params, queryTelemetry(dialect, 'SELECT', state.binding.table, this.telemetry));
  }
}
