// Read/Query DTO family — see ./SPEC.md.
// Types are compile-time only. `compileWhere` is the one runtime artifact.
// TDD: types + stubs land with the tests (red); impl fills the stubs (green).
import { isRecord } from '../index.ts';
import type { Entity } from '../index.ts';

// ---------------------------------------------------------------------------
// §1 WhereDTO + operator set
// ---------------------------------------------------------------------------
export interface FieldOps<V> {
  eq?: V;
  ne?: V;
  lt?: V;
  lte?: V;
  gt?: V;
  gte?: V;
  in?: readonly V[];
  nin?: readonly V[];
  like?: V extends string ? string : never;
  ilike?: V extends string ? string : never;
  isNull?: boolean;
  notNull?: boolean;
}

export type WhereDTO<S> = {
  [K in keyof Entity<S>]?: Entity<S>[K] | FieldOps<Entity<S>[K]>;
} & {
  and?: readonly WhereDTO<S>[];
  or?: readonly WhereDTO<S>[];
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
}

/**
 * Record view of a value, or `undefined` if it is not a plain object.
 *
 * Taking `unknown` is deliberate: narrowing a *generic* DTO (`WhereDTO<S>`) in
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
};

/**
 * Fold a WhereDTO into a query-compiler builder. Bare values become `eq`.
 * Fields/operators are applied in stable object-key order (golden SQL).
 * `and`/`or` groups compose; `or` members are ORed.
 */
export function compileWhere<S, B extends WhereTarget>(builder: B, where: WhereDTO<S> | undefined): B {
  if (!where) return builder;
  let b: B = builder;
  const applyField = (col: string, spec: unknown, connector: 'and' | 'or') => {
    const add = (op: string, value: unknown) =>
      (b = connector === 'or' ? b.orWhere(col, op, value) : b.where(col, op, value));
    const ops = asRecord(spec);
    if (ops) {
      for (const [op, value] of Object.entries(ops)) {
        if (op === 'isNull') {
          if (value) add('is null', null);
          else add('is not null', null);
        } else if (op === 'notNull') {
          add(value ? 'is not null' : 'is null', null);
        } else {
          const sql = OP_SQL[op];
          if (sql) add(sql, value);
        }
      }
    } else {
      // bare value ⇒ eq
      add('=', spec);
    }
  };
  // `and`/`or` are read from the typed DTO (no `val as readonly WhereDTO[]`),
  // while the guard proves the string-keyed field reads are safe. Keys are still
  // visited in insertion order, which the golden-SQL tests depend on.
  const { and, or } = where;
  const fields = asRecord(where);
  if (!fields) return b;
  for (const key of Object.keys(fields)) {
    if (key === 'and') {
      if (and) for (const sub of and) b = compileWhere(b, sub);
    } else if (key === 'or') {
      for (const sub of or ?? []) {
        const group = asRecord(sub);
        if (group) for (const [col, spec] of Object.entries(group)) applyField(col, spec, 'or');
      }
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
export type OrderByDTO<S> = ReadonlyArray<{ column: keyof Entity<S>; dir?: OrderDir }>;

/** Like {@link WhereTarget}: `this`-returning so folding preserves the builder type. */
export interface OrderTarget {
  orderBy(col: string, dir: OrderDir): this;
  limit(n: number): this;
  offset(n: number): this;
}
export type OffsetPage = { limit: number; offset?: number };
export type PaginationDTO<S> = OffsetPage | { limit: number; after?: Partial<Entity<S>>; before?: Partial<Entity<S>> };

/**
 * Schema-agnostic views of the order/page DTOs — exactly the fields the folders
 * read. `OrderByDTO<S>`/`PaginationDTO<S>` are structurally assignable to these
 * for *any* `S`, so callers pass their own typed DTO with no
 * `as OrderByDTO<CoreSchema<string>>` widening cast (which is what leaked into
 * consumer code, cf. COOKBOOK "sorting" example).
 */
export type OrderBySpec = ReadonlyArray<{ column: PropertyKey; dir?: OrderDir }>;
// `offset?: number | undefined` (not `offset?: number`) so callers under
// `exactOptionalPropertyTypes` can forward a possibly-absent offset positionally.
export type PaginationSpec = { limit: number; offset?: number | undefined };

export function applyOrderBy<B extends OrderTarget>(builder: B, order: OrderBySpec | undefined): B {
  if (!order) return builder;
  let b = builder;
  for (const { column, dir } of order) b = b.orderBy(String(column), dir ?? 'asc');
  return b;
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
export type Projection<S, K extends keyof Entity<S>> = Pick<Entity<S>, K>;

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
export interface GetOptions<S> {
  select?: readonly (keyof Entity<S>)[];
  populate?: readonly string[];
}
export type GetDTO<S, O extends GetOptions<S> = {}> = O['select'] extends readonly (infer K extends keyof Entity<S>)[]
  ? Projection<S, K>
  : Entity<S>;

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
export interface ListDTO<S> {
  where?: WhereDTO<S>;
  orderBy?: OrderByDTO<S>;
  page?: PaginationDTO<S>;
  select?: readonly (keyof Entity<S>)[];
}
export interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number;
  readonly hasMore: boolean;
  readonly cursor?: string;
}
/**
 * Assemble a ListResult: limit+1 trim ⇒ hasMore, per-item projection, opt-in total.
 *
 * Overloaded on `select` so the no-projection call keeps `ListResult<Row>` instead
 * of widening to `ListResult<Row | Partial<Row>>` — the widening is what forced
 * `as ListResult<Entity<S>>` in `@zmdb/repository`'s `list()`.
 */
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: { limit?: number; total?: number },
): ListResult<Row>;
export function buildListResult<Row extends Record<string, unknown>, K extends keyof Row>(
  rows: readonly Row[],
  opts: { limit?: number; total?: number; select: readonly K[] },
): ListResult<Pick<Row, K>>;
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: { limit?: number; select?: readonly (keyof Row)[]; total?: number },
): ListResult<Row | Partial<Row>>;
export function buildListResult<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  opts?: { limit?: number; select?: readonly (keyof Row)[]; total?: number },
): ListResult<Row | Partial<Row>> {
  const limit = opts?.limit;
  const hasMore = typeof limit === 'number' && rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const items = opts?.select ? kept.map(r => project(r, opts.select)) : kept;
  const result: ListResult<Row | Partial<Row>> = { items, hasMore };
  return opts?.total !== undefined ? { ...result, total: opts.total } : result;
}
export interface SearchDTO<S> {
  query: string;
  columns: readonly (keyof Entity<S>)[];
  where?: WhereDTO<S>;
  page?: PaginationDTO<S>;
  rank?: boolean;
}
export type SearchHit<Row> = Row & { readonly _score?: number };
export type SearchResult<Row> = ListResult<SearchHit<Row>>;

// ---------------------------------------------------------------------------
// §8 AggregateResult
// ---------------------------------------------------------------------------
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
export interface AggregateSpec<S> {
  groupBy?: readonly (keyof Entity<S>)[];
  computed: Readonly<Record<string, { fn: AggFn; column?: keyof Entity<S> }>>;
}
type AggComputedType<S, C> = C extends { fn: 'count' }
  ? number
  : C extends { fn: 'sum' | 'avg' }
    ? number | null
    : C extends { fn: 'min' | 'max'; column: infer Col extends keyof Entity<S> }
      ? Entity<S>[Col] | null
      : number | null;
export type AggregateResult<S, Spec extends AggregateSpec<S>> = {
  [K in Spec['groupBy'] extends readonly (infer G extends keyof Entity<S>)[] ? G : never]: Entity<S>[K];
} & {
  [K in keyof Spec['computed']]: AggComputedType<S, Spec['computed'][K]>;
};

/** Ordered field list for an aggregate spec: group-key cols then computed keys. */
export function describeAggregate<S>(spec: AggregateSpec<S>): readonly string[] {
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
