// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { isRecord, type DeclaredTable } from '@zmdb/schema';
import type { WhereDTO, UnknownRow, OrderDir, OrderBySpec, PaginationSpec } from '@zmdb/schema/dto';
import {
  trustedTable,
  createQueryCompiler,
  type ComparisonPredicate,
  type Predicate,
  type SqlDialect,
} from '@zmdb/sql';
import { ValidationError } from '@zmdb/validator';

/**
 * Minimal structural view of the query-compiler SelectBuilder we drive.
 *
 * The methods return `this` (not `WhereTarget`), so folding a DTO into a builder
 * preserves the caller's concrete builder type. That is what lets `compileWhere`
 * return `B` without asserting: previously the chain widened to `WhereTarget` and
 * every helper ended in `return b as B`.
 */
export interface WhereTarget {
  where(col: string, op: string, value: unknown): this;
  orWhere(col: string, op: string, value: unknown): this;
  whereGroup?(predicates: readonly Predicate[]): this;
  orWhereGroup?(predicates: readonly Predicate[]): this;
  whereExists?(subquery: unknown): this;
  orWhereExists?(subquery: unknown): this;
  whereNotExists?(subquery: unknown): this;
  orWhereNotExists?(subquery: unknown): this;
  whereIn?(col: string, values: readonly unknown[]): this;
  orWhereIn?(col: string, values: readonly unknown[]): this;
  whereNotIn?(col: string, values: readonly unknown[]): this;
  orWhereNotIn?(col: string, values: readonly unknown[]): this;
}

/**
 * Record view of a value, or `undefined` if it is not a plain object.
 *
 * Taking `unknown` is deliberate: narrowing a *generic* DTO (`WhereDTO<T>`) in
 * place leaves the mapped type, which has no string index signature, so keyed
 * reads would need `as Record<string, unknown>`. Routing through `unknown` lets
 * the guard do the widening instead of an assertion.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

const OP_SQL: Record<string, string> = {
  eq: '=',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  in: 'in',
  nin: 'not in',
  like: 'like',
  ilike: 'ilike',
  l2: 'l2',
  cosine: 'cosine',
  ip: 'ip',
};

// Every operator `applyField` accepts, for the error an unrecognised one raises.
// `isNull`/`notNull` are handled ahead of the map, so they are not keys of it.
const KNOWN_OPERATORS: readonly string[] = [...Object.keys(OP_SQL), 'isNull', 'notNull'];

/**
 * A `{ table, select?, where? }` literal in a DTO, compiled into a subquery builder.
 *
 * boundary: the input is `unknown` because a DTO arrives from outside the process, and what
 * establishes the shape is the `in` checks in the `if`, not the two casts. The first reads
 * the one property those checks have just proven is a string; the second names the rest of
 * the shape, and each optional field is tested again before it is used — `select` for a
 * non-zero length, `where` for presence — so the only thing a wrong payload can produce is
 * a narrower subquery, never a call with a value of the wrong kind in it.
 */
function resolveSubqueryTarget(target: unknown, dialect: SqlDialect | undefined): unknown {
  if (
    target !== null &&
    typeof target === 'object' &&
    !('compile' in target) &&
    'table' in target &&
    typeof (target as { table: unknown }).table === 'string'
  ) {
    const spec = target as {
      table: string;
      select?: readonly string[];
      where?: WhereDTO<UnknownRow>;
    };
    if (dialect === undefined) {
      throw new ValidationError('compileWhere: a table subquery requires the builder dialect object');
    }
    // Both clauses, not either: `{ table, select, where }` means a projection *and* a
    // filter, and a subquery that dropped the filter would match every row.
    let sub = createQueryCompiler(dialect).selectFrom(trustedTable(spec.table));
    if (spec.select && spec.select.length > 0) {
      sub = sub.select(spec.select);
    }
    if (spec.where) {
      sub = compileWhere(sub, spec.where);
    }
    return sub;
  }
  return target;
}

/**
 * Fold a WhereDTO into a query-compiler builder. Bare values become `eq`.
 * Fields/operators are applied in stable object-key order (golden SQL).
 * `and`/`or` groups compose; `or` members are ORed.
 */
export function compileWhere<T extends DeclaredTable, B extends WhereTarget>(
  builder: B,
  where: WhereDTO<T> | undefined,
  resolveColumn: (column: string) => string = column => column,
): B {
  if (!where) return builder;
  let b: B = builder;
  // boundary: `WhereTarget` is the structural minimum this function calls — `where`, `and`,
  // `or` — and deliberately does not require a `dialect`, so that a caller's own builder
  // qualifies. Reading one off it is therefore a probe for an optional property rather than
  // a claim about the type, and the `??` is what handles the builder that has none.
  const dialect = (builder as { dialect?: SqlDialect }).dialect;

  const applyField = (col: string, spec: unknown, connector: 'and' | 'or') => {
    const resolvedColumn = resolveColumn(col);
    const add = (op: string, rawVal: unknown) => {
      const value = resolveSubqueryTarget(rawVal, dialect);
      if (connector === 'or') {
        b = b.orWhere(resolvedColumn, op, value);
      } else {
        b = b.where(resolvedColumn, op, value);
      }
    };
    if (
      spec !== null &&
      typeof spec === 'object' &&
      !Array.isArray(spec) &&
      !('compile' in spec) &&
      !('table' in spec)
    ) {
      const ops = asRecord(spec);
      if (ops) {
        if (Object.keys(ops).length === 0) {
          // `FieldOps`' keys are all optional, so `{ age: {} }` is type-legal, and it is
          // what building a filter conditionally produces: `{ age: min === undefined ? {}
          // : { gte: min } }`. Folding it to nothing means the query looks filtered and is
          // not — over-disclosure on a SELECT, the whole table on an UPDATE or DELETE. An
          // empty operator map is not a filter, and "match everything" is the least likely
          // thing the caller meant (#608).
          throw new ValidationError(
            `compileWhere: column "${col}" has an empty operator map, which would match every row`,
            [{ path: col, message: 'empty operator map', expected: KNOWN_OPERATORS.join(' | ') }],
          );
        }
        for (const [op, value] of Object.entries(ops)) {
          if (op === 'isNull') {
            if (value) add('is null', null);
            else add('is not null', null);
          } else if (op === 'notNull') {
            add(value ? 'is not null' : 'is null', null);
          } else if (op === 'in' && Array.isArray(value)) {
            if (connector === 'or' && b.orWhereIn) b = b.orWhereIn(resolvedColumn, value);
            else if (connector !== 'or' && b.whereIn) b = b.whereIn(resolvedColumn, value);
            else add('in', value);
          } else if (op === 'nin' && Array.isArray(value)) {
            if (connector === 'or' && b.orWhereNotIn) b = b.orWhereNotIn(resolvedColumn, value);
            else if (connector !== 'or' && b.whereNotIn) b = b.whereNotIn(resolvedColumn, value);
            else add('not in', value);
          } else {
            // `Object.hasOwn`, not a truthy read: `OP_SQL` is an object literal, so an
            // operator named `toString`, `constructor`, `valueOf` or `__proto__` resolves
            // through `Object.prototype` and passes a truthiness check as a function or an
            // object. A where-DTO is the path user JSON takes into the builder, so those
            // keys arrive from outside the process (#364).
            const sql = Object.hasOwn(OP_SQL, op) ? OP_SQL[op] : undefined;
            if (sql === undefined) {
              // Fail closed. Skipping the key emitted a statement with one predicate
              // fewer than the caller wrote, which on an UPDATE or DELETE is the whole
              // table.
              throw new ValidationError(`compileWhere: unknown operator "${op}" on column "${col}"`, [
                {
                  path: col,
                  message: `unknown operator "${op}"`,
                  expected: KNOWN_OPERATORS.join(' | '),
                  value,
                },
              ]);
            }
            add(sql, value);
          }
        }
      }
    } else {
      // bare value or direct subquery spec ⇒ eq
      add('=', spec);
    }
  };

  const applyExists = (spec: unknown, isNot: boolean, connector: 'and' | 'or') => {
    const items = Array.isArray(spec) ? spec : [spec];
    for (const item of items) {
      const resolved = resolveSubqueryTarget(item, dialect);
      if (connector === 'or') {
        if (isNot) {
          if (!b.orWhereNotExists) {
            throw new Error('Builder does not support orWhereNotExists');
          }
          b = b.orWhereNotExists(resolved);
        } else {
          if (!b.orWhereExists) {
            throw new Error('Builder does not support orWhereExists');
          }
          b = b.orWhereExists(resolved);
        }
      } else {
        if (isNot) {
          if (!b.whereNotExists) {
            throw new Error('Builder does not support whereNotExists');
          }
          b = b.whereNotExists(resolved);
        } else {
          if (!b.whereExists) {
            throw new Error('Builder does not support whereExists');
          }
          b = b.whereExists(resolved);
        }
      }
    }
  };

  const { and, or } = where;
  const fields = asRecord(where);
  if (!fields) return b;
  for (const key of Object.keys(fields)) {
    if (key === 'and') {
      if (and) for (const sub of and) b = compileWhere(b, sub, resolveColumn);
    } else if (key === 'or') {
      for (const sub of or ?? []) {
        const group = asRecord(sub);
        if (group) {
          for (const [col, spec] of Object.entries(group)) {
            if (col === 'exists') {
              applyExists(spec, false, 'or');
            } else if (col === 'notExists') {
              applyExists(spec, true, 'or');
            } else {
              applyField(col, spec, 'or');
            }
          }
        }
      }
    } else if (key === 'exists') {
      applyExists(fields[key], false, 'and');
    } else if (key === 'notExists') {
      applyExists(fields[key], true, 'and');
    } else {
      applyField(key, fields[key], 'and');
    }
  }
  return b;
}

/** Like {@link WhereTarget}: `this`-returning so folding preserves the builder type. */
export interface OrderTarget {
  orderBy(col: string, dir: OrderDir): this;
  limit(n: number): this;
  offset(n: number): this;
}

export function applyOrderBy<B extends OrderTarget>(
  builder: B,
  order: OrderBySpec | undefined,
  pkColumn?: string,
  resolveColumn: (column: string) => string = column => column,
): B {
  if (!order && !pkColumn) return builder;
  let b = builder;
  const cols: { column: PropertyKey; dir?: OrderDir }[] = order ? [...order] : [];
  if (pkColumn && !cols.some(item => String(item.column) === pkColumn)) {
    cols.push({ column: pkColumn, dir: 'asc' });
  }
  if (cols.length === 0) return builder;
  for (const { column, dir } of cols) b = b.orderBy(resolveColumn(String(column)), dir ?? 'asc');
  return b;
}

class BranchTarget implements WhereTarget {
  private b: WhereTarget;
  private firstCallInBranch: boolean;

  constructor(b: WhereTarget, isFirstBranch: boolean) {
    this.b = b;
    this.firstCallInBranch = !isFirstBranch;
  }

  where(col: string, op: string, value: unknown): this {
    if (this.firstCallInBranch) {
      this.firstCallInBranch = false;
      this.b = this.b.orWhere(col, op, value);
    } else {
      this.b = this.b.where(col, op, value);
    }
    return this;
  }

  // A keyset branch is a conjunction that is OR'd onto the branches before it,
  // so the branch spends its OR on the first predicate and conjoins the rest.
  // Repository filters use `whereGroup` below to preserve their own OR boundary;
  // compileWhere's user-authored `or` tree is still flat and remains a separate
  // predicate-tree problem.
  orWhere(col: string, op: string, value: unknown): this {
    return this.where(col, op, value);
  }

  whereGroup(predicates: readonly ComparisonPredicate[]): this {
    const method = this.firstCallInBranch ? this.b.orWhereGroup : this.b.whereGroup;
    if (method === undefined) throw new Error('keyset filters require predicate-group support');
    this.firstCallInBranch = false;
    this.b = method.call(this.b, predicates);
    return this;
  }

  getBuilder(): WhereTarget {
    return this.b;
  }
}

/** Fold scalar values already decoded and validated against this effective ordering. */
export function applyKeysetFilter<B extends WhereTarget>(
  builder: B,
  cursorValues: Record<string, unknown>,
  orderBy: OrderBySpec,
  userWhere?: WhereDTO<UnknownRow>,
  additionalWhere?: (builder: WhereTarget) => void,
  resolveColumn: (column: string) => string = column => column,
): B {
  if (orderBy.length === 0) return builder;

  let currentBuilder: WhereTarget = builder;
  const k = orderBy.length;

  for (let i = 0; i < k; i++) {
    const itemI = orderBy[i];
    if (!itemI) continue;

    const target = new BranchTarget(currentBuilder, i === 0);

    if (userWhere) {
      compileWhere(target, userWhere, resolveColumn);
    }
    additionalWhere?.(target);

    for (let j = 0; j < i; j++) {
      const itemJ = orderBy[j];
      if (!itemJ) continue;
      const col = String(itemJ.column);
      target.where(resolveColumn(col), '=', cursorValues[col]);
    }

    const curCol = String(itemI.column);
    const dir = itemI.dir ?? 'asc';
    const op = dir === 'desc' ? '<' : '>';
    target.where(resolveColumn(curCol), op, cursorValues[curCol]);

    currentBuilder = target.getBuilder();
  }

  // boundary: BranchTarget wraps B (implementing WhereTarget); getBuilder() returns the mutated query builder B.
  return currentBuilder as B;
}

export function applyPagination<B extends OrderTarget>(builder: B, page: PaginationSpec | undefined): B {
  if (!page) return builder;
  let b = builder.limit(page.limit);
  if (page.mode === 'offset' && typeof page.offset === 'number') b = b.offset(page.offset);
  return b;
}
