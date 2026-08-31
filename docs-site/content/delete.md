Delete rows with the query builder, or through a repository's `delete(id)` (which
returns a boolean).

## Basic delete

```ts
qc.deleteFrom('users').where('id', '=', 1).compile();
```

```sql
DELETE FROM "users" WHERE "id" = $1
-- parameters: [1]
```

## Returning deleted rows

```ts
qc.deleteFrom('users').where('role', '=', 'guest').returning(['id']).compile();
```

```sql
DELETE FROM "users" WHERE "role" = $1 RETURNING "id"
```

> [!WARNING]
> As with UPDATE, a DELETE without a `where` clause removes **every row**. Prefer
> the repository's `delete(id)` for single-row deletes, or wrap bulk deletes in a
> [transaction](./transactions.html).
