// Clause rendering shared by every builder in this package.
//
// SELECT, the join builder, the aggregate builder, FTS, UPDATE and DELETE all
// have to turn the same three things into SQL: a predicate list, a join list,
// and the ORDER BY / LIMIT / OFFSET tail. Each builder used to carry its own
// copy, and the copies had drifted: the aggregate builder's `having` understood
// a subquery but its `where` pushed the builder object into the parameter list
// as if it were a value, and three of them reimplemented `renumberPlaceholders`
// inline rather than importing the one in ./quoting.ts.
//
// Everything here appends its own leading space and returns '' when it has
// nothing to render, so callers concatenate unconditionally.
import { dialectFamily, dialectName, dialectTraits, type DialectTarget } from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';
import {
  DISTANCE_OPERATORS,
  encodePgVector,
  isDistanceOp,
  renderSpatialPredicate,
  requirePostgres,
  type SpatialPredicateNode,
} from './extensions/index.js';
import type { CompiledQuery, QueryTelemetry } from './index.js';
import { formatPlaceholder, quoteColumn, quoteTable, renumberPlaceholders, unaliasedTable } from './quoting.js';

export type JoinKind = 'inner' | 'left' | 'right';

export interface JoinCondition {
  readonly leftCol: string;
  readonly rightCol: string;
}

export interface JoinSpec {
  readonly kind: JoinKind;
  readonly target: string;
  readonly conditions: readonly JoinCondition[];
  /** Predicates that belong to this target and therefore stay in the ON clause. */
  readonly on?: readonly Predicate[];
}

/**
 * One comparison in a WHERE or HAVING list. `connector` says how it attaches to
 * the predicate before it and is ignored on the first one; builders that only
 * ever conjoin can leave it out.
 */
export interface ComparisonPredicate {
  readonly kind?: 'comparison';
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR' | undefined;
}

/** One parenthesized predicate list, attached to the surrounding list by `connector`. */
export interface PredicateGroup {
  readonly kind: 'group';
  readonly predicates: readonly Predicate[];
  readonly connector?: 'AND' | 'OR' | undefined;
}

export type Predicate = ComparisonPredicate | SpatialPredicateNode | PredicateGroup;

export interface Tail<C = string> {
  readonly orderBys?: readonly { readonly col: C; readonly dir: 'asc' | 'desc' }[] | undefined;
  readonly limitN?: number | undefined;
  readonly offsetN?: number | undefined;
  /** Used by builders that render a richer ORDER BY expression before delegating pagination. */
  readonly ordered?: boolean | undefined;
}

const JOIN_KEYWORD: Record<JoinKind, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
  right: 'RIGHT JOIN',
};

// Object.create(null) prevents prototype inheritance so an operator named 'constructor' cannot resolve through Object.prototype.
export const OP_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null), {
    '=': '=',
    '!=': '!=',
    '<': '<',
    '<=': '<=',
    '>': '>',
    '>=': '>=',
    like: 'LIKE',
    ilike: 'ILIKE',
    in: 'IN',
    'not in': 'NOT IN',
    nin: 'NOT IN',
    exists: 'EXISTS',
    'not exists': 'NOT EXISTS',
    'is null': 'IS NULL',
    'is not null': 'IS NOT NULL',
    ...DISTANCE_OPERATORS,
  }),
);

/**
 * The lexical shape of an operator the compiler does not know by name.
 *
 * This is deliberately not a dialect/operator allowlist: PostgreSQL extensions,
 * SQLite GLOB, MySQL's null-safe equality and SQL Server's !< all remain usable.
 * It is only the boundary between one SQL token and caller-controlled SQL text.
 *
 * `--` is excluded even though `-` is needed by real operators such as `->>`.
 * `#` is restricted to PostgreSQL's `#>` / `#>>`; a bare hash starts a MySQL
 * line comment. Placeholder markers are excluded on the dialects where they
 * would be parsed as parameters. Slash is absent, so block-comment openers
 * cannot be formed.
 */
const UNMAPPED_OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;

function isUnmappedOperatorToken(op: string, dialect: DialectTarget): boolean {
  const traits = dialectTraits(dialect);
  if (typeof dialect !== 'string') return traits.acceptsOperator(op);
  if (op === '#>' || op === '#>>') return dialectFamily(dialect) === 'postgres';
  if (!UNMAPPED_OPERATOR_TOKEN.test(op)) return false;
  if (traits.placeholder === 'positional' && op.includes('?')) return false;
  if (traits.placeholder === 'named' && op.includes('@')) return false;
  return true;
}

/**
 * Anything with a `compile()` — a builder from this package, or a caller's own.
 *
 * boundary: the cast is inside the guard that the rest of the package relies on, and it
 * reads the one property the `in` check on the line above has just proven is there. Its
 * type is `unknown`, so the `typeof` is what establishes anything; a narrower cast would be
 * the claim this function exists to test.
 */
export function isSubqueryTarget(value: unknown): value is { compile(): CompiledQuery } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'compile' in value &&
    typeof (value as { compile?: unknown }).compile === 'function'
  );
}

/**
 * Normalizes known operators to canonical SQL keywords and admits an unmapped
 * operator only when it is one bounded SQL token.
 */
export function sqlOperator(op: string, dialect: DialectTarget = 'postgres'): string {
  const normalized = op.toLowerCase().trim();
  if (isDistanceOp(normalized) && !dialectTraits(dialect).vectorDistance) {
    throw new UnsupportedFeatureError(normalized, dialectName(dialect));
  }
  // A plain index read, and no own-property guard: `OP_MAP` has a null prototype, so
  // `OP_MAP['constructor']` is already `undefined` rather than a function off
  // `Object.prototype`. That is what makes `??` safe here, and it is why the map is built
  // the way it is.
  const mapped = OP_MAP[normalized];
  if (mapped !== undefined) return mapped;
  if (!isUnmappedOperatorToken(op, dialect)) {
    const name = dialectName(dialect);
    throw new TypeError(
      `invalid unmapped SQL operator ${JSON.stringify(op)} for dialect ${JSON.stringify(name)}; expected ` +
        'one non-comment operator token that does not conflict with the dialect placeholder syntax',
    );
  }
  return op;
}

/** `col op $n`, or `EXISTS (…)` / `col op (…)` when the value is a subquery. */
export function renderPredicate(dialect: DialectTarget, p: Predicate, params: unknown[]): string {
  if (p.kind === 'group') {
    if (p.predicates.length === 0) throw new TypeError('predicate groups must not be empty');
    return `(${predicateList(dialect, p.predicates, params)})`;
  }
  if (p.kind === 'spatial') return renderSpatialPredicate(dialect, p, params);
  const normalized = p.op.toLowerCase().trim();
  const sqlOp = sqlOperator(p.op, dialect);

  if (sqlOp === 'IS NULL' || sqlOp === 'IS NOT NULL') {
    return `${quoteColumn(dialect, p.col)} ${sqlOp}`;
  }

  if (isDistanceOp(normalized)) {
    requirePostgres(normalized, dialect);
    params.push(encodePgVector(p.value));
    return `${quoteColumn(dialect, p.col)} ${sqlOp} ${formatPlaceholder(dialect, params.length)}`;
  }

  if (sqlOp === 'IS NULL' || sqlOp === 'IS NOT NULL') {
    return `${quoteColumn(dialect, p.col)} ${sqlOp}`;
  }

  if (isSubqueryTarget(p.value)) {
    const sub = p.value.compile();
    // Continue the outer statement's numbering. Positional placeholders are a
    // no-op here, so the order of the pushes below is what matters.
    const text = renumberPlaceholders(sub.text, params.length, dialect);
    params.push(...sub.parameters);

    if (sqlOp === 'EXISTS') return `EXISTS (${text})`;
    if (sqlOp === 'NOT EXISTS') return `NOT EXISTS (${text})`;
    return `${quoteColumn(dialect, p.col)} ${sqlOp} (${text})`;
  }

  if (sqlOp === 'IN' || sqlOp === 'NOT IN') {
    const isNotIn = sqlOp === 'NOT IN';
    let arr = Array.isArray(p.value) ? p.value : [p.value];
    if (isNotIn) {
      arr = arr.filter(item => item !== null && item !== undefined);
    }
    if (arr.length === 0) {
      return isNotIn ? '1 = 1' : '1 = 0';
    }
    const placeholders = arr
      .map(item => {
        params.push(item);
        return formatPlaceholder(dialect, params.length);
      })
      .join(', ');
    return `${quoteColumn(dialect, p.col)} ${sqlOp} (${placeholders})`;
  }

  params.push(p.value);
  return `${quoteColumn(dialect, p.col)} ${sqlOp} ${formatPlaceholder(dialect, params.length)}`;
}

function predicateList(dialect: DialectTarget, preds: readonly Predicate[], params: unknown[]): string {
  return preds
    .map((p, i) => {
      const cond = renderPredicate(dialect, p, params);
      return i === 0 ? cond : `${p.connector ?? 'AND'} ${cond}`;
    })
    .join(' ');
}

/** ` WHERE …`, appending each predicate's parameters to `params` in order. */
export function whereClause(dialect: DialectTarget, preds: readonly Predicate[], params: unknown[]): string {
  if (preds.length === 0) return '';
  return ` WHERE ${predicateList(dialect, preds, params)}`;
}

/** ` HAVING …` — same rendering as WHERE, which is why they share a code path. */
export function havingClause(dialect: DialectTarget, preds: readonly Predicate[], params: unknown[]): string {
  if (preds.length === 0) return '';
  return ` HAVING ${predicateList(dialect, preds, params)}`;
}

/** ` INNER JOIN … ON … = … [AND … = …] [AND …]` for each join, in order. */
export function joinClauses(dialect: DialectTarget, joins: readonly JoinSpec[], params: unknown[] = []): string {
  return joins
    .map(j => {
      const conditions = j.conditions
        .map(condition => `${quoteColumn(dialect, condition.leftCol)} = ${quoteColumn(dialect, condition.rightCol)}`)
        .join(' AND ');
      const targetPredicates =
        j.on === undefined || j.on.length === 0
          ? ''
          : j.on
              .map((predicate, index) => {
                const rendered = renderPredicate(dialect, predicate, params);
                return `${index === 0 ? 'AND' : (predicate.connector ?? 'AND')} ${rendered}`;
              })
              .join(' ');
      return (
        ` ${JOIN_KEYWORD[j.kind]} ${quoteTable(dialect, j.target)} ` +
        `ON ${conditions}` +
        (targetPredicates.length === 0 ? '' : ` ${targetPredicates}`)
      );
    })
    .join('');
}

/**
 * ` ORDER BY … LIMIT n OFFSET n`. LIMIT and OFFSET are interpolated rather than
 * parameterized because they are numbers this package produced, never caller
 * strings — the builders' `limit`/`offset` take `number`.
 */
export function tailClause(dialect: DialectTarget, tail: Tail): string {
  let text = '';
  const rendersOrderBy = tail.orderBys !== undefined && tail.orderBys.length > 0;
  const ordered = tail.ordered ?? rendersOrderBy;
  if (rendersOrderBy) {
    const ob = tail.orderBys.map(o => `${quoteColumn(dialect, o.col)} ${o.dir.toUpperCase()}`).join(', ');
    text += ` ORDER BY ${ob}`;
  }
  text += dialectTraits(dialect).paginate({
    ...(tail.limitN === undefined ? {} : { limit: tail.limitN }),
    ...(tail.offsetN === undefined ? {} : { offset: tail.offsetN }),
    ordered,
  });
  return text;
}

/** Every `compile()` in this package returns this shape, frozen at both levels. */
export function frozenQuery(text: string, params: readonly unknown[], telemetry?: QueryTelemetry): CompiledQuery {
  const parameters = Object.freeze([...params]);
  return telemetry === undefined ? Object.freeze({ text, parameters }) : Object.freeze({ text, parameters, telemetry });
}

/** Compile-known database attributes, absent when telemetry was not requested. */
export function queryTelemetry(
  dialect: DialectTarget,
  operation: QueryTelemetry['operation'],
  collection: string,
  enabled: boolean,
): QueryTelemetry | undefined {
  if (!enabled) return undefined;
  const family = dialectFamily(dialect);
  return Object.freeze({
    system: family === 'postgres' ? 'postgresql' : family,
    operation,
    collection: unaliasedTable(collection),
  });
}

// --- builder wiring --------------------------------------------------------
//
// The rendering above is shared, but each builder still wired the same methods
// onto its own state by hand. The two below are the ones that were identical in
// three places (`orderBy`/`limit`/`offset`) and two (`innerJoin` and friends),
// which is one drift away from the bugs the header describes.
//
// Both take the current value and the builder's own `next`, and hand back
// methods returning whatever `next` returns — so each builder keeps its own
// state type and its own return type, and no cast is needed in either
// direction. That works because they ask for the *narrowest* patch they could
// pass: `TailPatch` is assignable to every builder's `Partial<State>`, so
// contravariance makes each builder's `next` acceptable here.
//
// It does require the state's arrays be `readonly`, which they should be
// anyway: `next` replaces them, nothing appends in place.

/**
 * What {@link tailMethods} passes to a builder's `next`. Deliberately not
 * `Partial<Tail>`: under `exactOptionalPropertyTypes` an optional property that
 * also admits `undefined` is not assignable to one that doesn't, and no
 * builder's state wants an explicit `undefined` written over its array.
 */
export interface TailPatch<C = string> {
  readonly orderBys?: readonly { readonly col: C; readonly dir: 'asc' | 'desc' }[];
  readonly limitN?: number;
  readonly offsetN?: number;
}

/** `orderBy` / `limit` / `offset`, for any state carrying a {@link Tail}. */
export function tailMethods<C, B>(tail: Tail<C>, next: (patch: TailPatch<C>) => B) {
  return {
    orderBy: (col: C, dir: 'asc' | 'desc'): B => next({ orderBys: [...(tail.orderBys ?? []), { col, dir }] }),
    limit: (n: number): B => next({ limitN: n }),
    offset: (n: number): B => next({ offsetN: n }),
  };
}

export interface JoinMethod<B> {
  (target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): B;
  (target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): B;
}

/** `innerJoin` / `leftJoin` / `rightJoin`, for any state carrying a join list. */
export function joinMethods<B>(joins: readonly JoinSpec[], next: (patch: { joins: readonly JoinSpec[] }) => B) {
  const add = (kind: JoinKind): JoinMethod<B> => {
    function join(target: string, leftCol: string, rightCol: string, on?: readonly Predicate[]): B;
    function join(target: string, conditions: readonly JoinCondition[], on?: readonly Predicate[]): B;
    function join(
      target: string,
      leftColOrConditions: string | readonly JoinCondition[],
      rightColOrOn?: string | readonly Predicate[],
      scalarOn?: readonly Predicate[],
    ): B {
      const conditions =
        typeof leftColOrConditions === 'string'
          ? typeof rightColOrOn === 'string'
            ? [{ leftCol: leftColOrConditions, rightCol: rightColOrOn }]
            : []
          : leftColOrConditions;
      if (conditions.length === 0) {
        throw new RangeError(`join "${target}" needs at least one ON condition`);
      }
      const on = typeof leftColOrConditions === 'string' ? scalarOn : rightColOrOn;
      if (on !== undefined && typeof on === 'string') {
        throw new TypeError(`join "${target}" received an invalid ON predicate list`);
      }
      return next({
        joins: [
          ...joins,
          {
            kind,
            target,
            conditions: conditions.map(condition => ({
              leftCol: condition.leftCol,
              rightCol: condition.rightCol,
            })),
            ...(on === undefined ? {} : { on }),
          },
        ],
      });
    }
    return join;
  };
  return { innerJoin: add('inner'), leftJoin: add('left'), rightJoin: add('right') };
}
