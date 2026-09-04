The repository pattern provides a typed, validated data access layer backed by your schema definition. zmdb's `BaseRepository` delivers CRUD, upsert, expression-valued updates, lifecycle hooks,
validation interception, and transaction support — all without proxies or an identity map.

## Defining a Repository

A repository is a minimal subclass that binds to your schema. The entire required body is one line.

<!-- snippet: repository.ts#snippet-1 -->

> [!IMPORTANT] The `static readonly schema = UserSchema` line is required. It binds the schema to the class so the repository can derive types and validate payloads.

## Injecting a Driver

The repository never opens database connections itself. You inject a `Driver` that executes compiled queries.

<!-- snippet: repository.ts#snippet-2 -->

## CRUD Operations

All write operations validate payloads against the schema before executing SQL. If validation fails, **no SQL runs**.

<!-- snippet: repository.ts#snippet-3 -->

For a numeric column, `repo.increment(id, column, by?)` is the typed atomic shortcut. The column union is derived from updatable `integer`, `bigint`, and `numeric` declarations, and the operand
preserves number versus bigint.

## Typed filtering & pagination

Beyond `findById`/`findOne`, the repository exposes typed `find` and `list` methods driven by the schema-derived [WhereDTO](./filters.html) and [pagination](./pagination.html) DTOs — no untyped
`Record` filters.

<!-- snippet: repository.ts#snippet-4 -->

```sql
SELECT * FROM "users" WHERE "role" = $1 AND "age" >= $2
SELECT * FROM "users" WHERE "email" = $1 LIMIT 1
SELECT * FROM "users" WHERE "role" = $1 ORDER BY "createdAt" DESC LIMIT 21
```

> [!NOTE] `list` fetches `limit + 1` rows and trims, so `hasMore` is computed without a separate `COUNT`. The operator set (`eq/ne/lt/lte/gt/gte/in/nin/like/ilike/isNull/notNull`) and result shape
> come from [Filters](./filters.html) and the [Read/Query DTOs](./read-dtos.html).

## Lifecycle Hooks

Hooks fire synchronously around their corresponding repository operations. Override them in your subclass.

<!-- snippet: repository.ts#snippet-5 -->

`preUpdate` runs for `update`, `updateMany`, and `increment`. `upsert` runs `preInsert` for its create payload; its conflict-update object does not also run `preUpdate`. A soft delete emits SQL
`UPDATE`, but follows delete semantics: `preDelete` runs and `preUpdate` does not.

## Transactions

Bind a repository to a transaction for atomic multi-operation flows.

<!-- snippet: repository.ts#snippet-6 -->

> [!NOTE] `withTransaction` returns a shallow clone — the original repository's driver is unchanged.

## Cross-links

- [CRUD](./crud.html) — detailed create/read/update/delete semantics
- [Increment & Decrement](./guide-increment-decrement.html) — atomic expression writes
- [Read DTOs](./read-dtos.html) — typed filtering, ordering, pagination
- [Transactions](./transactions.html) — transaction management details
- [Validation](./validators-is.html) — AOT-validated payloads
