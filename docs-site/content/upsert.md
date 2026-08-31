> **ToDo / feature gap.** There is no `ON CONFLICT` / `ON DUPLICATE KEY UPDATE`
> emitter. `InsertBuilder` has `values` / `returning` / `compile` and nothing
> else, and `BaseRepository` has `create` but no `upsert`.

## The workaround

Two statements inside a transaction, so a concurrent writer cannot slot in between them:

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(conn);

await db.transaction(async () => {
  const existing = await repo.findOne({ email: { eq: dto.email } });
  if (existing) return repo.update(existing.id, dto);
  return repo.create(dto);
});
```

> [!WARNING]
> At `READ COMMITTED` — the default on Postgres and MySQL — this is still racy:
> two transactions can both read "no row" and both insert, and the unique index
> decides the loser with an error. Either set `SERIALIZABLE`, or catch the
> unique-violation and retry the update:
>
> ```ts
> try {
>   await repo.create(dto);
> } catch (e) {
>   if (isUniqueViolation(e)) await repo.update(await keyOf(dto), dto);
>   else throw e;
> }
> ```
>
> `isUniqueViolation` is yours to write — it is driver-specific (`23505` on
> Postgres, `ER_DUP_ENTRY` on MySQL), which is one reason it is not in zmdb.

## Or emit the SQL yourself

Since a compiled query is `{ text, parameters }`, a real upsert is one object away:

```ts
const q = {
  text: `INSERT INTO "users" ("email", "name") VALUES ($1, $2)
         ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
         RETURNING *`,
  parameters: [dto.email, dto.name],
};
const [row] = await driver.execute(q);
```

This is atomic and it is one round trip. The cost is that the column list is written by hand, so it is not derived from the schema object — see [Raw SQL](./raw-sql.html) for how to keep that honest with a validated result type.

## What it would take

The emitter is dialect-divergent enough to need real design:

| Dialect  | Syntax                                            | Conflict target               |
| -------- | ------------------------------------------------- | ----------------------------- |
| postgres | `ON CONFLICT (cols) DO UPDATE SET x = EXCLUDED.x` | required, must match an index |
| sqlite   | same                                              | same                          |
| mysql    | `ON DUPLICATE KEY UPDATE x = VALUES(x)`           | implicit — _any_ unique key   |

MySQL's implicit target is the awkward part: a typed API that takes `conflictTarget: ['email']` cannot honour it on MySQL, and one that omits the target cannot express Postgres' partial-index case. The likely shape is `.onConflict({ columns, set })` with `columns` ignored on MySQL and documented as such, plus `EXCLUDED`-vs-`VALUES()` handled in the dialect layer. `UpdateBuilder.set()` [not supporting expressions](./guide-increment-decrement.html) blocks the `SET x = EXCLUDED.x` form too, so the two gaps share a fix.

---

See also: [Insert & Update](./insert.html) · [Raw SQL](./raw-sql.html) · [Transactions](./transactions.html)
