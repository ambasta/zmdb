Populate loads related entities for to-one and to-many relations. Unlike lazy-loading proxies, zmdb uses explicit batched queries — no proxies, no N+1 problem, and no identity map.

## Typed populate: `findById(id, { populate })`

Declare the relation on the type — see [Relations](./relations.html) — then ask for it by key. The result is a parent **typed** with its nested relation(s).

<!-- snippet: populate-results.ts#snippet-1 -->

`populate` accepts the relation keys of `User`, so `['ordres']` does not compile. There is no static `relations` map: it used to sit beside `static schema`, restating the target table, the foreign key
and the cardinality that the declaration above already carries.

Under the hood zmdb loads the parent, then runs **one batched query** for the children and attaches them — a plain array on a plain object.

```sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1
SELECT * FROM "orders" WHERE "userId" = $1   -- batched across all parents
```

> [!TIP] Without `{ populate }` the result is a plain `Entity<User>` — the relation key is not on the type and not on the object — so you never pay for data you didn't ask for. This replaces the older
> stringly-typed `findAllWithMany`.

## Populating To-One Relations (via JOIN)

Use `findJoined` to fetch a parent with its related entity via JOIN.

<!-- snippet: populate-results.ts#snippet-2 -->

**SQL emitted:**

```sql
SELECT "orders".*, "users"."id" AS "user_id", "users"."email" AS "user_email"
FROM "orders" LEFT JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
```

## Populating To-Many Relations

Use `findAllWithMany` to batch-load children for all parents.

<!-- snippet: populate-results.ts#snippet-3 -->

**SQL emitted (2 queries):**

```sql
-- First: fetch all users
SELECT * FROM "users"

-- Second: batched IN query for orders
SELECT * FROM "orders" WHERE "userId" IN ($1, $2, $3, ...)
```

> [!IMPORTANT] `findAllWithMany` executes exactly two queries regardless of parent count. This eliminates N+1 without proxies.

## Populate in GetDTO

Pass `populate` in the GetOptions to type-narrow the result:

<!-- snippet: populate-results.ts#snippet-4 -->

## No Lazy Loading

There are no lazy-loading proxies. If you don't call a populate method, relations are simply absent from the result:

<!-- snippet: populate-results.ts#snippet-5 -->

> [!TIP] Always consider which relations you need. Load only what's necessary to avoid unnecessary queries.

## Cross-links

- [Relations](./relations.html) — schema definition
- [Read DTOs](./read-dtos.html) — typed reads
- [Repository](./repository.html) — CRUD with populate
