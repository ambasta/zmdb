# zmdb Cookbook — Real-World Scenarios

> How common tasks are handled end-to-end. Every example below maps to a
> **frozen spec** (see each package's `SPEC.md`). Anything not yet backed by a
> frozen spec is explicitly marked **(planned)** so you can tell contract from roadmap.
>
> Targets: Node.js 26+, ESM-only, TypeScript 7. No proxies, no identity map,
> no runtime parsing — validation and serialization are AOT-compiled.

## Table of contents

1. [Declaring a model (Single Source of Truth)](#1-declaring-a-model)
2. [Deriving types (Entity / CreateDTO / UpdateDTO)](#2-deriving-types)
3. [CRUD](#3-crud)
4. [Why fetched rows are inert (the mutation question)](#4-why-fetched-rows-are-inert)
5. [Transactions & grouped writes](#5-transactions--grouped-writes)
6. [Relations](#6-relations)
7. [Validation at the boundary](#7-validation-at-the-boundary)
8. [Serialization / Deserialization (Ser/De)](#8-serialization--deserialization)
9. [HTTP request → validated payload → response](#9-http-request--response)
10. [JSON Schema / OpenAPI generation](#10-json-schema--openapi)
11. [Migrations](#11-migrations)
12. [Mental-model summary](#12-mental-model-summary)
13. [Typed reads (Get / List / Search DTOs)](#13-typed-reads-get--list--search-dtos)

---

## 1. Declaring a model

A table **is** a TypeScript type. That declaration is the single source of truth;
every derived type flows from it. Backed by `packages/schema-core/SPEC.md`.

```ts
import type { HasDefault, Min, Pattern, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  totalPrice: number & Sql<'numeric'> & Min<0>;
  status: ('pending' | 'shipped' | 'delivered') & HasDefault;
}
```

- Each property is its **app type** intersected with **tags**: the app type is what
  your code sees, the tags say what TypeScript has no syntax for. `Table<Name>` on the
  `extends` clause carries the table name.
- Tags are phantom `unique symbol` slots and `@zmdb/schema-core/tags` has no runtime
  exports, so the file above compiles to no JavaScript at all.
- `Sql<T>` is only needed where TypeScript is ambiguous. `string`, `boolean`, `bigint`,
  `Date` and a string-literal union are inferred; `number` is refused, because
  TypeScript spells both `integer` and `numeric` the same way.
- Write `(T & Tags) | null` for a nullable column, never `(T | null) & Tags` — the
  intersection distributes over the union and `null & Unique` is `never`.
- There is no builder DSL and no global registry. If you have a codebase full of
  `defineSchema('users', { id: serial().primaryKey() })`, `scripts/codemod-tagged-schema.mjs`
  converts it.

The value the query compiler and the repository read comes from `schemaOf<T>()`:

```ts
import { schemaOf } from '@zmdb/schema-core';

export const userSchema = schemaOf<User>();
export const orderSchema = schemaOf<Order>();
```

That call is compiled away. Its answer is a function of a type argument, and type
arguments do not exist at runtime, so the transformer replaces it with a frozen object
literal — and an untransformed build throws a message saying exactly that rather than
handing back an empty schema. Wire the unplugin, or run `zmdb-codegen`.

---

## 2. Deriving types

No hand-written DTOs. Types are derived at compile time (schema-core §4).

```ts
import type { CreateDTO, Entity, ReadDTO, UpdateDTO } from '@zmdb/schema-core/derive';

type UserRow = Entity<User>;
// { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

type CreateUser = CreateDTO<User>;
// { email: string; role?: 'admin'|'user'|'guest'; createdAt?: Date }
//  - id absent (Serial); role/createdAt optional (HasDefault)

type UpdateUser = UpdateDTO<User>;
// Partial<CreateUser>

type PublicUser = ReadDTO<User>;
// Entity<User> minus every column tagged Sensitive
```

`Serial` **removes** `id` rather than making it optional: there is no value you could
usefully pass for a column the database generates, and the repository refuses a payload
that supplies one.

Change the declaration (e.g. add a column) and all four types update automatically;
any code that no longer satisfies them fails to compile — that is the anti-drift guarantee.

> Every derivation takes the **declared type**, including the read surface in `./dto`.
> There used to be a second set on `@zmdb/schema-core`'s root that took the schema value
> instead; those are gone, and the root re-exports these. `Entity<User>`, never
> `Entity<typeof UserSchema>`.

---

## 3. CRUD

Backed by `packages/repository/SPEC.md`. A repository is just a schema binding —
the entire required body is one line.

```ts
import { BaseRepository } from '@zmdb/repository';

class UserRepository extends BaseRepository<User> {
  static readonly schema = userSchema;

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
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

This keeps the core DB-agnostic; adapters wrap `pg`, `mysql2`, `better-sqlite3`, etc.

---

## 6. Relations

Declared on the type; resolved by **explicit** `populate` — no lazy proxy getters.
Backed by `packages/schema-core/src/relations/SPEC.md`.

A relation is a property whose declared type says the cardinality and whose tag says
where to join. Relation properties are optional, and they are excluded from `Entity<T>`,
`CreateDTO<T>` and the DDL:

```ts
import type { ManyToOne, OneToMany, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  orders?: Order[] & OneToMany<'orders', 'userId'>; // inverse side
}

interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  user?: User & ManyToOne<'users', 'userId'>; // owning side (holds the FK)
}
```

Both tags take the target table **and** the foreign-key column. Cardinality is
deliberately not read back out of the tag — `Order[]` versus `User` already says it,
and a tag that repeated it could disagree with the declaration.

```ts
// Related data loads ONLY when populated (explicit):
const user = await users.findById(1, { populate: ['orders'] });
// user.orders: Order[]  — attached to the result type only because we populated it
```

The declaration above is the only place either fact is written. `defineRepository(userSchema,
driver)` takes no relations, `BaseRepository<User>` takes no second type parameter for them,
and `populate: ['orders']` is checked against `RelationKeys<User>` — a misspelling is a
compile error. There is no `oneToMany()` builder to write a map with.

- to-one → `JOIN`; to-many → batched `IN (…)` select. Strategy is deterministic.
- Which side holds the key is read off the tables, not the tag: `OneToOne` is symmetric, so
  the side with the column owns it. `References<'users.id'>` names the column the join
  matches, and a foreign key without one is assumed to point at `id`.
- No identity map: populated children are plain objects, not shared references.
- `ManyToMany` populate throws. `ManyToMany<'tags', 'post_tags'>` names a join table rather
  than a column, and inferring its two foreign keys from the tables either side is how a
  wrong query gets built quietly — join the two tables yourself.

---

## 7. Validation at the boundary

Validation is **AOT-compiled**: `validate(tags.X(...), value)` is replaced at build
time with inline JavaScript (no Zod-style runtime parser). Backed by
`packages/aot-validator/SPEC.md` and the advanced-validation spec.

```ts
import { tags, validate } from '@zmdb/aot-validator';

// authored:
const ok = validate(tags.Min(0), input.totalPrice);
// compiles to:
// const ok = (typeof input.totalPrice === 'number' && input.totalPrice >= 0);
```

Utility surface (typia-style), backed by the validator-utilities spec. Note the
subpath — the eight type-argument calls live in `/utilities`, not on the root:

```ts
import { assert, is, validate } from '@zmdb/aot-validator/utilities';

if (is<CreateUser>(payload)) {
  /* narrowed */
}

const user = assert<CreateUser>(payload); // throws AssertError with exact path
const res = validate<CreateUser>(payload); // { success, data?, errors? }
// res.errors[i] = { path: 'input.email', expected, value, message }
```

`is`, `assert`, `validate`, `equals`, `assertEquals`, `random`, `toJsonSchema` and
`schemaOf` are the eight calls the transformer rewrites. A file it did not reach has no
type argument left to read, so the call **throws** rather than passing everything — a
validator that fails open is worse than one that fails.

The rule-first form is the one that needs no build step, because the constraint arrives
as a value: `validate(tags.Min(0), price)` runs under `ts-node`, in a REPL, anywhere.

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
import { assert } from '@zmdb/aot-validator/utilities';
import { stringify } from '@zmdb/aot-validator/serialization';
import type { CreateDTO, Entity } from '@zmdb/schema-core/derive';

async function createUserHandler(req: Request): Promise<Response> {
  // 1. Validate the inbound payload against the derived Create DTO (AOT-inlined).
  const payload = assert<CreateDTO<User>>(await req.json());

  // 2. Persist through the repository (validates again at the write boundary).
  const user = await users.create(payload);

  // 3. Serialize the response with the AOT serializer.
  return new Response(stringify<Entity<User>>(user), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}
```

One declaration drives the request DTO, the DB write, and the response type. Change the
interface and this handler fails to compile until updated — no drift.

---

## 10. JSON Schema / OpenAPI

Because the declaration already carries column types, nullability, defaults, and
validation tags, a JSON Schema / OpenAPI document is generated **deterministically
at build time** from the same source of truth. Backed by
`packages/schema-core/src/openapi/SPEC.md` (epic #62; spec frozen in #63,
implementation in #64–#67).

```ts
import { toJsonSchema, toOpenApiComponents } from '@zmdb/schema-core/openapi';

const userEntity = toJsonSchema<User>(); // response shape, straight from the type
const userCreate = toJsonSchema(userSchema, 'create'); // request-body shape
// { type: 'object', properties: { ... }, required: [...] }  (draft 2020-12)

const components = toOpenApiComponents([userSchema, orderSchema]);
// components.schemas.User / .Order  (OpenAPI 3.1)
```

`toJsonSchema<T>()` is one of the eight transformed calls and produces the `entity`
variant. The two-argument form takes a schema value and a variant — `'entity'`
(default) | `'create'` | `'update'` — which is how you get a request body.

Frozen behavior:

- Build-time generation only — **no runtime reflection**.
- `create`/`update` variants for request bodies, `entity` for responses.
- Validation tags map to keywords: `Min→minimum`, `Max→maximum`,
  `MinLength/MaxLength→minLength/maxLength`, `Pattern→pattern`. Those five are the
  whole set. `enum` comes from a declared string-literal union, not from a tag, and
  `Rule<'name'>` has no JSON Schema equivalent at all — it is dropped.
- Every variant drops columns tagged `Sensitive` as its last step.
- Relations emit `$ref` (to-one) / `items:{$ref}` (to-many) — via
  `toJsonSchemaWithRelations(schema, variant)`, which reads them off `schema.ir`, so a
  generated document cannot name a relation the table does not have.
- Deterministic (stable key ordering) so output is committable/diffable.

---

## 11. Migrations

The declaration is the source of truth, so migrations are **diffed** from it. Backed by
`packages/query-compiler/src/migrations/SPEC.md`.

```ts
import { diff, emitDown, emitUp, runCli, snapshot } from '@zmdb/query-compiler/migrations';

// You pass the tables. Nothing enumerates them — the module-scope registry went with
// the builder DSL, so the list is an ordinary export you can grep for.
const next = snapshot([userSchema, orderSchema]);
const ops = diff(previousSnapshot, next);

const up = ops.map(op => emitUp(op, 'postgres'));
const down = ops.map(op => emitDown(op, 'postgres')).toReversed();
```

Hand the `up`/`down` pair to the runner as a numbered `Migration`, then apply it:

```ts
const output = runCli('up', connection, migrations); // 'applied: 3'
```

- Deterministic schema snapshot → `diff(prev, next)` → dialect-correct DDL.
- Migrations are plain, reviewable SQL; `down` reverses `up`.
- No runtime `updateSchema()` against production (explicitly rejected).
- **(planned)** A `zmdb migrate` command. The only shipped binary today is
  `zmdb-codegen`, which is the AOT transform, not the migration runner.
- The snapshot format models name, type, nullability, primary keys, lengths and
  foreign keys with referential actions. A `UNIQUE` constraint, a column default
  and an FTS index still need a custom migration.

---

## 12. Mental-model summary

- **Declare once** as a type; **derive everything** (Entity/CreateDTO/UpdateDTO/ReadDTO,
  relations, validators, serializers, migrations, OpenAPI).
- **Reads return inert plain objects.** Mutating them does nothing.
- **Writes are explicit and validated**: `create` / `update` / `delete`.
- **Atomicity is explicit**: `db.transaction(...)`, not implicit flush.
- **Validation & Ser/De are AOT-compiled**: inline JS, native speed, no runtime parser.
- **No proxies, no identity map, no runtime reflection.** Types are read by the
  transformer, at build time, from the real checker. That is the price of, and the
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
const where: WhereDTO<User> = {
  createdAt: { gte: since },
  role: 'admin',
  email: { like: '%@corp.com' },
};

// Compose into the query builder, then assemble a typed ListResult:
let qb = users.query.selectFrom('users');
qb = compileWhere(qb, where);
const orderBy: OrderByDTO<User> = [{ column: 'createdAt', dir: 'desc' }];
qb = applyOrderBy(qb, orderBy);
qb = applyPagination(qb, { limit: 20 });
const rows = await driver.execute(qb.compile());
const page: ListResult<UserRow> = buildListResult(rows, { limit: 20 }); // { items, hasMore, ... }
```

- **GetDTO / getResult** narrow a single-row fetch by `select`.
- **SearchDTO / buildSearchResult** add full-text query + ranking (`_score`).
- **Populated<T,K>** types populated relations; **AggregateResult<T,Spec>** types
  grouped aggregates. See the [docs site](https://ambasta.github.io/zmdb/docs/read-dtos.html).
