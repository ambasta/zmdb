> **ToDo / feature gap.** `PrimaryKey` is a per-column tag, and two of them do not
> currently become one composite key downstream. The code that needs "the" primary
> key — `findById`, `update`, `delete`, keyset pagination — reads a single column,
> and the DDL emitter writes `PRIMARY KEY` on each column rather than one table
> constraint. Both are fixable and neither is fixed.

## What the declaration says

```ts
import type { PrimaryKey, References, Sql, Table } from 'zmdb/tags';

export interface Membership extends Table<'memberships'> {
  orgId: number & Sql<'integer'> & References<'orgs.id'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'> & PrimaryKey;
  role: string & Sql<'text'>;
}
```

Two `PrimaryKey` tags is how you say composite, and the reflected schema records it correctly —
`primaryKey` is `['orgId', 'userId']`. There is no separate `primaryKey: [...]` option to keep
in step with the columns, which removes one way to get this wrong.

## What the DDL emitter does with it

Not that. `columnDdl` puts `PRIMARY KEY` on each keyed column, so a generated migration says:

```sql
CREATE TABLE "memberships" (
  "org_id" INTEGER PRIMARY KEY,
  "user_id" INTEGER PRIMARY KEY,   -- no dialect accepts a second one
  "role" TEXT NOT NULL
)
```

> [!WARNING]
> That statement does not run anywhere. Postgres rejects it with "multiple primary keys for
> table ... are not allowed", and MySQL and SQLite have their own versions of the same error.
> Write the table in a [custom migration](./migrations-custom.html) until the emitter learns
> the table-constraint form:
>
> ```sql
> CREATE TABLE "memberships" (
>   "org_id" INTEGER NOT NULL REFERENCES "orgs"("id"),
>   "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
>   "role" TEXT NOT NULL,
>   PRIMARY KEY ("org_id", "user_id")
> );
> ```
>
> The `REFERENCES` clauses are hand-written for the same reason: the snapshot format has no
> place for a foreign key either. See [Migrations](./migrations.html).

## What does work today

Anything that goes through `WhereDTO`, because that addresses columns by name rather than by "the key":

```ts
await repo.findOne({ orgId: { eq: 1 }, userId: { eq: 7 } });
await repo.find({ orgId: { eq: 1 } });
```

## What the repository cannot do

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

Four pieces, in order:

0. **`columnDdl`.** The `CREATE TABLE` op needs to collect the keyed columns and emit one
   `PRIMARY KEY (…)` table constraint. This is the smallest of the four and the only one that
   currently produces SQL that cannot run.

1. **A key type.** `PrimaryKeyOf<T>` becomes a tuple or a record of the tagged columns rather than a single `Col<T>`. The declaration already carries what it needs — the reflector emits `primaryKey` as an _array_ of names, so the information is there and only the consuming types are narrow.
2. **`buildKeyWhere`.** Already the single place that turns an id into a `WhereDTO<T>`; it needs to accept the record form and assemble a multi-column filter. The assertion there is already documented as taking a dynamic key name — this widens it, it does not change its nature.
3. **Keyset pagination.** `applyOrderBy(builder, order, pkColumn)` takes one tie-break column; it needs the full key to keep cursors stable.

Nothing about this is blocked by design. It is one DDL fix and a typed-signature change across three call sites.

## Related

The `manyToMany` join table is the common case for composite keys, and it works today, because [`manyToMany`](./relations.html) addresses the through-table by column names rather than through a repository.

---

See also: [Relations](./relations.html) · [Repository](./repository.html) · [Cursor-based pagination](./guide-cursor-pagination.html)
