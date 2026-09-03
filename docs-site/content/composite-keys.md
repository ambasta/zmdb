> **ToDo / feature gap.** `PrimaryKey` is a per-column tag, and the reflector does turn two of
> them into one ordered key — `findById`, `update` and `delete` compile a full multi-column
> `WHERE` from it. Two things do not: the DDL emitter writes `PRIMARY KEY` on each keyed column
> instead of one table constraint, so the generated `CREATE TABLE` does not run anywhere, and
> keyset pagination orders and cursors by the key's first column only, so a page boundary can
> skip rows. The hole in the _single_-column path that used to be the first thing to read here is
> fixed: the record form is now refused rather than silently dropping the `WHERE`.

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

## What the repository does with a composite key

`PrimaryKeyOf<T>` is a record when the key has two or more columns, so the key is an object and
the three keyed methods take it directly:

```ts
const key: PrimaryKeyOf<Membership> = { orgId: 1, userId: 7 };

await repo.findById(key);
// SELECT * FROM "memberships" WHERE "orgId" = $1 AND "userId" = $2 LIMIT 1
await repo.update(key, { role: 'admin' });
// UPDATE "memberships" SET "role" = $1 WHERE "orgId" = $2 AND "userId" = $3 RETURNING *
await repo.delete(key);
// DELETE FROM "memberships" WHERE "orgId" = $1 AND "userId" = $2 RETURNING "orgId", "userId"
```

A key that is missing a column is refused before any SQL is compiled. The wording is being
sharpened — it does not yet name the method or list more than one missing column — but the
refusal itself is there and it is a `ValidationError`, not a query on half a key.

Extra keys are ignored, so you can pass a whole row you already have:

```ts
await repo.delete(row); // row is a Membership; only orgId and userId are read
```

## One-column keys take the value, not a record

On a table whose key is a _single_ column, `findById`, `update` and `delete` take the value —
`42`, not `{ id: 42 }`. The record form is a `ValidationError` naming the method and the column:

```ts
await repo.delete({ id: 42 });
// ValidationError: products.delete requires the value of "id", not an object
```

A value is a string, a number, a bigint, a boolean or a `Date`. `null`, `undefined`, an array and
an object are all refused, and nothing is compiled or executed first.

> [!NOTE]
> This used to be accepted, and produced a statement with **no `WHERE` clause at all** — a
> `findById` that returned the table's first row, and an `update`/`delete` that hit every row:
>
> ```ts
> await repo.findById({ id: 42 }); // SELECT * FROM "products" LIMIT 1
> await repo.update({ id: 42 }, patch); // UPDATE "products" SET ... RETURNING *
> await repo.delete({ id: 42 }); // DELETE FROM "products" RETURNING "id"
> ```
>
> TypeScript rejected all three even then, so it only ever reached you through an `any`, a cast,
> or a key that arrived from a request body — which is the path that matters. Two further checks
> now stand behind the one above: `compileWhere` refuses an operator map with nothing in it, and
> `update`/`delete` refuse to execute a compiled statement whose text has no `WHERE`.

The asymmetry is deliberate rather than an oversight to smooth over: a one-column key that
accepted both forms is how code that will break the day the key gains a column gets written.

## What has to change

Two pieces:

1. **`columnDdl`.** The `CREATE TABLE` op needs to collect the keyed columns and emit one
   `PRIMARY KEY (…)` table constraint, and `TableSnapshot` needs to carry the ordered key so that
   `diff` can see a key change at all — today it compares only column names and types, so
   changing a key produces no migration op whatsoever.
2. **Keyset pagination.** `applyOrderBy(builder, order, pkColumn)` takes one tie-break column and
   `list` passes `primaryKey[0]`, so a two-column key orders by its first column only. The cursor
   is encoded from the same list, so the next page asks `WHERE "orgId" > $1` and skips every
   remaining row of that org. It needs the full key, in key order, for the ordering and for the
   cursor.

Done since this page was written: `PrimaryKeyOf<T>` is already a record for a key of two or more
columns, `buildKeyWhere` already assembles the multi-column filter from the whole
`schema.primaryKey`, and the one-column record form — which built `{ id: { id: 42 } }` and lost
the predicate — is refused.

Nothing about this is blocked by design. The typed-signature change is already done; what is left
is the DDL fix, the migration diff that has to see a key change, and two places that still read
`primaryKey[0]`.

## Related

The `manyToMany` join table is the common case for composite keys, and it works today, because [`manyToMany`](./relations.html) addresses the through-table by column names rather than through a repository.

---

See also: [Relations](./relations.html) · [Repository](./repository.html) · [Cursor-based pagination](./guide-cursor-pagination.html)
