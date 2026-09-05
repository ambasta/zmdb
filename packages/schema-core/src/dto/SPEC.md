# SPEC — Read/Query DTO family (frozen)

Covers the typed read/query surface derived from a table's **declared type** — the interface it was written as, with its tags. `T` below was `S` and meant a `CoreSchema` value; the derivations no
longer read a column map, so the parameter is the declaration and this document is keyed the same way `Entity<T>` is. Every shape here also re-exports from `@zmdb/schema-core/derive/query`, which is
the same type by a second name.

`T` is constrained: every type below reads `T extends DeclaredTable`, so passing a schema value where a declaration belongs does not compile. The one exception is deliberate — `UnknownRow`, the row of
a table named by a string, which a subquery target is. A string index signature satisfies the constraint where a schema value does not, which is what keeps `WhereDTO<UnknownRow>` legal without
reopening `WhereDTO<typeof userSchema>`.

All types are compile-time only; the one runtime artifact is `compileWhere` (WhereDTO → query-compiler where-clauses). No proxies, no identity map. ESM, Node 26, TS 7.

Epics: #163 (read/query DTO family), #177 (typed query & filter surface).

## 1. WhereDTO + operator set (#178/#179/#180)

```ts
type FieldOps<V> = {
  eq?: V;
  ne?: V;
  lt?: V;
  lte?: V;
  gt?: V;
  gte?: V; // comparison
  in?: readonly V[];
  nin?: readonly V[]; // membership
  like?: string;
  ilike?: string; // string match (V must be string)
  isNull?: boolean;
  notNull?: boolean; // null checks
};

type WhereDTO<T extends DeclaredTable> = {
  [K in keyof Entity<T>]?: Entity<T>[K] | FieldOps<Entity<T>[K]>;
} & {
  and?: readonly WhereDTO<T>[];
  or?: readonly WhereDTO<T>[];
};
```

- A bare value (`{ role: 'admin' }`) is shorthand for `{ role: { eq: 'admin' } }`.
- Multiple operators on one field AND together; multiple fields AND together.
- `and`/`or` compose nested groups. `or` at the same level ORs its members.
- `like`/`ilike` are only valid when the field type is `string` (enforced by `FieldOps<V>`: those keys accept `string`).

### Runtime: `compileWhere(where, apply)`

Deterministically folds a `WhereDTO` into a query-compiler `SelectBuilder` by calling `.where(col, op, value)` / `.orWhere(...)`. Operator mapping:

| DTO op      | SQL                                                         |
| ----------- | ----------------------------------------------------------- |
| eq          | `=` · ne → `!=` · lt `<` · lte `<=` · gt `>` · gte `>=`     |
| in          | `IN` · nin → `NOT IN`                                       |
| like        | `LIKE` · ilike → `ILIKE` (pg) / `LIKE` (others, documented) |
| isNull:true | `IS NULL` · notNull:true → `IS NOT NULL`                    |

- Field/operator order within a group is stable (object key order) for golden SQL.
- Empty WhereDTO ⇒ no predicate added. `{}` is a filter nobody wrote and `list()` with no filter is the caller that writes it, so it stays legal; what refuses an unfiltered write is `BaseRepository`,
  which will not execute an `UPDATE` or `DELETE` whose compiled text has no `WHERE` (`repository/SPEC.md` §2.1).
- **An empty operator map on a column is a `ValidationError`** naming the column. `{ age: {} }` is not the same case as `{}`: every key of `FieldOps` is optional, so it type-checks, and it is what a
  conditionally assembled filter produces — `{ age: min === undefined ? {} : { gte: min } }`. Folding it to nothing means the caller named a column and got every row (#608).
- **An operator key that is not in the table above is a `ValidationError`** naming the column, the key, and the set that would have been accepted. It is not skipped: skipping emitted a statement with
  one predicate fewer than the caller wrote, which on an `UPDATE` or `DELETE` is the whole table. The membership test is `Object.hasOwn`, because the map is an object literal and every
  `Object.prototype` member — `toString`, `constructor`, `valueOf`, `__proto__` — passes a truthy read as a function or an object, and a where-DTO is the path user JSON takes into the builder (#364).

### The fold is target-neutral; the predicate list is not

Recorded during the non-SQL target feasibility study (`@zmdb/query-compiler`'s `src/targets/SPEC.md`), because both halves of it are load-bearing and neither was written down.

**The fold names no SQL.** `compileWhere`, `applyOrderBy`, `applyKeysetFilter` and `applyPagination` take `WhereTarget` and `OrderTarget` — structural interfaces whose methods are
`where(col, op, value)` and `orderBy(col, dir)`, with everything past `where`/`orWhere` optional so a builder can decline a capability. Nothing in this file imports a dialect or constructs a
`CompiledQuery`. That is why these four functions are the seam a non-SQL target would implement, and why generalising `CompiledQuery` itself is unnecessary: this is already the generalisation.

**The list the fold produces has no grouping in it.** Predicates are appended flat, each carrying an `AND`/`OR` connector, and the compiler renders them in order without parentheses. The nesting comes
from SQL binding `AND` tighter than `OR`, which is what makes `[{a, AND}, {b, OR}, {c, AND}]` mean `a OR (b AND c)`. Two consequences:

- `and`/`or` groups in a `WhereDTO` do not always survive the fold. `applyKeysetFilter`'s branch wrapper spends its one `OR` on a branch's first predicate and conjoins the rest, so a user `or` nested
  inside a keyset branch flattens into that branch's `AND`. The comment on `BranchTarget.orWhere` is the record of it; this is the same fact stated where a reader looks for the operator semantics.
- The list is therefore only meaningful to a target that has SQL's precedence. Any future non-SQL target has to nest the predicate tree first, which would also fix the bullet above.

## 2. OrderByDTO + PaginationDTO (#181/#182/#183)

```ts
type OrderDir = 'asc' | 'desc';
type OrderByDTO<T> = ReadonlyArray<{ column: keyof Entity<T>; dir?: OrderDir }>;
// dir defaults to 'asc'.

type OffsetPage = { limit: number; offset?: number };
type CursorPage<T> = { limit: number; after?: CursorOf<T>; before?: CursorOf<T> };
type PaginationDTO<T> = OffsetPage | CursorPage<T>;
// CursorOf<T> is an opaque encoding of the last row's order-key values.
```

- `applyOrderBy(builder, order)` emits `ORDER BY col dir, …` in array order.
- Offset pagination emits `LIMIT n OFFSET m`. Cursor (keyset) pagination emits a `WHERE (orderKey) > (cursor)` predicate + `LIMIT n` (frozen: requires a stable OrderBy; documented that cursor needs a
  total order — typically the PK).
- The row-value spelling above is the semantics, not the emitted text. `applyKeysetFilter` emits one branch per order key — the keys before it compared with `=`, the key itself with `>` or `<` — OR'd
  together, because `WhereTarget` has no way to say a row-value comparison and not every dialect has one. See §1's note on the flat predicate list for what that costs.

### Golden (postgres)

- `applyOrderBy(b, [{column:'age',dir:'desc'},{column:'id'}])` ⇒ `ORDER BY "age" DESC, "id" ASC`.
- `applyPagination(b, {limit:20,offset:40})` ⇒ `LIMIT 20 OFFSET 40`.
- `applyPagination(b, {limit:20})` ⇒ `LIMIT 20` (no OFFSET clause).
- Frozen: `applyOrderBy`/`applyPagination` return the builder unchanged when the arg is `undefined`; `dir` defaults to `'asc'`.

## 3. Typed select()/projection narrowing (#184/#185/#186)

```ts
type Projection<T, K extends keyof Entity<T>> = Pick<Entity<T>, K>;
// select(['a','b']) narrows the row type to Projection<T,'a'|'b'>.
```

- `select()` with no args ⇒ full `Entity<T>`.
- Repository read methods gain a `select` option that narrows the return type.
- Runtime helper `project(row, cols)` returns a new object with only `cols` (stable order = `cols` order); `project(row, undefined)` returns `row` as-is.
- Frozen: projecting a key absent from the row yields `undefined` for that key (no throw); projection never mutates the input row.

## 4. GetDTO + Projection (#164/#165/#166)

```ts
interface GetOptions<T> {
  select?: readonly (keyof Entity<T>)[];
  populate?: readonly RelationKeys<T>[];
}
type GetDTO<T, O extends GetOptions<T> = {}> = O['select'] extends readonly (infer K extends keyof Entity<T>)[] ? Projection<T, K> : Entity<T>;
```

- No options ⇒ `Entity<T>`. `select` narrows to the picked columns.
- `populate` names relations, and a declared type carries them, so it is `RelationKeys<T>` rather than `readonly string[]` — a misspelled relation is a compile error. The widening it implies is
  `Populated<T, K>` in `../derive/query.ts`; GetDTO here freezes the select-narrowing behavior and the `GetOptions` shape.
- `findById` returns `GetDTO<T,O> | undefined`.
- Runtime `getResult(row, opts)` applies `project(row, opts.select)`.

## 5. ListDTO + ListResult (#167/#168/#169)

```ts
interface ListDTO<T> {
  where?: WhereDTO<T>;
  orderBy?: OrderByDTO<T>;
  page?: PaginationDTO<T>;
  select?: readonly (keyof Entity<T>)[];
}
interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number;
  readonly hasMore: boolean;
  readonly cursor?: string;
}
```

- `total` present only when an offset page requests it (extra COUNT query) — opt-in.
- `hasMore` computed by fetching `limit+1` and trimming (no COUNT needed).
- Runtime `buildListResult(rows, { limit, select, total? })`: if `rows.length > limit`, set `hasMore=true` and drop the extra row; project each item by `select`; attach `total` when provided. Frozen:
  with no `limit`, `hasMore=false` and all rows are returned.

## 6. SearchDTO (#170/#171/#172)

```ts
interface SearchDTO<T> {
  query: string;
  columns: readonly (keyof Entity<T>)[];
  where?: WhereDTO<T>;
  page?: PaginationDTO<T>;
  rank?: boolean;
}
type SearchHit<Row> = Row & { readonly _score?: number };
type SearchResult<Row> = ListResult<SearchHit<Row>>;
```

- `query` is the full-text term; `columns` the searched columns.
- `rank:true` adds a `_score` field (ts_rank on pg) and orders by it desc.
- Runtime `buildSearchResult(rows, opts)`: reuses `buildListResult` (limit+1 trim, projection, total) over `SearchHit` rows; `_score` is preserved on items when present. Frozen: when `rank` is
  false/absent, `_score` is simply absent.

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

## 8. AggregateResult<T, Spec> (#197/#198/#199)

```ts
type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
interface AggregateSpec<T> {
  groupBy?: readonly (keyof Entity<T>)[];
  computed: Readonly<Record<string, { fn: AggFn; column?: keyof Entity<T> }>>;
}
type AggComputedType<T, C> = C extends { fn: 'count' }
  ? number
  : C extends { fn: 'sum' | 'avg' }
    ? number | null
    : C extends { fn: 'min' | 'max'; column: infer Col extends keyof Entity<T> }
      ? Entity<T>[Col] | null
      : number | null;

type AggregateResult<T, Spec extends AggregateSpec<T>> =
  // groupBy key columns, typed from the entity
  {
    [K in Spec['groupBy'] extends readonly (infer G extends keyof Entity<T>)[] ? G : never]: Entity<T>[K];
  } & { [K in keyof Spec['computed']]: AggComputedType<T, Spec['computed'][K]> }; // one typed field per computed aggregate
```

- `count` ⇒ `number`; `sum`/`avg` ⇒ `number | null`; `min`/`max` ⇒ the source column's type `| null`.
- The result row is the group-key columns plus one field per computed aggregate.
- Compile-time only; the query-compiler `aggregateSelectFrom` produces the SQL.
- Runtime `describeAggregate(spec)` returns the ordered field list (for callers that assemble typed rows); frozen: group-key fields first (spec order), then computed fields (spec key order).
