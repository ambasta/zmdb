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

One **TypeScript interface** is the source of truth, and everything else is **derived from it by the type system**:

```ts
import type { HasDefault, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

There is no schema _object_ to write. The table name, the column types, the key and the
constraints are all on the type, carried by intersection tags that erase to nothing at
runtime — `zmdb/tags` has no runtime exports at all, so that import disappears from your
build output.

From that one declaration you get, with no second declaration and no runtime reflection:

- `Entity<User>` — the row type
- `CreateDTO<User>` — insert payload, with `id` **absent** because it is `Serial` and
  `createdAt` optional because it `HasDefault`
- `UpdateDTO<User>` — every field optional, identity columns dropped
- `WhereDTO<User>` — filters, typed per column
- `ReadDTO<User>` — the row minus every `Sensitive` column
- `schemaOf<User>()` — the schema value the repository and the migration snapshot take
- the compiled SQL, per dialect
- the JSON Schema and OpenAPI components
- the validator, emitted as straight-line JavaScript at build time

If you delete `email` from the interface, every one of those changes in the same commit, and the ones that cannot change break the build.

## Three design rules

**1. Compile time over runtime.** Validators are generated from the checker's view of your types during `tsc`, not assembled from `design:type` metadata at boot. That is why there is no `reflect-metadata`, no metadata cache to invalidate, and no CLI plugin that re-parses your source to recover types the decorators could not see.

**2. Rows are data.** A read returns a plain object. There is no identity map holding it, no proxy deciding whether a property access is free or a query, and no `flush()` inferring your intent from a diff. See [Why fetched rows are inert](./inert-rows.html).

**3. Zero required runtime dependencies.** `@zmdb/*` packages depend on nothing at runtime. The driver you write is yours; the ~15-line `Driver` interface is the whole contract.

> [!NOTE]
> Those rules cost you things. There is no `ON CONFLICT` yet and no GraphQL layer — the first is not built, the second [will not be](./web-graphql.html). The explicit result cache remains deliberately separate from an identity map. The [anti-patterns page](./anti-patterns.html) lists what is excluded on principle and the [coverage gate](https://github.com/ambasta/zmdb/blob/main/.github/scripts/verify-docs-coverage.mjs) lists the rest — every page in this manual marked **ToDo** names documentation or capability work that remains, and every page marked **Not planned** names one that is not.

## When not to use zmdb

- You need a dialect we do not compile: SQL Server, Gel, MongoDB. See [Dialects](./dialect-postgres.html).
- You want the ORM to track your objects and work out the writes. That is the [unit of work](./anti-patterns.html), and it is excluded by design, not deferred.
- You cannot run a TypeScript transformer in your build. The transformer is not optional — see [AOT Setup](./aot-setup.html).

---

See also: [Introduction](./introduction.html) · [Architecture](./architecture.html) · [AOT vs JIT](./jit-vs-aot.html) · [Anti-patterns](./anti-patterns.html)
