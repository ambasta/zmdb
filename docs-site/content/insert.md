Insert rows with the query builder, or (preferably) through a repository's `create()`, which validates the payload against `CreateDTO<S>` **before** any SQL is emitted.

## Basic insert

<!-- snippet: insert.ts#snippet-1 -->

```sql
INSERT INTO "users" ("email", "role") VALUES ($1, $2)
-- parameters: ['a@b.com', 'user']
```

## Returning the inserted row

<!-- snippet: insert.ts#snippet-2 -->

```sql
INSERT INTO "users" ("email") VALUES ($1) RETURNING "id", "createdAt"
```

SQL Server places its equivalent before `VALUES`:

```sql
INSERT INTO [users] ([email]) OUTPUT INSERTED.[id], INSERTED.[createdAt] VALUES (@p1)
```

MySQL refuses `returning()` rather than emitting unsupported SQL.

That also means `BaseRepository.create()` refuses before driver execution on the MySQL family: its `Promise<Entity<T>>` contract cannot honestly be satisfied by dropping the clause. Use a lower-level
INSERT without `returning()`, validate the payload explicitly, and perform the read you need.

## Through the repository (validated)

<!-- snippet: insert.ts#snippet-3 -->

> [!IMPORTANT] If the payload is invalid, `create` throws a structured `ValidationError` and **no SQL runs** — the driver is never called. Auto-increment PKs and defaulted columns may be omitted from
> the payload (that is what `CreateDTO` encodes).

See also [batch inserts](./batch.html) for multiple statements in one round-trip.
