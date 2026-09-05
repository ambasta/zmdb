// Read/Query DTO family — see ./SPEC.md.
// Types are compile-time only. `compileWhere` is the one runtime artifact.
// TDD: types + stubs land with the tests (red); impl fills the stubs (green).
import type { ComparisonPredicate, CompiledQuery, Dialect, SelectBuilder } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';

import type { DeclaredTable, RelationKeys } from '../derive/index.js';
import type { Entity } from '../index.js';
import { isRecord, ValidationError } from '../index.js';

// ---------------------------------------------------------------------------
// WhereDTO + operator set
// ---------------------------------------------------------------------------
/**
 * A row of a table the caller named with a string.
 *
 * A subquery target is `{ table: 'orders' }` — a table *name*, not a declared type — so there
 * is nothing for its filter to be keyed by. This says exactly that much and no more: every
 * property is a column of some SQL type, and none of them is a relation, which is what keeps
 * `WhereDTO` willing to derive from it. It is a named type rather than an inline
 * `Record<string, unknown>` so that it stays the one corner of the query surface that is
 * keyed by string; everything else is keyed by the interface the table was declared as.
 */
export interface UnknownRow {
  readonly [column: string]: string | number | boolean | bigint | Date | null;
}

export type SubqueryTarget<V = unknown> =
  | SelectBuilder<V>
  | { compile(): CompiledQuery; readonly _type?: V }
  | {
      table: string;
      select?: readonly string[];
      where?: WhereDTO<UnknownRow>;
      readonly _type?: V;
    };

type VectorOperand<V> =
  NonNullable<V> extends {
    readonly __zmdbExt?: readonly [extension: string, name: 'vector', args: readonly (string | number)[]];
  }
    ? readonly number[]
    : never;

export interface FieldOps<V> {
  eq?: V | SubqueryTarget<V>;
  ne?: V | SubqueryTarget<V>;
  lt?: V | SubqueryTarget<V>;
  lte?: V | SubqueryTarget<V>;
  gt?: V | SubqueryTarget<V>;
  gte?: V | SubqueryTarget<V>;
  in?: readonly V[] | SubqueryTarget<V>;
  nin?: readonly V[] | SubqueryTarget<V>;
  like?: V extends string ? string | SubqueryTarget<string> : never;
  ilike?: V extends string ? string | SubqueryTarget<string> : never;
  l2?: VectorOperand<V>;
  cosine?: VectorOperand<V>;
  ip?: VectorOperand<V>;
  isNull?: boolean;
  notNull?: boolean;
}

export type WhereDTO<T extends DeclaredTable> = {
  [K in keyof Entity<T>]?: Entity<T>[K] | FieldOps<Entity<T>[K]>;
} & {
  and?: readonly WhereDTO<T>[];
  or?: readonly WhereDTO<T>[];
  exists?: SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[];
  notExists?: SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[];
};

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
  whereGroup?(predicates: readonly ComparisonPredicate[]): this;
  orWhereGroup?(predicates: readonly ComparisonPredicate[]): this;
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
function resolveSubqueryTarget(target: unknown, dialect: Dialect = 'postgres'): unknown {
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
    // Both clauses, not either: `{ table, select, where }` means a projection *and* a
    // filter, and a subquery that dropped the filter would match every row.
    let sub = createQueryCompiler(dialect).selectFrom(spec.table);
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
  keysetState?: { firstCallInBranch: boolean },
): B {
  if (!where) return builder;
  let b: B = builder;
  // boundary: `WhereTarget` is the structural minimum this function calls — `where`, `and`,
  // `or` — and deliberately does not require a `dialect`, so that a caller's own builder
  // qualifies. Reading one off it is therefore a probe for an optional property rather than
  // a claim about the type, and the `??` is what handles the builder that has none.
  const dialect = (builder as { dialect?: Dialect }).dialect ?? 'postgres';

  const applyField = (col: string, spec: unknown, connector: 'and' | 'or') => {
    const resolvedColumn = resolveColumn(col);
    const add = (op: string, rawVal: unknown) => {
      const value = resolveSubqueryTarget(rawVal, dialect);
      if (keysetState) {
        if (keysetState.firstCallInBranch) {
          keysetState.firstCallInBranch = false;
          b = b.orWhere(resolvedColumn, op, value);
        } else {
          b = b.where(resolvedColumn, op, value);
        }
      } else if (connector === 'or') {
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
            if (!keysetState && connector === 'or' && b.orWhereIn) b = b.orWhereIn(resolvedColumn, value);
            else if (!keysetState && connector !== 'or' && b.whereIn) b = b.whereIn(resolvedColumn, value);
            else add('in', value);
          } else if (op === 'nin' && Array.isArray(value)) {
            if (!keysetState && connector === 'or' && b.orWhereNotIn) b = b.orWhereNotIn(resolvedColumn, value);
            else if (!keysetState && connector !== 'or' && b.whereNotIn) b = b.whereNotIn(resolvedColumn, value);
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
      if (keysetState) {
        if (keysetState.firstCallInBranch) {
          keysetState.firstCallInBranch = false;
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
      } else if (connector === 'or') {
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
      if (and) for (const sub of and) b = compileWhere(b, sub, resolveColumn, keysetState);
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

// ---------------------------------------------------------------------------
// §2 OrderBy + Pagination  (implemented in #183)
// ---------------------------------------------------------------------------
export type OrderDir = 'asc' | 'desc';
export type OrderByDTO<T extends DeclaredTable> = ReadonlyArray<{
  column: keyof Entity<T>;
  dir?: OrderDir;
}>;

/** Like {@link WhereTarget}: `this`-returning so folding preserves the builder type. */
export interface OrderTarget {
  orderBy(col: string, dir: OrderDir): this;
  limit(n: number): this;
  offset(n: number): this;
}
export type OffsetPage = { limit: number; offset?: number | undefined };
export type PaginationDTO<T extends DeclaredTable> =
  | OffsetPage
  | {
      limit: number;
      after?: Partial<Entity<T>> | string | undefined;
      before?: Partial<Entity<T>> | string | undefined;
    };

/**
 * Schema-agnostic views of the order/page DTOs — exactly the fields the folders
 * read. `OrderByDTO<T>`/`PaginationDTO<T>` are structurally assignable to these
 * for *any* `T`, so callers pass their own typed DTO with no
 * `as OrderByDTO<CoreSchema<string>>` widening cast (which is what leaked into
 * consumer code, cf. COOKBOOK "sorting" example).
 */
export type OrderBySpec = ReadonlyArray<{
  column: PropertyKey;
  dir?: OrderDir;
}>;
// `offset?: number | undefined` (not `offset?: number`) so callers under
// `exactOptionalPropertyTypes` can forward a possibly-absent offset positionally.
export type PaginationSpec = {
  limit: number;
  offset?: number | undefined;
  after?: Record<string, unknown> | string | undefined;
  before?: Record<string, unknown> | string | undefined;
};

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

function base64Encode(str: string): string {
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(str, 'utf-8').toString('base64url');
  }
  if (globalThis.btoa) {
    return globalThis.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  throw new Error('No base64 encoder available');
}

function base64Decode(str: string): string {
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(str, 'base64url').toString('utf-8');
  }
  if (globalThis.atob) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return globalThis.atob(base64);
  }
  throw new Error('No base64 decoder available');
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return base64Encode(JSON.stringify(payload));
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  if (typeof cursor !== 'string' || !cursor.trim()) {
    throw new Error('Invalid cursor: must be a non-empty string');
  }
  try {
    const json = base64Decode(cursor);
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid cursor payload');
    }
    // boundary: JSON.parse returns unknown (untrusted client payload); runtime check above proves parsed is a non-null, non-array object.
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid cursor')) {
      throw err;
    }
    throw new Error(`Invalid cursor format: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export function applyKeysetFilter<B extends WhereTarget>(
  builder: B,
  cursorValues: Record<string, unknown>,
  orderBy: OrderBySpec,
  userWhere?: WhereDTO<UnknownRow>,
  additionalWhere?: (builder: WhereTarget) => void,
  resolveColumn: (column: string) => string = column => column,
): B {
  if (orderBy.length === 0) return builder;

  for (const item of orderBy) {
    if (!item) continue;
    const colStr = String(item.column);
    if (cursorValues[colStr] === undefined) {
      throw new Error(`Invalid cursor: missing value for column "${colStr}"`);
    }
  }

  let currentBuilder: WhereTarget = builder;
  const k = orderBy.length;
  const state = { firstCallInBranch: false };

  for (let i = 0; i < k; i++) {
    const itemI = orderBy[i];
    if (!itemI) continue;

    state.firstCallInBranch = i > 0;

    if (userWhere) {
      currentBuilder = compileWhere(currentBuilder, userWhere, resolveColumn, state);
    }
    if (additionalWhere) {
      const branchTarget: WhereTarget = {
        where(col, op, value) {
          const resolvedCol = resolveColumn(col);
          if (state.firstCallInBranch) {
            state.firstCallInBranch = false;
            currentBuilder = currentBuilder.orWhere(resolvedCol, op, value);
          } else {
            currentBuilder = currentBuilder.where(resolvedCol, op, value);
          }
          return this;
        },
        orWhere(col, op, value) {
          return this.where(col, op, value);
        },
        whereGroup(predicates) {
          if (state.firstCallInBranch) {
            state.firstCallInBranch = false;
            if (!currentBuilder.orWhereGroup) throw new Error('keyset filters require predicate-group support');
            currentBuilder = currentBuilder.orWhereGroup(predicates);
          } else {
            if (!currentBuilder.whereGroup) throw new Error('keyset filters require predicate-group support');
            currentBuilder = currentBuilder.whereGroup(predicates);
          }
          return this;
        },
        orWhereGroup(predicates) {
          if (this.whereGroup) {
            return this.whereGroup(predicates);
          }
          return this;
        },
      };
      additionalWhere(branchTarget);
    }

    for (let j = 0; j < i; j++) {
      const itemJ = orderBy[j];
      if (!itemJ) continue;
      const col = resolveColumn(String(itemJ.column));
      if (state.firstCallInBranch) {
        state.firstCallInBranch = false;
        currentBuilder = currentBuilder.orWhere(col, '=', cursorValues[String(itemJ.column)]);
      } else {
        currentBuilder = currentBuilder.where(col, '=', cursorValues[String(itemJ.column)]);
      }
    }

    const curCol = resolveColumn(String(itemI.column));
    const dir = itemI.dir ?? 'asc';
    const op = dir === 'desc' ? '<' : '>';
    if (state.firstCallInBranch) {
      state.firstCallInBranch = false;
      currentBuilder = currentBuilder.orWhere(curCol, op, cursorValues[String(itemI.column)]);
    } else {
      currentBuilder = currentBuilder.where(curCol, op, cursorValues[String(itemI.column)]);
    }
  }

  // boundary: WhereTarget methods mutate and return the input query builder instance B
  return currentBuilder as B;
}

export function applyPagination<B extends OrderTarget>(builder: B, page: PaginationSpec | undefined): B {
  if (!page) return builder;
  let b = builder.limit(page.limit);
  if (typeof page.offset === 'number') b = b.offset(page.offset);
  return b;
}

// ---------------------------------------------------------------------------
// §3 Projection  (types only; narrowing wired in #186)
// ---------------------------------------------------------------------------
export type Projection<T extends DeclaredTable, K extends keyof Entity<T>> = Pick<Entity<T>, K>;

/** Narrow a row to `cols` (new object, stable order); passthrough when undefined. */
export function project<Row extends Record<string, unknown>>(row: Row, cols: undefined): Row;
export function project<Row extends Record<string, unknown>, K extends keyof Row>(
  row: Row,
  cols: readonly K[],
): Pick<Row, K>;
export function project<Row extends Record<string, unknown>, K extends keyof Row>(
  row: Row,
  cols: readonly K[] | undefined,
): Row | Pick<Row, K>;
export function project<Row extends Record<string, unknown>, K extends keyof Row>(
  row: Row,
  cols: readonly K[] | undefined,
): Row | Pick<Row, K> {
  if (!cols) return row;
  // boundary: a `Pick` is built key-by-key, so it is only complete once the loop
  // ends — there is no expression form that types a partially-filled mapped
  // type. The loop below writes exactly `cols`, which is what `Pick<Row, K>`
  // claims; `noUncheckedIndexedAccess` keeps the reads honest.
  const out = {} as Pick<Row, K>;
  for (const c of cols) out[c] = row[c];
  return out;
}

// ---------------------------------------------------------------------------
// §4 GetDTO
// ---------------------------------------------------------------------------
export interface GetOptions<T extends DeclaredTable> {
  select?: readonly (keyof Entity<T>)[];
  /**
   * The relations to fetch alongside the row.
   *
   * `RelationKeys<T>` rather than `readonly string[]`: a declared type names its relations,
   * so a misspelled one is a compile error rather than a relation that silently does not
   * arrive. It was a bare `string[]` while this family was keyed by the schema value, which
   * carries no relations to check a name against.
   */
  populate?: readonly RelationKeys<T>[];
}
export type GetDTO<
  T extends DeclaredTable,
  O extends GetOptions<T> = {},
> = O['select'] extends readonly (infer K extends keyof Entity<T>)[] ? Projection<T, K> : Entity<T>;

/** Apply a Get's select projection to a fetched row. */
export function getResult<Row extends Record<string, unknown>>(
  row: Row,
  opts?: { select?: readonly (keyof Row)[] },
): Row | Partial<Row> {
  return project(row, opts?.select);
}

// ---------------------------------------------------------------------------
// §4–6 Get/List/Search DTOs (types; result assembly in #166/#169/#172)
// ---------------------------------------------------------------------------
export interface ListDTO<T extends DeclaredTable> {
  where?: WhereDTO<T>;
  orderBy?: OrderByDTO<T>;
  page?: PaginationDTO<T>;
  select?: readonly (keyof Entity<T>)[];
}
export interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number;
  readonly hasMore: boolean;
  readonly cursor?: string;
}
/** Everything `buildListResult` accepts except `select`, which is what its overloads differ on. */
interface ListOptions {
  limit?: number;
  total?: number;
  cursor?: string;
  orderBy?: OrderBySpec;
  pkColumn?: string;
}
/**
 * Assemble a ListResult: limit+1 trim ⇒ hasMore, per-item projection, opt-in total, opaque cursor.
 *
 * Overloaded on `select` so the no-projection call keeps `ListResult<Row>` instead
 * of widening to `ListResult<Row | Partial<Row>>` — the widening is what forced
 * `as ListResult<Entity<T>>` in `@zmdb/repository`'s `list()`.
 */
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: ListOptions,
): ListResult<Row>;
export function buildListResult<Row extends Record<string, unknown>, K extends keyof Row>(
  rows: readonly Row[],
  opts: ListOptions & { select: readonly K[] },
): ListResult<Pick<Row, K>>;
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: ListOptions & { select?: readonly (keyof Row)[] },
): ListResult<Row | Partial<Row>>;
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: ListOptions & { select?: readonly (keyof Row)[] },
): ListResult<Row | Partial<Row>> {
  const limit = opts?.limit;
  const hasMore = typeof limit === 'number' && rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const select = opts?.select;
  const items = select ? kept.map(r => project(r, select)) : kept;

  let computedCursor: string | undefined = opts?.cursor;
  if (!computedCursor && hasMore && kept.length > 0) {
    const lastRow = kept[kept.length - 1];
    if (lastRow) {
      const cursorObj: Record<string, unknown> = {};
      const cols: { column: PropertyKey; dir?: OrderDir }[] = opts?.orderBy ? [...opts.orderBy] : [];
      if (opts?.pkColumn && !cols.some(c => String(c.column) === opts.pkColumn)) {
        cols.push({ column: opts.pkColumn, dir: 'asc' });
      }
      for (const item of cols) {
        if (!item) continue;
        const colStr = String(item.column);
        if (colStr in lastRow) {
          cursorObj[colStr] = lastRow[colStr];
        }
      }
      if (Object.keys(cursorObj).length > 0) {
        computedCursor = encodeCursor(cursorObj);
      }
    }
  }
  const result: ListResult<Row | Partial<Row>> = {
    items,
    hasMore,
    ...(computedCursor !== undefined ? { cursor: computedCursor } : {}),
  };
  return opts?.total !== undefined ? { ...result, total: opts.total } : result;
}
export interface SearchDTO<T extends DeclaredTable> {
  query: string;
  columns: readonly (keyof Entity<T>)[];
  where?: WhereDTO<T>;
  page?: PaginationDTO<T>;
  rank?: boolean;
}
export type SearchHit<Row> = Row & { readonly _score?: number };
export type SearchResult<Row> = ListResult<SearchHit<Row>>;

// ---------------------------------------------------------------------------
// §8 AggregateResult
// ---------------------------------------------------------------------------
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * `"relation.column"` for every relation the table declares.
 *
 * There was a second type parameter for this — the repository's relations map — and each of
 * its entries named the target either as a declared type or as a schema value, so the arm
 * that could see the target's columns was the one where an author had happened to write
 * `entity: Order`; everything else fell back to `${Rel}.${string}`. `RelationKeys<T>` reads
 * the target off the declaration, which every relation has, so every relation gets its
 * columns listed.
 */
type RelationTargetOf<V> = (NonNullable<V> extends readonly (infer E)[] ? E : NonNullable<V>) & DeclaredTable;

type RelatedColumns<T extends DeclaredTable> = {
  [Rel in RelationKeys<T> & string]: `${Rel}.${keyof Entity<RelationTargetOf<T[Rel & keyof T]>> & string}`;
}[RelationKeys<T> & string];

export type AggregateColumn<T extends DeclaredTable> = (keyof Entity<T> & string) | RelatedColumns<T> | (string & {});

export interface ComputedSpec<T extends DeclaredTable = DeclaredTable> {
  fn: AggFn;
  column?: AggregateColumn<T>;
  raw?: string;
}

export interface AggregateSpec<T extends DeclaredTable> {
  joins?:
    | readonly (RelationKeys<T> & string)[]
    | readonly { relation: RelationKeys<T> & string; kind?: 'inner' | 'left' | 'right' }[];
  where?: WhereDTO<T> | Record<string, unknown>;
  groupBy?: readonly AggregateColumn<T>[];
  computed: Record<string, ComputedSpec<T>>;
  having?: Readonly<{ column: AggregateColumn<T>; op: string; value: unknown }>;
  orderBy?: ReadonlyArray<{ column: AggregateColumn<T>; dir?: OrderDir }>;
  limit?: number;
  offset?: number;
}

type AggComputedType<T extends DeclaredTable, C> = C extends { fn: 'count' }
  ? number
  : C extends { fn: 'sum' | 'avg' }
    ? number | null
    : C extends { fn: 'min' | 'max'; column: infer Col extends keyof Entity<T> }
      ? Entity<T>[Col] | null
      : number | null;

export type AggregateResult<T extends DeclaredTable, Spec extends AggregateSpec<T>> = {
  [K in Spec['groupBy'] extends readonly (infer G extends keyof Entity<T>)[] ? G : never]: Entity<T>[K];
} & {
  [K in keyof Spec['computed']]: AggComputedType<T, Spec['computed'][K]>;
};

/** Ordered field list for an aggregate spec: group-key cols then computed keys. */
export function describeAggregate<T extends DeclaredTable>(spec: AggregateSpec<T>): readonly string[] {
  const keys = (spec.groupBy ?? []).map(k => String(k));
  return [...keys, ...Object.keys(spec.computed)];
}
/** Assemble a SearchResult (reuses buildListResult; preserves _score on hits). */
export function buildSearchResult<Row extends Record<string, unknown>>(
  rows: readonly SearchHit<Row>[],
  opts?: { limit?: number; select?: readonly (keyof Row)[]; total?: number },
): SearchResult<Row | Partial<Row>> {
  const limit = opts?.limit;
  const hasMore = typeof limit === 'number' && rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const items = kept.map(hit => {
    // `SearchHit<Row>` is `Row & {_score?}`, so it *is* a `Row` for projection
    // purposes — no `hit as Row` needed once `project` is keyed on the argument.
    const base = opts?.select ? project(hit, opts.select) : hit;
    // preserve the ranking score on the projected hit
    return hit._score !== undefined ? { ...base, _score: hit._score } : base;
  });
  const result: SearchResult<Row | Partial<Row>> = { items, hasMore };
  return opts?.total !== undefined ? { ...result, total: opts.total } : result;
}
