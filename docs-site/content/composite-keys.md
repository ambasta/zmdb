> **ToDo / feature gap.** `primaryKey()` is a per-column flag, and the code that
> needs "the" primary key — `findById`, `update`, `delete`, keyset pagination —
> reads a single column. Marking two columns `primaryKey()` emits a composite
> `PRIMARY KEY` in the DDL, but the repository's key-based methods will use
> whichever it finds first.

## What works today

The DDL is correct:

```ts
export const memberships = defineSchema('memberships', {
  orgId: references(integer(), orgs, 'id').primaryKey(),
  userId: references(integer(), users, 'id').primaryKey(),
  role: text().notNull(),
});
```

```sql
CREATE TABLE "memberships" (
  "org_id" INTEGER NOT NULL REFERENCES "orgs"("id"),
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "role" TEXT NOT NULL,
  PRIMARY KEY ("org_id", "user_id")
)
```

And so is anything that goes through `WhereDTO`, because that addresses columns by name rather than by "the key":

```ts
await repo.findOne({ orgId: { eq: 1 }, userId: { eq: 7 } });
await repo.find({ orgId: { eq: 1 } });
```

## What does not work

```ts
await repo.findById(???);        // no single value to pass
await repo.update(???, patch);
await repo.delete(???);
```

Use the compiler for keyed writes until this lands:

```ts
const q = createQueryCompiler('postgres')
  .updateTable('memberships')
  .set({ role: 'admin' })
  .where('org_id', '=', 1)
  .where('user_id', '=', 7)
  .compile();

await driver.execute(q);
```

## What has to change

Three pieces, in order:

1. **A key type.** `PrimaryKeyOf<S>` becomes a tuple or a record of the flagged columns rather than a single `Col<S>`.
2. **`buildKeyWhere`.** Already the single place that turns an id into a `WhereDTO<S>`; it needs to accept the record form and assemble a multi-column filter. The assertion there is already documented as taking a dynamic key name — this widens it, it does not change its nature.
3. **Keyset pagination.** `applyOrderBy(builder, order, pkColumn)` takes one tie-break column; it needs the full key to keep cursors stable.

Nothing about this is blocked by design. It is a typed-signature change across three call sites.

## Related

The `manyToMany` join table is the common case for composite keys, and it works today, because [`manyToMany`](./relations.html) addresses the through-table by column names rather than through a repository.

---

See also: [Relations](./relations.html) · [Repository](./repository.html) · [Cursor-based pagination](./guide-cursor-pagination.html)
