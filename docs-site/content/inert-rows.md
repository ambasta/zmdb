Fetched rows in zmdb are plain objects with no change tracking, no proxies, and no identity map. Mutating them has zero effect on the database. Reads, writes, and relation loading happen through
explicit repository calls.

## The Mutation Fallacy

If you're coming from MikroORM, TypeORM, or similar, you may be used to this pattern:

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies User, em; this excerpt does not repeat those declarations."}
// MikroORM-style
const user = await em.findOne(User, 1);
user.email = 'new@example.com';
await em.flush(); // persist changes
```

In zmdb, **this doesn't work**:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies users; this excerpt does not repeat those declarations."}
const user = await users.findById(1);
user.email = 'new@example.com'; // ❌ Does NOT persist

// The database still has the old email
const check = await users.findById(1);
console.log(check.email); // original value
```

> [!IMPORTANT] Fetched rows are inert. The only way to persist changes is through explicit `create`, `update`, or `delete` methods on the repository.

## Why Inert?

zmdb deliberately excludes:

- **Proxies** — no `Proxy` wrapping fetched rows
- **Dirty checking** — no comparison of original vs current state
- **Identity map** — no shared references across queries
- **Unit of work** — no implicit flush

This avoids proxy dispatch and change-tracking scans. Repositories still build queries and assemble results, including relation batches and populated copies. Those operations have runtime cost.

## The Correct Pattern

Translate your "load-mutate-flush" workflow into explicit updates:

| Traditional ORM                  | zmdb                                  |
| -------------------------------- | ------------------------------------- |
| `em.findOne(User, 1)`            | `await users.findById(1)`             |
| `user.email = 'x'`               | `const patch = { email: 'x' }`        |
| `await em.flush()`               | `await users.update(1, patch)`        |
| Multiple changes across entities | `db.transaction(async tx => { ... })` |

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies users; this excerpt does not repeat those declarations."}
// Find
const user = await users.findById(1);

// Prepare patch
const patch = { email: 'new@example.com', role: 'admin' };

// Persist explicitly
await users.update(1, patch);
```

## Explicit population

You can load relations after fetching a row without making that row a live object:

```ts {"mode":"illustrative","id":"populate-copy","reason":"The surrounding example supplies users with declared posts/comments relations and their target schemas registered in RepositoryOptions.schemas."}
const row = await users.findById(1);
if (row !== undefined) {
  const populated = await users.populate(row, ['posts.comments']);
  // row stays unchanged; populated carries the requested relations.
}
```

`populate()` also accepts readonly arrays of existing rows. It returns new populated copies and fetches only the requested relations, without reloading roots. Reading a property never triggers SQL.
See [loading strategies](./loading-strategies.html) for target-schema registration and [request-scoped batching](./dataloaders.html) for concurrent calls.

## Post-Select Hook

Use `postSelect` to enrich or filter rows on the way out:

```ts {"mode":"illustrative","id":"example-004","reason":"This decorator or member excerpt omits its containing class and the application-owned declarations it uses."}
protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map(r => ({
    ...r,
    // Add computed field
    isNew: r.createdAt instanceof Date && r.createdAt > new Date('2024-01-01'),
  }));
}
```

> [!TIP] `postSelect` is the escape hatch for row enrichment. Use it for computed fields, masking, or adding metadata — but it doesn't enable auto-persisting.

## Performance Impact

The inert row design avoids automatic entity bookkeeping:

- **No proxy dispatch** — property access reads ordinary objects
- **No change tracking** — no array of dirty entities to scan
- **No identity map** — repository reads do not consult a shared entity registry
- **Explicit loading** — requested relation paths and dialect batch limits determine the relation queries

## Cross-links

- [CRUD](./crud.html) — explicit create/update/delete
- [Repository](./repository.html) — full repository API
- [Transactions](./transactions.html) — grouping multiple writes
