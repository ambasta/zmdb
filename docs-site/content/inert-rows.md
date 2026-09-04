Fetched rows in zmdb are plain objects with no change tracking, no proxies, and no identity map. Mutating them has zero effect on the database. This is a deliberate design choice that enables
zero-overhead data access.

## The Mutation Fallacy

If you're coming from MikroORM, TypeORM, or similar, you may be used to this pattern:

<!-- snippet: inert-rows.ts#snippet-1 -->

In zmdb, **this doesn't work**:

<!-- snippet: inert-rows.ts#snippet-2 -->

> [!IMPORTANT] Fetched rows are inert. The only way to persist changes is through explicit `create`, `update`, or `delete` methods on the repository.

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

<!-- snippet: inert-rows.ts#snippet-3 -->

## Post-Select Hook

Use `postSelect` to enrich or filter rows on the way out:

<!-- snippet: inert-rows.ts#snippet-4 -->

> [!TIP] `postSelect` is the escape hatch for row enrichment. Use it for computed fields, masking, or adding metadata — but it doesn't enable auto-persisting.

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
