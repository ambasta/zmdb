> **ToDo / repository gap.** `UpdateBuilder.set()` supports `not()`, but
> `BaseRepository.update()` still accepts values only. Use the compiler builder
> directly when the client genuinely requests a toggle.

## What you cannot write

```ts
await userRepo.update(id, { active: { toggle: true } }); // no such API
```

The compiler form is atomic:

```ts
import { createQueryCompiler, not } from '@zmdb/query-compiler';

const query = createQueryCompiler('postgres')
  .updateTable('users')
  .set({ active: not() })
  .where('id', '=', id)
  .compile();

await driver.execute(query);
```

## The read-then-write, and its race

```ts
const user = await userRepo.findById(id);
await userRepo.update(id, { active: !(user?.active ?? false) });
```

Two concurrent toggles both read `false`, both write `true` — and the second toggle is silently lost. With a toggle this is worse than with a counter, because the result is not just off by one, it is the wrong state entirely and stays wrong.

It is also the more common bug in practice: a double-clicked button sends two requests, both read the old value, and the row ends up in the state the user did not ask for.

## Workaround — let the database do it

```ts
await driver.execute({
  text: 'UPDATE "users" SET "active" = NOT "active" WHERE "id" = $1',
  parameters: [id],
});
```

Atomic, and no read. On MySQL, booleans are `tinyint(1)`, so `NOT` works but returns `0`/`1`:

```sql
UPDATE `users` SET `active` = NOT `active` WHERE `id` = ?
```

SQLite is the same. `NOT 0` is `1`, `NOT 1` is `0`, and both round-trip through a `Sql<'boolean'>` column fine.

Returning the new state, Postgres only:

```ts
const [row] = await driver.execute({
  text: 'UPDATE "users" SET "active" = NOT "active" WHERE "id" = $1 RETURNING "active"',
  parameters: [id],
});
const nowActive = row?.active === true;
```

## Prefer an explicit target state

The deeper point: a toggle endpoint is usually a design mistake. `PATCH /users/:id { active: false }` is idempotent, retry-safe, and expressible in the typed API with no raw SQL:

```ts
@Patch('/users/:id')
async setActive(ctx: Ctx<{ id: string }, { active: boolean }>) {
  const dto = assert<{ active: boolean }>(ctx.body);
  return this.repo.update(Number(ctx.params.id), { active: dto.active });
}
```

A double-click now sets `false` twice, which is `false`. That is not a workaround for a missing feature — it is the better API, and it is why this gap bites less often than it looks like it should.

Use the raw `NOT` form when the client genuinely does not know the current state, which is rarer than it sounds.

## Nullable booleans

`NOT NULL` is `NULL`, not `true`. A `(boolean & Sql<'boolean'>) | null` column toggled with `NOT` stays null forever:

```sql
UPDATE "users" SET "active" = NOT COALESCE("active", false) WHERE "id" = $1
```

Decide what null means before writing the toggle. Usually it means the column should not have been nullable.

## What it would take

The compiler expression exists. The remaining gap is repository integration: `BaseRepository.update()` must
accept the branded expression while preserving validation for every ordinary value in the same patch.

---

See also: [Increment / decrement](./guide-increment-decrement.html) · [Bulk update](./guide-bulk-update.html) · [Raw SQL](./raw-sql.html)
