> **ToDo / feature gap.** `UpdateBuilder.set()` takes values, not expressions, so
> `SET views = views + 1` is not expressible. There is no `sql` expression type in
> the update path.

## What you cannot write

```ts
await postRepo.update(id, { views: { increment: 1 } }); // no such API
c.updateTable('posts').set({ views: c.ref('views').plus(1) }); // no such API
```

## The read-modify-write, and why it is wrong alone

```ts
const post = await postRepo.findById(id);
await postRepo.update(id, { views: (post?.views ?? 0) + 1 });
```

Two concurrent requests both read `10` and both write `11`. One view is lost. Under load you lose most of them, and nothing errors — the count is just quietly low, which is why this bug survives in production for years.

## Workaround 1 — raw SQL through the driver

The correct fix, because the database does the arithmetic atomically:

```ts
await driver.execute({
  text: 'UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2',
  parameters: [1, id],
});
```

One statement, no race, no lost updates. Keep these in a named module so the SQL is reviewed once and the call sites stay clean:

```ts
export const counters = {
  incrementViews: (id: number) =>
    driver.execute({
      text: 'UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2',
      parameters: [1, id],
    }),
};
```

Interpolate nothing. The delta is a parameter; the column name is a literal you wrote. See [Raw SQL](./raw-sql.html).

Returning the new value, on Postgres:

```ts
const [row] = await driver.execute({
  text: 'UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2 RETURNING "views"',
  parameters: [1, id],
});
```

MySQL has no `RETURNING` — issue a `SELECT` after, inside a transaction if you need the pair to be consistent.

## Workaround 2 — optimistic concurrency

If you want to stay in the typed API, make the lost update detectable:

```ts
const post = await postRepo.findById(id);
if (post === undefined) return;

const affected = await driver.execute({
  text: 'UPDATE "posts" SET "views" = $1 WHERE "id" = $2 AND "views" = $3',
  parameters: [post.views + 1, id, post.views],
});
// zero rows affected → someone else won; retry
```

Correct, but it is still raw SQL plus a retry loop, so workaround 1 is strictly simpler.

## Workaround 3 — do not store a counter

Often the best answer. Insert an event row and aggregate:

```ts
await viewRepo.create({ postId: id, at: new Date() });

const [row] = await viewRepo.aggregate({
  where: { postId: { eq: id } },
  computed: [{ fn: 'count', column: 'id', as: 'views' }],
});
```

No contention at all — inserts do not conflict — and you gain history. The cost is a growing table and a slower read, which a periodic rollup or a [cached](./caching.html) value fixes. For high-write counters this is what production systems do anyway, precisely to avoid a single hot row.

## What it would take

`set()` would need to accept an expression, not just a value — something like `set({ views: raw('views + ?', 1) })` or a small column-reference expression type. That is a genuine design decision rather than a missing helper: an expression type in the update path implies deciding how far it goes (arithmetic only? functions? subqueries?), how it is parameterised, and how it stays injection-safe. The same expression type unblocks [toggling a boolean](./guide-toggle-boolean.html), [bulk update](./guide-bulk-update.html) and `ON CONFLICT ... SET x = EXCLUDED.x` for [upsert](./upsert.html) — four features, one decision.

---

See also: [Toggle a boolean](./guide-toggle-boolean.html) · [Bulk update](./guide-bulk-update.html) · [Raw SQL](./raw-sql.html)
