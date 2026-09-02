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
For the AOT-inlined validators (the fast path), wire the transformer once — see
[AOT setup](./aot-setup.html). Without it, validation still works via a runtime
fallback.

## 2. Define your schema once

The schema is the single source of truth. Everything else derives from it.

```ts
import { defineSchema, serial, text, integer, numeric, jsonEnum, timestamp, references } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$')),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: references(integer().notNull(), 'users.id'),
  total: numeric().notNull().validate(tags.Min(0)),
});
```

Builders return **frozen** column metadata and modifiers are pure and chainable,
so a schema is a plain, inert value — no decorators, no global registry.

## 3. Types derive automatically

```ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
//   { id: number; email: string; role: 'admin' | 'user'; createdAt: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
//   { email: string; role?: 'admin' | 'user' }   ← id auto-omitted; defaulted → optional

type UpdateUser = UpdateDTO<typeof UserSchema>; //  Partial<CreateUser>
```

> [!TIP]
> Change a column and every derived type updates. Any call site that no longer
> satisfies them **fails to compile** — that compile error is the anti-drift
> guarantee. See [Type derivation](./type-derivation.html).

## 4. CRUD through a repository

A repository binds your schema to a driver. The fastest way is the
**`defineRepository`** helper (no subclass, no hand-written driver) with the
built-in `node:sqlite` driver — a genuinely zero-dependency setup:

```ts
import { DatabaseSync } from 'node:sqlite';
import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';

const db = new DatabaseSync('app.db'); // or ':memory:'
const users = defineRepository(UserSchema, sqliteDriver(db), { dialect: 'sqlite' });

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
class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
const users = new UserRepository(sqliteDriver(db), 'sqlite');
```

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

The filter, ordering and pagination are all typed against `UserSchema`. See
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
const payload = assert<CreateDTO<typeof UserSchema>>(await req.json());
const user = await users.create(payload);
```

## Where to go next

- [Schema declaration](./schema-declaration.html) and [Column types](./column-types.html)
- [Relations](./relations.html) and [typed populate/join results](./populate-results.html)
- [Migrations](./migrations.html) — diffed from the schema
- [Validators](./validators-is.html) and [JSON / Ser-De](./json-stringify.html)
- [Anti-patterns](./anti-patterns.html) — what zmdb deliberately does _not_ do, and why
