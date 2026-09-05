Increment through the repository when the new value depends on the value already
stored. The update is one SQL statement, so concurrent callers do not lose one
another's increments.

```ts
import { dec, inc } from 'zmdb';

const post = await postRepo.increment(id, 'views'); // +1
await postRepo.increment(id, 'views', 5); // +5
await postRepo.update(id, { views: dec(2) }); // -2
await postRepo.updateMany({ authorId }, { views: inc(1) });
```

`increment` derives its column argument from the table declaration. Only
updatable `Sql<'integer'>`, `Sql<'bigint'>`, and `Sql<'numeric'>` columns whose
app type is numeric are accepted. A bigint column requires a bigint operand.

`update` and `updateMany` expose the full closed expression vocabulary through
`UpdatePatch<T>`; `{ views: { increment: 1 } }` and caller-supplied SQL remain
invalid.

## Why read-modify-write loses updates

```ts
const post = await postRepo.findById(id);
await postRepo.update(id, { views: (post?.views ?? 0) + 1 });
```

Two concurrent requests can both read `10` and both write `11`. `inc(1)`
instead compiles the dependency into the update itself:

## SQL by dialect

For `postRepo.increment(7, 'views')`, the repository emits:

```sql
-- PostgreSQL
UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2 RETURNING *

-- MySQL
UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?

-- SQLite
UPDATE "posts" SET "views" = "views" + ? WHERE "id" = ? RETURNING *
```

The parameters are `[1, 7]` in every case. `dec(1)` emits the same statement
with `-` in place of `+`. The delta remains bound, and the expression can
reference only the column named by the patch key; it is not a general SQL AST.

## Compiler form

The same constructor works directly with the query compiler:

```ts
import { createQueryCompiler, inc } from 'zmdb';

const query = createQueryCompiler('postgres')
  .updateTable('posts')
  .set({ views: inc(1) })
  .where('id', '=', id)
  .compile();

await driver.execute(query);
```

## Validation and hooks

Ordinary patch values still pass the strict `UpdateDTO<T>` object validation.
The repository removes only a branded expression from that object check and
validates its operand against the same column IR. An invalid sibling remains an
error:

```ts
await postRepo.update(id, {
  views: inc(1),
  email: 'not-an-email', // still rejected by the email column rules
});
```

`preUpdate` receives the validated, `undefined`-stripped patch in schema order.
The expression object is the same branded object supplied by the caller.

## Return values by dialect

Postgres and SQLite use `RETURNING *`, while SQL Server uses `OUTPUT
INSERTED.*`; all three return the computed row from `update` and `increment`.
`updateMany` returns the number of returned rows.

MySQL has no `UPDATE … RETURNING`. Expression-bearing `update`/`increment` and
all `updateMany` calls omit it, execute one atomic statement, and resolve to
`undefined`; the repository does not issue a hidden `SELECT`. Read explicitly
afterward if the new row is required, and use a transaction if that read must be
paired consistently with the write.

## When not to store a counter

For a hot counter that also needs history, insert an event row and aggregate:

```ts
await viewRepo.create({ postId: id, at: new Date() });

const [row] = await viewRepo.aggregate({
  where: { postId: { eq: id } },
  computed: [{ fn: 'count', column: 'id', as: 'views' }],
});
```

That replaces contention on one row with append-only writes, at the cost of a
larger table and a more expensive read.

---

See also: [Toggle a boolean](./guide-toggle-boolean.html) · [Bulk update](./guide-bulk-update.html) · [Raw SQL](./raw-sql.html)
