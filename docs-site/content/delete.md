Delete rows with the query builder, or through a repository's `delete(id)` (which returns a boolean).

## Basic delete

<!-- snippet: delete.ts#snippet-1 -->

```sql
DELETE FROM "users" WHERE "id" = $1
-- parameters: [1]
```

## Returning deleted rows

<!-- snippet: delete.ts#snippet-2 -->

```sql
DELETE FROM "users" WHERE "role" = $1 RETURNING "id"
```

SQL Server places its equivalent before `WHERE`:

```sql
DELETE FROM [users] OUTPUT DELETED.[id] WHERE [role] = @p1
```

MySQL refuses `returning()` rather than emitting unsupported SQL.

## Repository soft delete

A repository whose table extends `SoftDelete<'deletedAt'>` changes the meaning of `delete(id)` without hiding the SQL:

```sql
UPDATE "users"
SET "deletedAt" = $1
WHERE "id" = $2 AND "deletedAt" IS NULL
RETURNING "id"
```

The parameter is a Node `Date`. `hardDelete(id)` always compiles a physical `DELETE`; `restore(id)` sets the managed column back to `NULL`; and `deleteMany(where)` uses the same soft-update rule for
bulk deletion. All remain subject to write filters, except that `restore` necessarily disables the built-in soft-delete predicate while retaining the others. See
[Entity Filters](./entity-filters.html) for the explicit read and hard-delete escapes, relation-target behavior, and unique-index interaction.

> [!WARNING] As with UPDATE, a DELETE without a `where` clause removes **every row**. Prefer the repository's `delete(id)` for single-row deletes, or wrap bulk deletes in a
> [transaction](./transactions.html).

---

See also: [Entity Filters](./entity-filters.html) · [CRUD](./crud.html) · [Transactions](./transactions.html)
