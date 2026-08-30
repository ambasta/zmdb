// zmdb docs manifest — the union of MikroORM + Drizzle + Typia doc surfaces,
// classified for a zero-overhead, no-proxy, AOT data layer:
//   status:'supported' → written in full (API is real; see COOKBOOK/SPECs)
//   status:'todo'      → valid capability, not yet implemented (roadmap, not anti-pattern)
// Anti-pattern pages are intentionally ABSENT from the nav and enumerated on the
// anti-patterns page with rationale.

export const NAV = [
  { title: 'Getting Started', pages: ['introduction', 'installation', 'aot-setup', 'pure-typescript'] },
  { title: 'Schema', pages: ['schema-declaration', 'column-types', 'type-derivation', 'relations', 'indexes-constraints', 'views', 'sequences', 'generated-columns', 'schemas-namespaces', 'rls'] },
  { title: 'Data Access', pages: ['crud', 'repository', 'select', 'insert', 'update', 'delete', 'filters', 'pagination', 'read-dtos', 'projections', 'joins', 'populate-results', 'aggregations', 'aggregate-results', 'full-text-search', 'aliases', 'inert-rows'] },
  { title: 'Transactions', pages: ['transactions', 'batch', 'read-replicas'] },
  { title: 'Migrations', pages: ['migrations', 'migrations-cli', 'seeding'] },
  { title: 'Validation', pages: ['validators-is', 'validators-assert', 'validators-validate', 'validators-tags', 'unions-refinements'] },
  { title: 'JSON & Serialization', pages: ['json-stringify', 'json-parse', 'json-schema', 'openapi', 'random'] },
  { title: 'Advanced', pages: ['custom-types', 'set-operations', 'lifecycle-hooks', 'embeddables', 'inheritance'] },
  { title: 'Integrations', pages: ['drivers', 'framework-integrations', 'llm-function-calling'] },
  { title: 'Reference', pages: ['anti-patterns', 'benchmarks'] },
];

const todo = (title, group, note, md = '') => ({ title, group, status: 'todo', note, md });
const ok = (title, group, md) => ({ title, group, status: 'supported', md });

export const PAGES = {
  // ---------------- Getting Started ----------------
  introduction: ok('Introduction', 'Getting Started', `
zmdb is a TypeScript data layer that eliminates schema-drift maintenance. You **define your schema once** and every derived artifact — entity types, create/update DTOs, runtime validation, JSON serialization, OpenAPI, and repository CRUD — is produced from that single source of truth, at **compile time**.

## The core idea

Other tools make you write your types more than once: a TypeScript type, plus a schema, plus decorators, plus DTOs. Every one of those is a place for drift. zmdb reads the schema you already wrote and derives the rest.

\`\`\`ts
import { defineSchema, serial, text, jsonEnum, timestamp } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$')),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});
\`\`\`

## What makes it different

- **No proxies, no identity map, no change tracking.** Rows you read back are plain, inert objects. Writes are explicit (\`create\`/\`update\`/\`delete\`). This is where the zero-overhead guarantee comes from — see [Why fetched rows are inert](./inert-rows.html).
- **AOT validation & serialization.** \`validate\`, \`assert\`, \`stringify\` compile to straight-line JavaScript at build time, not a runtime parser. See [AOT setup](./aot-setup.html).
- **SQL-first query builder** with real JOINs, aggregations and full-text search — plus a typed repository on top.

## Where to go next

- [Installation](./installation.html) and [AOT setup](./aot-setup.html)
- [Schema declaration](./schema-declaration.html) → [Type derivation](./type-derivation.html)
- [CRUD](./crud.html) and the [Repository](./repository.html)
- [Benchmarks](../benchmarks/index.html)
`),

  installation: ok('Installation', 'Getting Started', `
zmdb targets **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**.

\`\`\`bash
npm add @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository
\`\`\`

## Package overview

| Package | Responsibility |
|---------|----------------|
| \`@zmdb/schema-core\` | Schema DSL, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI |
| \`@zmdb/query-compiler\` | SELECT/INSERT/UPDATE/DELETE, dialects, JOINs, aggregations, FTS, migration diff/DDL/runner |
| \`@zmdb/aot-validator\` | AOT is/assert/validate/equals/random, unions, transforms, Ser/De |
| \`@zmdb/repository\` | Auto-validating CRUD, hooks, transactions, populate |

## tsconfig

\`\`\`json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true
  }
}
\`\`\`

To get the AOT-inlined validators (rather than the runtime fallback), wire the transformer — see [AOT setup](./aot-setup.html).
`),

  'aot-setup': ok('AOT Setup (transformer)', 'Getting Started', `
zmdb's validators and serializers are **ahead-of-time compiled**: \`is<T>()\`, \`assert<T>()\`, \`validate<T>()\` and \`stringify<T>()\` are replaced at build time with inlined JavaScript specific to \`T\`. Like typia, this needs the transformer wired into your build. Without it, the calls fall back to a slower runtime path.

## Bundlers / ts runners

\`\`\`ts
// vite / rollup / esbuild / webpack via unplugin
import { zmdbTransform } from '@zmdb/aot-validator/plugin';

export default {
  plugins: [zmdbTransform()],
};
\`\`\`

## What the transform produces

\`\`\`ts
// authored
const ok = validate(tags.Minimum(0), input.totalPrice);
// compiled
const ok = (typeof input.totalPrice === 'number' && input.totalPrice >= 0);
\`\`\`

There is no reflection and no schema object at runtime — just the exact comparisons your type implies. See the [Benchmarks](../benchmarks/index.html) for the AOT-vs-runtime difference (~40–100× on Node).

> The shipped default path (plugin not enabled) still works — it uses a runtime validator — but you only get the headline AOT numbers with the transform wired in.
`),

  'pure-typescript': ok('Pure TypeScript', 'Getting Started', `
zmdb is driven entirely by the TypeScript types you already write. The schema DSL is plain functions returning frozen metadata, and the derived types (\`Entity\`, \`CreateDTO\`, \`UpdateDTO\`) are computed by the type system — not generated files you have to keep in sync.

\`\`\`ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User       = Entity<typeof UserSchema>;
type CreateUser = CreateDTO<typeof UserSchema>;
type UpdateUser = UpdateDTO<typeof UserSchema>;
\`\`\`

Change a column and all three update; any code that no longer satisfies them **fails to compile**. That compile-time failure is the anti-drift guarantee — there is no runtime schema to fall out of sync with your types.
`),

  // ---------------- Schema ----------------
  'schema-declaration': ok('Schema Declaration', 'Schema', `
The schema is the single source of truth. Declare it once with \`defineSchema\`.

\`\`\`ts
import { defineSchema, serial, text, integer, numeric, jsonEnum, timestamp } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$')),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull().references('users.id'),
  totalPrice: numeric().notNull().validate(tags.Minimum(0)),
  status: jsonEnum(['pending', 'shipped', 'delivered']).notNull().defaultTo('pending'),
});
\`\`\`

- Builders return **frozen** column metadata; modifiers (\`.notNull()\`, \`.defaultTo()\`, \`.references()\`, \`.validate()\`) are pure and chainable.
- \`defineSchema\` derives \`primaryKey[]\` and \`references[]\` and deeply freezes the result.
`),

  'column-types': ok('Column Types', 'Schema', `
The builder functions map to SQL column types and drive both the derived TypeScript type and the DDL emitted by migrations.

| Builder | TS type | Notes |
|---------|---------|-------|
| \`serial()\` | \`number\` | auto-increment; omitted from \`CreateDTO\` |
| \`integer()\` | \`number\` | |
| \`numeric()\` | \`number\` | fixed precision |
| \`text()\` | \`string\` | |
| \`timestamp()\` | \`Date\` | \`.defaultTo('now')\` supported |
| \`jsonEnum([...])\` | union of literals | e.g. \`'admin'\\|'user'\` |
| \`boolean()\` | \`boolean\` | |

## Modifiers

\`\`\`ts
serial().primaryKey()
text().notNull()
jsonEnum(['a','b']).notNull().defaultTo('a')
integer().notNull().references('users.id')
text().validate(tags.Pattern('...'))
\`\`\`

\`.notNull()\` makes the field required; a column with \`.defaultTo()\` or \`serial()\` becomes **optional in \`CreateDTO\`**.
`),

  'type-derivation': ok('Type Derivation', 'Schema', `
No hand-written DTOs. Three types derive from every schema:

\`\`\`ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
// { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
// { email: string; role?: 'admin'|'user'|'guest' }
//   id omitted (autoIncrement); role/createdAt optional (hasDefault)

type UpdateUser = UpdateDTO<typeof UserSchema>;
// Partial<CreateUser>
\`\`\`

- **Entity** — the full row shape returned by reads.
- **CreateDTO** — insert shape; auto-increment PKs dropped, defaulted columns optional.
- **UpdateDTO** — \`Partial<CreateDTO>\`.

These are the same types the validators and serializers are generated against, so the request DTO, the DB write, and the response type can never drift apart.
`),

  relations: ok('Relations', 'Schema', `
Relations are declared in the DSL and resolved by **explicit** \`populate\` — there are no lazy proxy getters.

\`\`\`ts
import { defineSchema, serial, integer, oneToMany, manyToOne } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  orders: oneToMany('orders', 'userId'),   // inverse side
});

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  user: manyToOne('users', 'userId'),      // owning side (holds the FK)
});

// Related data loads ONLY when populated:
const user = await users.findById(1, { populate: ['orders'] });
// user.orders: Order[] — present in the result type only because we populated it
\`\`\`

- to-one → \`JOIN\`; to-many → batched \`IN (…)\` select. The strategy is deterministic.
- No identity map: populated children are plain objects, not shared references. See [Anti-patterns](./anti-patterns.html) for why lazy/proxy relations are excluded.
`),

  'indexes-constraints': todo('Indexes & Constraints', 'Schema', 'A declarative index/unique/check DSL on the schema, feeding migration DDL, is planned.'),
  views: todo('Views', 'Schema', 'Declaring SQL views (and materialized views) as first-class schema objects is planned.'),
  sequences: todo('Sequences', 'Schema', 'Standalone sequence objects (beyond serial columns) are planned.'),
  'generated-columns': todo('Generated Columns', 'Schema', 'Stored/virtual generated columns are planned.'),
  'schemas-namespaces': todo('Schemas / Namespaces', 'Schema', 'Multiple Postgres schema namespaces are planned.'),
  rls: todo('Row-Level Security (RLS)', 'Schema', 'Declarative RLS policy generation is planned.'),

  // ---------------- Data Access ----------------
  crud: ok('CRUD', 'Data Access', `
A repository is a schema binding — the required body is one line, and every write is validated **before** any SQL runs.

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}

const users = new UserRepository(driver);

const u       = await users.create({ email: 'a@b.com', role: 'user' }); // validated vs CreateDTO
const one     = await users.findById(u.id);       // Entity | undefined
const someone = await users.findOne({ role: 'admin' });
const all     = await users.findAll();             // readonly Entity[]
const updated = await users.update(u.id, { role: 'admin' }); // validated vs UpdateDTO
const ok      = await users.delete(u.id);          // boolean
\`\`\`

If a payload is invalid, \`create\`/\`update\` throw a structured \`ValidationError\` and **no SQL is executed**.
`),

  repository: ok('Repository', 'Data Access', `
\`BaseRepository<S>\` provides validated CRUD and a query builder. Add domain methods freely; CRUD is inherited.

\`\`\`ts
class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;

  findAdmins() {
    return this.query.selectFrom('users').where('role', '=', 'admin').execute();
  }
}
\`\`\`

The repository never opens connections — you inject a \`Driver\`:

\`\`\`ts
interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
\`\`\`

This keeps the core DB-agnostic; adapters wrap \`pg\`, \`mysql2\`, \`better-sqlite3\`, etc. See [Drivers](./drivers.html).
`),

  select: ok('Select', 'Data Access', `
The query builder is SQL-first and typed against the schema.

\`\`\`ts
this.query
  .selectFrom('users')
  .select(['id', 'email', 'role'])
  .where('role', '=', 'admin')
  .orderBy('createdAt', 'desc')
  .limit(20)
  .execute();
\`\`\`

Columns and operators are checked against the schema. See [Filters](./filters.html) for the full operator set and [Joins](./joins.html) for multi-table reads.
`),

  insert: ok('Insert', 'Data Access', `
\`\`\`ts
this.query.insertInto('users').values({ email: 'a@b.com', role: 'user' }).returning(['id']).execute();
\`\`\`

Through the repository, prefer \`create()\`, which validates against \`CreateDTO<S>\` before emitting SQL.
`),

  update: ok('Update', 'Data Access', `
\`\`\`ts
this.query.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).execute();
\`\`\`

Through the repository, prefer \`update(id, patch)\`, which validates the patch against \`UpdateDTO<S>\`.
`),

  delete: ok('Delete', 'Data Access', `
\`\`\`ts
this.query.deleteFrom('users').where('id', '=', 1).execute();
\`\`\`

Through the repository, prefer \`delete(id)\`, which returns a boolean.
`),

  filters: ok('Filters & Operators', 'Data Access', `
\`where\` accepts a column, operator and value. Chained \`where\` clauses are ANDed; use \`orWhere\` for OR.

\`\`\`ts
.where('role', '=', 'admin')
.where('createdAt', '>', someDate)
.where('id', 'in', [1, 2, 3])
.where('email', 'like', '%@example.com')
\`\`\`

Supported operators include \`=\`, \`!=\`, \`<\`, \`<=\`, \`>\`, \`>=\`, \`in\`, \`not in\`, \`like\`, \`is null\`, \`is not null\`. Values are always parameterized.

## Typed filters — WhereDTO

For the repository/read side there is a **typed** filter DTO derived from your schema (\`@zmdb/schema-core/dto\`). Each column is keyed to its value type with an operator set, and \`compileWhere\` folds it into the query builder.

\`\`\`ts
import { compileWhere, type WhereDTO } from '@zmdb/schema-core/dto';

const where: WhereDTO<typeof UserSchema> = {
  age: { gte: 18, lt: 65 },     // ANDed comparisons
  role: 'admin',                 // bare value ⇒ eq
  email: { like: '%@corp.com' }, // like/ilike only on string fields
  or: [{ id: { in: [1, 2] } }, { email: { isNull: true } }],
};
compileWhere(builder, where); // → parameterized WHERE clauses
\`\`\`

Operators: \`eq/ne/lt/lte/gt/gte\`, \`in/nin\`, \`like/ilike\`, \`isNull/notNull\`, with \`and\`/\`or\` group composition. \`like\`/\`ilike\` are a **compile-time error** on non-string fields.
`),

  pagination: ok('Ordering & Pagination', 'Data Access', `
Typed ordering and pagination DTOs from \`@zmdb/schema-core/dto\`.

## OrderByDTO

\`\`\`ts
import { applyOrderBy, type OrderByDTO } from '@zmdb/schema-core/dto';

const order: OrderByDTO<typeof UserSchema> = [
  { column: 'age', dir: 'desc' },
  { column: 'id' }, // dir defaults to 'asc'
];
applyOrderBy(builder, order); // → ORDER BY "age" DESC, "id" ASC
\`\`\`

Columns are constrained to your entity's keys (typo = compile error).

## PaginationDTO

\`\`\`ts
import { applyPagination, type PaginationDTO } from '@zmdb/schema-core/dto';

applyPagination(builder, { limit: 20, offset: 40 }); // → LIMIT 20 OFFSET 40
applyPagination(builder, { limit: 20 });             // → LIMIT 20
\`\`\`

Offset pagination emits \`LIMIT/OFFSET\`; keyset (cursor) pagination is supported via \`{ limit, after }\` on a stable order key (typically the primary key). Both helpers pass the builder through unchanged when the argument is \`undefined\`.
`),

  'read-dtos': ok('Read/Query DTOs — Get / List / Search', 'Data Access', `
The read side is fully typed via \`@zmdb/schema-core/dto\`. Three result shapes derive from your schema.

## GetDTO — single row

\`\`\`ts
import { getResult, type GetDTO } from '@zmdb/schema-core/dto';

type FullRow = GetDTO<typeof UserSchema>;                       // = Entity
type Slim    = GetDTO<typeof UserSchema, { select: readonly ['id','email'] }>; // { id; email }

const row = getResult(fetched, { select: ['id', 'email'] as const }); // narrowed at runtime
\`\`\`

## ListDTO + ListResult — collections with pagination metadata

\`\`\`ts
import { buildListResult, type ListDTO, type ListResult } from '@zmdb/schema-core/dto';

const query: ListDTO<typeof UserSchema> = {
  where: { role: 'admin' }, orderBy: [{ column: 'id' }], page: { limit: 20 },
};
// Fetch limit+1 rows, then:
const result: ListResult<Row> = buildListResult(rows, { limit: 20, total });
// { items, hasMore, total?, cursor? } — hasMore computed by trimming the extra row
\`\`\`

## SearchDTO — full-text + filters + ranking

\`\`\`ts
import { buildSearchResult, type SearchDTO } from '@zmdb/schema-core/dto';

const search: SearchDTO<typeof DocSchema> = { query: 'wireless', columns: ['body'], rank: true };
const result = buildSearchResult(hits, { limit: 20 }); // items carry an optional _score
\`\`\`

All three compose with [filters](./filters.html) (WhereDTO), [ordering & pagination](./pagination.html), and [projections](./projections.html). OpenAPI \`get\`/\`list\`/\`search\` response schemas are generated from the same source (see [OpenAPI](./openapi.html)).
`),

  projections: ok('Projections (partial select)', 'Data Access', `
Narrow a row to a subset of columns — typed and runtime-applied.

\`\`\`ts
import { project, type Projection } from '@zmdb/schema-core/dto';

type Slim = Projection<typeof UserSchema, 'id' | 'email'>; // { id: number; email: string }

const slim = project(row, ['id', 'email'] as const); // new object, only those keys
project(row, undefined); // passthrough — returns the row unchanged
\`\`\`

Projection never mutates the input row, and preserves the order of the requested columns. It underpins the \`select\` option on Get/List/Search DTOs.
`),

  joins: ok('Joins', 'Data Access', `
Real SQL joins across tables, typed against the participating schemas.

\`\`\`ts
this.query
  .selectFrom('orders')
  .innerJoin('users', 'orders.userId', 'users.id')
  .select(['orders.id', 'users.email'])
  .where('orders.status', '=', 'shipped')
  .execute();
\`\`\`

\`innerJoin\`, \`leftJoin\` are supported. Joins power the to-one relation \`populate\` strategy.
`),

  'populate-results': ok('Typed Populate & Join Results', 'Data Access', `
Populated reads and joins produce **typed** result shapes (no proxies, no identity map — plain objects).

## Populated parents

\`\`\`ts
import { attachPopulated, type PopulatedEntity } from '@zmdb/schema-core';

// findById(1, { populate: ['orders'] }) → parent widened with the relation:
type UserWithOrders = PopulatedEntity<User, UserRelations, 'orders'>;
// { id; name; orders: Order[] }   (to-many ⇒ array; to-one ⇒ object | null)

const populated = attachPopulated(user, 'orders', orders); // new object, non-mutating
\`\`\`

## Typed join rows

\`\`\`ts
import { aliasRow, type JoinRow } from '@zmdb/schema-core';

type Row = JoinRow<Employee, Recipient, 'left'>; // Employee & Partial<Recipient>

// Rename aliased join columns into a clean shape:
const clean = aliasRow(row, { r_id: 'recipientId', r_name: 'recipientName' });
\`\`\`

\`JoinRow<Base, Joined, 'inner'>\` makes the joined columns required; \`'left'\` makes them optional (the join may not match).
`),

  aggregations: ok('Aggregations', 'Data Access', `
\`\`\`ts
this.query
  .selectFrom('orders')
  .select(['userId'])
  .count('id', 'orderCount')
  .sum('totalPrice', 'revenue')
  .groupBy(['userId'])
  .having('orderCount', '>', 5)
  .execute();
\`\`\`

\`count\`, \`sum\`, \`avg\`, \`min\`, \`max\` with \`groupBy\`/\`having\` are supported and verified against real PostgreSQL in the [benchmarks](../benchmarks/index.html).
`),

  'aggregate-results': ok('Typed Aggregate Results', 'Data Access', `
Aggregate queries return a **derived, typed** result row — the group-by key columns plus one typed field per computed aggregate (\`@zmdb/schema-core/dto\`).

\`\`\`ts
import { describeAggregate, type AggregateResult, type AggregateSpec } from '@zmdb/schema-core/dto';

const spec = {
  groupBy: ['customerId'] as const,
  computed: {
    orderCount: { fn: 'count' },
    revenue:    { fn: 'sum', column: 'total' },
    firstStatus:{ fn: 'min', column: 'status' },
  },
} satisfies AggregateSpec<typeof OrderSchema>;

type Row = AggregateResult<typeof OrderSchema, typeof spec>;
// { customerId: number; orderCount: number; revenue: number | null; firstStatus: string | null }

describeAggregate(spec); // ['customerId','orderCount','revenue','firstStatus']
\`\`\`

Typing rules: \`count\` ⇒ \`number\`; \`sum\`/\`avg\` ⇒ \`number | null\`; \`min\`/\`max\` ⇒ the source column's type \`| null\`. The group-key columns are typed straight from the entity. Pairs with the [aggregations](./aggregations.html) query builder.
`),

  'full-text-search': ok('Full-Text Search', 'Data Access', `
Postgres full-text search is expressible directly in the builder.

\`\`\`ts
this.query
  .selectFrom('products')
  .whereFullText('description', 'wireless headphones')
  .execute();
\`\`\`

Compiles to a \`to_tsvector\`/\`to_tsquery\` predicate. This is one of the routes exercised in the drizzle-benchmarks harness against real Postgres.
`),

  aliases: ok('Aliases', 'Data Access', `
\`\`\`ts
this.query
  .selectFrom('users')
  .select([['email', 'contactEmail']])   // AS contactEmail
  .execute();
\`\`\`

Table and column aliases are supported; joined columns can be aliased to avoid collisions.
`),

  'inert-rows': ok('Why Fetched Rows Are Inert', 'Data Access', `
This is the most common point of confusion coming from MikroORM/TypeORM.

\`\`\`ts
const user = await users.findById(1);

// ❌ Does NOT persist anything — user is a plain object.
user.email = 'new@example.com';

// ✅ Persist via an explicit, validated method:
await users.update(1, { email: 'new@example.com' });
\`\`\`

There is **no change tracking, no proxy, no \`flush()\`**. A write happens only when you call \`create\`/\`update\`/\`delete\`. Removing the proxy layer and identity map is precisely where the zero-overhead guarantee comes from.

| MikroORM | zmdb |
|----------|------|
| \`const u = em.findOne(User, 1)\` | \`const u = await users.findById(1)\` |
| \`u.email = 'x'\` | \`const patch = { email: 'x' }\` |
| \`await em.flush()\` | \`await users.update(1, patch)\` |
| unit-of-work across many entities | \`db.transaction(...)\` |
`),

  // ---------------- Transactions ----------------
  transactions: ok('Transactions', 'Transactions', `
The legitimate job \`flush()\` does elsewhere — atomically committing several writes — is handled by **explicit transactions**.

\`\`\`ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async (tx) => {
  const user  = await tx.repo(UserRepository).create({ email: 'a@b.com' });
  const order = await tx.repo(OrderRepository).create({ userId: user.id, totalPrice: 42 });
  // throw → ROLLBACK (nothing persists); clean return → COMMIT
});
\`\`\`

- SQL ordering is deterministic: \`BEGIN … COMMIT\` on success, \`BEGIN … ROLLBACK\` on throw.
- Nested \`tx.savepoint(fn)\` maps to \`SAVEPOINT\`/\`RELEASE\`/\`ROLLBACK TO SAVEPOINT\`.
`),

  batch: ok('Batch API', 'Transactions', `
Bundle multiple compiled statements into a single round-trip (\`@zmdb/query-compiler/set-ops\`).

\`\`\`ts
import { batch } from '@zmdb/query-compiler/set-ops';

const b = batch([stmtA, stmtB, stmtC]);
const [ra, rb, rc] = await b.execute((stmts) => driver.runAll(stmts));
\`\`\`

\`execute(runner)\` calls the runner exactly once with all statements and returns their results in order. An empty batch never calls the runner. Batching is a transport concern — wrap in \`db.transaction\` when you need atomicity.
`),
  'read-replicas': ok('Read Replicas', 'Transactions', `
Route reads to replicas and writes to the primary with a transparent, stateless driver wrapper (\`@zmdb/repository/replicas\`).

\`\`\`ts
import { withReplicas } from '@zmdb/repository/replicas';

const driver = withReplicas({
  primary: pgDriver(primaryPool),
  replicas: [pgDriver(replica1), pgDriver(replica2)],
});
const users = new UserRepository(driver);
\`\`\`

Writes (\`INSERT\`/\`UPDATE\`/\`DELETE\`) go to the primary; other statements round-robin across replicas (falling back to the primary when none are configured). The wrapper only picks a driver and delegates — no identity map, no caching. For read-after-write consistency inside a unit of work, use a [transaction](./transactions.html) (which stays on the primary).
`),

  // ---------------- Migrations ----------------
  migrations: ok('Migrations', 'Migrations', `
Because the schema is the source of truth, migrations are **diffed** from it — deterministic snapshot → \`diff(prev, next)\` → dialect-correct DDL.

- Migrations are plain, reviewable SQL files; \`down\` reverses \`up\`.
- No runtime \`updateSchema()\` against production (explicitly rejected — see [Anti-patterns](./anti-patterns.html)).

See [Migrations CLI](./migrations-cli.html) for commands.
`),

  'migrations-cli': ok('Migrations CLI', 'Migrations', `
\`\`\`bash
zmdb migrate create   # snapshot current schema, diff vs last, emit up/down SQL
zmdb migrate up       # apply pending migrations (records version)
zmdb migrate down     # roll back the last migration
zmdb migrate status   # show applied vs pending
\`\`\`

The diff is deterministic, so generated SQL is committable and diffable in review.
`),

  seeding: ok('Seeding', 'Migrations', `
Generate deterministic, reproducible seed data from a schema (\`@zmdb/schema-core/seeding\`).

\`\`\`ts
import { seedRows } from '@zmdb/schema-core/seeding';

const users = seedRows(UserSchema, { seed: 42, count: 100 });
// 100 CreateDTO rows; the same (schema, seed, count) is byte-identical every run
for (const u of users) await userRepo.create(u);
\`\`\`

Values respect each column's type (text⇒string, integer⇒int, boolean⇒bool, timestamp⇒Date, jsonEnum⇒a member). Auto-increment and defaulted columns are omitted so rows insert cleanly via \`repository.create\`. The PRNG (mulberry32) is seeded, so runs are reproducible across processes and runtimes.
`),

  // ---------------- Validation ----------------
  'validators-is': ok('is()', 'Validation', `
A compile-time type guard. Narrows the input on success.

\`\`\`ts
import { is } from '@zmdb/aot-validator';

if (is<CreateUser>(payload)) {
  // payload is narrowed to CreateUser here
}
\`\`\`

With the [AOT transform](./aot-setup.html) enabled, this inlines to the exact structural checks \`CreateUser\` implies — no runtime schema, no reflection.
`),

  'validators-assert': ok('assert()', 'Validation', `
Throws a structured error with the exact failing path, otherwise returns the input typed as \`T\`.

\`\`\`ts
import { assert } from '@zmdb/aot-validator';

const user = assert<CreateUser>(payload);
// throws AssertError { path: 'input.email', expected, value, message }
\`\`\`

There is also a strict variant (\`equals\`/\`assertStrict\`) that rejects excess keys. See [Benchmarks](../benchmarks/index.html) — strict is now competitive with typia after the allocation-free key-count fix.
`),

  'validators-validate': ok('validate()', 'Validation', `
Returns a result object with every error path, rather than throwing.

\`\`\`ts
import { validate } from '@zmdb/aot-validator';

const res = validate<CreateUser>(payload);
if (res.success) use(res.data);
else res.errors.forEach(e => report(e)); // { path, expected, value, message }
\`\`\`
`),

  'validators-tags': ok('Special Tags', 'Validation', `
Tags attach constraints to a type/column; they compile to inline checks and also map to JSON Schema / OpenAPI keywords.

\`\`\`ts
import { tags, validate } from '@zmdb/aot-validator';

validate(tags.Minimum(0), input.totalPrice);
// compiles to: (typeof input.totalPrice === 'number' && input.totalPrice >= 0)
\`\`\`

| Tag | Meaning | JSON Schema |
|-----|---------|-------------|
| \`Minimum(n)\` / \`Maximum(n)\` | numeric bounds | \`minimum\`/\`maximum\` |
| \`MinLength(n)\` / \`MaxLength(n)\` | string length | \`minLength\`/\`maxLength\` |
| \`Pattern(re)\` | regex | \`pattern\` |
| \`Enum([...])\` | allowed values | \`enum\` |
`),

  'unions-refinements': ok('Unions, Refinements & Transforms', 'Validation', `
The validator supports discriminated unions, custom refinements, transforms, coercion and brands. These are inlined by the AOT transform just like the primitives.

\`\`\`ts
import { is } from '@zmdb/aot-validator';

type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'rect'; w: number; h: number };

if (is<Shape>(input)) { /* discriminated on kind */ }
\`\`\`

See \`packages/aot-validator/src/advanced\` for the full frozen surface.
`),

  // ---------------- JSON & Serialization ----------------
  'json-stringify': ok('stringify()', 'JSON & Serialization', `
An AOT JSON serializer — straight-line concatenation, no reflection.

\`\`\`ts
import { stringify, assertStringify } from '@zmdb/aot-validator/serialization';

const body     = stringify(user);
const safeBody = assertStringify<User>(user); // serialize + validate in one pass
\`\`\`

Frozen escaping rules (quotes, control chars, unicode); \`undefined\` object props are omitted; \`bigint\` throws \`TypeError\` (documented policy).
`),

  'json-parse': ok('parse()', 'JSON & Serialization', `
Parse + validate into \`T\` in one pass.

\`\`\`ts
import { parse } from '@zmdb/aot-validator/serialization';

const result = parse<User>(rawJson);
if (result.success) use(result.data);
else report(result.issues); // { path, expected, value, message }[]
\`\`\`
`),

  'json-schema': ok('JSON Schema', 'JSON & Serialization', `
Because the schema carries column types, nullability, defaults and validation tags, a JSON Schema document is generated **deterministically at build time** from the same source of truth.

\`\`\`ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

const userEntity = toJsonSchema(UserSchema);           // response shape (draft 2020-12)
const userCreate = toJsonSchema(UserSchema, 'create'); // request-body shape
\`\`\`

No runtime reflection; stable key ordering so output is committable.
`),

  openapi: ok('OpenAPI', 'JSON & Serialization', `
\`\`\`ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const components = toOpenApiComponents([UserSchema, OrderSchema]);
// components.schemas.User / .Order  (OpenAPI 3.1)
\`\`\`

- \`create\`/\`update\` variants for request bodies, \`entity\` for responses.
- Validation tags map to keywords (\`Minimum→minimum\`, \`Pattern→pattern\`, …).
- Relations emit \`$ref\` (to-one) / \`items:{$ref}\` (to-many).
`),

  random: ok('Random Generator', 'JSON & Serialization', `
Produce a value that satisfies a type, tags and all — useful for tests and seeding.

\`\`\`ts
import { random } from '@zmdb/aot-validator';

const fakeUser = random<CreateUser>();
\`\`\`

Respects constraints (\`Minimum\`, \`Pattern\`, enum members, etc.) inlined by the AOT transform.
`),

  // ---------------- Advanced ----------------
  'custom-types': ok('Custom Types & Codecs', 'Advanced', `
Define a column type with a SQL type + a TS type + a to-DB/from-DB codec (\`@zmdb/schema-core/custom-types\`).

\`\`\`ts
import { defineType, encodeValue, decodeValue } from '@zmdb/schema-core/custom-types';

const jsonb = defineType<Record<string, unknown>, string>({
  sqlType: 'jsonb',
  toDb: (v) => JSON.stringify(v),
  fromDb: (raw) => JSON.parse(raw),
});

encodeValue(jsonb, { a: 1 }); // '{"a":1}'  (for the driver)
decodeValue(jsonb, raw);      // parsed object (from a row)
\`\`\`

The codec is AOT-friendly (a plain pair of functions, no reflection); \`sqlType\` feeds migration DDL. \`decodeValue(t, encodeValue(t, v))\` round-trips for codec-clean values.
`),
  'set-operations': ok('Set Operations', 'Advanced', `
Combine result sets with UNION / UNION ALL / INTERSECT / EXCEPT (\`@zmdb/query-compiler/set-ops\`).

\`\`\`ts
import { setOperation } from '@zmdb/query-compiler/set-ops';

const admins = qc.selectFrom('users').where('role', '=', 'admin').compile();
const guests = qc.selectFrom('users').where('role', '=', 'guest').compile();

const both = setOperation('union', [admins, guests], 'postgres');
// SELECT ... $1 UNION SELECT ... $2   (params: ['admin','guest'])
\`\`\`

Positional placeholders are renumbered across the combined parameter list on Postgres (kept as \`?\` on MySQL/SQLite). Order is preserved; a single query passes through unchanged. Row shapes must be union-compatible.
`),
  'lifecycle-hooks': todo('Lifecycle Hooks & Events', 'Advanced', 'Repository-level create/update/delete hooks exist; a full entity event/subscriber system is planned. Note: implicit lifecycle magic that depends on change-tracking is an anti-pattern here — see the anti-patterns page.'),
  embeddables: todo('Embeddables', 'Advanced', 'Embedding a value object across columns of one table is planned.'),
  inheritance: todo('Inheritance Mapping', 'Advanced', 'Single-table / class-table inheritance mapping is planned.'),

  // ---------------- Integrations ----------------
  drivers: ok('Drivers', 'Integrations', `
The core never opens a connection. Inject any \`Driver\`:

\`\`\`ts
interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
\`\`\`

Wrap your database client of choice — \`pg\`, \`mysql2\`, \`better-sqlite3\`, \`node:sqlite\` — in this interface. The benchmark harness uses a \`pg\`-backed driver against real PostgreSQL 16. Additional first-party driver adapters are on the roadmap.
`),

  'framework-integrations': ok('Framework Integrations', 'Integrations', `
zmdb is framework-agnostic. \`makeEndpoint\` (\`@zmdb/repository/integrations\`) wires boundary validation + serialization into any HTTP framework.

\`\`\`ts
import { makeEndpoint } from '@zmdb/repository/integrations';
import { assert } from '@zmdb/aot-validator';

const createUser = makeEndpoint({
  validate: (raw) => assert<CreateDTO<typeof UserSchema>>(raw),
  handle: (dto) => users.create(dto),
});
// validate → handle → serialize; invalid input ⇒ 400 (handler not called), else 200
\`\`\`

Thin per-framework wrappers (1–2 lines each):

\`\`\`ts
// Hono
app.post('/users', async (c) => { const r = await createUser(await c.req.json()); return c.body(r.body, r.status); });
// Express
app.post('/users', async (req, res) => { const r = await createUser(req.body); res.status(r.status).send(r.body); });
// tRPC
t.procedure.input(z.unknown()).mutation(({ input }) => createUser(input));
\`\`\`

No framework is a hard dependency of the core.
`),
  'llm-function-calling': ok('LLM Function Calling', 'Integrations', `
Turn a schema into an LLM tool schema and leniently parse model output (\`@zmdb/schema-core/llm\`).

\`\`\`ts
import { toolFromSchema, lenientParse } from '@zmdb/schema-core/llm';

const tool = toolFromSchema('createUser', UserSchema, { description: 'Create a user' });
// { name, description, parameters }  — parameters = create-variant JSON Schema

const res = lenientParse('\`\`\`json\n{"email":"a@b.com"}\n\`\`\`');
if (res.success) use(res.data); else retryWith(res.errors);
\`\`\`

\`toolFromSchema\` reuses the OpenAPI generator (input shape = the create variant). \`lenientParse\` strips Markdown code fences before \`JSON.parse\`, and applies an optional \`coerce\` (guarded — a throwing coerce yields \`success:false\` with errors), suitable for an LLM retry loop.
`),

  // ---------------- Reference ----------------
  benchmarks: ok('Benchmarks', 'Reference', `
zmdb runs inside the **actual upstream benchmark harnesses** against the **real competitor libraries**:

- **ORM** — the drizzle-benchmarks routes + k6 vs Drizzle/Kysely against real PostgreSQL 16. zmdb serves all 13 routes (0 DNF).
- **Validation** — the moltar typescript-runtime-type-benchmarks runner vs Zod v3/v4, Valibot, Ajv, TypeBox, ArkType, myzod, typia — across **Node, Bun and Deno**.

DNF cases are enumerated individually, never summed or faked; we don't claim a "fastest" title we haven't earned across the full workload.

📊 **Interactive dashboard:** [open the benchmarks →](../benchmarks/index.html)
`),

  'anti-patterns': ok('Anti-patterns (deliberately excluded)', 'Reference', `
These docs incorporate the union of the MikroORM, Drizzle and Typia surfaces. A number of their pages describe patterns that are **fundamentally incompatible** with zmdb's design goal — a zero-overhead, no-proxy, AOT data layer. Those pages are **intentionally excluded**, not "TODO". Here is each one and why.

## Identity map
A per-session cache that returns the same object instance for the same row. It requires holding entity state in memory and reconciling it — overhead and surprising aliasing. zmdb reads return **plain, independent objects**; see [Why fetched rows are inert](./inert-rows.html).

## Unit of work / auto-flush / change-tracking
"Load, mutate, \`flush()\`" relies on proxies that record mutations. That proxy layer is exactly what we remove for the zero-overhead guarantee. The legitimate job — atomic multi-write — is served by explicit [Transactions](./transactions.html).

## Active Record
Entities that carry \`save()\`/\`delete()\` methods blend the row with persistence and re-introduce change tracking. zmdb keeps rows as data and persistence in the [Repository](./repository.html).

## Lazy / proxy relations
Accessing \`user.orders\` triggering a hidden query is a proxy behavior with unpredictable N+1 costs. zmdb loads relations only via explicit [populate](./relations.html).

## Identity-map caching
Caching keyed on identity-map instances presupposes the identity map we don't have. Caching, when added, will be an explicit, opt-in query concern.

## JIT mappers
Runtime just-in-time row-mapping is the opposite of our approach — we resolve mapping **ahead of time** via the [AOT transform](./aot-setup.html).

## Protocol Buffers
Typia ships a protobuf codec, but binary wire encoding is out of scope for a SQL data layer (typia itself frames it as a separate feature area). Excluded to keep scope coherent.

## "Relational queries as the only API" / Why-not-SQL-like
zmdb is SQL-first by design. We don't hide SQL behind a relational-only object API; the query builder maps directly to SQL, with typed [joins](./joins.html) and [aggregations](./aggregations.html).

## Runtime schema mutation (\`updateSchema()\`)
Applying schema changes to a live database at runtime is rejected in favor of reviewable, diffed [migrations](./migrations.html).
`),
};
