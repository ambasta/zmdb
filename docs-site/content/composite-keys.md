> **ToDo / remaining gaps.** `PrimaryKey` is a per-column tag, and the reflector turns two of
> them into one ordered key. Snapshots, migration diffs and `CREATE TABLE` now preserve that
> whole key, and `findById`, `update` and `delete` compile a full multi-column `WHERE` from it.
> This page remains a gap because the keyed-method diagnostics, composite-parent relations and
> keyset pagination still have unfinished cases. Keyset pagination currently orders and cursors
> by the key's first column only, so a page boundary can skip rows.

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

The snapshot stores the ordered key separately from its alphabetically sorted columns. A generated
migration therefore emits one table constraint in declaration order:

```sql
CREATE TABLE "memberships" (
  "orgId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  PRIMARY KEY ("orgId", "userId")
)
```

Postgres, MySQL and SQLite use that same table-level shape with their own identifier quoting and
integer spelling. A one-column key keeps the existing inline form, including SQLite's
`INTEGER PRIMARY KEY` rowid alias.

Changing the key produces one reversible `alter_primary_key` operation. Postgres and MySQL emit
one `ALTER TABLE` statement that drops the old key and adds the new one. SQLite has no key-alter
form, so generation throws an `UnsupportedFeatureError` naming the table and requiring a
hand-written table rebuild; it never silently omits the change.

> [!NOTE]
> Foreign-key `REFERENCES` clauses remain a separate migration gap. The composite primary key
> itself is generated; the two references in the declaration above are not yet emitted. See
> [Migrations](./migrations.html).

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

The snapshot/diff/DDL piece is complete. The remaining composite-key work is:

1. **Keyed-method diagnostics.** Partial composite keys are refused before SQL, but the message
   still reports one missing column at a time and does not name the method in the frozen form.
2. **Composite-parent relations.** A relation must join on every parent-key column or refuse the
   declaration; it must never reduce the key to its first column.
3. **Keyset pagination.** `applyOrderBy(builder, order, pkColumn)` takes one tie-break column and
   `list` passes `primaryKey[0]`, so a two-column key orders by its first column only. The cursor
   is encoded from the same list, so the next page asks `WHERE "orgId" > $1` and skips every
   remaining row of that org. It needs the full key, in key order, for the ordering and for the
   cursor.

Done since this page was written: `PrimaryKeyOf<T>` is already a record for a key of two or more
columns, `buildKeyWhere` already assembles the multi-column filter from the whole
`schema.primaryKey`, and the one-column record form — which built `{ id: { id: 42 } }` and lost
the predicate — is refused. `TableSnapshot.primaryKey`, composite `CREATE TABLE`, key-change
diffing and the explicit SQLite refusal are also implemented.

Nothing about the remaining work is blocked by design. The typed signature and migration boundary
are done; the remaining slices remove the runtime `primaryKey[0]` assumptions and finish the
diagnostic contract.

## Related

The `manyToMany` join table is the common case for composite keys, and it works today, because [`manyToMany`](./relations.html) addresses the through-table by column names rather than through a repository.

---

See also: [Relations](./relations.html) · [Repository](./repository.html) · [Cursor-based pagination](./guide-cursor-pagination.html)
