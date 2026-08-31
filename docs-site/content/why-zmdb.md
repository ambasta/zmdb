zmdb exists because the four libraries it replaces each solve one part of "get data from a request into a database and back" and each pay for it in a different way. Using all four together means running four metadata systems over the same types.

## The problem with the stack it replaces

A typical TypeScript API today wires up something like this:

| Layer               | Library                        | What it reads                   |
| ------------------- | ------------------------------ | ------------------------------- |
| Request validation  | Typia or Zod                   | your TypeScript types           |
| DTO / serialization | class-transformer              | decorator metadata              |
| Schema / queries    | Drizzle or MikroORM            | a second schema declaration     |
| OpenAPI             | `@nestjs/swagger` + CLI plugin | a third re-parse of your source |

The same `User` shape is described four times. Nothing checks that the four descriptions agree, so the failure mode is not a crash — it is a validator that accepts a field the database rejects, or an OpenAPI document that documents a field you removed last week.

## What zmdb does instead

One schema object is the source of truth, and everything else is **derived from it by the type system**:

```ts
import { defineSchema, serial, text, timestamp, primaryKey, notNull } from '@zmdb/schema-core';

export const users = defineSchema('users', {
  id: primaryKey(serial()),
  email: notNull(text()),
  createdAt: notNull(timestamp()),
});
```

From that one declaration you get, with no second declaration and no runtime reflection:

- `Entity<typeof users>` — the row type
- `CreateDTO<typeof users>` — insert payload, with `id` omitted because it is `serial`
- `UpdateDTO<typeof users>` — every field optional
- `WhereDTO<typeof users>` — filters, typed per column
- the compiled SQL, per dialect
- the JSON Schema and OpenAPI components
- the validator, generated at build time by the AOT transformer

If you delete `email` from the schema, every one of those changes in the same commit, and the ones that cannot change break the build.

## Three design rules

**1. Compile time over runtime.** Validators are generated from the checker's view of your types during `tsc`, not assembled from `design:type` metadata at boot. That is why there is no `reflect-metadata`, no metadata cache to invalidate, and no CLI plugin that re-parses your source to recover types the decorators could not see.

**2. Rows are data.** A read returns a plain object. There is no identity map holding it, no proxy deciding whether a property access is free or a query, and no `flush()` inferring your intent from a diff. See [Why fetched rows are inert](./inert-rows.html).

**3. Zero required runtime dependencies.** `@zmdb/*` packages depend on nothing at runtime. The driver you write is yours; the ~15-line `Driver` interface is the whole contract.

> [!NOTE]
> Those rules cost you things. There is no `ON CONFLICT` yet, no query result cache, no GraphQL layer. The [anti-patterns page](./anti-patterns.html) lists what is excluded on principle and the [coverage gate](https://github.com/ambasta/zmdb/blob/main/.github/scripts/verify-docs-coverage.mjs) lists what is merely not built — every page marked **ToDo** in this manual names the specific gap.

## When not to use zmdb

- You need a dialect we do not compile: SQL Server, Gel, MongoDB. See [Dialects](./dialect-postgres.html).
- You want the ORM to track your objects and work out the writes. That is the [unit of work](./anti-patterns.html), and it is excluded by design, not deferred.
- You cannot run a TypeScript transformer in your build. The transformer is not optional — see [AOT Setup](./aot-setup.html).

---

See also: [Introduction](./introduction.html) · [Architecture](./architecture.html) · [AOT vs JIT](./jit-vs-aot.html) · [Anti-patterns](./anti-patterns.html)
