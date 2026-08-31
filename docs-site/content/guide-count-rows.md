Three ways, for three different questions.

## Count alongside a page — free

`list()` already returns the total:

```ts
const { rows, total } = await userRepo.list({
  where: { active: { eq: true } },
  page: { limit: 20, offset: 0 },
});
// rows.length === 20, total === 1_483
```

`total` is the count matching the `where` **ignoring the page**, which is what a paginator needs. Do not run a second count query for this.

## Count only

```ts
const { rows } = await userRepo.list({ where: { active: { eq: true } }, page: { limit: 0 } });
const count = rows.length; // wrong — this is 0
```

Use `aggregate` instead:

```ts
const [row] = await userRepo.aggregate({
  where: { active: { eq: true } },
  computed: [{ fn: 'count', column: 'id', as: 'n' }],
});
const count = Number(row?.n ?? 0);
```

> [!WARNING]
> `COUNT` returns `bigint` in Postgres and MySQL, which node-postgres and mysql2
> give you as a **string** by default. `row.n` is `'1483'`, and `'1483' > 100` is
> `false` in the comparison you meant. Always `Number(...)` it.

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

Two behaviours to keep straight: `COUNT(*)` counts rows; `COUNT(col)` counts rows where `col` is not null. If you want "how many rows" and you count a nullable column, you get a smaller number and no error.

## Existence — do not count

```ts
const found = await userRepo.findOne({ email: { eq: 'a@b.c' } });
if (found !== undefined) {
  /* exists */
}
```

Counting to test existence makes the database examine every match. `findOne` stops at the first, and an `EXISTS` subquery is better still inside a larger query — see [`EXISTS` subqueries](./guide-exists-subquery.html).

## Exact counts are expensive

`COUNT(*)` with no `WHERE` on a large Postgres table is a full scan; there is no stored row count. On a hundred-million-row table that is seconds, per request.

If an approximation will do:

```sql
SELECT reltuples::bigint FROM pg_class WHERE relname = 'events';
```

Accurate to the last `ANALYZE`, and O(1). Serve it through a [named raw query](./raw-sql.html).

For a paginated UI, the honest alternative is not to show a total at all — fetch `limit + 1` rows and report "more results" rather than "page 7 of 4,318". That is also what makes [cursor pagination](./guide-cursor-pagination.html) work.

---

See also: [Aggregates](./aggregations.html) · [Cursor-based pagination](./guide-cursor-pagination.html) · [`EXISTS` subqueries](./guide-exists-subquery.html)
