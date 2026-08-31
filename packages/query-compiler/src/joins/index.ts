import {
  type ComparisonPredicate,
  type JoinCondition,
  type JoinSpec,
  type Predicate,
  frozenQuery,
  joinClauses,
  joinMethods,
  queryTelemetry,
  tailClause,
  tailMethods,
  whereClause,
} from '../clauses.js';
import type { DialectTarget } from '../dialects/index.js';
import type { CompiledQuery, Operator, QueryCompilerOptions } from '../index.js';
import { quoteTable } from '../quoting.js';

export type { JoinCondition, JoinKind } from '../clauses.js';

interface State {
  readonly table: string;
  readonly joins: readonly JoinSpec[];
  readonly wheres: readonly Predicate[];
  readonly orderBys: readonly { col: string; dir: 'asc' | 'desc' }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

export interface JoinableSelect {
  innerJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): JoinableSelect;
  innerJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): JoinableSelect;
  leftJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): JoinableSelect;
  leftJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): JoinableSelect;
  rightJoin(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): JoinableSelect;
  rightJoin(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): JoinableSelect;
  where(col: string, op: Operator, value: unknown): JoinableSelect;
  whereGroup(predicates: readonly ComparisonPredicate[]): JoinableSelect;
  orderBy(col: string, dir: 'asc' | 'desc'): JoinableSelect;
  limit(n: number): JoinableSelect;
  offset(n: number): JoinableSelect;
  compile(): CompiledQuery;
}

function make(d: DialectTarget, s: State, telemetry: boolean): JoinableSelect {
  const next = (patch: Partial<State>): JoinableSelect => make(d, { ...s, ...patch }, telemetry);
  return {
    ...joinMethods(s.joins, next),
    ...tailMethods(s, next),
    where: (col, op, value) => next({ wheres: [...s.wheres, { col, op, value }] }),
    whereGroup: predicates => next({ wheres: [...s.wheres, { kind: 'group', predicates, connector: 'AND' }] }),
    compile: () => {
      const params: unknown[] = [];
      const text =
        `SELECT * FROM ${quoteTable(d, s.table)}` +
        joinClauses(d, s.joins, params) +
        whereClause(d, s.wheres, params) +
        tailClause(d, s);
      return frozenQuery(text, params, queryTelemetry(d, 'SELECT', s.table, telemetry));
    },
  };
}

export function joinableSelectFrom(
  table: string,
  dialect: DialectTarget = 'postgres',
  options?: QueryCompilerOptions,
): JoinableSelect {
  return make(dialect, { table, joins: [], wheres: [], orderBys: [] }, options?.telemetry === true);
}
