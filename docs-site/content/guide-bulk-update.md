> **ToDo / feature gap.** `BaseRepository.update` takes one id and there is no
> `updateWhere`. The compiler's closed SET expressions operate on the same column;
> they do not provide a `CASE` expression or a `VALUES` source, so "update many
> rows, each to a different value" still has no typed form.

## Two different problems

**Same value, many rows** — this works today, via the builder:

```ts
const q = createQueryCompiler('postgres')
  .updateTable('posts')
  .set({ published: true })
  .where('author_id', '=', authorId)
  .compile();

await driver.execute(q);
```

One statement. `UpdateBuilder` is `set / where / returning / compile`, which covers this case fully — the repository just does not expose it.

**Different value per row** — this is the gap.

```ts
for (const { id, title } of updates) await postRepo.update(id, { title }); // N statements
```

N round trips, and no atomicity unless you wrap it.

## Workaround 1 — a transaction around the loop

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  const posts = postRepo.withTransaction(tx);
  for (const { id, title } of updates) await posts.update(id, { title });
});
```

Still N statements, but all-or-nothing. Acceptable for tens of rows; painful for thousands, because the cost is the round trips, not the statements.

## Workaround 2 — one statement with `CASE`

```ts
const ids = updates.map(u => u.id);
const cases = updates.map((_, i) => `WHEN $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ');
const params = updates.flatMap(u => [u.id, u.title]);

await driver.execute({
  text: `UPDATE "posts" SET "title" = CASE "id" ${cases} END
         WHERE "id" IN (${ids.map((_, i) => `$${params.length + i + 1}`).join(', ')})`,
  parameters: [...params, ...ids],
});
```

One round trip. Note that every value is a placeholder — the only thing interpolated is the generated placeholder _positions_, which is the line that keeps this injection-safe. Never interpolate `u.title`.

Batch it. A thousand rows in one statement exceeds parameter limits on every dialect — chunk to a few hundred.

## Workaround 3 — `UPDATE ... FROM VALUES` (Postgres)

Cleaner and faster than `CASE`:

```sql
UPDATE "posts" AS p
SET "title" = v.title
FROM (VALUES ($1::int, $2::text), ($3::int, $4::text)) AS v(id, title)
WHERE p.id = v.id
```

The casts on the first tuple are required — without them Postgres cannot infer the `VALUES` column types and errors. MySQL's equivalent is a join against a derived table; SQLite 3.33+ supports `UPDATE ... FROM`.

## Workaround 4 — temp table, for large volumes

For tens of thousands of rows: `COPY` (or a batched insert) into a temporary table, then one `UPDATE ... FROM` join. This is what a bulk loader does, and it is an order of magnitude faster than anything statement-per-row.

## Bulk _delete_ has the same shape

```ts
const q = createQueryCompiler('postgres').deleteFrom('posts').where('author_id', '=', id).compile();
await driver.execute(q);
```

There is no `deleteWhere` on the repository either — the builder covers it.

## What it would take

Two independent pieces:

- **`updateWhere(where, values)` / `deleteWhere(where)` on the repository.** Straightforward — the builder already does this, and the DTO `where` already compiles. The reason to be careful is that an accidental empty `where` updates every row, so it should probably require a non-empty predicate.
- **Per-row values in one statement.** Needs a `VALUES` source plus a `CASE` or source-column expression
  surface. The current vocabulary deliberately references only the column named by the `set()` key, so this
  is wider than [increment](./guide-increment-decrement.html) or [toggle](./guide-toggle-boolean.html).

The first is a small, safe addition; the second is the real feature.

---

See also: [Query Builder](./select.html) · [Increment / decrement](./guide-increment-decrement.html) · [Transactions](./transactions.html)
