Populate loads declared to-one and one-to-many relations through explicit batched queries. Dotted paths can traverse multiple relation levels. Results remain plain objects with no proxies or identity
map; many-to-many population is unsupported.

## Typed populate: `findById(id, { populate })`

Declare the relation on the type — see [Relations](./relations.html) — then ask for it by key or dotted path. The result is a parent **typed** with its requested relations.

<!-- snippet: populate-results.ts#snippet-1 -->

`populate` checks every segment against the declared relations, so `['ordres']` does not compile. Existing repository read options also accept paths such as `['orders.items']`. Register the target
schemas in `RepositoryOptions.schemas` to traverse those paths. The relation metadata supplies the target table, foreign key, and cardinality.

zmdb loads the parent, then batches the related keys and attaches the resulting children as plain arrays or objects. Shared path prefixes are deduplicated. A batch can split into multiple SQL
statements at the dialect's parameter limit; this small example needs one child statement:

```sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1
SELECT * FROM "orders" WHERE "userId" = $1   -- batched across all parents
```

> [!TIP] Without `{ populate }` the result is a plain `Entity<User>` — the relation key is not on the type and not on the object. You can populate a copy later when the caller needs it.

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

Use `findAll({ populate: ['orders'] })` to batch-load children for all parents.

<!-- snippet: populate-results.ts#snippet-3 -->

**SQL for a nonempty result that fits one relation batch:**

```sql
-- First: fetch all users
SELECT * FROM "users"

-- Second: batched IN query for orders
SELECT * FROM "orders" WHERE "userId" IN ($1, $2, $3, ...)
```

> [!IMPORTANT] Relations are batched across parents. Large parent sets may need multiple statements because dialects limit the number of bound parameters.

## Populate rows already loaded

Call `repo.populate(row, paths, options?)` for one row or pass a readonly row array for multiple roots. The optional third argument is `ReadOptions`.

```ts {"mode":"illustrative","id":"populate-existing","reason":"The surrounding example supplies users, existingUser and existingUsers; Order declares an items relation and the repository registers both target schemas."}
const userWithItems = await users.populate(existingUser, ['orders.items']);
const usersWithItems = await users.populate(existingUsers, ['orders.items']);
```

Both calls return new populated copies and leave the input rows unchanged. They fetch the requested relations without fetching the roots again. To combine concurrent calls, use
`ctx.loaders.populate(users, rows, paths, options?)` on an HTTP request's lazy `LoaderScope`, or a scope created with `createLoaderScope()` in standalone code. Batching matches the repository, path
set, and options object identity; this method retains no result cache. See [DataLoaders](./dataloaders.html).

## Populate in GetDTO

Pass `populate` in the GetOptions to type-narrow the result:

<!-- snippet: populate-results.ts#snippet-4 -->

## No Lazy Loading

Relations appear only when requested by a `populate` read option or an explicit `populate()` call. Property access never loads them:

<!-- snippet: populate-results.ts#snippet-5 -->

> [!TIP] Always consider which relations you need. Load only what's necessary to avoid unnecessary queries.

## Cross-links

- [Relations](./relations.html) — schema definition
- [Read DTOs](./read-dtos.html) — typed reads
- [Repository](./repository.html) — CRUD with populate
