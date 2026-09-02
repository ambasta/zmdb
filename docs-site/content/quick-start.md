This guide takes you from an empty project to a validated, type-safe data layer
in a few minutes. By the end you will have defined a schema, derived its types,
run CRUD through a repository, and issued a typed query.

> [!NOTE]
> zmdb targets **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. It never
> opens a database connection itself — you inject a small `Driver`, so it works
> with `pg`, `mysql2`, `better-sqlite3`, or `node:sqlite`.

## 1. Install

```bash
npm add zmdb@alpha
```

One package re-exports the whole ecosystem. (Prefer granular installs? Use the
four `@zmdb/*` packages instead — see [Installation](./installation.html).)
Then wire the transformer once — see [AOT setup](./aot-setup.html). It is not an
optimisation you can skip: `schemaOf<T>()` and the validators read a type argument,
which does not exist at runtime, so an untransformed build throws rather than
quietly checking nothing.

## 2. Declare your table once

A table is a TypeScript type. That declaration is the single source of truth, and
everything else derives from it.

```ts
import type { HasDefault, Min, Pattern, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

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

Each property is its **app type** intersected with **tags**. The app type is what your
code sees; the tags say what TypeScript has no syntax for. Tags are phantom `unique
symbol` slots, so they erase completely — this file compiles to no JavaScript at all.

There is no builder DSL and no global registry. If you have a codebase full of
`defineSchema('users', { id: serial().primaryKey() })`, the
[codemod](./codemod.html) converts it.

## 3. Types derive automatically

```ts
import type { CreateDTO, Entity, UpdateDTO } from 'zmdb/derive';

type Row = Entity<User>;
//   { id: number; email: string; role: 'admin' | 'user'; createdAt: Date }

type CreateUser = CreateDTO<User>;
//   { email: string; role?: 'admin' | 'user'; createdAt?: Date }   ← id absent (Serial); HasDefault → optional

type UpdateUser = UpdateDTO<User>; //  Partial<CreateUser>
```

> [!TIP]
> Change a column and every derived type updates. Any call site that no longer
> satisfies them **fails to compile** — that compile error is the anti-drift
> guarantee. See [Type derivation](./type-derivation.html).

`Serial` removes `id` from the create type rather than making it optional: there is no
value you could usefully pass for a column the database generates.

## 4. CRUD through a repository

A repository binds your schema to a driver. The fastest way is the
**`defineRepository`** helper (no subclass, no hand-written driver) with the
built-in `node:sqlite` driver — a genuinely zero-dependency setup:

```ts
import { DatabaseSync } from 'node:sqlite';
import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { schemaOf } from 'zmdb';

const db = new DatabaseSync('app.db'); // or ':memory:'
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });

const u = await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const one = await users.findById(u.id); // Entity<S> | undefined
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
const updated = await users.update(u.id, { role: 'admin' }); // validated vs UpdateDTO<S>
const gone = await users.delete(u.id); // boolean
```

Prefer a class? Subclassing works identically:

```ts
import { BaseRepository } from '@zmdb/repository';

const userSchema = schemaOf<User>();
class UserRepository extends BaseRepository<User> {
  static readonly schema = userSchema;
}
const users = new UserRepository(sqliteDriver(db), 'sqlite');
```

> [!IMPORTANT]
> `schemaOf<T>()` is a **compile-time** call — the answer is a function of a type
> argument, and type arguments do not exist at runtime. The transformer replaces it
> with a frozen object literal. An untransformed build throws a message saying exactly
> that; it does not hand back an empty schema. Wire up the
> [plugin](./aot-setup.html) or the [codegen CLI](./cli-codegen.html).

> [!TIP]
> Use `pgDriver` from `@zmdb/repository/drivers/pg` for PostgreSQL. A full
> runnable example lives at `examples/quickstart.ts`. See [Drivers](./drivers.html).

> [!IMPORTANT]
> Rows you read back are **plain, inert objects**. Mutating `user.email = 'x'`
> persists nothing — writes only happen through `create`/`update`/`delete`.
> This is deliberate; see [Why fetched rows are inert](./inert-rows.html).

## 5. Query your data (typed)

```ts
import { compileWhere, applyOrderBy, buildListResult } from '@zmdb/schema-core/dto';

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

The filter, ordering and pagination are all typed against `User`. See
[Filters](./filters.html), [Ordering & pagination](./pagination.html) and the
[Read/Query DTOs](./read-dtos.html).

## 6. Atomic writes with transactions

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);
await db.transaction(async tx => {
  // withTransaction re-binds a repository onto the transaction's connection
  const user = await users.withTransaction(tx).create({ email: 'a@b.com' });
  const order = await orders.withTransaction(tx).create({ userId: user.id, total: 42 });
  // throw here → ROLLBACK; clean return → COMMIT
});
```

## 7. Validate at the boundary

```ts
import { assert } from '@zmdb/aot-validator/utilities';

// In an HTTP handler: validate the inbound body against the derived Create DTO.
const payload = assert<CreateDTO<User>>(await req.json());
const user = await users.create(payload);
```

## Where to go next

- [Schema declaration](./schema-declaration.html), the [tag reference](./tags-reference.html) and [Column types](./column-types.html)
- [Relations](./relations.html) and [typed populate/join results](./populate-results.html)
- [Migrations](./migrations.html) — diffed from the schema
- [Validators](./validators-is.html) and [JSON / Ser-De](./json-stringify.html)
- [Anti-patterns](./anti-patterns.html) — what zmdb deliberately does _not_ do, and why
