Fetched rows in zmdb are plain objects with no change tracking, no proxies, and no identity map. Mutating them has zero effect on the database. This is a deliberate design choice that enables zero-overhead data access.

## The Mutation Fallacy

If you're coming from MikroORM, TypeORM, or similar, you may be used to this pattern:

```ts
// MikroORM-style
const user = await em.findOne(User, 1);
user.email = 'new@example.com';
await em.flush(); // persist changes
```

In zmdb, **this doesn't work**:

```ts
const user = await users.findById(1);
user.email = 'new@example.com'; // ❌ Does NOT persist

// The database still has the old email
const check = await users.findById(1);
console.log(check.email); // original value
```

> [!IMPORTANT]
> Fetched rows are inert. The only way to persist changes is through explicit `create`, `update`, or `delete` methods on the repository.

## Why Inert?

zmdb deliberately excludes:

- **Proxies** — no `Proxy` wrapping fetched rows
- **Dirty checking** — no comparison of original vs current state
- **Identity map** — no shared references across queries
- **Unit of work** — no implicit flush

This enables the zero-overhead promise: the data layer adds no runtime overhead beyond the SQL itself. Every operation is explicit and visible.

## The Correct Pattern

Translate your "load-mutate-flush" workflow into explicit updates:

| Traditional ORM                  | zmdb                                  |
| -------------------------------- | ------------------------------------- |
| `em.findOne(User, 1)`            | `await users.findById(1)`             |
| `user.email = 'x'`               | `const patch = { email: 'x' }`        |
| `await em.flush()`               | `await users.update(1, patch)`        |
| Multiple changes across entities | `db.transaction(async tx => { ... })` |

```ts
// Find
const user = await users.findById(1);

// Prepare patch
const patch = { email: 'new@example.com', role: 'admin' };

// Persist explicitly
await users.update(1, patch);
```

## Post-Select Hook

Use `postSelect` to enrich or filter rows on the way out:

```ts
protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map(r => ({
    ...r,
    // Add computed field
    isNew: r.createdAt instanceof Date && r.createdAt > new Date('2024-01-01'),
  }));
}
```

> [!TIP]
> `postSelect` is the escape hatch for row enrichment. Use it for computed fields, masking, or adding metadata — but it doesn't enable auto-persisting.

## Performance Impact

The inert row design trades convenience for speed:

- **No proxy overhead** — plain objects are as fast as JavaScript gets
- **No change tracking** — no array of dirty entities to scan
- **No identity map** — no Map lookups on every fetch
- **Deterministic behavior** — you see exactly what SQL will run

## Cross-links

- [CRUD](./crud.html) — explicit create/update/delete
- [Repository](./repository.html) — full repository API
- [Transactions](./transactions.html) — grouping multiple writes
