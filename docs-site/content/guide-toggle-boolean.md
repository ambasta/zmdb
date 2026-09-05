Use the branded `not()` expression when the new state must be the inverse of
the value currently stored:

```ts
import { not } from 'zmdb';

const user = await userRepo.update(id, { active: not() });
await userRepo.updateMany({ suspended: false }, { active: not() });
```

The repository validates the patch before emitting one atomic statement:

## SQL by dialect

For `userRepo.update(7, { active: not() })`, the repository emits:

```sql
-- PostgreSQL
UPDATE "users" SET "active" = NOT "active" WHERE "id" = $1 RETURNING *

-- MySQL
UPDATE `users` SET `active` = NOT `active` WHERE `id` = ?

-- SQLite
UPDATE "users" SET "active" = NOT "active" WHERE "id" = ? RETURNING *
```

The sole parameter is the id, `7`. MySQL omits `RETURNING`; Postgres and SQLite
return the computed row.

`{ active: { toggle: true } }` remains invalid. The expression is identified by
the compiler-owned symbol brand, not by a request-body object with a familiar
shape.

## The read-then-write, and its race

```ts
const user = await userRepo.findById(id);
await userRepo.update(id, { active: !(user?.active ?? false) });
```

Two concurrent toggles both read `false`, both write `true` — and the second toggle is silently lost. With a toggle this is worse than with a counter, because the result is not just off by one, it is the wrong state entirely and stays wrong.

It is also the more common bug in practice: a double-clicked button sends two requests, both read the old value, and the row ends up in the state the user did not ask for.

## Compiler form

```ts
import { createQueryCompiler, not } from 'zmdb';

const query = createQueryCompiler('postgres')
  .updateTable('users')
  .set({ active: not() })
  .where('id', '=', id)
  .compile();

await driver.execute(query);
```

On the MySQL family, booleans are `tinyint(1)`, so `NOT` stores `0`/`1`. SQLite has the
same truth table: `NOT 0` is `1`, `NOT 1` is `0`, and both round-trip through a
`Sql<'boolean'>` column.

The Postgres family, SQLite and SQL Server return the computed row; SQL Server
spells the toggle as bitwise `~` and returns it through `OUTPUT INSERTED.*`.
The MySQL family has no `UPDATE … RETURNING`, so an expression-bearing
repository update omits it and resolves to `undefined` without a follow-up
read.

## Prefer an explicit target state

The deeper point: a toggle endpoint is usually a design mistake. `PATCH /users/:id { active: false }` is idempotent, retry-safe, and expressible in the typed API with no raw SQL:

```ts
@Patch('/users/:id')
async setActive(ctx: Ctx<{ id: string }, { active: boolean }>) {
  const dto = assert<{ active: boolean }>(ctx.body);
  return this.repo.update(Number(ctx.params.id), { active: dto.active });
}
```

A double-click now sets `false` twice, which is `false`. That is not a
workaround for a missing feature — it is the better API, and it is why this
race bites less often than it looks like it should.

Use `not()` when the client genuinely does not know the current state, which is
rarer than it sounds.

## Nullable booleans

`NOT NULL` is `NULL`, not `true`. A `(boolean & Sql<'boolean'>) | null` column toggled with `NOT` stays null forever:

```sql
UPDATE "users" SET "active" = NOT COALESCE("active", false) WHERE "id" = $1
```

Decide what null means before writing the toggle. Usually it means the column should not have been nullable.

## Validation and hooks

An ordinary value in the same patch still passes the strict `UpdateDTO`
validation. `not()` has no operand to validate at runtime, but its result type
limits it to boolean-valued patch keys at compile time. `preUpdate` receives the
same branded object after the complete patch has passed validation.

---

See also: [Increment / decrement](./guide-increment-decrement.html) · [Bulk update](./guide-bulk-update.html) · [Raw SQL](./raw-sql.html)
