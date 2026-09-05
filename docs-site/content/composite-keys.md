> **Partial support.** `PrimaryKey` is a per-column tag, and the reflector turns two of them
> into one ordered key. Snapshots, migration diffs, generated DDL and repository keyed methods
> preserve that whole key. Keyset pagination orders and cursors by the whole key too. A relation
> pointing at a composite parent still resolves one key column, so that relation case remains a
> documented gap.

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

The four root dialects and Cockroach use that same table-level shape with their
own identifier quoting and integer spelling. SingleStore adds its required
shard or rowstore declaration to the same `CREATE TABLE`. A one-column key
keeps the existing inline form, including SQLite's `INTEGER PRIMARY KEY` rowid
alias.

Changing the key produces one reversible `alter_primary_key` operation. Postgres and MySQL emit
one `ALTER TABLE` statement that drops the old key and adds the new one. SQLite has no key-alter
form, so generation throws an `UnsupportedFeatureError` naming the table and requiring a
hand-written table rebuild. SQL Server also refuses the generated operation because the snapshot
does not carry the existing primary-key constraint name needed for `DROP CONSTRAINT`.

> [!NOTE]
> The two `References<…>` tags above emit two independent single-column foreign
> keys. They are never grouped merely because both columns belong to one primary
> key. When one constraint must pair several local and target columns, declare it
> explicitly with
> `ForeignKey<'tenantId,userId', 'users', 'tenantId,id'>`.

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

A key that is missing a column is refused before any SQL is compiled. `IncompleteKeyError`
extends `ValidationError`, names the table, method and every missing column in key order, and
exposes the table and missing columns as fields:

```text
memberships.findById requires every key column; missing: orgId, userId
```

Only own properties count. A `userId` inherited from the key object's prototype is still
reported missing, so a prototype cannot silently complete a partial key.

Extra keys are ignored, so you can pass a whole row you already have:

```ts
await repo.delete(row); // row is a Membership; only orgId and userId are read
```

The same ordered key is the default conflict target for `upsert` and the deterministic
tie-breaker for `list`. A composite-key cursor therefore carries every key column, rather than
skipping rows that tie on the first one.

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
> Older versions accepted this object form and produced SQL with no `WHERE`
> clause. `findById` returned the first row, while `update` and `delete` affected
> the whole table:
>
> ```ts
> await repo.findById({ id: 42 }); // SELECT * FROM "products" LIMIT 1
> await repo.update({ id: 42 }, patch); // UPDATE "products" SET ... RETURNING *
> await repo.delete({ id: 42 }); // DELETE FROM "products" RETURNING "id"
> ```
>
> TypeScript rejected these calls, but untyped request data or a cast could still
> reach the runtime path. The repository now validates the key before compiling
> SQL. In addition, `compileWhere` rejects empty operator maps, and `update` and
> `delete` refuse to run compiled SQL without a `WHERE` clause.

A single-column key intentionally accepts only the scalar form. Supporting both
forms would make code silently change meaning if the table later gained a
composite key.

## What remains

**Relations to a composite parent.** Relation derivation still reads the parent's first key
column. It must pair every parent-key column with an equally sized `via` list or refuse the
declaration, never silently join on half a key.

Composite repository keys already work throughout the main data path.
`PrimaryKeyOf<T>` returns a record for multi-column keys, `keyWhere` uses every
ordered key column, partial keys report missing properties, and keyset pagination
uses the full key. Snapshot, diff, and DDL operations also preserve key order.

Nothing about the remaining work is blocked by design. The relation reader must stop treating
the first primary-key column as the whole key.

## Related

The `manyToMany` join table is the common case for composite keys, and it works today, because [`manyToMany`](./relations.html) addresses the through-table by column names rather than through a repository.

---

See also: [Relations](./relations.html) · [Repository](./repository.html) · [Cursor-based pagination](./guide-cursor-pagination.html)
