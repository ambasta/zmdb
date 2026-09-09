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

/** Execution facts shared by compiled statements and structural subquery targets. */
export type QueryEffects =
  | { readonly operation: 'SELECT'; readonly requiresPrimary: boolean; readonly returnsRows: true }
  | {
      readonly operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'UNKNOWN';
      readonly requiresPrimary: true;
      readonly returnsRows: boolean;
    };

export type SubqueryTarget<V = unknown> =
  | {
      compile(): {
        readonly text: string;
        readonly parameters: readonly unknown[];
        readonly effects: QueryEffects;
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

/** Values supported by SQL cursor comparisons and their lossless token encoding. */
export type CursorValue = string | number | boolean | bigint | Date;

export type CursorOrderByDTO<T extends DeclaredTable> = ReadonlyArray<{
  column: {
    [K in keyof Entity<T>]-?: null extends Entity<T>[K]
      ? never
      : undefined extends Entity<T>[K]
        ? never
        : Entity<T>[K] extends CursorValue
          ? K
          : never;
  }[keyof Entity<T>];
  dir?: OrderDir;
}>;

export type OffsetPage = {
  mode: 'offset';
  limit: number;
  offset?: number | undefined;
  after?: never;
  before?: never;
};

export type CursorPage = {
  mode: 'cursor';
  limit: number;
  offset?: never;
} & ({ after?: string | undefined; before?: never } | { before?: string | undefined; after?: never });

export type PaginationDTO<_T extends DeclaredTable> = OffsetPage | CursorPage;

/** Schema-agnostic inputs to the SQL-facing DTO folders. */
export type OrderBySpec = ReadonlyArray<{
  column: PropertyKey;
  dir?: OrderDir;
}>;

/** Effective cursor ordering, with defaults and every primary-key tie-breaker resolved. */
export type CursorOrderSpec = ReadonlyArray<{ column: string; dir: OrderDir }>;

export type PaginationSpec = OffsetPage | CursorPage;

function base64Encode(str: string): string {
  if (globalThis.Buffer) return globalThis.Buffer.from(str, 'utf8').toString('base64url');
  if (globalThis.btoa) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  throw new Error('No base64 encoder available');
}

function base64Decode(str: string): string {
  const remainder = str.length % 4;
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(str.at(-1) ?? '');
  if (
    !/^[A-Za-z0-9_-]+$/.test(str) ||
    remainder === 1 ||
    (remainder === 2 && (last & 15) !== 0) ||
    (remainder === 3 && (last & 3) !== 0)
  ) {
    throw new Error('Invalid cursor: expected canonical base64url');
  }
  let bytes: Uint8Array;
  if (globalThis.Buffer) {
    bytes = globalThis.Buffer.from(str, 'base64url');
  } else if (globalThis.atob) {
    const base64 = str
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(str.length + ((4 - remainder) % 4), '=');
    bytes = Uint8Array.from(globalThis.atob(base64), char => char.charCodeAt(0));
  } else {
    throw new Error('No base64 decoder available');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function cursorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCursorKeys(values: Record<string, unknown>, order: CursorOrderSpec): void {
  if (order.length === 0 || Object.keys(values).length !== order.length) {
    throw new Error('Invalid cursor: values must match every ordered column exactly');
  }
  const seen = new Set<string>();
  for (const { column, dir } of order) {
    if (typeof column !== 'string' || column.length === 0 || (dir !== 'asc' && dir !== 'desc') || seen.has(column)) {
      throw new Error('Invalid cursor: invalid ordering');
    }
    seen.add(column);
    if (!Object.hasOwn(values, column)) throw new Error(`Invalid cursor: missing value for column "${column}"`);
  }
}

type EncodedCursorValue = readonly [
  type: 'string' | 'number' | 'boolean' | 'bigint' | 'date',
  value: string | number | boolean,
];

function encodeCursorValue(value: unknown): EncodedCursorValue {
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', Object.is(value, -0) ? '-0' : value];
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (value instanceof Date && Number.isFinite(value.getTime())) return ['date', value.toISOString()];
  throw new Error('Invalid cursor: ordered values must be defined, non-null scalar values');
}

function decodeCursorValue(encoded: unknown): CursorValue {
  if (!Array.isArray(encoded) || encoded.length !== 2) throw new Error('Invalid cursor: malformed scalar');
  const [type, value] = encoded;
  if (type === 'string' && typeof value === 'string') return value;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (type === 'number') {
    if (value === '-0') return -0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  if (type === 'bigint' && typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)) {
    const integer = BigInt(value);
    if (integer.toString() === value) return integer;
  }
  if (type === 'date' && typeof value === 'string') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime()) && date.toISOString() === value) return date;
  }
  throw new Error('Invalid cursor: malformed scalar');
}

/** Encode exactly the effective ordering and its scalar values; no legacy payload format. */
export function encodeCursor(values: Record<string, unknown>, order: CursorOrderSpec): string {
  if (!cursorRecord(values)) throw new Error('Invalid cursor: expected values object');
  assertCursorKeys(values, order);
  return base64Encode(
    JSON.stringify({
      order: order.map(({ column, dir }) => [column, dir]),
      values: Object.fromEntries(order.map(({ column }) => [column, encodeCursorValue(values[column])])),
    }),
  );
}

/** Decode and validate once against the caller's complete effective ordering, before SQL. */
export function decodeCursor(cursor: string, order: CursorOrderSpec): Record<string, CursorValue> {
  if (typeof cursor !== 'string' || cursor.length === 0) throw new Error('Invalid cursor: must be a non-empty string');
  try {
    const parsed: unknown = JSON.parse(base64Decode(cursor));
    if (
      !cursorRecord(parsed) ||
      Object.keys(parsed).length !== 2 ||
      !Array.isArray(parsed.order) ||
      !cursorRecord(parsed.values)
    ) {
      throw new Error('Invalid cursor: malformed payload');
    }
    if (parsed.order.length !== order.length) throw new Error('Invalid cursor: ordering mismatch');
    for (let i = 0; i < order.length; i++) {
      const expected = order[i];
      const received: unknown = parsed.order[i];
      if (
        !Array.isArray(received) ||
        received.length !== 2 ||
        received[0] !== expected?.column ||
        received[1] !== expected?.dir
      ) {
        throw new Error('Invalid cursor: ordering mismatch');
      }
    }
    const values = parsed.values;
    assertCursorKeys(values, order);
    return Object.fromEntries(order.map(({ column }) => [column, decodeCursorValue(values[column])]));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid cursor')) throw err;
    throw new Error(`Invalid cursor format: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
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
export type ListDTO<T extends DeclaredTable> = {
  where?: WhereDTO<T>;
  select?: readonly (keyof Entity<T>)[];
} & ({ page?: OffsetPage; orderBy?: OrderByDTO<T> } | { page: CursorPage; orderBy?: CursorOrderByDTO<T> });

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
  orderBy?: CursorOrderSpec;
  /** Rows arrived in reverse query order for a before page. Trim before reversing. */
  reverse?: boolean;
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
  const queryRows = hasMore ? rows.slice(0, limit) : rows;
  const kept = opts?.reverse ? queryRows.toReversed() : queryRows;
  const select = opts?.select;
  const items = select ? kept.map(r => project(r, select)) : kept;

  let computedCursor: string | undefined = opts?.cursor;
  if (!computedCursor && hasMore && opts?.orderBy) {
    const boundary = queryRows.at(-1);
    if (boundary) {
      computedCursor = encodeCursor(
        Object.fromEntries(opts.orderBy.map(({ column }) => [column, boundary[column]])),
        opts.orderBy,
      );
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
  params?: readonly unknown[] | Record<string, unknown>;
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
