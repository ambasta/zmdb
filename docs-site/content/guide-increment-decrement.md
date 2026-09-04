> **ToDo / repository gap.** `UpdateBuilder.set()` supports the closed `inc()` /
> `dec()` expression vocabulary, but `BaseRepository.update()` still accepts values
> only. Use the compiler builder directly when the write must be atomic.

## What you cannot write

```ts
await postRepo.update(id, { views: { increment: 1 } }); // no such API
c.updateTable('posts').set({ views: c.ref('views').plus(1) }); // no such API
```

The compiler form is deliberately smaller than a general expression builder:

```ts
import { createQueryCompiler, inc } from '@zmdb/query-compiler';

const query = createQueryCompiler('postgres')
  .updateTable('posts')
  .set({ views: inc(1) })
  .where('id', '=', id)
  .compile();

await driver.execute(query);
```

The column comes from the `set()` key, the delta remains a parameter, and the same call emits the correct
placeholder and quoting for MySQL and SQLite.

## The read-modify-write, and why it is wrong alone

```ts
const post = await postRepo.findById(id);
await postRepo.update(id, { views: (post?.views ?? 0) + 1 });
```

Two concurrent requests both read `10` and both write `11`. One view is lost. Under load you lose most of them, and nothing errors — the count is just quietly low, which is why this bug survives in production for years.

## Raw SQL through the driver

The same atomic statement can be executed directly when code is not using the compiler builder:

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

No contention at all — inserts do not conflict — and you gain history. The cost is a growing table and a slower read, which a periodic rollup or a [cached](./caching.html) value fixes; the rollup now has somewhere to live — a `@Cron` task with `runs: 'once-per-cluster'` ([task scheduling](./web-task-scheduling.html)), which is exactly the kind of work that must not run on three replicas at once. For high-write counters this is what production systems do anyway, precisely to avoid a single hot row.

## What it would take

The compiler decision is made: expressions are a closed, symbol-branded vocabulary over the same column,
not caller-supplied SQL or a general AST. The remaining work is repository integration:
`BaseRepository.update()` must accept `SetValue<T>`, validate an expression's operand, and skip only that
column's ordinary row-value check. Until then, use the compiler form above or raw SQL.

---

See also: [Toggle a boolean](./guide-toggle-boolean.html) · [Bulk update](./guide-bulk-update.html) · [Raw SQL](./raw-sql.html)
