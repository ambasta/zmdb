# SPEC — Read/Query DTO family (frozen)

Covers the typed read/query surface derived from a `CoreSchema<S>`. All types are
compile-time only; the one runtime artifact is `compileWhere` (WhereDTO →
query-compiler where-clauses). No proxies, no identity map. ESM, Node 26, TS 7.

Epics: #163 (read/query DTO family), #177 (typed query & filter surface).

## 1. WhereDTO + operator set (#178/#179/#180)

```ts
type FieldOps<V> = {
  eq?: V; ne?: V;
  lt?: V; lte?: V; gt?: V; gte?: V;      // comparison
  in?: readonly V[]; nin?: readonly V[]; // membership
  like?: string; ilike?: string;          // string match (V must be string)
  isNull?: boolean; notNull?: boolean;    // null checks
};

type WhereDTO<S> = {
  [K in keyof Entity<S>]?: Entity<S>[K] | FieldOps<Entity<S>[K]>;
} & {
  and?: readonly WhereDTO<S>[];
  or?: readonly WhereDTO<S>[];
};
```

- A bare value (`{ role: 'admin' }`) is shorthand for `{ role: { eq: 'admin' } }`.
- Multiple operators on one field AND together; multiple fields AND together.
- `and`/`or` compose nested groups. `or` at the same level ORs its members.
- `like`/`ilike` are only valid when the field type is `string` (enforced by `FieldOps<V>`: those keys accept `string`).

### Runtime: `compileWhere(where, apply)`
Deterministically folds a `WhereDTO` into a query-compiler `SelectBuilder` by
calling `.where(col, op, value)` / `.orWhere(...)`. Operator mapping:

| DTO op | SQL |
|--------|-----|
| eq | `=` · ne → `!=` · lt `<` · lte `<=` · gt `>` · gte `>=` |
| in | `IN` · nin → `NOT IN` |
| like | `LIKE` · ilike → `ILIKE` (pg) / `LIKE` (others, documented) |
| isNull:true | `IS NULL` · notNull:true → `IS NOT NULL` |

- Field/operator order within a group is stable (object key order) for golden SQL.
- Empty WhereDTO ⇒ no predicate added.

## 2. OrderByDTO + PaginationDTO (#181/#182/#183)

```ts
type OrderDir = 'asc' | 'desc';
type OrderByDTO<S> = ReadonlyArray<{ column: keyof Entity<S>; dir?: OrderDir }>;
// dir defaults to 'asc'.

type OffsetPage = { limit: number; offset?: number };
type CursorPage<S> = { limit: number; after?: CursorOf<S>; before?: CursorOf<S> };
type PaginationDTO<S> = OffsetPage | CursorPage<S>;
// CursorOf<S> is an opaque encoding of the last row's order-key values.
```

- `applyOrderBy(builder, order)` emits `ORDER BY col dir, …` in array order.
- Offset pagination emits `LIMIT n OFFSET m`. Cursor (keyset) pagination emits a
  `WHERE (orderKey) > (cursor)` predicate + `LIMIT n` (frozen: requires a stable
  OrderBy; documented that cursor needs a total order — typically the PK).

### Golden (postgres)
- `applyOrderBy(b, [{column:'age',dir:'desc'},{column:'id'}])` ⇒ `ORDER BY "age" DESC, "id" ASC`.
- `applyPagination(b, {limit:20,offset:40})` ⇒ `LIMIT 20 OFFSET 40`.
- `applyPagination(b, {limit:20})` ⇒ `LIMIT 20` (no OFFSET clause).
- Frozen: `applyOrderBy`/`applyPagination` return the builder unchanged when the
  arg is `undefined`; `dir` defaults to `'asc'`.

## 3. Typed select()/projection narrowing (#184/#185/#186)

```ts
type Projection<S, K extends keyof Entity<S>> = Pick<Entity<S>, K>;
// select(['a','b']) narrows the row type to Projection<S,'a'|'b'>.
```

- `select()` with no args ⇒ full `Entity<S>`.
- Repository read methods gain a `select` option that narrows the return type.
- Runtime helper `project(row, cols)` returns a new object with only `cols`
  (stable order = `cols` order); `project(row, undefined)` returns `row` as-is.
- Frozen: projecting a key absent from the row yields `undefined` for that key
  (no throw); projection never mutates the input row.

## 4. GetDTO + Projection (#164/#165/#166)

```ts
interface GetOptions<S> { select?: readonly (keyof Entity<S>)[]; populate?: readonly string[]; }
type GetDTO<S, O extends GetOptions<S> = {}> =
  O['select'] extends readonly (infer K extends keyof Entity<S>)[] ? Projection<S, K> : Entity<S>;
```

- No options ⇒ `Entity<S>`. `select` narrows to the picked columns.
- `populate` widening is layered on by epic #188 (`Populated<S,K>`); GetDTO here
  freezes the select-narrowing behavior and the `GetOptions` shape.
- `findById` returns `GetDTO<S,O> | undefined`.
- Runtime `getResult(row, opts)` applies `project(row, opts.select)`.

## 5. ListDTO + ListResult (#167/#168/#169)

```ts
interface ListDTO<S> { where?: WhereDTO<S>; orderBy?: OrderByDTO<S>; page?: PaginationDTO<S>; select?: readonly (keyof Entity<S>)[]; }
interface ListResult<Row> { readonly items: readonly Row[]; readonly total?: number; readonly hasMore: boolean; readonly cursor?: string; }
```

- `total` present only when an offset page requests it (extra COUNT query) — opt-in.
- `hasMore` computed by fetching `limit+1` and trimming (no COUNT needed).

## 6. SearchDTO (#170/#171/#172)

```ts
interface SearchDTO<S> { query: string; columns: readonly (keyof Entity<S>)[]; where?: WhereDTO<S>; page?: PaginationDTO<S>; rank?: boolean; }
type SearchHit<Row> = Row & { readonly _score?: number };
type SearchResult<Row> = ListResult<SearchHit<Row>>;
```

- `query` is the full-text term; `columns` the searched columns.
- `rank:true` adds a `_score` field (ts_rank on pg) and orders by it desc.

## 7. OpenAPI get/list/search variants (#173/#174/#175)

- Extend `Variant` with `'get' | 'list' | 'search'`.
- `get` → response schema (= entity, or projected subset when documented).
- `list` → `{ items: [entity], total?, hasMore, cursor? }`.
- `search` → `list` items extended with optional `_score`.
- Deterministic key ordering; build-time only.

## Acceptance
- Type-level (`expectTypeOf`) assertions for each derived type.
- Runtime golden SQL for `compileWhere`, order/pagination.
- No proxies/identity map; parameterized SQL.
