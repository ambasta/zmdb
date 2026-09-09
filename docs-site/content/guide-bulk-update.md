`BaseRepository.updateMany` applies one validated patch to every matching row in one statement. Ordinary values and closed SET expressions are both supported:

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies authorId, postRepo; this excerpt does not repeat those declarations."}
import { inc } from '@zmdb/core/sql';

const affected = await postRepo.updateMany({ authorId }, { published: true });
await postRepo.updateMany({ authorId }, { views: inc(1) });
```

The `where` is a typed `WhereDTO`, the patch is an expression-aware `UpdatePatch`, and both are compiled into one statement.

## SQL by dialect

For `postRepo.updateMany({ published: false }, { views: inc(1) })`, the repository emits:

```sql
-- PostgreSQL
UPDATE "posts" SET "views" = "views" + $1 WHERE "published" = $2 RETURNING "id"

-- MySQL
UPDATE `posts` SET `views` = `views` + ? WHERE `published` = ?

-- SQLite
UPDATE "posts" SET "views" = "views" + ? WHERE "published" = ? RETURNING "id"

-- SQL Server
UPDATE [posts] SET [views] = [views] + @p1 OUTPUT INSERTED.[id] WHERE [published] = @p2
```

The parameters are `[1, false]`. The Postgres family, SQLite and SQL Server return the number of primary-key rows returned by the statement. The MySQL family omits unsupported `RETURNING`, executes
the same atomic update, and resolves to `undefined`.

## Different values per row

This is a separate shape and remains outside the typed API. The closed SET expressions operate on each row's own column; they do not provide a `CASE` expression or a `VALUES` source.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies postRepo, updates; this excerpt does not repeat those declarations."}
for (const { id, title } of updates) await postRepo.update(id, { title }); // N statements
```

N round trips, and no atomicity unless you wrap it.

## Workaround 1 — a transaction around the loop

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies connection, postRepo, updates; this excerpt does not repeat those declarations."}
import { createTransactionalDb } from '@zmdb/orm/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  const posts = postRepo.withTransaction(tx);
  for (const { id, title } of updates) await posts.update(id, { title });
});
```

Still N statements, but all-or-nothing. Acceptable for tens of rows; painful for thousands, because the cost is the round trips, not the statements.

## Workaround 2 — one statement with `CASE`

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies driver, updates; this excerpt does not repeat those declarations."}
const ids = updates.map(u => u.id);
const cases = updates.map((_, i) => `WHEN $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ');
const params = updates.flatMap(u => [u.id, u.title]);

await driver.execute({
  text: `UPDATE "posts" SET "title" = CASE "id" ${cases} END
         WHERE "id" IN (${ids.map((_, i) => `$${params.length + i + 1}`).join(', ')})`,
  parameters: [...params, ...ids],
});
```

One round trip. Note that every value is a placeholder — the only thing interpolated is the generated placeholder _positions_, which is the line that keeps this injection-safe. Never interpolate
`u.title`.

Batch it. A thousand rows in one statement exceeds parameter limits on every dialect — chunk to a few hundred.

## Workaround 3 — `UPDATE ... FROM VALUES` (Postgres)

Cleaner and faster than `CASE`:

```sql
UPDATE "posts" AS p
SET "title" = v.title
FROM (VALUES ($1::int, $2::text), ($3::int, $4::text)) AS v(id, title)
WHERE p.id = v.id
```

The casts on the first tuple are required — without them Postgres cannot infer the `VALUES` column types and errors. MySQL's equivalent is a join against a derived table; SQLite 3.33+ supports
`UPDATE ... FROM`.

## Workaround 4 — temp table, for large volumes

For tens of thousands of rows: `COPY` (or a batched insert) into a temporary table, then one `UPDATE ... FROM` join. This is what a bulk loader does, and it is an order of magnitude faster than
anything statement-per-row.

## Bulk _delete_ has the same shape

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies createQueryCompiler, driver, id; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

import { postgres } from '@zmdb/postgres';

const q = createQueryCompiler(postgres).deleteFrom(trustedTable('posts')).where('author_id', '=', id).compile();
await driver.execute(q);
```

There is no `deleteWhere` on the repository either — the builder covers it.

## What remains

Per-row values in one statement need a `VALUES` source plus a `CASE` or source-column expression surface. The current vocabulary deliberately references only the column named by the `set()` key, so
this is wider than [increment](./guide-increment-decrement.html) or [toggle](./guide-toggle-boolean.html). Repository-level bulk delete is also a separate gap.

---

See also: [Query Builder](./select.html) · [Increment / decrement](./guide-increment-decrement.html) · [Transactions](./transactions.html)
