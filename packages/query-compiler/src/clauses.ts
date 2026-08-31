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
import type { CompiledQuery, Dialect } from './index.ts';
import { formatPlaceholder, quoteColumn, quoteTable, renumberPlaceholders } from './quoting.ts';

export type JoinKind = 'inner' | 'left' | 'right';

export interface JoinSpec {
  readonly kind: JoinKind;
  readonly target: string;
  readonly leftCol: string;
  readonly rightCol: string;
}

/**
 * One comparison in a WHERE or HAVING list. `connector` says how it attaches to
 * the predicate before it and is ignored on the first one; builders that only
 * ever conjoin can leave it out.
 */
export interface Predicate {
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR' | undefined;
}

export interface Tail {
  readonly orderBys?: readonly { readonly col: string; readonly dir: 'asc' | 'desc' }[] | undefined;
  readonly limitN?: number | undefined;
  readonly offsetN?: number | undefined;
}

const JOIN_KEYWORD: Record<JoinKind, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
  right: 'RIGHT JOIN',
};

/** Anything with a `compile()` — a builder from this package, or a caller's own. */
export function isSubqueryTarget(value: unknown): value is { compile(): CompiledQuery } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'compile' in value &&
    typeof (value as { compile?: unknown }).compile === 'function'
  );
}

/**
 * The two operators we spell for the caller. Everything else is emitted as
 * written, which is what makes raw operators (`@>`, `&&`, `BETWEEN`) work.
 */
export function sqlOperator(op: string): string {
  if (op === 'like') return 'LIKE';
  if (op === 'in') return 'IN';
  return op;
}

/** `col op $n`, or `EXISTS (…)` / `col op (…)` when the value is a subquery. */
export function renderPredicate(dialect: Dialect, p: Predicate, params: unknown[]): string {
  if (isSubqueryTarget(p.value)) {
    const sub = p.value.compile();
    // Continue the outer statement's numbering. For mysql/sqlite the
    // placeholder is positional, so this is a no-op and the order of the
    // pushes below is what matters.
    const text = renumberPlaceholders(sub.text, params.length);
    params.push(...sub.parameters);

    const opUpper = p.op.toUpperCase();
    if (opUpper === 'EXISTS') return `EXISTS (${text})`;
    if (opUpper === 'NOT EXISTS') return `NOT EXISTS (${text})`;
    return `${quoteColumn(dialect, p.col)} ${sqlOperator(p.op)} (${text})`;
  }
  params.push(p.value);
  return `${quoteColumn(dialect, p.col)} ${sqlOperator(p.op)} ${formatPlaceholder(dialect, params.length)}`;
}

function predicateList(dialect: Dialect, preds: readonly Predicate[], params: unknown[]): string {
  return preds
    .map((p, i) => {
      const cond = renderPredicate(dialect, p, params);
      return i === 0 ? cond : `${p.connector ?? 'AND'} ${cond}`;
    })
    .join(' ');
}

/** ` WHERE …`, appending each predicate's parameters to `params` in order. */
export function whereClause(dialect: Dialect, preds: readonly Predicate[], params: unknown[]): string {
  if (preds.length === 0) return '';
  return ` WHERE ${predicateList(dialect, preds, params)}`;
}

/** ` HAVING …` — same rendering as WHERE, which is why they share a code path. */
export function havingClause(dialect: Dialect, preds: readonly Predicate[], params: unknown[]): string {
  if (preds.length === 0) return '';
  return ` HAVING ${predicateList(dialect, preds, params)}`;
}

/** ` INNER JOIN … ON … = …` for each join, in order. */
export function joinClauses(dialect: Dialect, joins: readonly JoinSpec[]): string {
  return joins
    .map(
      j =>
        ` ${JOIN_KEYWORD[j.kind]} ${quoteTable(dialect, j.target)} ` +
        `ON ${quoteColumn(dialect, j.leftCol)} = ${quoteColumn(dialect, j.rightCol)}`,
    )
    .join('');
}

/**
 * ` ORDER BY … LIMIT n OFFSET n`. LIMIT and OFFSET are interpolated rather than
 * parameterized because they are numbers this package produced, never caller
 * strings — the builders' `limit`/`offset` take `number`.
 */
export function tailClause(dialect: Dialect, tail: Tail): string {
  let text = '';
  if (tail.orderBys && tail.orderBys.length > 0) {
    const ob = tail.orderBys.map(o => `${quoteColumn(dialect, o.col)} ${o.dir.toUpperCase()}`).join(', ');
    text += ` ORDER BY ${ob}`;
  }
  if (tail.limitN !== undefined) text += ` LIMIT ${tail.limitN}`;
  if (tail.offsetN !== undefined) text += ` OFFSET ${tail.offsetN}`;
  return text;
}

/** Every `compile()` in this package returns this shape, frozen at both levels. */
export function frozenQuery(text: string, params: readonly unknown[]): CompiledQuery {
  return Object.freeze({ text, parameters: Object.freeze([...params]) });
}
