Insert a row, and if it collides with a unique index, update it instead. One statement, one round trip, no read-then-write race.

```ts
const row = await repo.upsert({ id: 1, email: 'ada@example.com', name: 'Ada', hits: 1 });
```

`BaseRepository.upsert` validates the payload through the `create` variant — so
required-field and excess-property checks apply exactly as they do to `create`
— defaults the conflict target to the table's primary key, and has return type
`Promise<Entity<T> | undefined>`. It returns `undefined` rather than throwing
when the statement comes back with no row.

Its `updateFields` option accepts either column names or an expression-aware
`UpdatePatch<T>`:

```ts
import { inc, proposed } from 'zmdb';

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

The insert payload still passes `CreateDTO<T>` validation. Ordinary values in
the update object pass the strict `UpdateDTO<T>` check, while each branded
expression operand is validated against its column. `upsert` runs `preInsert`
for the create payload; the conflict-update object does not also run
`preUpdate`.

## The compiler's four update forms

`insertInto(...).values(...).onConflict(target?)` returns a builder with `doUpdate` and `doNothing`. The four `doUpdate` argument forms are four different statements, and the difference matters more than it looks.

**`doUpdate()` — every non-target column takes the value this INSERT tried to write.** This is what `repo.upsert` calls.

```ts
createQueryCompiler('postgres').insertInto('users').values(row).onConflict('id').doUpdate().compile();
// INSERT INTO "users" ("id", "email", "name", "hits") VALUES ($1, $2, $3, $4)
//   ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "name" = EXCLUDED."name", "hits" = EXCLUDED."hits"
```

If _every_ inserted column is a conflict target the set list would be empty SQL, so the compiler sets them all back to themselves. That is a deliberate no-op rather than an oversight, and it is commented as such at `packages/query-compiler/src/index.ts:287`.

**`doUpdate(['name'])` — those columns only.**

```ts
// ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"
```

**`doUpdate({ hits: 9 })` — literal values or closed expressions.** Literals are
bound as parameters appended after the insert's own. The insert carries four
values, so the literal is `$5`:

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

> [!WARNING]
> On MySQL, `doNothing()` compiles to `INSERT IGNORE INTO …`, and the two are **not** equivalent.
> `INSERT IGNORE` downgrades other errors to warnings as well — a truncated string, a bad date, a
> failed foreign key — so it is broader than "ignore the conflict". If you need the narrow form on
> MySQL, `doUpdate` the target columns back to themselves instead.

## The conflict target is honoured on Postgres and SQLite, and ignored on MySQL

> [!CAUTION]
> `upsert(dto, { target: ['email'] })` — and `onConflict('email')` — is emitted on Postgres and
> SQLite and **silently dropped on MySQL**, which has no syntax for a conflict target at all:
>
> ```sql
> -- postgres, sqlite
> INSERT INTO "users" (…) VALUES (…) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
> -- mysql
> INSERT INTO `users` (…) VALUES (…) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)
> ```
>
> On a table with one unique index the two agree. On a table with **two**, they are different
> programs: Postgres raises on a collision with the non-target index, and MySQL quietly updates
> whichever row it collided with. If your table has more than one unique constraint and you are
> targeting one of them, the upsert is not portable, and no amount of testing on Postgres will
> tell you.

**Why the API does not refuse an explicit target on MySQL.** It could — the dialect is known when the compiler is constructed, so `createQueryCompiler('mysql').insertInto(…).onConflict('email')` is a diagnosable call. It stays permitted because the dialect is usually a deployment choice rather than a call-site one: refusing would mean the same repository code compiles against one database and not another, and the divergence would move from a documented behaviour to a build failure in whichever environment happens to run MySQL. The trade is a real one and it is decided in favour of portable code plus this warning; if you want the strict reading, assert your dialect at the call site.

## MySQL's `VALUES()` is deprecated, on purpose

The MySQL branch writes `` `col` = VALUES(`col`) ``, which MySQL 8.0.20 and later deprecate in favour of a row alias (`… AS new ON DUPLICATE KEY UPDATE col = new.col`). It is kept because servers older than 8.0.20 do not understand the alias form. On a modern MySQL this produces a deprecation warning in the server log and nothing else — it is expected, not a bug.

MySQL also has no `RETURNING`. For an expression-valued repository
`updateFields` object, zmdb emits one `INSERT … ON DUPLICATE KEY UPDATE`
statement without `RETURNING` and resolves to `undefined`; it does not perform
a follow-up read. That branch is deliberately scoped to expression upserts and
does not claim that every pre-existing MySQL repository write-returning path is
resolved.

## What `upsert` does not reach

`BaseRepository.upsert` always calls `doUpdate`. There is no `repo.upsertOrIgnore`, so `DO NOTHING` is only reachable through the compiler:

```ts
const q = createQueryCompiler('postgres')
  .insertInto('users')
  .values(clean)
  .onConflict('email')
  .doNothing()
  .returning(['*'])
  .compile();

await driver.execute(q);
```

Going through the compiler skips the DTO validation `repo.upsert` performs, so validate the payload yourself or route it through `repo` and accept the update.

## Partial-index targets

Postgres allows a conflict target with a predicate (`ON CONFLICT (email) WHERE deleted_at IS NULL`). The builder takes column names only, so a partial-index target still needs [raw SQL](./raw-sql.html). This is the one upsert shape that has no builder spelling.

---

See also: [Insert & Update](./insert.html) · [Raw SQL](./raw-sql.html) · [Transactions](./transactions.html)
