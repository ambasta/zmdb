import { type DeclaredTable, type RelationKeys } from '../derive/index.js';
import { type Entity } from '../index.js';

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
  | {
      compile(): {
        readonly text: string;
        readonly parameters: readonly unknown[];
        readonly telemetry?: {
          readonly system: string;
          readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
          readonly collection: string;
        };
      };
      readonly _type?: V;
    }
  | { table: string; select?: readonly string[]; where?: WhereDTO<UnknownRow>; readonly _type?: V };

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

// ---------------------------------------------------------------------------
// §2 OrderBy + Pagination  (implemented in #183)
// ---------------------------------------------------------------------------
export type OrderDir = 'asc' | 'desc';

export type OrderByDTO<T extends DeclaredTable> = ReadonlyArray<{
  column: keyof Entity<T>;
  dir?: OrderDir;
}>;

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

export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(json).toString('base64url');
  }
  if (globalThis.btoa) {
    return globalThis.btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  throw new Error('No base64 encoder available');
}

export function decodeCursor(cursor: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof cursor === 'object' && cursor !== null && !Array.isArray(cursor)) {
    return cursor;
  }
  if (typeof cursor !== 'string' || !cursor.trim()) {
    throw new Error('Invalid cursor: must be a non-empty string or object');
  }
  try {
    let parsed: unknown;
    if (globalThis.Buffer) {
      const buf = globalThis.Buffer.from(cursor, 'base64url');
      parsed = JSON.parse(buf.toString('utf-8'));
    } else if (globalThis.atob) {
      let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const json = globalThis.atob(base64);
      parsed = JSON.parse(json);
    } else {
      throw new Error('No base64 decoder available');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid cursor payload');
    }
    // boundary: JSON.parse returns unknown (untrusted client payload); runtime check above proves parsed is a non-null, non-array object.
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invalid cursor payload')) {
      throw err;
    }
    throw new Error(`Invalid cursor: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
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
 * `as ListResult<Entity<T>>` in `@zmdb/orm`'s `list()`.
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
