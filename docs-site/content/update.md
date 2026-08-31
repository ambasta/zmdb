Update rows with the query builder, or through a repository's `update(id, patch)`,
which validates `patch` against `UpdateDTO<S>` (a `Partial<CreateDTO<S>>`).

## Basic update

```ts
qc.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).compile();
```

```sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2
-- parameters: ['admin', 1]
```

## Returning the updated row

```ts
qc.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).returning(['id', 'role']).compile();
```

```sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING "id", "role"
```

## Through the repository (validated)

```ts
const updated = await users.update(1, { role: 'admin' }); // validated vs UpdateDTO
```

> [!WARNING]
> An `update` without a `where` clause updates **every row**. The repository's
> `update(id, patch)` always scopes by primary key; the raw builder does not — add
> a predicate.
