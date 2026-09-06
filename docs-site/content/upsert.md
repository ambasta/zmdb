Insert a row, and if it collides with a unique index, update it instead. One statement, one round trip, no read-then-write race.

```ts
const row = await repo.upsert({ id: 1, email: 'ada@example.com', name: 'Ada', hits: 1 });
```

`BaseRepository.upsert` validates the payload through the `create` variant — so required-field and excess-property checks apply exactly as they do to `create` — defaults the conflict target to the
table's primary key, and has return type `Promise<Entity<T> | undefined>`. It returns `undefined` rather than throwing when the statement comes back with no row.

Its `updateFields` option accepts either column names or an expression-aware `UpdatePatch<T>`:

```ts
import { inc, proposed } from 'zmdb/sql';

await repo.upsert(
  { id: 1, email: 'ada@example.com', name: 'Ada', hits: 1 },
  {
    target: 'id',
    updateFields: {
      hits: inc(1),
      name: proposed<string>(),
    },
  },
);
```

The insert payload still passes `CreateDTO<T>` validation. Ordinary values in the update object pass the strict `UpdateDTO<T>` check, while each branded expression operand is validated against its
column. `upsert` runs `preInsert` for the create payload; the conflict-update object does not also run `preUpdate`.

## The compiler's four update forms

`insertInto(...).values(...).onConflict(target?)` returns a builder with `doUpdate` and `doNothing`. The four `doUpdate` argument forms are four different statements, and the difference matters more
than it looks.

**`doUpdate()` — every non-target column takes the value this INSERT tried to write.** This is what `repo.upsert` calls.

```ts
import { postgres } from '@zmdb/postgres';

createQueryCompiler(postgres).insertInto('users').values(row).onConflict('id').doUpdate().compile();
// INSERT INTO "users" ("id", "email", "name", "hits") VALUES ($1, $2, $3, $4)
//   ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "name" = EXCLUDED."name", "hits" = EXCLUDED."hits"
```

If _every_ inserted column is a conflict target the set list would be empty SQL, so the compiler sets them all back to themselves. That is a deliberate no-op rather than an oversight, and it is
commented as such at `packages/query-compiler/src/index.ts:287`.

**`doUpdate(['name'])` — those columns only.**

```ts
// ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"
```

**`doUpdate({ hits: 9 })` — literal values or closed expressions.** Literals are bound as parameters appended after the insert's own. The insert carries four values, so the literal is `$5`:

```ts
// INSERT INTO "users" ("id", "email", "name", "hits") VALUES ($1, $2, $3, $4)
//   ON CONFLICT ("id") DO UPDATE SET "hits" = $5
// parameters: [1, 'ada@example.com', 'Ada', 1, 9]
```

An expression refers to the column named by its key:

```ts
// doUpdate({ hits: inc(1) })
// ... DO UPDATE SET "hits" = "hits" + $5
```

**`doUpdate([])` throws.** An empty array reads as "update nothing" and means something else, so it is refused rather than compiled:

```
Empty updateFields array is not allowed in doUpdate(). Omit updateFields (or pass
undefined) to update all non-target columns, or use doNothing().
```

**`doNothing()` — keep the existing row.**

```ts
// ON CONFLICT ("id") DO NOTHING
```

Omitting the target lets the server infer it: `onConflict()` emits a bare `ON CONFLICT DO NOTHING`, which matches a collision on any unique index.

> [!WARNING] On the MySQL family, `doNothing()` compiles to `INSERT IGNORE INTO …`, and the two are **not** equivalent. `INSERT IGNORE` downgrades other errors to warnings as well — a truncated
> string, a bad date, a failed foreign key — so it is broader than "ignore the conflict". If you need the narrow form on MySQL, `doUpdate` the target columns back to themselves instead.

## Conflict targets: honoured on the Postgres family, SQLite and SQL Server; ignored on the MySQL family

> [!CAUTION] The Postgres family, SQLite and SQL Server emit the target supplied to `upsert(dto, { target: ['email'] })` or `onConflict('email')`. The MySQL family has no equivalent syntax, so it
> silently ignores that target:
>
> ```sql
> -- postgres, sqlite
> INSERT INTO "users" (…) VALUES (…) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
> -- mysql
> INSERT INTO `users` (…) VALUES (…) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)
> -- mssql
> MERGE [users] WITH (HOLDLOCK) AS tgt
> USING (VALUES (…)) AS src (…) ON tgt.[email] = src.[email]
> WHEN MATCHED THEN UPDATE SET [name] = src.[name]
> WHEN NOT MATCHED THEN INSERT (…) VALUES (…);
> ```
>
> With one unique index, the behavior is equivalent. With several unique constraints, Postgres raises when a non-target index conflicts, while MySQL updates the row for whichever unique index matched.
> An upsert that relies on a particular conflict target is therefore not portable to MySQL.

**Why the API permits an explicit target on MySQL.** The compiler knows its dialect and could reject `createQueryCompiler(mysql).insertInto(…).onConflict('email')`.

The call remains valid because the database dialect is often selected at deployment time. Rejecting it would make the same repository code compile for one environment and fail for another.

Applications that require strict conflict-target semantics should check the dialect before issuing the upsert.

## SQL Server uses `MERGE`, and requires a target

SQL Server has no `ON CONFLICT`; zmdb emits one terminated `MERGE` statement. `onConflict()` with no columns is refused because `MERGE` needs an `ON` predicate. `BaseRepository.upsert` normally
supplies the table's primary key, and an explicit `target` supplies another unique key.

The target carries `WITH (HOLDLOCK)`. Without the serializable range lock, two concurrent upserts can both observe an absent key and race into the insert branch. The lock closes that race, but hot
keys can block longer or deadlock; error `1205` is classified as retryable metadata, while retrying the whole unit of work remains the application's responsibility.

`returning()` becomes `OUTPUT INSERTED.…` inside the `MERGE`, so repository upserts can return the resulting row. See [SQL Server](./dialect-mssql.html) for the trigger limitation and complete
contract.

## MySQL's `VALUES()` is deprecated, on purpose

The MySQL branch writes `` `col` = VALUES(`col`) ``, which MySQL 8.0.20 and later deprecate in favour of a row alias (`… AS new ON DUPLICATE KEY UPDATE col = new.col`). It is kept because servers
older than 8.0.20 do not understand the alias form. On a modern MySQL this produces a deprecation warning in the server log and nothing else — it is expected, not a bug.

MySQL also has no `RETURNING`. An ordinary repository upsert refuses before driver execution because its `Entity<T> | undefined` result depends on a returned row. For an expression-valued
`updateFields` object, zmdb instead uses the explicit one-statement branch: it emits `INSERT … ON DUPLICATE KEY UPDATE` without `RETURNING`, resolves to `undefined`, and performs no follow-up read.

## What `upsert` does not reach

`BaseRepository.upsert` always calls `doUpdate`. There is no `repo.upsertOrIgnore`, so `DO NOTHING` is only reachable through the compiler:

```ts
const q = createQueryCompiler(postgres).insertInto('users').values(clean).onConflict('email').doNothing().returning(['*']).compile();

await driver.execute(q);
```

Going through the compiler skips the DTO validation `repo.upsert` performs, so validate the payload yourself or route it through `repo` and accept the update.

## Soft-deleted conflicts and partial-index targets

On a table declared with `SoftDelete<'deletedAt'>`, a full unique index still contains deleted rows. `create({ email })` therefore gets the database's normal unique-constraint error when a deleted row
owns that email.

Repository `upsert` chooses a deliberate result for the same collision: its conflict update sets `deletedAt` back to `NULL`, restoring the existing row while applying `updateFields`. It never returns
a row that remains hidden by the soft-delete filter.

If the application should create a replacement row instead, define a partial unique index over live rows:

```sql
CREATE UNIQUE INDEX users_email_live
ON users (email)
WHERE deleted_at IS NULL;
```

Postgres allows a conflict target with a predicate (`ON CONFLICT (email) WHERE deleted_at IS NULL`). The builder takes column names only, so a partial-index target still needs
[raw SQL](./raw-sql.html). This is the one upsert shape that has no builder spelling.

---

See also: [Insert & Update](./insert.html) · [Raw SQL](./raw-sql.html) · [Transactions](./transactions.html)
