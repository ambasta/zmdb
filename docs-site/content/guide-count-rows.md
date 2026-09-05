Three ways, for three different questions.

## Alongside a page — `hasMore`, not a total

```ts
const { items, hasMore, total } = await userRepo.list({
  where: { active: { eq: true } },
  page: { limit: 20, offset: 0 },
});
// items.length === 20, hasMore === true, total === undefined
```

`ListResult` declares `total?: number`, and **`list()` never populates it.** The field exists because `buildListResult` accepts an opt-in `total`, and `list()` does not pass one — so reading `total`
from a `list()` result gets you `undefined`, not a count.

What you do get for free is `hasMore`, and it is genuinely free: `list()` fetches `limit + 1` rows and reports whether the extra one came back. That answers "is there a next page" without a second
query, which is what most paginators actually need.

A count matching the `where` and ignoring the page is a **second query**, and there is no way around that — see the next section, and see the last section for why you may not want it at all.

## Count only

```ts
const { items } = await userRepo.list({ where: { active: { eq: true } }, page: { limit: 0 } });
const count = items.length; // wrong — this is 0
```

Use `aggregate` instead:

```ts
const [row] = await userRepo.aggregate({
  where: { active: { eq: true } },
  computed: [{ fn: 'count', column: 'id', as: 'n' }],
});
const count = Number(row?.n ?? 0);
```

> [!WARNING] `COUNT` returns `bigint` in Postgres and MySQL, which node-postgres and mysql2 give you as a **string** by default. `row.n` is `'1483'`, and `'1483' > 100` is `false` in the comparison
> you meant. Always `Number(...)` it.

## Count per group

```ts
const rows = await postRepo.aggregate({
  computed: [{ fn: 'count', column: 'id', as: 'posts' }],
  groupBy: ['author_id'],
  having: { posts: { gt: 5 } },
  orderBy: [{ column: 'posts', dir: 'desc' }],
  limit: 10,
});
```

`having` filters on the computed alias, `where` filters rows before grouping. Putting a condition in the wrong one is the usual mistake and changes the answer.

## Distinct, and non-null

```ts
computed: [{ fn: 'count', column: 'author_id', as: 'authors', distinct: true }];
```

Two behaviours to keep straight: `COUNT(*)` counts rows; `COUNT(col)` counts rows where `col` is not null. If you want "how many rows" and you count a nullable column, you get a smaller number and no
error.

## Existence — do not count

```ts
const found = await userRepo.findOne({ email: { eq: 'a@b.c' } });
if (found !== undefined) {
  /* exists */
}
```

Counting to test existence makes the database examine every match. `findOne` stops at the first, and an `EXISTS` subquery is better still inside a larger query — see
[`EXISTS` subqueries](./guide-exists-subquery.html).

## Exact counts are expensive

`COUNT(*)` with no `WHERE` on a large Postgres table is a full scan; there is no stored row count. On a hundred-million-row table that is seconds, per request.

If an approximation will do:

```sql
SELECT reltuples::bigint FROM pg_class WHERE relname = 'events';
```

Accurate to the last `ANALYZE`, and O(1). Serve it through a [named raw query](./raw-sql.html).

For a paginated UI, the practical alternative is not to show a total at all — fetch `limit + 1` rows and report "more results" rather than "page 7 of 4,318". That is exactly what `hasMore` is, and it
is what makes [cursor pagination](./guide-cursor-pagination.html) work.

---

See also: [Aggregates](./aggregations.html) · [Cursor-based pagination](./guide-cursor-pagination.html) · [`EXISTS` subqueries](./guide-exists-subquery.html)
