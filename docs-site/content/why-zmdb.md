zmdb exists because the four libraries it replaces each solve one part of "get data from a request into a database and back" and each pay for it in a different way. Using all four together means
running four metadata systems over the same types.

## The problem with the stack it replaces

A typical TypeScript API today wires up something like this:

| Layer               | Library                        | What it reads                   |
| ------------------- | ------------------------------ | ------------------------------- |
| Request validation  | Typia or Zod                   | your TypeScript types           |
| DTO / serialization | class-transformer              | decorator metadata              |
| Schema / queries    | Drizzle or MikroORM            | a second schema declaration     |
| OpenAPI             | `@nestjs/swagger` + CLI plugin | a third re-parse of your source |

The same `User` shape is described four times. Nothing checks that the four descriptions agree, so the failure mode is not a crash — it is a validator that accepts a field the database rejects, or an
OpenAPI document that documents a field you removed last week.

## What zmdb does instead

One **TypeScript interface** is the source of truth, and everything else is **derived from it by the type system**:

```ts {"mode":"compile","id":"example-001"}
import type { HasDefault, PrimaryKey, Serial, Sql, Table, Unique } from '@zmdb/core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

There is no column-map schema _object_ to write. The table name, column types, key and constraint intent are all on the type, carried by intersection tags that erase to nothing at runtime —
`@zmdb/core/tags` has no runtime exports at all, so that import disappears from your build output. Schema objects that have no type-level shape, such as a standalone or expression index, stay in
explicit migrations.

From that one declaration you get, with no second declaration and no runtime reflection:

- `Entity<User>` — the row type
- `CreateDTO<User>` — insert payload, with `id` **absent** because it is `Serial` and `createdAt` optional because it `HasDefault`
- `UpdateDTO<User>` — every field optional, identity columns dropped
- `WhereDTO<User>` — filters, typed per column
- `ReadDTO<User>` — the row minus every `Sensitive` column
- `schemaOf<User>()` — the schema value the repository and the migration snapshot take
- the compiled SQL, per dialect
- the JSON Schema and OpenAPI components
- the validator, emitted as straight-line JavaScript at build time

If you delete `email` from the interface, every one of those changes in the same commit, and the ones that cannot change break the build.

## Three design rules

**1. Compile time over runtime.** Validators are generated from the checker's view of your types during `tsc`, not assembled from `design:type` metadata at boot. That is why there is no
`reflect-metadata`, no metadata cache to invalidate, and no CLI plugin that re-parses your source to recover types the decorators could not see.

**2. Rows are data.** A read returns a plain object. There is no identity map holding it, no proxy deciding whether a property access is free or a query, and no `flush()` inferring your intent from a
diff. See [Why fetched rows are inert](./inert-rows.html).

**3. Explicit ownership.** The runtime foundation has no external runtime dependencies. Database providers, HTTP, build tooling and optional integrations have their own declared dependencies and
resource ownership. The default `@zmdb/core` install includes SQLite; select a supported driver instead of writing an adapter for the beginner path. See [Runtime foundation](./runtime-foundation.html)
and [Database selection](./drivers.html).

These rules exclude identity maps, automatic unit-of-work flushing and lazy relation proxies. [Anti-patterns](./anti-patterns.html) explains those boundaries. Use the
[generated package reference](./package-reference.html) and [client integration guide](./framework-integrations.html) for current package and framework support.

## When not to use zmdb

- You need a target we do not compile: Gel or MongoDB, or a SQL dialect beyond Postgres, MySQL, SQLite, SQL Server, CockroachDB and SingleStore. See [Database selection](./drivers.html).
- You want the ORM to track your objects and work out the writes. That is the [unit of work](./anti-patterns.html), and it is excluded by design, not deferred.
- You cannot run a TypeScript transformer in your build. The transformer is not optional — see [AOT Setup](./aot-setup.html).

---

Continue with [Quick start](./quick-start.html) → [Blog API](./tutorial-blog-api.html) → [Generated client](./generated-client.html). See [Architecture](./architecture.html) for ownership and
[Anti-patterns](./anti-patterns.html) for deliberate limits.
