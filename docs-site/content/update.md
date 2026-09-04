Update rows with the query builder, or through a repository's `update(id, patch)` / `updateMany(where, patch)`. Repository patches are `UpdatePatch<S>`: each ordinary value is still validated against
`UpdateDTO<S>`, while a branded expression's operand is validated against the same column.

## Basic update

<!-- snippet: update.ts#snippet-1 -->

```sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2
-- parameters: ['admin', 1]
```

## Returning the updated row

<!-- snippet: update.ts#snippet-2 -->

```sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING "id", "role"
```

On SQL Server the same builder places the clause before `WHERE`:

```sql
UPDATE [users] SET [role] = @p1 OUTPUT INSERTED.[id], INSERTED.[role] WHERE [id] = @p2
```

## Through the repository (validated)

<!-- snippet: update.ts#snippet-3 -->

`increment` accepts only updatable numeric columns and preserves number versus bigint operands. `preUpdate` receives the validated, `undefined`-stripped patch in schema order, including the same
branded expression objects supplied by the caller.

The Postgres family, SQLite and SQL Server return the computed row from `update`/`increment`, and `updateMany` returns a row count. On the MySQL family, an ordinary value-bearing `update` refuses
before driver execution because its returned-entity contract needs `UPDATE … RETURNING`. Expression updates and every `updateMany` instead use their explicit one-statement contract, omit unsupported
`RETURNING`, and resolve to `undefined`; no hidden read follows the write.

> [!WARNING] An `update` without a `where` clause updates **every row**. The repository's `update(id, patch)` always scopes by primary key. `updateMany` and the raw builder use the `where` you supply,
> so an empty filter reaches every row.
