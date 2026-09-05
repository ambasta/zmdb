Update rows with the query builder, or through a repository's
`update(id, patch)` / `updateMany(where, patch)`. Repository patches are
`UpdatePatch<S>`: each ordinary value is still validated against
`UpdateDTO<S>`, while a branded expression's operand is validated against the
same column.

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

On SQL Server the same builder places the clause before `WHERE`:

```sql
UPDATE [users] SET [role] = @p1 OUTPUT INSERTED.[id], INSERTED.[role] WHERE [id] = @p2
```

## Through the repository (validated)

```ts
import { inc, not } from 'zmdb';

const updated = await users.update(1, { role: 'admin' });
const counted = await posts.increment(1, 'views', 2);
await users.update(1, { active: not() });
const affected = await posts.updateMany({ authorId: 7 }, { views: inc(1) });
```

`increment` accepts only updatable numeric columns and preserves number versus
bigint operands. `preUpdate` receives the validated, `undefined`-stripped patch
in schema order, including the same branded expression objects supplied by the
caller.

The Postgres family, SQLite and SQL Server return the computed row from
`update`/`increment`, and `updateMany` returns a row count. The MySQL family
omits unsupported `RETURNING` for expression updates and every `updateMany`, so
those calls resolve to `undefined`; no hidden read follows the write.

> [!WARNING]
> An `update` without a `where` clause updates **every row**. The repository's
> `update(id, patch)` always scopes by primary key. `updateMany` and the raw
> builder use the `where` you supply, so an empty filter reaches every row.
