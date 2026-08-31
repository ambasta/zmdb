import {
  type ComparisonPredicate,
  type JoinCondition,
  type JoinSpec,
  type Predicate,
  frozenQuery,
  havingClause,
  joinClauses,
  joinMethods,
  queryTelemetry,
  tailClause,
  tailMethods,
  whereClause,
} from '../clauses.js';
import type { DialectTarget } from '../dialects/index.js';
import type { CompiledQuery, QueryCompilerOptions } from '../index.js';
import { quoteColumn, quoteIdentifier, quoteTable } from '../quoting.js';

export type { JoinCondition, JoinKind } from '../clauses.js';


type SelectItem =
  | { kind: 'col'; col: string }
  | { kind: 'agg'; fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; col: string; alias: string }
  | { kind: 'expr'; raw: string; alias: string };

interface Comparison {
  col: string;
  op: string;
  value: unknown;
  connector?: 'AND' | 'OR';
}

interface State {
  readonly table: string;
  readonly items: readonly SelectItem[];
  readonly joins: readonly JoinSpec[];
  readonly wheres: readonly Predicate[];
  readonly groups: readonly string[];
  readonly havings: readonly Comparison[];
  readonly orderBys: readonly { col: string; dir: 'asc' | 'desc' }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

function resolveColAlias(a: string, b?: string, defaultCol = a) {
  if (b === undefined) return { col: defaultCol, alias: a };
  const isColA = a.includes('.') || ['id', 'quantity', 'qty', 'amount', 'unit_price', 'total_price'].includes(a);
  if (isColA) {
    return { col: a, alias: b };
  }
  return { col: b, alias: a };
}

export interface AggregateSelect {
  selectFrom(table: string): AggregateSelect;
  select(cols: readonly string[]): AggregateSelect;
  count(a: string, b?: string): AggregateSelect;
  sum(a: string, b?: string): AggregateSelect;
  avg(a: string, b?: string): AggregateSelect;
  min(a: string, b?: string): AggregateSelect;
  max(a: string, b?: string): AggregateSelect;
  expr(rawExpr: string, alias: string): AggregateSelect;
  innerJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): AggregateSelect;
  innerJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): AggregateSelect;
  leftJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): AggregateSelect;
  leftJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): AggregateSelect;
  rightJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): AggregateSelect;
  rightJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): AggregateSelect;
  where(col: string, op: string, value: unknown): AggregateSelect;
  orWhere(col: string, op: string, value: unknown): AggregateSelect;
  whereGroup(predicates: readonly ComparisonPredicate[]): AggregateSelect;
  groupBy(...cols: string[]): AggregateSelect;
  having(col: string, op: string, value: unknown): AggregateSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): AggregateSelect;
  limit(n: number): AggregateSelect;
  offset(n: number): AggregateSelect;
  compile(): CompiledQuery;
}

function make(d: DialectTarget, s: State, telemetry: boolean): AggregateSelect {
  const next = (p: Partial<State>): AggregateSelect => make(d, { ...s, ...p }, telemetry);
  const agg = (fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX', col: string, alias: string) =>
    next({ items: [...s.items, { kind: 'agg', fn, col, alias }] });

  return {
    selectFrom: table => next({ table }),
    ...joinMethods(s.joins, next),
    ...tailMethods(s, next),
    select: cols => next({ items: [...s.items, ...cols.map((c): SelectItem => ({ kind: 'col', col: c }))] }),
    count: (a, b) => {
      const { col, alias } = resolveColAlias(a, b, '*');
      return agg('COUNT', col, alias);
    },
    sum: (a, b) => {
      const { col, alias } = resolveColAlias(a, b);
      return agg('SUM', col, alias);
    },
    avg: (a, b) => {
      const { col, alias } = resolveColAlias(a, b);
      return agg('AVG', col, alias);
    },
    min: (a, b) => {
      const { col, alias } = resolveColAlias(a, b);
      return agg('MIN', col, alias);
    },
    max: (a, b) => {
      const { col, alias } = resolveColAlias(a, b);
      return agg('MAX', col, alias);
    },
    expr: (raw, alias) => next({ items: [...s.items, { kind: 'expr', raw, alias }] }),
    where: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value, connector: 'AND' }] }),
    orWhere: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value, connector: 'OR' }] }),
    whereGroup: predicates => next({ wheres: [...s.wheres, { kind: 'group', predicates, connector: 'AND' }] }),
    groupBy: (...cols) => next({ groups: [...s.groups, ...cols] }),
    having: (col, op, value) => next({ havings: [...s.havings, { col, op, value }] }),
    compile: () => {
      const params: unknown[] = [];
      const cols = s.items.map(it => {
        if (it.kind === 'col') {
          const m = /^(\S+)\s+as\s+(\S+)$/i.exec(it.col.trim());
          if (m && m[1] && m[2]) return `${quoteColumn(d, m[1])} AS ${quoteIdentifier(d, m[2])}`;
          if (it.col.includes('.') && !it.col.toLowerCase().startsWith(`${s.table.toLowerCase()}.`)) {
            return `${quoteColumn(d, it.col)} AS ${quoteIdentifier(d, it.col)}`;
          }
          return quoteColumn(d, it.col);
        }
        if (it.kind === 'agg') return `${it.fn}(${quoteColumn(d, it.col)}) AS ${quoteIdentifier(d, it.alias)}`;
        return `${it.raw} AS ${quoteIdentifier(d, it.alias)}`;
      });
      const groupBy = s.groups.length > 0 ? ` GROUP BY ${s.groups.map(c => quoteColumn(d, c)).join(', ')}` : '';
      const text =
        `SELECT ${cols.join(', ')} FROM ${quoteTable(d, s.table)}` +
        joinClauses(d, s.joins, params) +
        whereClause(d, s.wheres, params) +
        groupBy +
        havingClause(d, s.havings, params) +
        tailClause(d, s);
      return frozenQuery(text, params, queryTelemetry(d, 'SELECT', s.table, telemetry));
    },
  };
}

export function aggregateSelectFrom(
  table: string,
  dialect: DialectTarget = 'postgres',
  options?: QueryCompilerOptions,
): AggregateSelect {
  return make(
    dialect,
    { table, items: [], joins: [], wheres: [], groups: [], havings: [], orderBys: [] },
    options?.telemetry === true,
  );
}

export function count(col = '*'): (b: AggregateSelect, alias: string) => AggregateSelect {
  return (b, alias) => b.count(alias, col);
}
export function sum(col: string): (b: AggregateSelect, alias: string) => AggregateSelect {
  return (b, alias) => b.sum(alias, col);
}
export function avg(col: string): (b: AggregateSelect, alias: string) => AggregateSelect {
  return (b, alias) => b.avg(alias, col);
}
export function min(col: string): (b: AggregateSelect, alias: string) => AggregateSelect {
  return (b, alias) => b.min(alias, col);
}
export function max(col: string): (b: AggregateSelect, alias: string) => AggregateSelect {
  return (b, alias) => b.max(alias, col);
}
