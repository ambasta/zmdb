// Read/Query DTO family — see ./SPEC.md.
// Types are compile-time only. `compileWhere` is the one runtime artifact.
// TDD: types + stubs land with the tests (red); impl fills the stubs (green).
import type { CoreSchema } from '../index.ts';
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

// Minimal structural view of the query-compiler SelectBuilder we drive.
export interface WhereTarget {
  where(col: string, op: string, value: unknown): WhereTarget;
  orWhere(col: string, op: string, value: unknown): WhereTarget;
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
export function compileWhere<B extends WhereTarget>(builder: B, where: WhereDTO<CoreSchema<string>> | undefined): B {
  if (!where) return builder;
  let b: WhereTarget = builder;
  const applyField = (col: string, spec: unknown, connector: 'and' | 'or') => {
    const add = (op: string, value: unknown) =>
      (b = connector === 'or' ? b.orWhere(col, op, value) : b.where(col, op, value));
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      const ops = spec as Record<string, unknown>;
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
  for (const [key, val] of Object.entries(where)) {
    if (key === 'and') {
      for (const sub of val as readonly WhereDTO<CoreSchema<string>>[]) b = compileWhere(b as B, sub);
    } else if (key === 'or') {
      for (const sub of val as readonly Record<string, unknown>[]) {
        for (const [col, spec] of Object.entries(sub)) applyField(col, spec, 'or');
      }
    } else {
      applyField(key, val, 'and');
    }
  }
  return b as B;
}

// ---------------------------------------------------------------------------
// §2 OrderBy + Pagination  (implemented in #183)
// ---------------------------------------------------------------------------
export type OrderDir = 'asc' | 'desc';
export type OrderByDTO<S> = ReadonlyArray<{ column: keyof Entity<S>; dir?: OrderDir }>;

export interface OrderTarget {
  orderBy(col: string, dir: OrderDir): OrderTarget;
  limit(n: number): OrderTarget;
  offset(n: number): OrderTarget;
}
export type OffsetPage = { limit: number; offset?: number };
export type PaginationDTO<S> = OffsetPage | { limit: number; after?: unknown; before?: unknown };

export function applyOrderBy<B extends OrderTarget>(builder: B, order: OrderByDTO<CoreSchema<string>> | undefined): B {
  if (!order) return builder;
  let b: OrderTarget = builder;
  for (const { column, dir } of order) b = b.orderBy(String(column), dir ?? 'asc');
  return b as B;
}
export function applyPagination<B extends OrderTarget>(builder: B, page: PaginationDTO<CoreSchema<string>> | undefined): B {
  if (!page) return builder;
  let b: OrderTarget = builder.limit(page.limit);
  if ('offset' in page && typeof page.offset === 'number') b = b.offset(page.offset);
  return b as B;
}

// ---------------------------------------------------------------------------
// §3 Projection  (types only; narrowing wired in #186)
// ---------------------------------------------------------------------------
export type Projection<S, K extends keyof Entity<S>> = Pick<Entity<S>, K>;

/** Narrow a row to `cols` (new object, stable order); passthrough when undefined. */
export function project<Row extends Record<string, unknown>, K extends keyof Row>(
  row: Row,
  cols: readonly K[] | undefined,
): Row | Pick<Row, K> {
  if (!cols) return row;
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
export interface SearchDTO<S> {
  query: string;
  columns: readonly (keyof Entity<S>)[];
  where?: WhereDTO<S>;
  page?: PaginationDTO<S>;
  rank?: boolean;
}
export type SearchHit<Row> = Row & { readonly _score?: number };
export type SearchResult<Row> = ListResult<SearchHit<Row>>;
