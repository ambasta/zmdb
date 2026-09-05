`OFFSET 100000` makes the database produce and discard 100,000 rows before returning yours. Keyset (cursor) pagination filters instead, so page 5,000 costs the same as page 1 — and `list()` implements
it for you, cursor encoding included.

## Offset pagination, and where it breaks

```ts
await postRepo.list({
  orderBy: [{ column: 'created_at', dir: 'desc' }],
  page: { limit: 20, offset: page * 20 },
});
```

Two problems, both real in production:

- **Cost grows with the page number.** Deep pages get slow, and there is nothing to index your way out of.
- **Rows shift.** A row inserted while the user is on page 1 pushes one row from page 1 to page 2, so they see it twice — or a deletion makes them miss one entirely.

Fine for an admin table with 200 rows. Not fine for a feed.

## Keyset pagination, built in

Pass `after` instead of `offset` and read the `cursor` back off the result:

```ts
export async function feed(after?: string) {
  const page = await postRepo.list({
    orderBy: [{ column: 'created_at', dir: 'desc' }],
    page: { limit: 20, ...(after !== undefined ? { after } : {}) },
  });

  return { items: page.items, next: page.cursor, hasMore: page.hasMore };
}
```

That is the whole implementation. `list()` fetches `limit + 1` rows, trims to `limit`, sets `hasMore` from the extra row, and — when there is a next page — encodes the last kept row's sort-key values
into an opaque base64 `cursor`. Hand `page.cursor` back to the client and pass it as `after` next time.

`ListResult` is `{ items, total?, hasMore, cursor? }`. `total` is **never populated by `list()`** — a count is a second query you have to ask for, see [Count rows](./guide-count-rows.html).

## Ties are handled for you

If the sort column is not unique, rows with equal values can be skipped or repeated across a page boundary. This is the classic keyset bug, and `list()` closes it: if your `orderBy` does not already
include the primary key, it **appends `{ column: pk, dir: 'asc' }`** before compiling. So

```ts
orderBy: [{ column: 'created_at', dir: 'desc' }];
```

is executed as `ORDER BY created_at DESC, id ASC`, and the cursor carries both values.

The generated predicate is the proper lexicographic comparison, not a naive `created_at < :at`:

```sql
created_at < :at OR (created_at = :at AND id > :id)
```

One `OR` branch per sort column, each pinning the preceding columns with `=`. Your own `where` is replicated into every branch, so a tenant filter is not lost in the second branch — which is exactly
the mistake hand-written keyset pagination makes.

Composite keyset comparison therefore needs no builder and no raw SQL. Row-value syntax — `(created_at, id) < (:at, :id)` — is tidier for a human to read and would need [raw SQL](./raw-sql.html), but
it is not more correct.

## Index the sort key

```ts
createIndexDdl({ name: 'posts_created_id', table: 'posts', columns: ['created_at', 'id'] }, 'postgres');
```

Match the index column order to the `ORDER BY`, **including the primary key `list()` appends**. Without the index the database sorts the whole table per page and you have lost the point of keyset
pagination.

## The cursor is encoding, not authentication

`after` accepts either the opaque string from a previous result or a plain object of column values:

```ts
page: { limit: 20, after: { created_at: at, id } }   // equivalent, and useful in tests
```

Both end up as query parameters.

> [!WARNING] A base64 cursor is trivially forgeable — anyone can decode one, edit it, and send it back. A cursor must therefore never carry authorisation. Filter by tenant and by owner in the `where`
> clause on every page, so a forged cursor can move a caller _within_ their own result set and nowhere else. See [Authorization](./web-authorization.html).

A malformed cursor throws (`Invalid cursor format`, or `Invalid cursor: missing value for column "x"` when the `orderBy` changed between requests) — which reaches the router as a **500**, not a 400.
Decode-and-validate at your boundary if a bad cursor should be a client error.

## `before` is declared but ignored

> **ToDo / feature gap.** `PaginationDTO` accepts `{ limit, before }`, but `list()` only reads `after`. A `before` cursor is **silently dropped** — you get the first page back with no error, which is
> the worst possible failure mode for backwards pagination.

Until it lands, page backwards by reversing the `orderBy` and reversing the returned `items` in your code. What it would take: the `after` branch in `list()` generalised to emit the flipped comparison
operators for `before`, and `buildListResult` emitting a start cursor alongside the end cursor.

## What you give up

No page numbers, no "jump to page 40", no total. If the UI needs those, offset pagination is the better choice — see [Count rows](./guide-count-rows.html) for why the total is the expensive part.

## Both

Keyset for the infinite-scroll API, offset for the admin table. They are different products with different requirements, and using one implementation for both is how the feed gets slow.

---

See also: [Pagination](./pagination.html) · [Count rows](./guide-count-rows.html) · [Query Performance](./perf-queries.html)
