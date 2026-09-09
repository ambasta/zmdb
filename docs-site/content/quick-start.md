This guide takes you from an empty project to a validated, type-safe data layer in a few minutes. By the end you will have defined a schema, derived its types, run CRUD through a repository, and
issued a typed query. Continue with the [blog API tutorial](./tutorial-blog-api.html) to put the same data layer behind HTTP, then [generate its client contract](./generated-client.html).

> [!NOTE] zmdb targets **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. The default product includes the SQLite provider. You own its connection and pass the selected driver into the
> repository; other database providers are explicit selections.

## 1. Install

```bash
yarn add @zmdb/core@1.0.0-beta.1
```

`@zmdb/core` includes SQLite and exposes its driver through `@zmdb/core/sqlite`. (Prefer granular installs? See [Installation](./installation.html).) Then wire the transformer once — see
[AOT setup](./aot-setup.html). It is not an optimisation you can skip: `schemaOf<T>()` and the validators read a type argument, which does not exist at runtime, so an untransformed build throws rather
than quietly checking nothing.

## 2. Declare your table once

A table is a TypeScript type. That declaration is the single source of truth, and everything else derives from it.

```ts {"mode":"compile","id":"example-001"}
import type { HasDefault, Min, Pattern, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/core';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}
```

Each property is its **app type** intersected with **tags**. The app type is what your code sees; the tags say what TypeScript has no syntax for. Tags are phantom `unique symbol` slots, so they erase
completely — this file compiles to no JavaScript at all.

The build reads the TypeScript declaration. No separate builder declaration or global schema registry is required.

## 3. Types derive automatically

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import type { CreateDTO, Entity, UpdateDTO } from '@zmdb/core';

type Row = Entity<User>;
//   { id: number; email: string; role: 'admin' | 'user'; createdAt: Date }

type CreateUser = CreateDTO<User>;
//   { email: string; role?: 'admin' | 'user'; createdAt?: Date }   ← id absent (Serial); HasDefault → optional

type UpdateUser = UpdateDTO<User>; //  Partial<CreateUser>
```

> [!TIP] Change a column and every derived type updates. Any call site that no longer satisfies them **fails to compile** — that compile error is the anti-drift guarantee. See
> [Type derivation](./type-derivation.html).

`Serial` removes `id` from the create type rather than making it optional: there is no value you could usefully pass for a column the database generates.

## 4. CRUD through a repository

A repository binds your schema to a driver. The fastest way is the **`defineRepository`** helper (no subclass, no hand-written driver) with the included `@zmdb/core/sqlite` adapter for `node:sqlite`:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { DatabaseSync } from 'node:sqlite';
import { defineRepository, schemaOf } from '@zmdb/core';
import { sqliteDriver } from '@zmdb/core/sqlite';

const db = new DatabaseSync('app.db'); // or ':memory:'
const users = defineRepository(schemaOf<User>(), sqliteDriver(db));

const u = await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const one = await users.findById(u.id); // Entity<S> | undefined
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
const updated = await users.update(u.id, { role: 'admin' }); // UpdatePatch<S>; plain values validate as UpdateDTO<S>
const gone = await users.delete(u.id); // boolean
```

Prefer a class? Subclassing works identically:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies User, db, schemaOf, sqliteDriver; this excerpt does not repeat those declarations."}
import { BaseRepository } from '@zmdb/core/orm';

const userSchema = schemaOf<User>();
class UserRepository extends BaseRepository<User> {
  static readonly schema = userSchema;
}
const users = new UserRepository(sqliteDriver(db));
```

> [!IMPORTANT] `schemaOf<T>()` is a **compile-time** call — the answer is a function of a type argument, and type arguments do not exist at runtime. The transformer replaces it with a frozen object
> literal. An untransformed build throws a message saying exactly that; it does not hand back an empty schema. Wire up the [plugin](./aot-setup.html) or the [codegen CLI](./cli-codegen.html).

> [!TIP] Install `@zmdb/postgres` and `pg`, then use `postgresDriver(pool)` for PostgreSQL. The driver carries the same frozen dialect object used by compilation, migrations, and introspection. See
> [Drivers](./drivers.html).

> [!IMPORTANT] Rows you read back are **plain, inert objects**. Mutating `user.email = 'x'` persists nothing — writes only happen through `create`/`update`/`delete`. This is deliberate; see
> [Why fetched rows are inert](./inert-rows.html).

## 5. Query your data (typed)

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies driver, since, users; this excerpt does not repeat those declarations."}
import { applyOrderBy, buildListResult, compileWhere } from '@zmdb/core/schema';

let qb = users.query.selectFrom('users');
qb = compileWhere(qb, { role: 'admin', createdAt: { gte: since } });
qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }]);
const rows = await driver.execute(qb.limit(21).compile());
const page = buildListResult(rows, { limit: 20 }); // { items, hasMore }
```

```sql
SELECT * FROM "users"
WHERE "role" = $1 AND "createdAt" >= $2
ORDER BY "createdAt" DESC
LIMIT 21
```

The filter, ordering and pagination are all typed against `User`. See [Filters](./filters.html), [Ordering & pagination](./pagination.html) and the [Read/Query DTOs](./read-dtos.html).

## 6. Atomic writes with transactions

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies connection, orders, users; this excerpt does not repeat those declarations."}
import { createTransactionalDb } from '@zmdb/core/orm';

const db = createTransactionalDb(connection);
await db.transaction(async tx => {
  // withTransaction re-binds a repository onto the transaction's connection
  const user = await users.withTransaction(tx).create({ email: 'a@b.com' });
  const order = await orders.withTransaction(tx).create({ userId: user.id, total: 42 });
  // throw here → ROLLBACK; clean return → COMMIT
});
```

## 7. Validate at the boundary

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies User, req, users; this excerpt does not repeat those declarations."}
import { assert, type CreateDTO } from '@zmdb/core';

// In an HTTP handler: validate the inbound body against the derived Create DTO.
const payload = assert<CreateDTO<User>>(await req.json());
const user = await users.create(payload);
```

## Where to go next

- [Blog API](./tutorial-blog-api.html) → [Generated HTTP client](./generated-client.html) → [Client applications](./framework-integrations.html)
- [One server journey](./web-overview.html) — generate the migration, serve validated HTTP, and explicitly add a SQLite-backed worker to the same application

- [Schema declaration](./schema-declaration.html), the [tag reference](./tags-reference.html) and [Column types](./column-types.html)
- [Relations](./relations.html) and [typed populate/join results](./populate-results.html)
- [Migrations](./migrations.html) — diffed from the schema
- [Validators](./validators-is.html) and [JSON / Ser-De](./json-stringify.html)
- [Anti-patterns](./anti-patterns.html) — what zmdb deliberately does _not_ do, and why
