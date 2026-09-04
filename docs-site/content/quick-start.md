This guide takes you from an empty project to a validated, type-safe data layer in a few minutes. By the end you will have defined a schema, derived its types, run CRUD through a repository, and
issued a typed query.

> [!NOTE] zmdb targets **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. It never opens a database connection itself — you inject a small `Driver`, so it works with `pg`, `mysql2`,
> `better-sqlite3`, or `node:sqlite`.

## 1. Install

```bash
npm add zmdb@alpha @zmdb/sqlite@alpha
```

`zmdb` exposes the cohesive product API; `@zmdb/sqlite` is the explicit complete SQLite vertical selected by this guide. (Prefer granular installs? See [Installation](./installation.html).) Then wire
the transformer once — see [AOT setup](./aot-setup.html). It is not an optimisation you can skip: `schemaOf<T>()` and the validators read a type argument, which does not exist at runtime, so an
untransformed build throws rather than quietly checking nothing.

## 2. Declare your table once

A table is a TypeScript type. That declaration is the single source of truth, and everything else derives from it.

<!-- snippet: quick-start.ts#snippet-1 -->

Each property is its **app type** intersected with **tags**. The app type is what your code sees; the tags say what TypeScript has no syntax for. Tags are phantom `unique symbol` slots, so they erase
completely — this file compiles to no JavaScript at all.

There is no builder DSL and no global registry. If you have a codebase full of `defineSchema('users', { id: serial().primaryKey() })`, the [codemod](./codemod.html) converts it.

## 3. Types derive automatically

<!-- snippet: quick-start.ts#snippet-2 -->

> [!TIP] Change a column and every derived type updates. Any call site that no longer satisfies them **fails to compile** — that compile error is the anti-drift guarantee. See
> [Type derivation](./type-derivation.html).

`Serial` removes `id` from the create type rather than making it optional: there is no value you could usefully pass for a column the database generates.

## 4. CRUD through a repository

A repository binds your schema to a driver. The fastest way is the **`defineRepository`** helper (no subclass, no hand-written driver) with the built-in `node:sqlite` driver — a genuinely
zero-dependency setup:

<!-- snippet: quick-start.ts#snippet-3 -->

Prefer a class? Subclassing works identically:

<!-- snippet: quick-start.ts#snippet-4 -->

> [!IMPORTANT] `schemaOf<T>()` is a **compile-time** call — the answer is a function of a type argument, and type arguments do not exist at runtime. The transformer replaces it with a frozen object
> literal. An untransformed build throws a message saying exactly that; it does not hand back an empty schema. Wire up the [plugin](./aot-setup.html) or the [codegen CLI](./cli-codegen.html).

> [!TIP] Use `pgDriver` from `@zmdb/repository/drivers/pg` for PostgreSQL. A full runnable example lives at `examples/quickstart.ts`. See [Drivers](./drivers.html).

> [!IMPORTANT] Rows you read back are **plain, inert objects**. Mutating `user.email = 'x'` persists nothing — writes only happen through `create`/`update`/`delete`. This is deliberate; see
> [Why fetched rows are inert](./inert-rows.html).

## 5. Query your data (typed)

<!-- snippet: quick-start.ts#snippet-5 -->

```sql
SELECT * FROM "users"
WHERE "role" = $1 AND "createdAt" >= $2
ORDER BY "createdAt" DESC
LIMIT 21
```

The filter, ordering and pagination are all typed against `User`. See [Filters](./filters.html), [Ordering & pagination](./pagination.html) and the [Read/Query DTOs](./read-dtos.html).

## 6. Atomic writes with transactions

<!-- snippet: quick-start.ts#snippet-6 -->

## 7. Validate at the boundary

<!-- snippet: quick-start.ts#snippet-7 -->

## Where to go next

- [Schema declaration](./schema-declaration.html), the [tag reference](./tags-reference.html) and [Column types](./column-types.html)
- [Relations](./relations.html) and [typed populate/join results](./populate-results.html)
- [Migrations](./migrations.html) — diffed from the schema
- [Validators](./validators-is.html) and [JSON / Ser-De](./json-stringify.html)
- [Anti-patterns](./anti-patterns.html) — what zmdb deliberately does _not_ do, and why
