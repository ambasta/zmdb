# zmdb Cookbook — Real-World Scenarios

> How common tasks are handled end-to-end. Every example below maps to a
> **frozen spec** (see each package's `SPEC.md`). Anything not yet backed by a
> frozen spec is explicitly marked **(planned)** so you can tell contract from roadmap.
>
> Targets: Node.js 26+, ESM-only, TypeScript 7. No proxies, no identity map,
> no runtime parsing — validation and serialization are AOT-compiled.

## Table of contents

1. [Defining a model (Single Source of Truth)](#1-defining-a-model)
2. [Deriving types (Entity / CreateDTO / UpdateDTO)](#2-deriving-types)
3. [CRUD](#3-crud)
4. [Why fetched rows are inert (the mutation question)](#4-why-fetched-rows-are-inert)
5. [Transactions & grouped writes](#5-transactions--grouped-writes)
6. [Relations](#6-relations)
7. [Validation at the boundary](#7-validation-at-the-boundary)
8. [Serialization / Deserialization (Ser/De)](#8-serialization--deserialization)
9. [HTTP request → validated payload → response](#9-http-request--response)
10. [JSON Schema / OpenAPI generation (planned)](#10-json-schema--openapi-planned)
11. [Migrations](#11-migrations)
12. [Mental-model summary](#12-mental-model-summary)
13. [Typed reads (Get / List / Search DTOs)](#13-typed-reads-get--list--search-dtos)

---

## 1. Defining a model

The schema is the **single source of truth**. You write it once; every derived
type flows from it. Backed by `packages/schema-core/SPEC.md`.

```ts
import { defineSchema, serial, text, integer, numeric, jsonEnum, timestamp } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$')),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull().references('users.id'),
  totalPrice: numeric().notNull().validate(tags.Minimum(0)),
  status: jsonEnum(['pending', 'shipped', 'delivered']).notNull().defaultTo('pending'),
});
```

- Builders return **frozen** column metadata; modifiers are pure and chainable.
- `defineSchema` derives `primaryKey[]` and `references[]`, and deeply freezes the result.

---

## 2. Deriving types

No hand-written DTOs. Types are derived at compile time (schema-core §4).

```ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
// { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
// { email: string; role?: 'admin'|'user'|'guest' }
//  - id omitted (autoIncrement); role/createdAt optional (hasDefault)

type UpdateUser = UpdateDTO<typeof UserSchema>;
// Partial<CreateUser>
```

Change the schema (e.g. add a column) and all three types update automatically;
any code that no longer satisfies them fails to compile — that is the anti-drift guarantee.

---

## 3. CRUD

Backed by `packages/repository/SPEC.md`. A repository is just a schema binding —
the entire required body is one line.

```ts
import { BaseRepository } from '@zmdb/repository';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;

  // Optional: add domain queries. CRUD is inherited.
  findAdmins() {
    return this.query.selectFrom('users').where('role', '=', 'admin').execute();
  }
}

const users = new UserRepository(driver); // driver injected (see §5 for drivers)

// CREATE — payload validated against CreateDTO<S> BEFORE any SQL runs
const u = await users.create({ email: 'a@b.com', role: 'user' });

// READ — returns plain objects
const one = await users.findById(u.id); // Entity | undefined
const some = await users.findOne({ role: 'admin' });
const all = await users.findAll(); // readonly Entity[]

// UPDATE — partial payload validated against UpdateDTO<S>
const updated = await users.update(u.id, { role: 'admin' });

// DELETE
const ok = await users.delete(u.id); // boolean
```

If a payload is invalid, `create`/`update` throw a structured `ValidationError`
and **no SQL is executed** (the driver is never called).

---

## 4. Why fetched rows are inert

This is the most common point of confusion coming from Mikro-ORM / TypeORM.

```ts
const user = await users.findById(1);

// ❌ This does NOT persist anything. `user` is a plain object.
user.email = 'new@example.com';

// ✅ Persist by calling an explicit, validated method:
await users.update(1, { email: 'new@example.com' });
```

There is **no change tracking, no proxy, no `flush()`**. A write happens only when
you call `create` / `update` / `delete`. This is deliberate: it removes the proxy
layer and identity map entirely, which is where the zero-overhead guarantee comes from.

Coming from a "load, mutate, flush" workflow, the translation is:

| Mikro-ORM                         | zmdb                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `const u = em.findOne(User, 1)`   | `const u = await users.findById(1)`                       |
| `u.email = 'x'`                   | _(prepare a patch object)_ `const patch = { email: 'x' }` |
| `await em.flush()`                | `await users.update(1, patch)`                            |
| unit-of-work across many entities | `db.transaction(...)` (see §5)                            |

---

## 5. Transactions & grouped writes

The legitimate job `flush()` does in other ORMs — atomically committing several
writes — is handled by **explicit transactions**. Backed by
`packages/repository/src/transactions/SPEC.md`.

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  const user = await tx.repo(UserRepository).create({ email: 'a@b.com' });
  const order = await tx.repo(OrderRepository).create({
    userId: user.id,
    totalPrice: 42,
  });
  // If anything throws here → ROLLBACK; nothing persists.
  // On clean return → COMMIT.
});
```

- Emitted SQL ordering is deterministic: `BEGIN … COMMIT` on success,
  `BEGIN … ROLLBACK` on throw.
- Nested `tx.savepoint(fn)` maps to `SAVEPOINT` / `RELEASE` / `ROLLBACK TO SAVEPOINT`,
  so an inner failure can roll back without losing the outer transaction.

### Drivers

The repository never opens connections. You inject a `Driver`:

```ts
interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
```

This keeps the core DB-agnostic; adapters wrap `pg`, `mysql2`, `better-sqlite3`, etc.

---

## 6. Relations

Declared in the schema DSL; resolved by **explicit** `populate` — no lazy proxy
getters. Backed by `packages/schema-core/src/relations/SPEC.md`.

```ts
import { defineSchema, serial, integer, oneToMany, manyToOne } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  orders: oneToMany('orders', 'userId'), // inverse side
});

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  user: manyToOne('users', 'userId'), // owning side (holds FK)
});

// Related data loads ONLY when populated (explicit):
const user = await users.findById(1, { populate: ['orders'] });
// user.orders: Order[]  — attached to the result type only because we populated it
```

- to-one → `JOIN`; to-many → batched `IN (…)` select. Strategy is deterministic.
- No identity map: populated children are plain objects, not shared references.

---

## 7. Validation at the boundary

Validation is **AOT-compiled**: `validate(tags.X(...), value)` is replaced at build
time with inline JavaScript (no Zod-style runtime parser). Backed by
`packages/aot-validator/SPEC.md` and the advanced-validation spec.

```ts
import { tags, validate } from '@zmdb/aot-validator';

// authored:
const ok = validate(tags.Minimum(0), input.totalPrice);
// compiles to:
// const ok = (typeof input.totalPrice === 'number' && input.totalPrice >= 0);
```

Utility surface (typia-style), backed by the validator-utilities spec:

```ts
import { is, assert, validate } from '@zmdb/aot-validator';

if (is<CreateUser>(payload)) {
  /* narrowed */
}

const user = assert<CreateUser>(payload); // throws AssertError with exact path
const res = validate<CreateUser>(payload); // { success, data?, errors? }
// res.errors[i] = { path: 'input.email', expected, value, message }
```

Advanced constructs (refinements, transforms, unions, coercion, brands, object
strictness) are covered by `packages/aot-validator/src/advanced/SPEC.md`.

---

## 8. Serialization / Deserialization

AOT JSON serializer — straight-line concatenation, no reflection. Backed by
`packages/aot-validator/src/serialization/SPEC.md`.

```ts
import { stringify, assertStringify, parse } from '@zmdb/aot-validator/serialization';

// Ser: fast, byte-identical to JSON.stringify for supported values
const body = stringify(user);

// Ser + validate in one pass (throws on invalid):
const safeBody = assertStringify<User>(user);

// De: parse + validate into T
const result = parse<User>(rawJson);
if (result.success) use(result.data);
else report(result.issues); // { path, expected, value, message }[]
```

Frozen escaping rules (quotes, control chars, unicode); `undefined` object props
are omitted; `bigint` throws `TypeError` (documented policy).

---

## 9. HTTP request → response

Putting it together for a typical API handler (framework-agnostic):

```ts
import { assert } from '@zmdb/aot-validator';
import { stringify } from '@zmdb/aot-validator/serialization';
import type { CreateDTO, Entity } from '@zmdb/schema-core';

async function createUserHandler(req: Request): Promise<Response> {
  // 1. Validate the inbound payload against the derived Create DTO (AOT-inlined).
  const payload = assert<CreateDTO<typeof UserSchema>>(await req.json());

  // 2. Persist through the repository (validates again at the write boundary).
  const user = await users.create(payload);

  // 3. Serialize the response with the AOT serializer.
  return new Response(stringify<Entity<typeof UserSchema>>(user), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}
```

One schema drives the request DTO, the DB write, and the response type. Change the
schema and this handler fails to compile until updated — no drift.

---

## 10. JSON Schema / OpenAPI

Because the schema already carries column types, nullability, defaults, and
validation tags, a JSON Schema / OpenAPI document is generated **deterministically
at build time** from the same source of truth. Backed by
`packages/schema-core/src/openapi/SPEC.md` (epic #62; spec frozen in #63,
implementation in #64–#67).

```ts
import { toJsonSchema, toOpenApiComponents } from '@zmdb/schema-core/openapi';

// Variant-aware: 'entity' (default) | 'create' | 'update'
const userEntity = toJsonSchema(UserSchema); // response shape
const userCreate = toJsonSchema(UserSchema, 'create'); // request-body shape
// { type: 'object', properties: { ... }, required: [...] }  (draft 2020-12)

const components = toOpenApiComponents([UserSchema, OrderSchema]);
// components.schemas.User / .Order  (OpenAPI 3.1)
```

Frozen behavior:

- Build-time generation only — **no runtime reflection**.
- `create`/`update` variants for request bodies, `entity` for responses.
- Validation tags map to keywords: `Minimum→minimum`, `Maximum→maximum`,
  `MinLength/MaxLength→minLength/maxLength`, `Pattern→pattern`, `Enum→enum`.
- Relations emit `$ref` (to-one) / `items:{$ref}` (to-many).
- Deterministic (stable key ordering) so output is committable/diffable.

---

## 11. Migrations

Schema is the source of truth, so migrations are **diffed** from it. Backed by
`packages/query-compiler/src/migrations/SPEC.md`.

```bash
zmdb migrate create   # snapshot current schema, diff vs last, emit up/down SQL
zmdb migrate up        # apply pending migrations (records version)
zmdb migrate down      # roll back the last migration
zmdb migrate status    # show applied vs pending
```

- Deterministic schema snapshot → `diff(prev, next)` → dialect-correct DDL.
- Migrations are plain, reviewable SQL files; `down` reverses `up`.
- No runtime `updateSchema()` against production (explicitly rejected).

---

## 12. Mental-model summary

- **Define once** in the schema DSL; **derive everything** (Entity/CreateDTO/UpdateDTO,
  relations, validators, serializers, migrations, and — planned — OpenAPI).
- **Reads return inert plain objects.** Mutating them does nothing.
- **Writes are explicit and validated**: `create` / `update` / `delete`.
- **Atomicity is explicit**: `db.transaction(...)`, not implicit flush.
- **Validation & Ser/De are AOT-compiled**: inline JS, native speed, no runtime parser.
- **No proxies, no identity map, no reflection.** That is the price of, and the
  reason for, the zero-overhead guarantee.

---

## 13. Typed reads (Get / List / Search DTOs)

The read side is fully typed via `@zmdb/schema-core/dto` — no more
`Record<string, unknown>`.

```ts
import {
  compileWhere,
  applyOrderBy,
  applyPagination,
  project,
  buildListResult,
  type WhereDTO,
  type OrderByDTO,
  type ListResult,
} from '@zmdb/schema-core/dto';

// Typed filter (per-column value types + operator set):
const where: WhereDTO<typeof UserSchema> = {
  age: { gte: 18 },
  role: 'admin',
  email: { like: '%@corp.com' },
};

// Compose into the query builder, then assemble a typed ListResult:
let qb = users.query.selectFrom('users');
qb = compileWhere(qb, where);
qb = applyOrderBy(qb, [{ column: 'age', dir: 'desc' }] as OrderByDTO<typeof UserSchema>);
qb = applyPagination(qb, { limit: 20 });
const rows = await driver.execute(qb.compile());
const page: ListResult<User> = buildListResult(rows, { limit: 20 }); // { items, hasMore, ... }
```

- **GetDTO / getResult** narrow a single-row fetch by `select`.
- **SearchDTO / buildSearchResult** add full-text query + ranking (`_score`).
- **Populated<S,K>** types populated relations; **AggregateResult<S,Spec>** types
  grouped aggregates. See the [docs site](https://ambasta.github.io/zmdb/docs/read-dtos.html).
