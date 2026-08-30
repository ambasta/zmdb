// zmdb docs manifest — the union of MikroORM + Drizzle + Typia doc surfaces,
// classified for a zero-overhead, no-proxy, AOT data layer:
//   status:'supported' → written in full (API is real; see COOKBOOK/SPECs)
//   status:'todo'      → valid capability, not yet implemented (roadmap, not anti-pattern)
// Anti-pattern pages are intentionally ABSENT from the nav and enumerated on the
// anti-patterns page with rationale.

export const NAV = [
  { title: 'Getting Started', pages: ['introduction', 'quick-start', 'installation', 'aot-setup', 'pure-typescript'] },
  { title: 'Schema', pages: ['schema-declaration', 'column-types', 'type-derivation', 'relations', 'indexes-constraints', 'views', 'sequences', 'generated-columns', 'schemas-namespaces', 'rls'] },
  { title: 'Data Access', pages: ['crud', 'repository', 'select', 'insert', 'update', 'delete', 'filters', 'pagination', 'read-dtos', 'projections', 'joins', 'populate-results', 'aggregations', 'aggregate-results', 'full-text-search', 'aliases', 'inert-rows'] },
  { title: 'Transactions', pages: ['transactions', 'batch', 'read-replicas'] },
  { title: 'Migrations', pages: ['migrations', 'migrations-cli', 'seeding'] },
  { title: 'Validation', pages: ['validators-is', 'validators-assert', 'validators-validate', 'validators-tags', 'unions-refinements'] },
  { title: 'JSON & Serialization', pages: ['json-stringify', 'json-parse', 'json-schema', 'openapi', 'random'] },
  { title: 'Advanced', pages: ['custom-types', 'set-operations', 'lifecycle-hooks', 'embeddables', 'inheritance'] },
  { title: 'Integrations', pages: ['drivers', 'framework-integrations', 'llm-function-calling'] },
  { title: 'Web Framework', pages: ['web-overview', 'web-controllers', 'web-context', 'web-di', 'web-domain-state', 'web-pipeline', 'web-data-integration', 'web-modules'] },
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

  'quick-start': ok('Quick Start', 'Getting Started', `
This guide takes you from an empty project to a validated, type-safe data layer
in a few minutes. By the end you will have defined a schema, derived its types,
run CRUD through a repository, and issued a typed query.

> [!NOTE]
> zmdb targets **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. It never
> opens a database connection itself — you inject a small \`Driver\`, so it works
> with \`pg\`, \`mysql2\`, \`better-sqlite3\`, or \`node:sqlite\`.

## 1. Install

\`\`\`bash
npm add zmdb@alpha
\`\`\`

One package re-exports the whole ecosystem. (Prefer granular installs? Use the
four \`@zmdb/*\` packages instead — see [Installation](./installation.html).)
For the AOT-inlined validators (the fast path), wire the transformer once — see
[AOT setup](./aot-setup.html). Without it, validation still works via a runtime
fallback.

## 2. Define your schema once

The schema is the single source of truth. Everything else derives from it.

\`\`\`ts
import { defineSchema, serial, text, integer, numeric, jsonEnum, timestamp } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$')),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull().references('users.id'),
  total: numeric().notNull().validate(tags.Minimum(0)),
});
\`\`\`

Builders return **frozen** column metadata and modifiers are pure and chainable,
so a schema is a plain, inert value — no decorators, no global registry.

## 3. Types derive automatically

\`\`\`ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User       = Entity<typeof UserSchema>;
//   { id: number; email: string; role: 'admin' | 'user'; createdAt: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
//   { email: string; role?: 'admin' | 'user' }   ← id auto-omitted; defaulted → optional

type UpdateUser = UpdateDTO<typeof UserSchema>;   //  Partial<CreateUser>
\`\`\`

> [!TIP]
> Change a column and every derived type updates. Any call site that no longer
> satisfies them **fails to compile** — that compile error is the anti-drift
> guarantee. See [Type derivation](./type-derivation.html).

## 4. CRUD through a repository

A repository binds your schema to a driver. The fastest way is the
**\`defineRepository\`** helper (no subclass, no hand-written driver) with the
built-in \`node:sqlite\` driver — a genuinely zero-dependency setup:

\`\`\`ts
import { DatabaseSync } from 'node:sqlite';
import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';

const db = new DatabaseSync('app.db'); // or ':memory:'
const users = defineRepository(UserSchema, sqliteDriver(db), { dialect: 'sqlite' });

const u       = await users.create({ email: 'a@b.com' });    // validated vs CreateDTO<S>
const one     = await users.findById(u.id);                  // Entity<S> | undefined
const admins  = await users.find({ role: 'admin' });         // typed WhereDTO<S>
const page    = await users.list({ page: { limit: 20 } });   // ListResult<Entity<S>>
const updated = await users.update(u.id, { role: 'admin' }); // validated vs UpdateDTO<S>
const gone    = await users.delete(u.id);                    // boolean
\`\`\`

Prefer a class? Subclassing works identically:

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';
class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
const users = new UserRepository(sqliteDriver(db), 'sqlite');
\`\`\`

> [!TIP]
> Use \`pgDriver\` from \`@zmdb/repository/drivers/pg\` for PostgreSQL. A full
> runnable example lives at \`examples/quickstart.ts\`. See [Drivers](./drivers.html).

> [!IMPORTANT]
> Rows you read back are **plain, inert objects**. Mutating \`user.email = 'x'\`
> persists nothing — writes only happen through \`create\`/\`update\`/\`delete\`.
> This is deliberate; see [Why fetched rows are inert](./inert-rows.html).

## 5. Query your data (typed)

\`\`\`ts
import { compileWhere, applyOrderBy, buildListResult } from '@zmdb/schema-core/dto';

let qb = users.query.selectFrom('users');
qb = compileWhere(qb, { role: 'admin', createdAt: { gte: since } });
qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }]);
const rows = await driver.execute(qb.limit(21).compile());
const page = buildListResult(rows, { limit: 20 }); // { items, hasMore }
\`\`\`

\`\`\`sql
SELECT * FROM "users"
WHERE "role" = $1 AND "createdAt" >= $2
ORDER BY "createdAt" DESC
LIMIT 21
\`\`\`

The filter, ordering and pagination are all typed against \`UserSchema\`. See
[Filters](./filters.html), [Ordering & pagination](./pagination.html) and the
[Read/Query DTOs](./read-dtos.html).

## 6. Atomic writes with transactions

\`\`\`ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);
await db.transaction(async (tx) => {
  const user  = await tx.repo(UserRepository).create({ email: 'a@b.com' });
  const order = await tx.repo(OrderRepository).create({ userId: user.id, total: 42 });
  // throw here → ROLLBACK; clean return → COMMIT
});
\`\`\`

## 7. Validate at the boundary

\`\`\`ts
import { assert } from '@zmdb/aot-validator';

// In an HTTP handler: validate the inbound body against the derived Create DTO.
const payload = assert<CreateDTO<typeof UserSchema>>(await req.json());
const user = await users.create(payload);
\`\`\`

## Where to go next

- [Schema declaration](./schema-declaration.html) and [Column types](./column-types.html)
- [Relations](./relations.html) and [typed populate/join results](./populate-results.html)
- [Migrations](./migrations.html) — diffed from the schema
- [Validators](./validators-is.html) and [JSON / Ser-De](./json-stringify.html)
- [Anti-patterns](./anti-patterns.html) — what zmdb deliberately does *not* do, and why
`),
  'installation': ok('Installation', 'Getting Started', `
zmdb is an ESM-only TypeScript data layer framework targeting Node.js 26+ and TypeScript 7.0+. The easiest way to install is the single umbrella package; the four sub-packages are also published individually for advanced/tree-shaken use.

## Recommended: one install

\`\`\`bash
npm add zmdb@alpha
\`\`\`

\`\`\`ts
// everything from one import
import { defineSchema, serial, text, defineRepository, is } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
\`\`\`

The \`zmdb\` package re-exports the curated public API of all four sub-packages,
with deeper surfaces under subpaths (\`zmdb/dto\`, \`zmdb/relations\`,
\`zmdb/drivers/sqlite\`, \`zmdb/drivers/pg\`, …).

## Prerequisites

- **Node.js** 26.0.0 or later
- **TypeScript** 7.0.0 or later
- **ESM** — your \`package.json\` must have \`"type": "module"\`

\`\`\`json
{
  "type": "module",
  "dependencies": {
    "zmdb": "^1.0.0-alpha.4"
  }
}
\`\`\`

## Advanced: install sub-packages individually

Prefer to depend only on the pieces you use (better tree-shaking):

\`\`\`bash
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository
\`\`\`

## Install Individual Packages

Install only what you need:

\`\`\`bash
# Schema definition + type derivation
npm install @zmdb/schema-core

# Query builder (SELECT/INSERT/UPDATE/DELETE)
npm install @zmdb/query-compiler

# AOT validation + serialization
npm install @zmdb/aot-validator

# Repository with CRUD + transactions
npm install @zmdb/repository
\`\`\`

> [!NOTE]
> \`@zmdb/query-compiler\` is a required peer dependency of \`@zmdb/repository\`.

## TypeScript Configuration

Ensure your \`tsconfig.json\` targets modern features:

\`\`\`json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
\`\`\`

## Verify Installation

\`\`\`ts
import { defineSchema, serial, text } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

console.log(UserSchema.table);      // 'users'
console.log(UserSchema.columns.email.type); // 'text'
\`\`\`

## Package Overview

| Package | Purpose |
|---------|---------|
| \`@zmdb/schema-core\` | DSL builders, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI |
| \`@zmdb/query-compiler\` | SELECT/INSERT/UPDATE/DELETE, dialects, JOINs, aggregations, FTS, migrations |
| \`@zmdb/aot-validator\` | AOT inlining + is/assert/validate/equals, unions, transforms, serialization |
| \`@zmdb/repository\` | Auto-validating CRUD, hooks, transactions, populate |

## Next Steps

- [Quick Start](./quick-start.html) — define your first schema
- [AOT Setup](./aot-setup.html) — configure build-time validation inlining
- [Pure TypeScript](./pure-typescript.html) — runtime-only validation without AOT
`),

  'aot-setup': ok('AOT Setup (transformer)', 'Getting Started', `
AOT (ahead-of-time) validation inlines type checks at build time, eliminating runtime parsing overhead. The validator transforms \`is<T>()\`, \`assert<T>()\`, and \`validate<T>()\` calls into direct JavaScript boolean expressions — no Zod-style runtime parsers, no reflection.

## Why AOT?

Runtime validators like Zod parse type definitions on every call. AOT inlining compiles those checks once, at build time:

\`\`\`ts
// Authored code
const ok = is<{ email: string }>(input);

// Compiled output (no runtime parser)
const ok = (typeof input === "object" && input !== null && typeof input.email === "string");
\`\`\`

> [!IMPORTANT]
> AOT validation achieves 5-24× speedup over runtime validators on assert operations. See [benchmarks](./benchmarks.html) for real numbers.

## Build Plugin

The AOT transformer is available as an unplugin for Vite, esbuild, Webpack, and Rollup:

\`\`\`ts
// vite.config.ts
import { defineConfig } from 'vite';
import { zmdbAot } from '@zmdb/aot-validator/unplugin';

export default defineConfig({
  plugins: [
    zmdbAot(),
  ],
});
\`\`\`

## ts-patch Alternative

For TypeScript project references or direct ts-patch usage:

\`\`\`json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "@zmdb/aot-validator/plugin", "type": "program" }
    ]
  }
}
\`\`\`

## Intercepted Functions

The transformer recognizes these generic functions from \`@zmdb/aot-validator\`:

| Function | Emits |
|----------|-------|
| \`is<T>(x)\` | Inline boolean check |
| \`assert<T>(x)\` | Inline check + throw on failure |
| \`validate<T>(x)\` | Returns \`{ success: boolean; data?: T; errors?: Issues[] }\` |
| \`equals<T>(x, y)\` | Inline deep equality + excess key check |
| \`assertEquals<T>(x, y)\` | Inline equality + throw on mismatch |

## Golden Transformations

**Before:**
\`\`\`ts
const ok = is<{ n: number; s: string }>(input);
\`\`\`

**After:**
\`\`\`ts
const ok = (typeof input === "object" && input !== null && typeof input.n === "number" && typeof input.s === "string");
\`\`\`

**assert with throw:**
\`\`\`ts
const v = assert<{ s: string }>(input);
\`\`\`

\`\`\`ts
const v = ((() => { 
  if (!(typeof input === "object" && input !== null && typeof input.s === "string")) 
    throw new AssertError("assertion failed", ...); 
  return input; 
})());
\`\`\`

## Nested Objects

The transformer recursively inlines nested object checks:

\`\`\`ts
// Input
const ok = is<{ user: { email: string } }>(input);

// Output
const ok = (typeof input === "object" && input !== null && 
  typeof input.user === "object" && input.user !== null && 
  typeof input.user.email === "string");
\`\`\`

> [!TIP]
> Deeply nested objects emit longer inline expressions. For extreme depth (10+ levels), consider flattening your types.

## Excluded Files

The plugin skips:
- Files in \`node_modules\`
- Declaration files (\`.d.ts\`)
- Non-TypeScript files

\`\`\`ts
// vite.config.ts
export default defineConfig({
  plugins: [
    zmdbAot({
      // Optional: additional excludes
      exclude: [/node_modules/, /dist/],
    }),
  ],
});
\`\`\`

## Fallback Runtime

If AOT is not configured, the runtime validator from \`@zmdb/aot-validator\` is used as a fallback — validation still works, just without the speed benefit.

\`\`\`ts
// Without AOT build, this uses runtime parser (slower but functional)
import { is } from '@zmdb/aot-validator';
const ok = is<User>(payload);
\`\`\`

## Cross-links

- [Pure TypeScript](./pure-typescript.html) — runtime-only validation
- [Validation](./validators-is.html) — validation API surface
- [Benchmarks](./benchmarks.html) — performance numbers
`),

  'pure-typescript': ok('Pure TypeScript', 'Getting Started', `
Runtime validation without the AOT build step. The \`@zmdb/aot-validator\` package provides validation utilities that work without any build plugin — just import and use.

## When to Use Runtime

- Quick prototyping without build configuration
- Environments where build plugins aren't available
- Debugging AOT-transformed code (compare behavior)

> [!NOTE]
> Runtime validation is slower than AOT (5-24× depending on the case). For production, prefer the AOT setup.

## Basic Usage

\`\`\`ts
import { is, assert, validate, equals } from '@zmdb/aot-validator';

// Type guard — returns boolean
if (is<User>(payload)) {
  // TypeScript narrows payload to User here
  console.log(payload.email);
}

// Assert — throws on invalid
const user = assert<User>(payload);
// user: User (or throws AssertError)

// Validate — returns result object
const result = validate<User>(payload);
if (result.success) {
  console.log(result.data);
} else {
  console.log(result.errors);
}

// Deep equality check
const same = equals<User>(a, b);
\`\`\`

## Result Types

\`\`\`ts
// validate() returns this shape:
interface ValidateResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly {
    path: string;
    expected: string;
    value: unknown;
    message: string;
  }[];
}
\`\`\`

## Working with DTOs

Validate against your schema-derived types:

\`\`\`ts
import type { CreateDTO } from '@zmdb/schema-core';
import { assert } from '@zmdb/aot-validator';

// Type is derived from your schema
const payload = assert<CreateDTO<typeof UserSchema>>(requestBody);
\`\`\`

## Tags for Constraints

Use validation tags for runtime rules:

\`\`\`ts
import { tags, validate } from '@zmdb/aot-validator';

const ok = validate(tags.Minimum(0), input.price);
const validEmail = validate(tags.Pattern('^[^@]+@[^@]+$'), input.email);
\`\`\`

Available tags:
- \`Minimum(n)\`, \`Maximum(n)\` — numeric bounds
- \`MinLength(n)\`, \`MaxLength(n)\` — string/array bounds
- \`Pattern(regex)\` — RegExp validation
- \`Enum([values])\` — allowed values

## Serialization

JSON stringify/parse with validation:

\`\`\`ts
import { stringify, parse, assertStringify } from '@zmdb/aot-validator/serialization';

// Serialize (fast, no validation)
const json = stringify(user);

// Serialize + validate (throws on invalid)
const safeJson = assertStringify<User>(user);

// Parse + validate
const result = parse<User>(json);
if (!result.success) {
  console.log(result.errors);
}
\`\`\`

## Comparison: Runtime vs AOT

| Aspect | Runtime | AOT |
|--------|---------|-----|
| Setup | None | Build plugin |
| Performance | Baseline | 5-24× faster |
| Output | \`TypeDescriptor\` walk | Inline JS |
| Debugging | Easier | Harder |

\`\`\`ts
// Runtime path (no build)
import { is } from '@zmdb/aot-validator';

// After AOT build, this becomes inline JS
const ok = is<User>(payload);
\`\`\`

> [!TIP]
> Start with runtime validation for development speed. Add the AOT build plugin before deploying to production.

## Cross-links

- [AOT Setup](./aot-setup.html) — build plugin configuration
- [Validation](./validators-is.html) — full validation API
- [Benchmarks](./benchmarks.html) — performance comparison
`),

  // ---------------- Schema ----------------
  'schema-declaration': ok('Schema Declaration', 'Schema', `
Schema declaration is the foundation of zmdb. You define your table structure once using column builders and modifiers, and zmdb derives types for Entity, CreateDTO, and UpdateDTO automatically.

> [!IMPORTANT]
> zmdb uses a define-once approach. All type derivation happens at compile time from the schema metadata.

## Defining a Basic Schema

Use \`defineSchema\` with column definitions. Each column uses type-safe builders.

\`\`\`ts
import { defineSchema, serial, text, timestamp } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate({ kind: 'pattern', value: '^[^@]+@[^@]+$', message: 'Invalid email' }),
  name: text().nullable(),
  role: text().notNull().defaultTo('user'),
  created_at: timestamp().notNull(),
});
\`\`\`

> [!TIP]
> The schema object is frozen — you cannot modify it after creation. This ensures type safety.

## Column Builders

zmdb provides builders for all common SQL types:

\`\`\`ts
import { serial, integer, bigint, numeric, text, varchar, boolean, timestamp, json, jsonEnum } from '@zmdb/schema-core';

const id = serial();              // Auto-increment
const count = integer();          // Regular integer
const bigId = bigint();           // Big integers
const price = numeric(10, 2);     // Numeric with precision
const description = text();       // Text field
const code = varchar(50);         // VARCHAR with length
const active = boolean();         // Boolean
const created = timestamp();      // Timestamp
const metadata = json();          // JSON column
const status = jsonEnum(['pending', 'active', 'completed']); // JSON enum
\`\`\`

## Column Modifiers

Fluent methods change column properties:

\`\`\`ts
import { text, notNull, unique, primaryKey, defaultTo, validate } from '@zmdb/schema-core';

const column = text()
  .notNull()
  .unique()
  .primaryKey()
  .defaultTo('value')
  .validate({ kind: 'pattern', value: '^[A-Z]+$', message: 'Must be uppercase' });
\`\`\`

> [!NOTE]
> Function-style modifiers also work: \`notNull(col)\`, \`nullable(col)\`, \`primaryKey(col)\`, \`unique(col)\`, \`defaultTo(col, value)\`, \`validate(col, rule)\`.

## Derived Types

zmdb automatically derives types:

\`\`\`ts
import { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
// { id: number; email: string; name: string | null; role: string; created_at: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
// { email: string; name?: string | null; role?: string; created_at: Date }

type UpdateUser = UpdateDTO<typeof UserSchema>;
// Partial<CreateUser>
\`\`\`

## Foreign Keys

Add references using the \`references\` modifier:

\`\`\`ts
import { defineSchema, serial, text, integer, references } from '@zmdb/schema-core';

const PostSchema = defineSchema('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  author_id: integer().notNull().references('users'),  // FK to users
});
\`\`\`

> [!WARNING]
> The \`references\` modifier only adds metadata — it doesn't create a FK constraint. Use migration DDL to add the constraint.

## Schema Registry

Access defined schemas:

\`\`\`ts
import { getRegisteredSchema, registeredSchemas } from '@zmdb/schema-core';

const userSchema = getRegisteredSchema('users');
const allSchemas = registeredSchemas();
\`\`\`

## Working with the Schema

Use with the query compiler:

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');
const query = compiler
  .selectFrom(UserSchema.table)
  .select(['id', 'email'])
  .where('role', '=', 'admin')
  .compile();
\`\`\`

\`\`\`sql
SELECT "id", "email" FROM "users" WHERE "role" = $1
-- parameters: ['admin']
\`\`\`

## Related

- [Relations](./relations.html) — defining relationships
- [Indexes & Constraints](./indexes-constraints.html) — adding constraints
- [Repository](./repository.html) — using schemas with the repository
`),

  'column-types': ok('Column Types', 'Schema', `
The builder functions map to SQL column types and drive both the derived
TypeScript type and the DDL emitted by [migrations](./migrations.html).

## Type mapping

| Builder | SQL | TS type |
|---------|-----|---------|
| \`serial()\` | \`SERIAL\` / auto-inc PK | \`number\` (omitted from \`CreateDTO\`) |
| \`integer()\` | \`INTEGER\` | \`number\` |
| \`bigint()\` | \`BIGINT\` | \`bigint\` |
| \`numeric()\` | \`NUMERIC\` | \`number\` |
| \`text()\` | \`TEXT\` | \`string\` |
| \`varchar()\` | \`VARCHAR(n)\` | \`string\` |
| \`boolean()\` | \`BOOLEAN\` | \`boolean\` |
| \`timestamp()\` | \`TIMESTAMP\` | \`Date\` |
| \`json()\` | \`JSON\` / \`JSONB\` | \`unknown\` |
| \`jsonEnum([...])\` | \`TEXT\` + check | union of the literals |

## Modifiers

Modifiers are pure and chainable; they return frozen column metadata.

\`\`\`ts
serial().primaryKey()
text().notNull()
varchar().notNull() // length via the builder
jsonEnum(['admin', 'user']).notNull().defaultTo('user')
integer().notNull().references('users.id')
text().validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$'))
timestamp().notNull().defaultTo('now')
\`\`\`

## How columns become DDL

A schema diffs into \`CREATE TABLE\` DDL through migrations:

\`\`\`sql
CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
\`\`\`

> [!TIP]
> \`.notNull()\` makes a field **required**; a column with \`.defaultTo()\` or
> \`serial()\` becomes **optional in \`CreateDTO\`** and is omitted where
> auto-generated. \`nullable\` columns become \`T | null\` in \`Entity\`. See
> [Type derivation](./type-derivation.html).

For richer schema objects (indexes, generated columns, sequences), see
[Indexes & constraints](./indexes-constraints.html) and
[Generated columns](./generated-columns.html).
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

> [!IMPORTANT]
> This is the anti-drift guarantee: change a column and all three types update.
> Any code that no longer satisfies them **fails to compile** — there is no
> runtime schema object to fall out of sync with.

Beyond the write triad, the **read side** also derives typed DTOs —
\`GetDTO\`, \`ListDTO\`/\`ListResult\`, \`SearchDTO\`, \`Projection\`,
\`Populated\` and \`AggregateResult\`. See [Read/Query DTOs](./read-dtos.html).
`),

  'relations': ok('Relations', 'Schema', `
Relations define how tables relate through foreign keys. zmdb provides a typed relation DSL with compile-time type derivation for populated entities.

> [!IMPORTANT]
> Relations in zmdb are metadata-only — they describe structure but don't create FK constraints. Use migration DDL to add constraints.

## Defining Relations

zmdb provides relation builders: \`manyToOne\`, \`oneToMany\`, \`oneToOne\`, \`manyToMany\`. Each returns a frozen \`RelationMeta\`.

\`\`\`ts
import { manyToOne, oneToMany, oneToOne, manyToMany } from '@zmdb/schema-core/relations';

const postToUser = manyToOne('users', 'user_id');
const userToPosts = oneToMany('posts', 'user_id');
const userToProfile = oneToOne('profiles', 'user_id');
const userToRoles = manyToMany('roles', 'user_roles');
\`\`\`

## Type-Safe Population

Use \`PopulatedEntity\` for type-safe results. The type system knows to expect an array (to-many) or single entity (to-one).

\`\`\`ts
import { Entity, defineSchema } from '@zmdb/schema-core';
import { PopulatedEntity, RelationDef, RelationsMap } from '@zmdb/schema-core/relations';

const UserSchema = defineSchema('users', {
  id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  email: { type: 'text', flags: { nullable: false } },
});

const PostSchema = defineSchema('posts', {
  id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  user_id: { type: 'serial', flags: { nullable: false }, references: { target: 'users' } },
  title: { type: 'text', flags: { nullable: false } },
});

type UserRelations = RelationsMap & {
  posts: RelationDef & { meta: ReturnType<typeof oneToMany>; entity: Entity<typeof PostSchema> };
};

type UserWithPosts = PopulatedEntity<Entity<typeof UserSchema>, UserRelations, 'posts'>;
// user.posts[0].title is typed as string
\`\`\`

## Compiling Population Queries

\`compilePopulate\` generates SQL for loading relations. It handles both join (to-one) and batched IN() queries (to-many).

\`\`\`ts
import { compilePopulate } from '@zmdb/schema-core/relations';

const query = compilePopulate('users', 'posts', oneToMany('posts', 'user_id'), 'postgres', [1, 2, 3]);
// query.kind: 'batched'
// query.sql: SELECT * FROM "posts" WHERE "user_id" IN ($1, $2, $3)
\`\`\`

For to-one, it generates a JOIN:

\`\`\`ts
const query2 = compilePopulate('posts', 'author', manyToOne('users', 'user_id'), 'postgres', []);
// query2.kind: 'join'
// query2.sql: SELECT * FROM "posts" INNER JOIN "users" ON "posts"."user_id" = "users"."id"
\`\`\`

## Attaching Populated Relations

\`attachPopulated\` merges related entities into the parent result. Non-mutating.

\`\`\`ts
import { attachPopulated } from '@zmdb/schema-core/relations';

const user = { id: 1, email: 'user@example.com' };
const posts = [{ id: 1, user_id: 1, title: 'First Post' }];
const userWithPosts = attachPopulated(user, 'posts', posts);
// { id: 1, email: 'user@example.com', posts: [...] }
\`\`\`

> [!TIP]
> Use \`attachPopulated\` when manually composing results. For automatic population, use the repository's \`populate\` method.

## Join Result Types

\`JoinRow\` types handle inner vs left joins:

\`\`\`ts
import { JoinRow, Entity } from '@zmdb/schema-core/relations';

type UserPostInner = JoinRow<Entity<typeof UserSchema>, Entity<typeof PostSchema>, 'inner'>;
// All columns present

type UserPostLeft = JoinRow<Entity<typeof UserSchema>, Entity<typeof PostSchema>, 'left'>;
// Joined columns are Partial<>
\`\`\`

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with foreign keys
- [Repository](./repository.html) — CRUD with relation support
- [Indexes & Constraints](./indexes-constraints.html) — indexing FK columns
`),

  'indexes-constraints': ok('Indexes & Constraints', 'Schema', `
Indexes and constraints are essential schema objects for data integrity and query performance. zmdb provides DDL functions to create indexes (including unique and partial indexes) and check constraints.

> [!TIP]
> Indexes improve read performance but add overhead to writes. Use them strategically based on your query patterns. Constraints should always be defined to maintain data integrity.

## Creating a Basic Index

Use \`createIndexDdl\` to generate index DDL. The function accepts an \`IndexDef\` with the index name, table, and columns.

\`\`\`ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const indexDef = {
  name: 'idx_users_email',
  table: 'users',
  columns: ['email'],
};

const ddl = createIndexDdl(indexDef, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE INDEX "idx_users_email" ON "users" ("email")
\`\`\`

## Unique Indexes

Unique indexes enforce uniqueness and can serve as alternative primary keys or enforce unique constraints on non-primary columns.

\`\`\`ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const uniqueIndex = {
  name: 'idx_users_email_unique',
  table: 'users',
  columns: ['email'],
  unique: true,
};

const ddl = createIndexDdl(uniqueIndex, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" ("email")
\`\`\`

> [!NOTE]
> PostgreSQL automatically creates a unique index for \`UNIQUE\` constraints and primary keys. Use explicit unique indexes when you need additional control or want a named index for management.

## Composite Indexes

For queries that filter on multiple columns, composite indexes can significantly improve performance. Column order matters — put the most selective column first.

\`\`\`ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const compositeIndex = {
  name: 'idx_orders_tenant_status',
  table: 'orders',
  columns: ['tenant_id', 'status', 'created_at'],
};

const ddl = createIndexDdl(compositeIndex, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE INDEX "idx_orders_tenant_status" ON "orders" ("tenant_id", "status", "created_at")
\`\`\`

## Partial Indexes

Partial indexes only include rows that match a condition, making them smaller and faster for specific query patterns.

\`\`\`ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const partialIndex = {
  name: 'idx_orders_pending',
  table: 'orders',
  columns: ['id'],
  where: "status = 'pending'",
};

const ddl = createIndexDdl(partialIndex, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE INDEX "idx_orders_pending" ON "orders" ("id") WHERE status = 'pending'
\`\`\`

> [!IMPORTANT]
> Partial indexes only help queries that include the WHERE condition. Make sure your application queries match the partial index condition.

## Check Constraints

Check constraints validate that column values meet a condition. Use \`checkConstraintDdl\` to generate the DDL.

\`\`\`ts
import { checkConstraintDdl } from '@zmdb/query-compiler/schema-objects';

const constraint = {
  name: 'chk_users_age',
  table: 'users',
  expression: 'age >= 18',
};

const ddl = checkConstraintDdl('users', 'chk_users_age', 'age >= 18', 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
ALTER TABLE "users" ADD CONSTRAINT "chk_users_age" CHECK (age >= 18)
\`\`\`

## Common Constraint Patterns

### Positive Values

\`\`\`ts
const positiveConstraint = checkConstraintDdl(
  'products', 
  'chk_product_price', 
  'price > 0', 
  'postgres'
);
\`\`\`

\`\`\`sql
ALTER TABLE "products" ADD CONSTRAINT "chk_product_price" CHECK (price > 0)
\`\`\`

### Enum-Like Constraints

\`\`\`ts
const enumConstraint = checkConstraintDdl(
  'orders', 
  'chk_order_status', 
  "status IN ('pending', 'processing', 'completed', 'cancelled')", 
  'postgres'
);
\`\`\`

\`\`\`sql
ALTER TABLE "orders" ADD CONSTRAINT "chk_order_status" CHECK (status IN ('pending', 'processing', 'completed', 'cancelled'))
\`\`\`

### String Length

\`\`\`ts
const lengthConstraint = checkConstraintDdl(
  'users', 
  'chk_username_length', 
  'char_length(username) >= 3', 
  'postgres'
);
\`\`\`

\`\`\`sql
ALTER TABLE "users" ADD CONSTRAINT "chk_username_length" CHECK (char_length(username) >= 3)
\`\`\`

## Indexes on Expressions

For queries that use expressions in WHERE clauses, expression indexes can improve performance.

\`\`\`ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

// Lowercase email index for case-insensitive lookups
const expressionIndex = {
  name: 'idx_users_email_lower',
  table: 'users',
  columns: ['(lower(email))'], // Note: expression syntax varies by dialect
};

const ddl = createIndexDdl(expressionIndex, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE INDEX "idx_users_email_lower" ON "users" ((lower(email)))
\`\`\`

## Dropping Indexes and Constraints

Include drop statements in your migrations when removing indexes or constraints.

\`\`\`ts
const dropIndexDdl = \`DROP INDEX IF EXISTS "idx_users_email"\`;
const dropConstraintDdl = \`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"\`;
\`\`\`

\`\`\`sql
DROP INDEX IF EXISTS "idx_users_email"
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"
\`\`\`

## Related

- [Views](./views.html) — optimizing views with indexes
- [Generated Columns](./generated-columns.html) — indexing computed values
- [Schema Declaration](./schema-declaration.html) — defining tables with constraints
`),
  'views': ok('Views', 'Schema', `
Views in zmdb are declarative schema objects that encapsulate reusable SELECT queries. They provide a way to define virtual tables based on the result of a query, which is particularly useful for complex joins, aggregations, or exposing a simplified API over normalized data.

> [!IMPORTANT]
> zmdb treats views as pure DDL declarations — you define them once and let the migration system handle creation/dropping. Views are **not** automatically synced with schema changes; you must manually update them when underlying tables change.

## Creating a Simple View

Use \`createViewDdl\` from \`@zmdb/query-compiler/schema-objects\` to generate the DDL for a view. The function accepts a \`ViewDef\` with the view name and SELECT query.

\`\`\`ts
import { createViewDdl } from '@zmdb/query-compiler/schema-objects';

const viewDef = {
  name: 'user_with_post_count',
  select: \`SELECT u.id, u.email, COUNT(p.id) AS post_count 
           FROM users u 
           LEFT JOIN posts p ON u.id = p.author_id 
           GROUP BY u.id, u.email\`,
};

const ddl = createViewDdl(viewDef, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE VIEW "user_with_post_count" AS SELECT u.id, u.email, COUNT(p.id) AS post_count            FROM users u 
           LEFT JOIN posts p ON u.id = p.author_id 
           GROUP BY u.id, u.email
\`\`\`

## Materialized Views

Materialized views store the result of the query physically on disk, making them useful for expensive aggregations or frequently accessed data that doesn't need to be real-time. PostgreSQL is the only supported dialect.

\`\`\`ts
import { createViewDdl, UnsupportedFeatureError } from '@zmdb/query-compiler/schema-objects';

// Only works on PostgreSQL
const materializedDef = {
  name: 'sales_summary',
  select: \`SELECT region, SUM(amount) AS total_sales 
           FROM sales 
           GROUP BY region\`,
  materialized: true,
};

const ddl = createViewDdl(materializedDef, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE MATERIALIZED VIEW "sales_summary" AS SELECT region, SUM(amount) AS total_sales 
           FROM sales 
           GROUP BY region
\`\`\`

> [!NOTE]
> Materialized views require periodic refreshes. Use \`REFRESH MATERIALIZED VIEW "view_name"\` to update the data. On MySQL or SQLite, this will throw \`UnsupportedFeatureError\`.

## Dropping Views

When migrating, you may need to drop existing views before recreating them. Use \`dropViewDdl\` for this.

\`\`\`ts
import { dropViewDdl } from '@zmdb/query-compiler/schema-objects';

const dropDdl = dropViewDdl('user_with_post_count', 'postgres');
console.log(dropDdl);
\`\`\`

\`\`\`sql
DROP VIEW IF EXISTS "user_with_post_count"
\`\`\`

## Using Views in Queries

Once a view exists in your database, you can query it like a regular table using zmdb's query compiler. The view's columns become available through standard SELECT operations.

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query = compiler
  .selectFrom('user_with_post_count')
  .select(['id', 'email', 'post_count'])
  .where('post_count', '>', 5)
  .orderBy('post_count', 'desc')
  .limit(10)
  .compile();

console.log(query.text);
console.log(query.parameters);
\`\`\`

\`\`\`sql
SELECT "id", "email", "post_count" FROM "user_with_post_count" WHERE "post_count" > $1 ORDER BY "post_count" DESC LIMIT 10
-- parameters: [5]
\`\`\`

> [!TIP]
> Views are read-only in most databases. If you need to modify data through a view, you'll need to define INSTEAD OF triggers or use an updatable view with the proper constraints.

## Related

- [Indexes & Constraints](./indexes-constraints.html) — optimize view queries with indexes
- [Sequences](./sequences.html) — another schema object for auto-incrementing values
- [Schema Declaration](./schema-declaration.html) — defining tables that views query
`),
  'sequences': ok('Sequences', 'Schema', `
Sequences are database objects that generate auto-incrementing numeric values. In PostgreSQL, they're the underlying mechanism behind \`SERIAL\` columns. zmdb provides declarative DDL functions to create and manage sequences independently.

> [!TIP]
> While zmdb's \`serial()\` column builder creates sequences implicitly, you may need explicit sequences for custom auto-increment behavior, multiple tables sharing a sequence, or generating unique IDs for external systems.

## Creating a Sequence

Use \`createSequenceDdl\` to generate the DDL for a sequence. You can specify optional \`start\` and \`increment\` values.

\`\`\`ts
import { createSequenceDdl } from '@zmdb/query-compiler/schema-objects';

const seqDef = {
  name: 'order_number_seq',
  start: 1000,
  increment: 1,
};

const ddl = createSequenceDdl(seqDef, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE SEQUENCE "order_number_seq" START 1000 INCREMENT 1
\`\`\`

## Using Sequences with Column Builders

Sequences pair well with \`integer()\` columns that need custom sequence behavior. Create the sequence first, then reference it in your column definition.

\`\`\`ts
import { integer, defaultTo, defineSchema } from '@zmdb/schema-core';

const OrderSchema = defineSchema('orders', {
  order_id: integer().notNull(),
  order_number: integer().notNull().defaultTo('nextval(\\'order_number_seq\\')'),
  created_at: integer().notNull(), // timestamp as unix epoch
});
\`\`\`

> [!IMPORTANT]
> The \`defaultTo\` value uses raw SQL (\`nextval(...)\`). This is passed through as-is to the generated DDL. Ensure the sequence exists before running migrations.

## Getting the Next Value

To use a sequence in your application, call \`nextval()\` to retrieve the next value. This is typically done at the application level or through a trigger.

\`\`\`ts
// Generating next sequence value via query compiler
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const nextValQuery = compiler
  .selectFrom('order_number_seq')
  .select(['nextval'])
  .compile();

console.log(nextValQuery.text);
\`\`\`

\`\`\`sql
SELECT nextval('order_number_seq')
\`\`\`

> [!NOTE]
> zmdb's query compiler doesn't have a dedicated \`nextval\` helper. For production use, consider creating a function or using raw SQL queries through your driver.

## Dropping a Sequence

Sequences can be dropped using standard DDL. Include this in your migration files when removing tables that depend on custom sequences.

\`\`\`ts
const dropSequenceDdl = \`DROP SEQUENCE IF EXISTS "order_number_seq"\`;
\`\`\`

\`\`\`sql
DROP SEQUENCE IF EXISTS "order_number_seq"
\`\`\`

## Sequences vs Serial Columns

zmdb's \`serial()\` column builder abstracts away the sequence creation. Here's when to use explicit sequences:

| Use Case | Recommendation |
|----------|----------------|
| Simple auto-increment PK | Use \`serial()\` — creates sequence automatically |
| Custom start value | Use explicit \`createSequenceDdl\` + \`integer()\` with \`defaultTo\` |
| Shared sequence across tables | Use explicit sequence with \`nextval()\` |
| UUID generation | Use \`gen_random_uuid()\` instead |

> [!WARNING]
> MySQL and SQLite don't have native sequence objects. On these dialects, \`createSequenceDdl\` will generate syntactically invalid DDL or throw an error. Use auto-increment columns instead.

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with serial columns
- [Indexes & Constraints](./indexes-constraints.html) — adding constraints to tables with sequences
- [Generated Columns](./generated-columns.html) — computed columns that depend on sequences
`),
  'generated-columns': ok('Generated Columns', 'Schema', `
Generated columns are table columns whose values are computed automatically from an expression. They're computed at write time (stored) or read time (virtual), ensuring data consistency without application-level calculations.

> [!IMPORTANT]
> Generated columns are computed by the database, not by zmdb. This ensures values are always consistent even if written directly to the database. zmdb supports them through DDL emission and treats them as read-only in the schema.

## Creating a Generated Column

Use \`generatedColumnDdl\` from \`@zmdb/query-compiler/schema-objects\` to generate the DDL. The function accepts a \`GeneratedColumn\` definition with the column name, SQL type, and expression.

\`\`\`ts
import { generatedColumnDdl } from '@zmdb/query-compiler/schema-objects';

const genCol = {
  name: 'full_name',
  type: 'VARCHAR(255)',
  expression: 'first_name || \\' \\' || last_name',
  stored: true,
};

const ddl = generatedColumnDdl(genCol, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
"full_name" VARCHAR(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
\`\`\`

> [!NOTE]
> The \`stored: true\` option makes the column "stored" (computed and written to disk). Omit it for virtual columns (computed on read). PostgreSQL requires \`STORED\` for generated columns.

## Common Use Cases

### Computed Timestamps

Track elapsed time or derive timestamps from other columns.

\`\`\`ts
import { timestamp, integer } from '@zmdb/schema-core';

const auditLogDef = {
  name: 'duration_ms',
  type: 'INTEGER',
  expression: 'EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000',
  stored: true,
};
\`\`\`

\`\`\`sql
"duration_ms" INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) STORED
\`\`\`

### JSON Extraction

Extract values from JSON columns into dedicated fields for indexing or querying.

\`\`\`ts
const jsonExtractionDef = {
  name: 'user_email',
  type: 'VARCHAR(255)',
  expression: '(payload->>\\'user\\')::text',
  stored: true,
};
\`\`\`

\`\`\`sql
"user_email" VARCHAR(255) GENERATED ALWAYS AS ((payload->>'user')::text) STORED
\`\`\`

### Arithmetic Expressions

Precompute values that are frequently queried but expensive to calculate.

\`\`\`ts
const totalPriceDef = {
  name: 'total_price',
  type: 'NUMERIC(10,2)',
  expression: 'unit_price * quantity',
  stored: true,
};
\`\`\`

\`\`\`sql
"total_price" NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED
\`\`\`

## Using Generated Columns with defineSchema

When defining a schema with \`defineSchema\`, treat generated columns as read-only. They won't have a corresponding entry in your column builders since they're managed by the database.

\`\`\`ts
import { defineSchema, serial, integer, numeric } from '@zmdb/schema-core';

// Define the base columns (non-generated)
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  unit_price: numeric(10, 2).notNull(),
  quantity: integer().notNull(),
  // generated columns are added via DDL migration, not in defineSchema
});
\`\`\`

> [!WARNING]
> Do not include generated columns in your \`CreateDTO\` or \`UpdateDTO\` types. The database will reject any INSERT/UPDATE attempts on generated columns since they're computed automatically.

## Querying Generated Columns

Generated columns can be selected like regular columns. They're computed automatically, so you don't need to do anything special in your queries.

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query = compiler
  .selectFrom('orders')
  .select(['id', 'unit_price', 'quantity', 'total_price'])
  .compile();

console.log(query.text);
\`\`\`

\`\`\`sql
SELECT "id", "unit_price", "quantity", "total_price" FROM "orders"
\`\`\`

> [!TIP]
> Generated columns are particularly useful for indexes. Create an index on a generated column for fast lookups on computed values without duplicating the computation logic.

## Dialect Support

| Dialect | Generated Columns | Notes |
|---------|-------------------|-------|
| PostgreSQL | ✅ | Requires \`STORED\` keyword |
| SQLite | ✅ | Virtual (without STORED) or stored |
| MySQL | ✅ | Virtual by default, \`STORED\` for persisted |

> [!NOTE]
> MySQL and SQLite may have different syntax. The \`generatedColumnDdl\` function assumes PostgreSQL-style output. For other dialects, you may need custom DDL or conditional logic.

## Related

- [Indexes & Constraints](./indexes-constraints.html) — index generated columns for performance
- [Schema Declaration](./schema-declaration.html) — defining tables with all column types
- [Views](./views.html) — virtual tables that can also compute values
`),
  'schemas-namespaces': ok('Schemas / Namespaces', 'Schema', `
Database schemas provide a namespace for organizing database objects. In PostgreSQL, schemas allow you to group tables, views, and other objects into logical units, enabling multiple teams or applications to use the same database without naming collisions.

> [!IMPORTANT]
> zmdb supports schema creation through pure DDL functions. Schemas are PostgreSQL-native concepts; MySQL and SQLite don't have namespace support (they use databases and database files respectively).

## Creating a Schema

Use \`createSchemaDdl\` to generate the DDL for creating a new schema (namespace).

\`\`\`ts
import { createSchemaDdl } from '@zmdb/query-compiler/schema-objects';

const ddl = createSchemaDdl('analytics', 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE SCHEMA "analytics"
\`\`\`

## Qualifying Objects with Schemas

When working with multiple schemas, you need to reference objects using fully-qualified names. The \`qualify\` function generates properly quoted identifiers.

\`\`\`ts
import { qualify } from '@zmdb/query-compiler/schema-objects';

// Fully qualify a table name
const tableRef = qualify('analytics', 'events', 'postgres');
console.log(tableRef);
\`\`\`

\`\`\`sql
"analytics"."events"
\`\`\`

## Using Qualified Names in Queries

Use the qualified table name when compiling queries that span schemas.

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

// Query a table in a specific schema
const query = compiler
  .selectFrom('analytics.events')
  .select(['event_id', 'event_type', 'occurred_at'])
  .where('event_type', '=', 'page_view')
  .limit(100)
  .compile();

console.log(query.text);
console.log(query.parameters);
\`\`\`

\`\`\`sql
SELECT "event_id", "event_type", "occurred_at" FROM "analytics"."events" WHERE "event_type" = $1 LIMIT 100
-- parameters: ['page_view']
\`\`\`

## Schema Organization Patterns

### Multi-Tenant Architecture

Each tenant can have their own schema, providing strong isolation.

\`\`\`ts
// Creating schemas for each tenant
const tenantSchemas = ['acme_corp', 'globex', 'soylent'];

const createAllDdl = tenantSchemas.map(tenant => 
  createSchemaDdl(tenant, 'postgres')
).join(';\\n');

console.log(createAllDdl);
\`\`\`

\`\`\`sql
CREATE SCHEMA "acme_corp";
CREATE SCHEMA "globex";
CREATE SCHEMA "soylent"
\`\`\`

> [!TIP]
> For multi-tenant applications, consider using row-level security (RLS) within a single schema instead of managing dozens of schemas. See the [RLS](./rls.html) documentation.

### Team-Based Organization

Separate schemas for different teams or domains within an organization.

\`\`\`ts
const teamSchemas = [
  { name: 'auth', description: 'Authentication and users' },
  { name: 'billing', description: 'Payments and invoices' },
  { name: 'analytics', description: 'Event tracking and reporting' },
];

const ddl = teamSchemas.map(t => createSchemaDdl(t.name, 'postgres')).join(';\\n');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE SCHEMA "auth";
CREATE SCHEMA "billing";
CREATE SCHEMA "analytics"
\`\`\`

## Default Schema Search Path

PostgreSQL uses a \`search_path\` to resolve unqualified object names. The default is \`$user, public\`. You can set a custom search path to control which schema is searched first.

\`\`\`ts
// Setting search path (run as migration or initial setup)
const setSearchPathDdl = \`SET search_path TO analytics, public\`;
\`\`\`

> [!NOTE]
> This DDL is a session-level setting. For permanent changes, use \`ALTER DATABASE\` or \`ALTER ROLE\`.

## Dropping Schemas

Schemas can be dropped with \`CASCADE\` to also drop all contained objects, or \`RESTRICT\` (default) to refuse if objects exist.

\`\`\`ts
const dropSchemaDdl = \`DROP SCHEMA IF EXISTS "staging" CASCADE\`;
\`\`\`

\`\`\`sql
DROP SCHEMA IF EXISTS "staging" CASCADE
\`\`\`

## Related

- [RLS](./rls.html) — row-level security for tenant isolation
- [Views](./views.html) — creating views within specific schemas
- [Schema Declaration](./schema-declaration.html) — defining tables that belong to schemas
`),
  'rls': ok('Row-Level Security (RLS)', 'Schema', `
Row-Level Security (RLS) is a PostgreSQL feature that restricts which rows users can access based on their session characteristics. It's the recommended approach for multi-tenant applications, providing security at the database level without relying solely on application logic.

> [!IMPORTANT]
> RLS is PostgreSQL-only. MySQL and SQLite do not support row-level security. On non-PostgreSQL dialects, the RLS DDL functions will throw \`UnsupportedFeatureError\`.

## Enabling Row-Level Security

Use \`enableRlsDdl\` to enable RLS on a table. This is the first step before creating any policies.

\`\`\`ts
import { enableRlsDdl, UnsupportedFeatureError } from '@zmdb/query-compiler/schema-objects';

const ddl = enableRlsDdl('orders', 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY
\`\`\`

> [!WARNING]
> Once RLS is enabled, all queries against the table are subject to RLS policies. If no policy exists, no rows will be returned. Always create at least one policy after enabling RLS.

## Creating RLS Policies

Use \`createPolicyDdl\` to define a policy. The policy specifies which rows are visible based on a USING expression.

\`\`\`ts
import { createPolicyDdl } from '@zmdb/query-compiler/schema-objects';

const policy = {
  name: 'users_can_see_own_orders',
  table: 'orders',
  using: 'user_id = current_user_id()',
  command: 'SELECT',
};

const ddl = createPolicyDdl(policy, 'postgres');
console.log(ddl);
\`\`\`

\`\`\`sql
CREATE POLICY "users_can_see_own_orders" ON "orders" FOR SELECT USING (user_id = current_user_id())
\`\`\`

## Policy Commands

Policies can be scoped to specific SQL commands: \`SELECT\`, \`INSERT\`, \`UPDATE\`, \`DELETE\`, or \`ALL\` (default).

\`\`\`ts
// Policy for all operations
const allPolicy = {
  name: 'tenant_isolation_all',
  table: 'documents',
  using: 'tenant_id = current_tenant_id()',
  command: 'ALL',
};

const selectOnlyPolicy = {
  name: 'read_only_access',
  table: 'reports',
  using: 'true', // everyone can read
  command: 'SELECT',
};
\`\`\`

\`\`\`sql
CREATE POLICY "tenant_isolation_all" ON "documents" FOR ALL USING (tenant_id = current_tenant_id())
CREATE POLICY "read_only_access" ON "reports" FOR SELECT USING (true)
\`\`\`

## Multi-Tenant Isolation

The most common use case for RLS is multi-tenant data isolation. Each tenant's data is protected at the database level.

\`\`\`ts
// Complete RLS setup for a multi-tenant table
const policies = [
  // Enable RLS on the table
  enableRlsDdl('tenants', 'postgres'),
  
  // Policy for SELECT - users can only see their tenant
  createPolicyDdl({
    name: 'tenant_select',
    table: 'tenants',
    using: 'id = current_setting(\\'app.tenant_id\\', true)::uuid',
    command: 'SELECT',
  }, 'postgres'),
  
  // Policy for INSERT - can only insert for their tenant
  createPolicyDdl({
    name: 'tenant_insert',
    table: 'tenants',
    using: 'id = current_setting(\\'app.tenant_id\\', true)::uuid',
    command: 'INSERT',
  }, 'postgres'),
  
  // Policy for UPDATE - can only update their tenant
  createPolicyDdl({
    name: 'tenant_update',
    table: 'tenants',
    using: 'id = current_setting(\\'app.tenant_id\\', true)::uuid',
    command: 'UPDATE',
  }, 'postgres'),
  
  // Policy for DELETE - can only delete their tenant
  createPolicyDdl({
    name: 'tenant_delete',
    table: 'tenants',
    using: 'id = current_setting(\\'app.tenant_id\\', true)::uuid',
    command: 'DELETE',
  }, 'postgres'),
];

console.log(policies.join(';\\n'));
\`\`\`

\`\`\`sql
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select" ON "tenants" FOR SELECT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_insert" ON "tenants" FOR INSERT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_update" ON "tenants" FOR UPDATE USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_delete" ON "tenants" FOR DELETE USING (id = current_setting('app.tenant_id', true)::uuid)
\`\`\`

> [!TIP]
> Set the tenant context using \`SET LOCAL app.tenant_id = 'uuid-here'\` in your transaction, then execute queries. The RLS policy automatically filters rows.

## Bypass for Service Accounts

Some operations (like batch imports or admin tools) may need to bypass RLS. Use \`FORCE\` to make policies mandatory or bypass them with \`BYPASS\`.

\`\`\`ts
// Admin role bypass (run as superuser or owner)
const bypassPolicy = {
  name: 'admin_bypass',
  table: 'orders',
  using: 'current_user = \\'admin\\'',
  command: 'ALL',
};

// Note: BYPASS requires superuser or BYPASSRLS attribute
// This is typically handled at the role level, not in the policy
\`\`\`

\`\`\`sql
CREATE POLICY "admin_bypass" ON "orders" FOR ALL USING (current_user = 'admin')
\`\`\`

> [!NOTE]
> Bypassing RLS is a powerful privilege that should be granted sparingly. Create separate service accounts for admin operations rather than using superuser accounts.

## Disabling RLS

If you need to temporarily disable RLS (for migrations, etc.), use \`DISABLE ROW LEVEL SECURITY\`.

\`\`\`ts
const disableRlsDdl = \`ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY\`;
\`\`\`

\`\`\`sql
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY
\`\`\`

## Related

- [Schemas & Namespaces](./schemas-namespaces.html) — organizing RLS-protected tables
- [Indexes & Constraints](./indexes-constraints.html) — performance considerations for RLS
- [Relations](./relations.html) — relationship handling with RLS enabled
`),

  // ---------------- Data Access ----------------
  'crud': ok('CRUD', 'Data Access', `
Create, Read, Update, and Delete operations form the backbone of any data layer. zmdb's repository provides full CRUD semantics with automatic validation against your schema, ensuring that only well-typed data reaches the database.

## Create

Insert a new row. The payload is validated against \`CreateDTO<S>\` — auto-increment columns are rejected, columns with defaults are optional.

\`\`\`ts
const user = await users.create({
  email: 'alice@example.com',
  role: 'user',  // optional, 'user' is the default
});
// user: Entity<UserSchema> — includes generated id, createdAt
\`\`\`

**SQL emitted:**

\`\`\`sql
INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING *
-- parameters: ['alice@example.com', 'user']
\`\`\`

> [!IMPORTANT]
> If validation fails, **no SQL is executed**. The driver is never called with an invalid payload.

## Read

Fetch rows by ID, by arbitrary where clause, or all rows.

\`\`\`ts
// By primary key — the fastest path
const user = await users.findById(1);
// user: Entity<UserSchema> | undefined

// By arbitrary columns
const admin = await users.findOne({ role: 'admin' });
// admin: Entity<UserSchema> | undefined

// All rows — use with caution on large tables
const allUsers = await users.findAll();
// allUsers: readonly Entity<UserSchema>[]
\`\`\`

## Update

Partial update. The payload is validated against \`UpdateDTO<S>\` — all fields are optional, but types must match.

\`\`\`ts
const updated = await users.update(1, { role: 'admin' });
// updated: Entity<UserSchema> | undefined (undefined if id not found)
\`\`\`

**SQL emitted:**

\`\`\`sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING *
-- parameters: ['admin', 1]
\`\`\`

> [!WARNING]
> Unlike ORM proxies, zmdb rows are inert. Mutating a fetched object **does not persist**:

\`\`\`ts
const user = await users.findById(1);
user.role = 'admin'; // ❌ This does NOTHING

await users.update(1, { role: 'admin' }); // ✅ Explicit update required
\`\`\`

## Delete

Remove a row by ID. Returns \`true\` if a row was deleted, \`false\` if the ID didn't exist.

\`\`\`ts
const deleted = await users.delete(1);
// deleted: boolean
\`\`\`

**SQL emitted:**

\`\`\`sql
DELETE FROM "users" WHERE "id" = $1 RETURNING "id"
-- parameters: [1]
\`\`\`

## Validation Semantics

Both \`create\` and \`update\` run validation before compiling SQL:

| Operation | Auto-increment fields | Fields with defaults | Required fields |
|-----------|----------------------|---------------------|-----------------|
| create | **Rejected** (always) | Optional | Must be present |
| update | Ignored (cannot update) | Optional | N/A (all optional) |

\`\`\`ts
// This throws — id is auto-increment
await users.create({ id: 999, email: 'test@example.com' });

// This throws — missing required field
await users.create({}); // email is required
\`\`\`

> [!TIP]
> The validation error includes a structured \`issues\` array with paths and messages, useful for API error responses.

## Cross-links

- [Repository](./repository.html) — full repository API
- [Read DTOs](./read-dtos.html) — typed query helpers
- [Inert Rows](./inert-rows.html) — why rows don't auto-persist
- [Validation](./validators-is.html) — AOT validation details
`),

  'repository': ok('Repository', 'Data Access', `
The repository pattern provides a typed, validated data access layer backed by your schema definition. zmdb's \`BaseRepository\` delivers full CRUD with lifecycle hooks, validation interception, and transaction support — all without proxies or an identity map.

## Defining a Repository

A repository is a minimal subclass that binds to your schema. The entire required body is one line.

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';
import { UserSchema } from './schema';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
\`\`\`

> [!IMPORTANT]
> The \`static readonly schema = UserSchema\` line is required. It binds the schema to the class so the repository can derive types and validate payloads.

## Injecting a Driver

The repository never opens database connections itself. You inject a \`Driver\` that executes compiled queries.

\`\`\`ts
const driver: Driver = {
  async execute(query) {
    // query.text: SQL string
    // query.parameters: $1, $2, ... placeholders
    const result = await pg.query(query.text, query.parameters);
    return result.rows;
  }
};

const users = new UserRepository(driver, 'postgres');
\`\`\`

## CRUD Operations

All write operations validate payloads against the schema before executing SQL. If validation fails, **no SQL runs**.

\`\`\`ts
// CREATE — validates against CreateDTO<UserSchema>
// { email: string; role?: 'admin'|'user'|'guest' }
const created = await users.create({ email: 'a@b.com', role: 'user' });
// created: Entity<UserSchema>

// READ — returns plain objects
const byId = await users.findById(created.id);
// byId: Entity<UserSchema> | undefined

const byEmail = await users.findOne({ email: 'a@b.com' });
// byEmail: Entity<UserSchema> | undefined

const all = await users.findAll();
// all: readonly Entity<UserSchema>[]

// UPDATE — validates against UpdateDTO<UserSchema> (all optional)
const updated = await users.update(created.id, { role: 'admin' });
// updated: Entity<UserSchema> | undefined

// DELETE — returns boolean indicating if a row was deleted
const deleted = await users.delete(created.id);
// deleted: boolean
\`\`\`

## Typed filtering & pagination

Beyond \`findById\`/\`findOne\`, the repository exposes typed \`find\` and \`list\`
methods driven by the schema-derived [WhereDTO](./filters.html) and
[pagination](./pagination.html) DTOs — no untyped \`Record\` filters.

\`\`\`ts
// find(where: WhereDTO<S>) → readonly Entity<S>[]
const admins = await users.find({ role: 'admin', age: { gte: 18 } });

// findOne(where) adds LIMIT 1
const one = await users.findOne({ email: 'a@b.com' });

// list(query) → ListResult<Entity<S>>  { items, hasMore, total?, cursor? }
const page = await users.list({
  where: { role: 'admin' },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { limit: 20 },
});
// page.items: readonly Entity<S>[]  ·  page.hasMore: boolean
\`\`\`

\`\`\`sql
SELECT * FROM "users" WHERE "role" = $1 AND "age" >= $2
SELECT * FROM "users" WHERE "email" = $1 LIMIT 1
SELECT * FROM "users" WHERE "role" = $1 ORDER BY "createdAt" DESC LIMIT 21
\`\`\`

> [!NOTE]
> \`list\` fetches \`limit + 1\` rows and trims, so \`hasMore\` is computed without a
> separate \`COUNT\`. The operator set (\`eq/ne/lt/lte/gt/gte/in/nin/like/ilike/
> isNull/notNull\`) and result shape come from [Filters](./filters.html) and the
> [Read/Query DTOs](./read-dtos.html).

## Lifecycle Hooks

Hooks fire synchronously around CRUD operations. Override them in your subclass.

\`\`\`ts
class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;

  protected preInsert(row: Record<string, unknown>): void {
    console.log('about to insert', row);
  }

  protected postInsert(row: Record<string, unknown>): void {
    console.log('inserted', row);
    // Trigger welcome email, etc.
  }

  protected preUpdate(row: Record<string, unknown>): void {
    // Audit log, concurrency check
  }

  protected preDelete(id: unknown): void {
    // Soft-delete check, cascade cleanup
  }

  protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
    // Filter sensitive fields, enrich data
    return rows.map(r => ({ ...r, viewedAt: new Date() }));
  }
}
\`\`\`

## Transactions

Bind a repository to a transaction for atomic multi-operation flows.

\`\`\`ts
const tx = await pool.connect();
await tx.query('BEGIN');

try {
  const txRepo = users.withTransaction({ execute: tx.query.bind(tx) });
  const user = await txRepo.create({ email: 'a@b.com' });
  const order = await ordersRepo.withTransaction({ execute: tx.query.bind(tx) })
    .create({ userId: user.id, total: 100 });
  
  await tx.query('COMMIT');
} catch (e) {
  await tx.query('ROLLBACK');
  throw e;
} finally {
  tx.release();
}
\`\`\`

> [!NOTE]
> \`withTransaction\` returns a shallow clone — the original repository's driver is unchanged.

## Cross-links

- [CRUD](./crud.html) — detailed create/read/update/delete semantics
- [Read DTOs](./read-dtos.html) — typed filtering, ordering, pagination
- [Transactions](./transactions.html) — transaction management details
- [Validation](./validators-is.html) — AOT-validated payloads
`),

  select: ok('Select', 'Data Access', `
zmdb's query builder is **SQL-first**: it maps directly to SQL rather than hiding
it behind an object graph. Every builder call is typed against your schema, and
\`.compile()\` returns a parameterized \`{ text, parameters }\` — nothing runs until
you hand it to a driver.

The examples below assume this schema:

\`\`\`ts
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
  createdAt: timestamp().notNull(),
});
\`\`\`

## Basic select

Select every column from a table:

\`\`\`ts
const q = qc.selectFrom('users').compile();
// q.text, q.parameters — pass to your driver
\`\`\`

\`\`\`sql
SELECT * FROM "users"
\`\`\`

Through a repository you usually call \`findAll()\` / \`findById()\` instead, which
return \`Entity<S>\` objects.

## Partial select (projection)

Pass the columns you want. Combined with the DTO \`project\`/\`select\` helpers this
also **narrows the result type** to the chosen columns.

\`\`\`ts
qc.selectFrom('users').select(['id', 'email']).compile();
\`\`\`

\`\`\`sql
SELECT "id", "email" FROM "users"
\`\`\`

> [!NOTE]
> zmdb lists columns explicitly rather than emitting \`SELECT *\` when you project,
> so the column order in the result is deterministic. See [Projections](./projections.html)
> for the typed \`Projection<S, K>\` narrowing.

## Filtering

\`where(column, operator, value)\` adds a predicate; chained \`where\`/\`andWhere\` are
ANDed and \`orWhere\` is ORed. Values are always parameterized.

\`\`\`ts
qc.selectFrom('users')
  .where('role', '=', 'admin')
  .andWhere('email', 'like', '%@corp.com')
  .compile();
\`\`\`

\`\`\`sql
SELECT * FROM "users" WHERE "role" = $1 AND "email" LIKE $2
-- parameters: ['admin', '%@corp.com']
\`\`\`

For a typed, schema-derived filter object (operator sets, AND/OR groups), use
[\`compileWhere\` + WhereDTO](./filters.html).

## Ordering

\`\`\`ts
qc.selectFrom('users').orderBy('createdAt', 'desc').orderBy('id', 'asc').compile();
\`\`\`

\`\`\`sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC
\`\`\`

## Limit & offset

\`\`\`ts
qc.selectFrom('users').orderBy('id', 'asc').limit(20).offset(40).compile();
\`\`\`

\`\`\`sql
SELECT * FROM "users" ORDER BY "id" ASC LIMIT 20 OFFSET 40
\`\`\`

See [Ordering & pagination](./pagination.html) for typed \`OrderByDTO\` /
\`PaginationDTO\` and keyset (cursor) pagination.

## Dialect differences

The same builder emits dialect-correct SQL. Identifiers and placeholders differ:

| dialect | quoting | placeholder |
|---------|---------|-------------|
| postgres | \`"col"\` | \`$1, $2, …\` |
| mysql | backtick-quoted | \`?\` |
| sqlite | \`"col"\` | \`?\` |

\`\`\`ts
createQueryCompiler('mysql').selectFrom('users').where('id', '=', 1).compile();
// text: SELECT * FROM \`users\` WHERE \`id\` = ?   parameters: [1]
\`\`\`

## Next steps

- [Filters & operators](./filters.html) — the full operator set + typed WhereDTO
- [Joins](./joins.html) and [aggregations](./aggregations.html)
- [Read/Query DTOs](./read-dtos.html) — Get/List/Search result shapes
`),

  insert: ok('Insert', 'Data Access', `
Insert rows with the query builder, or (preferably) through a repository's
\`create()\`, which validates the payload against \`CreateDTO<S>\` **before** any SQL
is emitted.

## Basic insert

\`\`\`ts
qc.insertInto('users').values({ email: 'a@b.com', role: 'user' }).compile();
\`\`\`

\`\`\`sql
INSERT INTO "users" ("email", "role") VALUES ($1, $2)
-- parameters: ['a@b.com', 'user']
\`\`\`

## Returning the inserted row

\`\`\`ts
qc.insertInto('users').values({ email: 'a@b.com' }).returning(['id', 'createdAt']).compile();
\`\`\`

\`\`\`sql
INSERT INTO "users" ("email") VALUES ($1) RETURNING "id", "createdAt"
\`\`\`

## Through the repository (validated)

\`\`\`ts
const user = await users.create({ email: 'a@b.com' }); // role defaults applied
// returns Entity<typeof UserSchema>
\`\`\`

> [!IMPORTANT]
> If the payload is invalid, \`create\` throws a structured \`ValidationError\` and
> **no SQL runs** — the driver is never called. Auto-increment PKs and defaulted
> columns may be omitted from the payload (that is what \`CreateDTO\` encodes).

See also [batch inserts](./batch.html) for multiple statements in one round-trip.
`),

  update: ok('Update', 'Data Access', `
Update rows with the query builder, or through a repository's \`update(id, patch)\`,
which validates \`patch\` against \`UpdateDTO<S>\` (a \`Partial<CreateDTO<S>>\`).

## Basic update

\`\`\`ts
qc.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).compile();
\`\`\`

\`\`\`sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2
-- parameters: ['admin', 1]
\`\`\`

## Returning the updated row

\`\`\`ts
qc.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).returning(['id', 'role']).compile();
\`\`\`

\`\`\`sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING "id", "role"
\`\`\`

## Through the repository (validated)

\`\`\`ts
const updated = await users.update(1, { role: 'admin' }); // validated vs UpdateDTO
\`\`\`

> [!WARNING]
> An \`update\` without a \`where\` clause updates **every row**. The repository's
> \`update(id, patch)\` always scopes by primary key; the raw builder does not — add
> a predicate.
`),

  delete: ok('Delete', 'Data Access', `
Delete rows with the query builder, or through a repository's \`delete(id)\` (which
returns a boolean).

## Basic delete

\`\`\`ts
qc.deleteFrom('users').where('id', '=', 1).compile();
\`\`\`

\`\`\`sql
DELETE FROM "users" WHERE "id" = $1
-- parameters: [1]
\`\`\`

## Returning deleted rows

\`\`\`ts
qc.deleteFrom('users').where('role', '=', 'guest').returning(['id']).compile();
\`\`\`

\`\`\`sql
DELETE FROM "users" WHERE "role" = $1 RETURNING "id"
\`\`\`

> [!WARNING]
> As with UPDATE, a DELETE without a \`where\` clause removes **every row**. Prefer
> the repository's \`delete(id)\` for single-row deletes, or wrap bulk deletes in a
> [transaction](./transactions.html).
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

  'pagination': ok('Ordering & Pagination', 'Data Access', `
Pagination controls how many rows are returned and in what order. zmdb supports both offset-based and cursor-based pagination through the DTO helpers, with type-safe ordering and limit/offset application.

## Offset Pagination

The simplest form — specify \`limit\` and optional \`offset\`.

\`\`\`ts
import { applyPagination, applyOrderBy, buildListResult } from '@zmdb/schema-core/dto';

let qb = qb.selectFrom('users');

// Apply ordering first
qb = applyOrderBy(qb, [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id' },
] as OrderByDTO<typeof UserSchema>);

// Then pagination
qb = applyPagination(qb, { limit: 20, offset: 40 });

const rows = await driver.execute(qb.compile());

// Build result with hasMore flag
const result = buildListResult(rows, { limit: 20 });
// result: { items: User[], hasMore: boolean, total?: number, cursor?: string }
\`\`\`

**SQL emitted:**

\`\`\`sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC LIMIT 20 OFFSET 40
\`\`\`

> [!IMPORTANT]
> Offset pagination has O(n) complexity on large offsets — the database must scan \`offset + limit\` rows. For large datasets, prefer cursor pagination.

## Cursor Pagination

More efficient for deep pagination — the cursor encodes the last seen ordering key values.

\`\`\`ts
qb = applyPagination(qb, {
  limit: 20,
  after: { createdAt: '2024-01-15T10:00:00Z', id: 123 }
} as PaginationDTO<typeof UserSchema>);
\`\`\`

**SQL emitted (keyset pagination):**

\`\`\`sql
SELECT * FROM "users" 
WHERE ("createdAt", "id") > ($1, $2)
ORDER BY "createdAt" DESC, "id" ASC
LIMIT 20
\`\`\`

> [!NOTE]
> Cursor pagination requires a stable total order — typically your ordering includes the primary key as the last column.

## ListResult Structure

\`buildListResult\` assembles the paginated response:

\`\`\`ts
interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number;      // only when requested
  readonly hasMore: boolean;    // computed from limit+1 fetch
  readonly cursor?: string;     // opaque cursor for next page
}
\`\`\`

The \`hasMore\` flag is computed by fetching \`limit + 1\` rows and trimming:

\`\`\`ts
const result = buildListResult(rows, { limit: 20 });
// If rows.length === 21 → hasMore = true, items = rows[0:20]
// If rows.length <= 20 → hasMore = false, items = rows
\`\`\`

## Requesting Total Count

Opt-in to a \`total\` count — this runs an extra COUNT query.

\`\`\`ts
const result = buildListResult(rows, { limit: 20, total: 1234 });
// result.total = 1234
// result.hasMore = true (if items.length === 20)
\`\`\`

> [!TIP]
> Only request \`total\` when you need it (e.g., pagination UI showing "page 3 of 24"). It adds an extra query.

## Typed Pagination

\`PaginationDTO<S>\` is fully typed — TypeScript enforces valid column names in cursors and prevents invalid combinations.

\`\`\`ts
type PaginationDTO<S> = 
  | { limit: number; offset?: number }
  | { limit: number; after?: CursorOf<S>; before?: CursorOf<S> };
\`\`\`

## Cross-links

- [Read DTOs](./read-dtos.html) — full DTO family
- [Repository](./repository.html) — CRUD with pagination
- [Query Compiler](./select.html) — builder details
`),

  'read-dtos': ok('Read/Query DTOs — Get / List / Search', 'Data Access', `
Read Data Transfer Objects provide typed query inputs and result shapes for fetching data. zmdb derives all read types from your schema — any change to the schema automatically updates the DTOs, eliminating drift between your API contracts and database queries.

## WhereDTO — Typed Filters

Filter rows with column-level operators. Types are inferred from your schema.

\`\`\`ts
import { compileWhere, type WhereDTO } from '@zmdb/schema-core/dto';

const where: WhereDTO<typeof UserSchema> = {
  role: 'admin',                      // eq shorthand
  age: { gte: 18, lt: 65 },           // operators
  email: { like: '%@corp.com' },
  status: { in: ['active', 'pending'] },
  deletedAt: { isNull: true },
};
\`\`\`

**SQL emitted:**

\`\`\`sql
SELECT * FROM "users" WHERE 
  "role" = $1 AND "age" >= $2 AND "age" < $3 
  AND "email" LIKE $4 AND "status" IN ($5, $6) 
  AND "deletedAt" IS NULL
\`\`\`

## OrderByDTO — Typed Sorting

Specify columns and direction with compile-time type checking.

\`\`\`ts
import { applyOrderBy, type OrderByDTO } from '@zmdb/schema-core/dto';

const orderBy: OrderByDTO<typeof UserSchema> = [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id' }, // defaults to 'asc'
];
\`\`\`

**SQL emitted:** \`ORDER BY "createdAt" DESC, "id" ASC\`

## PaginationDTO — Cursor and Offset

Both offset and cursor-based pagination are supported.

\`\`\`ts
import { applyPagination, type PaginationDTO } from '@zmdb/schema-core/dto';

// Offset pagination
const offsetPage = { limit: 20, offset: 40 };

// Cursor pagination (efficient for deep pages)
const cursorPage: PaginationDTO<typeof UserSchema> = {
  limit: 20,
  after: { createdAt: '2024-01-15T10:00:00Z', id: 123 }
};
\`\`\`

## GetDTO — Single Row Fetch

Narrow results to specific columns with optional population.

\`\`\`ts
const opts: GetOptions<typeof UserSchema> = {
  select: ['id', 'email'] as const,
  populate: ['orders'],
};
// Type narrows to Pick<Entity, 'id' | 'email'>
\`\`\`

## ListDTO + ListResult — Paginated Lists

Full-featured list queries with filtering, sorting, pagination.

\`\`\`ts
import { buildListResult, type ListResult } from '@zmdb/schema-core/dto';

const listDto: ListDTO<typeof UserSchema> = {
  where: { role: 'admin' },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { limit: 20, offset: 0 },
  select: ['id', 'email', 'createdAt'] as const,
};

const result = buildListResult(rows, { limit: 20 });
// result: { items, hasMore, total?, cursor? }
\`\`\`

> [!IMPORTANT]
> \`total\` is only present when you explicitly request it. \`hasMore\` is computed from limit+1 fetch.

## SearchDTO — Full-Text Search

Full-text search with ranking scores.

\`\`\`ts
import { buildSearchResult, type SearchResult } from '@zmdb/schema-core/dto';

const searchDto: SearchDTO<typeof UserSchema> = {
  query: 'john smith',
  columns: ['email', 'name'],
  page: { limit: 10 },
  rank: true, // adds _score
};

const searchResult: SearchResult<User> = buildSearchResult(rows, { limit: 10 });
// items have optional _score when rank: true
\`\`\`

## Projection Helper

Use \`project()\` to narrow row types at runtime.

\`\`\`ts
import { project } from '@zmdb/schema-core/dto';

const row = { id: 1, email: 'a@b.com', role: 'admin' };
const narrow = project(row, ['email', 'role'] as const);
// narrow: Pick<Row, 'email' | 'role'>
\`\`\`

## Cross-links

- [Projections](./projections.html) — column narrowing
- [Pagination](./pagination.html) — detailed pagination
- [Repository](./repository.html) — CRUD with DTOs
`),

  'projections': ok('Projections (partial select)', 'Data Access', `
Projections let you narrow the result set to specific columns, reducing payload size and improving query performance. zmdb provides compile-time type narrowing and a runtime helper for applying projections to fetched rows.

## Narrowing Select Results

The repository's read methods accept a \`select\` option that narrows the returned row type. This is type-safe — only valid column keys from the schema are allowed.

\`\`\`ts
import type { Entity } from '@zmdb/schema-core';

// Given UserSchema with columns: id, email, role, createdAt
type User = Entity<typeof UserSchema>;
// User = { id: number; email: string; role: string; createdAt: Date }

// Select only email and role — type narrows automatically
const minimal = await users.findById(1, { select: ['email', 'role'] as const });
// Type: { email: string; role: string } | undefined
\`\`\`

## Runtime Projection Helper

The \`project()\` function applies a column selection to a fetched row, returning a new object with only the specified keys.

\`\`\`ts
import { project } from '@zmdb/schema-core/dto';

const row = { id: 1, email: 'a@b.com', role: 'admin', createdAt: new Date() };

const narrow = project(row, ['email', 'role'] as const);
// narrow = { email: 'a@b.com', role: 'admin' }

// Passing undefined returns the row unchanged
const full = project(row, undefined);
// full = { id: 1, email: 'a@b.com', role: 'admin', createdAt: ... }
\`\`\`

## SQL Emitted

When you specify \`select\` in a repository call, the compiler emits only those columns in the SELECT clause.

\`\`\`ts
const q = qb.selectFrom('users').select(['email', 'role']).where('id', '=', 1).compile();

console.log(q.text);
// SELECT "email", "role" FROM "users" WHERE "id" = $1
\`\`\`

> [!IMPORTANT]
> Projections are compile-time checked against the schema. If you reference a column that doesn't exist, TypeScript will error before your code runs.

## Use Cases

- API responses that expose only public-safe fields
- Dashboard queries fetching only display columns
- Reducing memory footprint for large result sets

\`\`\`ts
// Expose only public-safe user data
const publicUser = await users.findById(id, {
  select: ['id', 'email', 'role'] as const,
});
// Never leaks internal fields like password_hash
\`\`\`

> [!TIP]
> Combine projections with pagination to minimize data transfer. Fetch only what you display.

## Cross-links

- [Read DTOs](./read-dtos.html) — full GetDTO/ListDTO/SearchDTO documentation
- [Aliases](./aliases.html) — column renaming with AS
- [Repository](./repository.html) — CRUD with projection support
`),

  joins: ok('Joins', 'Data Access', `
Real SQL joins across tables, compiled to parameterized, dialect-correct SQL and
typed against the participating schemas. Joins also power the to-one relation
[populate](./relations.html) strategy.

The examples use \`orders(id, userId, status)\` joined to \`users(id, email)\`.

## Inner join

\`\`\`ts
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';

joinableSelectFrom('orders', 'postgres')
  .innerJoin('users', 'orders.userId', 'users.id')
  .where('orders.status', '=', 'shipped')
  .compile();
\`\`\`

\`\`\`sql
SELECT * FROM "orders"
INNER JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
\`\`\`

## Left join

A left join keeps base rows even when there is no match — the joined columns may
be null (reflected by \`JoinRow<Base, Joined, 'left'>\`).

\`\`\`ts
joinableSelectFrom('employees as e', 'postgres')
  .leftJoin('employees as r', 'r.id', 'e.recipient_id')
  .where('e.id', '=', 1)
  .compile();
\`\`\`

\`\`\`sql
SELECT * FROM "employees" AS "e"
LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
WHERE "e"."id" = $1
\`\`\`

## Self-join & aliases

As above, table aliases (\`table as alias\`) let a table join itself. Use
[\`aliasRow\`](./populate-results.html) to rename the aliased columns into a clean
typed shape.

## Through the repository

\`\`\`ts
await orders.findJoined(
  { target: 'users', leftCol: 'orders.userId', rightCol: 'users.id', kind: 'inner' },
  { col: 'orders.status', op: '=', value: 'shipped' },
);
\`\`\`

> [!TIP]
> Joined rows come back as **flat plain objects** (no nested proxies). For typed
> nested relation shapes use [populate](./relations.html); for a typed flat join
> row use [\`JoinRow\`](./populate-results.html).

This is one of the routes exercised in the drizzle-benchmarks harness against
real PostgreSQL — see the [benchmarks](../benchmarks/index.html).
`),

  'populate-results': ok('Typed Populate & Join Results', 'Data Access', `
Populate loads related entities for to-one and to-many relations. Unlike lazy-loading proxies, zmdb uses explicit batched queries — no proxies, no N+1 problem, and no identity map.

## Typed populate: \`findById(id, { populate })\`

Declare a repository's relations once in a typed static \`relations\` map, then ask
for them by key — the result is a parent **typed** with its nested relation(s).

\`\`\`ts
import { oneToMany } from '@zmdb/schema-core/relations';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
  static readonly relations = {
    orders: { meta: oneToMany('orders', 'userId'), entity: OrderSchema,
              cardinality: 'one-to-many', childTable: 'orders', childFk: 'userId', parentKey: 'id' },
  } as const;
}

const user = await users.findById(1, { populate: ['orders'] });
// user.orders: Order[]   — typed; to-one relations come back as Child | null
\`\`\`

Under the hood zmdb loads the parent, then runs **one batched query** for the
children and attaches them — a plain array on a plain object.

\`\`\`sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1
SELECT * FROM "orders" WHERE "userId" = $1   -- batched across all parents
\`\`\`

> [!TIP]
> Without \`{ populate }\` the result is a plain \`Entity<S>\` (no relation key), so
> you never pay for data you didn't ask for. This replaces the older stringly-
> typed \`findAllWithMany\`.

## Populating To-One Relations (via JOIN)

Use \`findJoined\` to fetch a parent with its related entity via JOIN.

\`\`\`ts
// Given OrderSchema with user: manyToOne('users', 'userId')
const orders = await ordersRepo.findJoined(
  { target: 'users', leftCol: 'userId', rightCol: 'id', kind: 'left' },
  { col: 'status', op: '=', value: 'pending' }
);

// Each order now has user data attached (flat object)
for (const order of orders) {
  console.log(order.userId, order.user?.email);
}
\`\`\`

**SQL emitted:**

\`\`\`sql
SELECT "orders".*, "users"."id" AS "user_id", "users"."email" AS "user_email"
FROM "orders" LEFT JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
\`\`\`

## Populating To-Many Relations

Use \`findAllWithMany\` to batch-load children for all parents.

\`\`\`ts
// Find all users, then batch-load their orders
const usersWithOrders = await usersRepo.findAllWithMany(
  'orders',        // relation name on User
  'orders',        // child table
  'userId',        // foreign key on orders
  'id'             // parent key (default: 'id')
);

// usersWithOrders[0].orders = all orders where userId = user.id
\`\`\`

**SQL emitted (2 queries):**

\`\`\`sql
-- First: fetch all users
SELECT * FROM "users"

-- Second: batched IN query for orders
SELECT * FROM "orders" WHERE "userId" IN ($1, $2, $3, ...)
\`\`\`

> [!IMPORTANT]
> \`findAllWithMany\` executes exactly two queries regardless of parent count. This eliminates N+1 without proxies.

## Populate in GetDTO

Pass \`populate\` in the GetOptions to type-narrow the result:

\`\`\`ts
import type { GetDTO, Populated } from '@zmdb/schema-core/dto';

const result = await users.findById(1, { populate: ['orders'] });
// result: Populated<typeof UserSchema, 'orders'> | undefined
// result.orders: Order[]
\`\`\`

## No Lazy Loading

There are no lazy-loading proxies. If you don't call a populate method, relations are simply absent from the result:

\`\`\`ts
const user = await users.findById(1);
// user.orders === undefined (not loaded)
\`\`\`

> [!TIP]
> Always consider which relations you need. Load only what's necessary to avoid unnecessary queries.

## Cross-links

- [Relations](./relations.html) — schema definition
- [Read DTOs](./read-dtos.html) — typed reads
- [Repository](./repository.html) — CRUD with populate
`),

  aggregations: ok('Aggregations', 'Data Access', `
Grouped aggregates — \`count\`, \`sum\`, \`avg\`, \`min\`, \`max\` with \`GROUP BY\` and
\`HAVING\` — compiled to real SQL and verified against PostgreSQL in the
[benchmarks](../benchmarks/index.html).

## Count

\`\`\`ts
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';

aggregateSelectFrom('orders', 'postgres').count('id', 'orderCount').compile();
\`\`\`

\`\`\`sql
SELECT COUNT("id") AS "orderCount" FROM "orders"
\`\`\`

## Group by + multiple aggregates

\`\`\`ts
aggregateSelectFrom('orders', 'postgres')
  .select(['userId'])
  .count('id', 'orderCount')
  .sum('total', 'revenue')
  .groupBy(['userId'])
  .compile();
\`\`\`

\`\`\`sql
SELECT "userId", COUNT("id") AS "orderCount", SUM("total") AS "revenue"
FROM "orders" GROUP BY "userId"
\`\`\`

## Having

Filter on an aggregate with \`having\`:

\`\`\`ts
aggregateSelectFrom('orders', 'postgres')
  .select(['userId'])
  .count('id', 'orderCount')
  .groupBy(['userId'])
  .having('orderCount', '>', 5)
  .compile();
\`\`\`

\`\`\`sql
SELECT "userId", COUNT("id") AS "orderCount" FROM "orders"
GROUP BY "userId" HAVING COUNT("id") > $1
\`\`\`

> [!TIP]
> The result row is **typed** from the spec — group-key columns plus one field
> per computed aggregate, with correct \`number\` / \`number | null\` typing. See
> [Typed aggregate results](./aggregate-results.html).
`),

  'aggregate-results': ok('Typed Aggregate Results', 'Data Access', `
Aggregations compute summary statistics over grouped rows — counts, sums, averages, min/max values. zmdb provides a typed aggregate API that returns compile-time typed results based on your aggregation specification.

## Defining an Aggregate

Use \`AggregateSpec<S>\` to declare what you want to compute:

\`\`\`ts
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';
import type { AggregateResult, AggregateSpec } from '@zmdb/schema-core/dto';

const spec: AggregateSpec<typeof OrderSchema> = {
  groupBy: ['status'],
  computed: {
    orderCount: { fn: 'count' },
    totalRevenue: { fn: 'sum', column: 'totalPrice' },
    avgPrice: { fn: 'avg', column: 'totalPrice' },
    minOrder: { fn: 'min', column: 'totalPrice' },
    maxOrder: { fn: 'max', column: 'totalPrice' },
  },
};
\`\`\`

## Running the Aggregate

Pass a builder function to \`aggregate()\` — you compose exactly what you need.

\`\`\`ts
const results = await ordersRepo.aggregate(spec, (agg) => 
  agg
    .groupBy('status')
    .count('orderCount')
    .sum('totalRevenue', 'totalPrice')
    .avg('avgPrice', 'totalPrice')
    .min('minOrder', 'totalPrice')
    .max('maxOrder', 'totalPrice')
    .compile()
);
\`\`\`

**SQL emitted:**

\`\`\`sql
SELECT "status", 
       COUNT(*) AS "orderCount", 
       SUM("totalPrice") AS "totalRevenue", 
       AVG("totalPrice") AS "avgPrice", 
       MIN("totalPrice") AS "minOrder", 
       MAX("totalPrice") AS "maxOrder"
FROM "orders"
GROUP BY "status"
\`\`\`

## Typed Result

The result type is inferred from the spec:

\`\`\`ts
type OrderAgg = AggregateResult<typeof OrderSchema, typeof spec>;
// {
//   status: 'pending' | 'shipped' | 'delivered';
//   orderCount: number;
//   totalRevenue: number | null;
//   avgPrice: number | null;
//   minOrder: number | null;
//   maxOrder: number | null;
// }
\`\`\`

> [!IMPORTANT]
> \`sum\` and \`avg\` return \`number | null\` (NULL if no rows in group). \`min\` and \`max\` return the column's type or \`null\`. \`count\` always returns \`number\`.

## Without Grouping

Aggregate over the entire table by omitting \`groupBy\`:

\`\`\`ts
const totals = await ordersRepo.aggregate({
  computed: {
    totalOrders: { fn: 'count' },
    revenue: { fn: 'sum', column: 'totalPrice' },
  },
}, (agg) => agg.count('totalOrders').sum('revenue', 'totalPrice').compile());

// totals[0]: { totalOrders: number, revenue: number | null }
\`\`\`

**SQL emitted:**

\`\`\`sql
SELECT COUNT(*) AS "totalOrders", SUM("totalPrice") AS "revenue" FROM "orders"
\`\`\`

## Combining with Where

Filter rows before aggregating by passing a pre-filtered query builder:

\`\`\`ts
const recentStats = await ordersRepo.aggregate({
  computed: { count: { fn: 'count' } },
}, (agg) => {
  // Filter first
  const q = qb.selectFrom('orders').where('createdAt', '>', '2024-01-01');
  // Then aggregate
  return agg.count('count').compile();
});
\`\`\`

> [!TIP]
> Push filters before aggregation for performance — the database evaluates the WHERE clause before the GROUP BY.

## Cross-links

- [Read DTOs](./read-dtos.html) — full DTO family
- [Repository](./repository.html) — CRUD API
- [Query Compiler](./select.html) — aggregation builder
`),

  'full-text-search': ok('Full-Text Search', 'Data Access', `
PostgreSQL full-text search is expressible directly in the query builder, and a
typed [SearchDTO](./read-dtos.html) layers ranking + paging on top.

## Match a term

\`\`\`ts
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';

ftsSelectFrom('products', 'postgres').whereMatch('description', 'wireless headphones').compile();
\`\`\`

\`\`\`sql
SELECT * FROM "products"
WHERE to_tsvector("description") @@ to_tsquery($1)
\`\`\`

## Through the repository

\`\`\`ts
await products.findByFullText('description', 'wireless headphones');
\`\`\`

## Ranked search with SearchDTO

\`\`\`ts
import { buildSearchResult, type SearchDTO } from '@zmdb/schema-core/dto';

const search: SearchDTO<typeof ProductSchema> = {
  query: 'wireless', columns: ['description'], rank: true,
};
const result = buildSearchResult(hits, { limit: 20 }); // items carry an optional _score
\`\`\`

> [!IMPORTANT]
> FTS is dialect-specific. On SQLite (no arbitrary-column FTS without FTS5),
> \`findByFullText\` throws an honest \`UnsupportedFeatureError\` rather than
> silently running a wrong query. This is one of the routes exercised against
> real Postgres in the [benchmarks](../benchmarks/index.html).
`),

  'aliases': ok('Aliases', 'Data Access', `
Table aliases let you give a table a short name in a query — essential for
**self-joins** and for disambiguating columns when the same table appears twice.
zmdb's join builder accepts a \`'table as alias'\` spec and quotes it per dialect.

> [!NOTE]
> zmdb's builder keeps column selection close to raw SQL: it emits the columns
> you name (or \`*\`). It does **not** rewrite result keys with \`AS\` column
> aliases — reshape/rename the returned rows with [\`aliasRow\`](./populate-results.html)
> or a [projection](./projections.html) instead. Table aliases, below, are fully
> supported.

## Table aliases in joins

Pass \`'table as alias'\` to the join builder; both the base table and joined
tables can be aliased, and columns are referenced through the alias.

\`\`\`ts
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';

joinableSelectFrom('employees as e', 'postgres')
  .leftJoin('employees as r', 'r.id', 'e.recipient_id')
  .where('e.id', '=', 1)
  .compile();
\`\`\`

\`\`\`sql
SELECT * FROM "employees" AS "e"
LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
WHERE "e"."id" = $1
-- parameters: [1]
\`\`\`

## Self-joins

The same table joined to itself is the canonical case for aliases — without them
the two references would be ambiguous.

\`\`\`ts
joinableSelectFrom('categories as c', 'postgres')
  .leftJoin('categories as parent', 'parent.id', 'c.parent_id')
  .compile();
\`\`\`

\`\`\`sql
SELECT * FROM "categories" AS "c"
LEFT JOIN "categories" AS "parent" ON "parent"."id" = "c"."parent_id"
\`\`\`

## Renaming aliased columns in the result

When a join produces columns you want under cleaner keys (e.g. mapping
\`r_id\`/\`r_name\` to \`recipientId\`/\`recipientName\`), use \`aliasRow\` on the rows —
this is the typed, runtime equivalent of a \`SELECT ... AS\` rename.

\`\`\`ts
import { aliasRow, type JoinRow } from '@zmdb/schema-core';

type Row = JoinRow<Employee, Recipient, 'left'>; // Employee & Partial<Recipient>
const clean = aliasRow(row, { r_id: 'recipientId', r_name: 'recipientName' });
\`\`\`

## Dialect quoting

Aliases are quoted with the dialect's identifier quoting — \`"…"\` on
PostgreSQL/SQLite, backticks on MySQL.

\`\`\`ts
joinableSelectFrom('users as u', 'mysql').compile();
// SELECT * FROM \`users\` AS \`u\`
\`\`\`

> [!TIP]
> Prefer table aliases whenever a query touches a table more than once. For
> single-table reads you rarely need them — see [Select](./select.html).

- [Joins](./joins.html) — inner/left joins that use these aliases
- [Typed populate & join results](./populate-results.html) — \`JoinRow\` + \`aliasRow\`
- [Projections](./projections.html) — narrowing/reshaping selected columns
`),

  'inert-rows': ok('Why Fetched Rows Are Inert', 'Data Access', `
Fetched rows in zmdb are plain objects with no change tracking, no proxies, and no identity map. Mutating them has zero effect on the database. This is a deliberate design choice that enables zero-overhead data access.

## The Mutation Fallacy

If you're coming from MikroORM, TypeORM, or similar, you may be used to this pattern:

\`\`\`ts
// MikroORM-style
const user = await em.findOne(User, 1);
user.email = 'new@example.com';
await em.flush(); // persist changes
\`\`\`

In zmdb, **this doesn't work**:

\`\`\`ts
const user = await users.findById(1);
user.email = 'new@example.com'; // ❌ Does NOT persist

// The database still has the old email
const check = await users.findById(1);
console.log(check.email); // original value
\`\`\`

> [!IMPORTANT]
> Fetched rows are inert. The only way to persist changes is through explicit \`create\`, \`update\`, or \`delete\` methods on the repository.

## Why Inert?

zmdb deliberately excludes:
- **Proxies** — no \`Proxy\` wrapping fetched rows
- **Dirty checking** — no comparison of original vs current state
- **Identity map** — no shared references across queries
- **Unit of work** — no implicit flush

This enables the zero-overhead promise: the data layer adds no runtime overhead beyond the SQL itself. Every operation is explicit and visible.

## The Correct Pattern

Translate your "load-mutate-flush" workflow into explicit updates:

| Traditional ORM | zmdb |
|-----------------|------|
| \`em.findOne(User, 1)\` | \`await users.findById(1)\` |
| \`user.email = 'x'\` | \`const patch = { email: 'x' }\` |
| \`await em.flush()\` | \`await users.update(1, patch)\` |
| Multiple changes across entities | \`db.transaction(async tx => { ... })\` |

\`\`\`ts
// Find
const user = await users.findById(1);

// Prepare patch
const patch = { email: 'new@example.com', role: 'admin' };

// Persist explicitly
await users.update(1, patch);
\`\`\`

## Post-Select Hook

Use \`postSelect\` to enrich or filter rows on the way out:

\`\`\`ts
protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map(r => ({
    ...r,
    // Add computed field
    isNew: (r.createdAt as Date) > new Date('2024-01-01'),
  }));
}
\`\`\`

> [!TIP]
> \`postSelect\` is the escape hatch for row enrichment. Use it for computed fields, masking, or adding metadata — but it doesn't enable auto-persisting.

## Performance Impact

The inert row design trades convenience for speed:

- **No proxy overhead** — plain objects are as fast as JavaScript gets
- **No change tracking** — no array of dirty entities to scan
- **No identity map** — no Map lookups on every fetch
- **Deterministic behavior** — you see exactly what SQL will run

## Cross-links

- [CRUD](./crud.html) — explicit create/update/delete
- [Repository](./repository.html) — full repository API
- [Transactions](./transactions.html) — grouping multiple writes
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

## Emitted SQL

\`\`\`sql
BEGIN;
INSERT INTO "users" (...) VALUES (...);
INSERT INTO "orders" (...) VALUES (...);
COMMIT;   -- or ROLLBACK; if the callback threw
\`\`\`

## Savepoints (nested)

\`\`\`ts
await db.transaction(async (tx) => {
  await tx.repo(UserRepository).create({ email: 'a@b.com' });
  await tx.savepoint(async (sp) => {
    await sp.repo(OrderRepository).create({ userId: 1, total: 42 });
    // a throw here rolls back to the savepoint, keeping the outer tx alive
  });
});
\`\`\`

\`\`\`sql
BEGIN;
INSERT INTO "users" ...;
SAVEPOINT sp_1;
INSERT INTO "orders" ...;
RELEASE SAVEPOINT sp_1;   -- or ROLLBACK TO SAVEPOINT sp_1;
COMMIT;
\`\`\`

> [!IMPORTANT]
> There is no implicit flush. A write happens only when you call
> \`create\`/\`update\`/\`delete\` — inside a transaction those run on the tx
> connection. This replaces the unit-of-work/auto-flush model (an
> [anti-pattern](./anti-patterns.html) here) with explicit, predictable writes.
`),

  'batch': ok('Batch API', 'Transactions', `
Batch operations execute multiple statements in a single database round-trip. Use \`batch\` when you need to run several independent queries together — bulk inserts, multi-table updates, or grouped operations that benefit from a single network call.

## The Batch Handle

Create a batch handle from compiled statements:

\`\`\`ts
import { batch, createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const stmt1 = compiler
  .insertInto('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .compile();

const stmt2 = compiler
  .insertInto('users')
  .values({ name: 'Bob', email: 'bob@example.com' })
  .compile();

const batchHandle = batch([stmt1, stmt2]);
// batchHandle.statements => [stmt1, stmt2]
\`\`\`

## Executing a Batch

The \`execute\` method runs all statements via your driver:

\`\`\`ts
const results = await batchHandle.execute(async (statements) => {
  // Your driver must support multi-statement execution
  // For PostgreSQL: client.query(text + ';' + text, [...params1, ...params2])
  return driver.executeMulti(statements);
});
// results => [result1, result2]
\`\`\`

The callback receives all compiled statements and returns an array of results in the same order.

> [!NOTE]
> Not all drivers support multi-statement execution. Check your driver documentation. For PostgreSQL, use \`pg\`'s query chaining or a transaction.

## Bulk Inserts

Combine multiple inserts into one batch:

\`\`\`ts
const users = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' },
];

const statements = users.map(u =>
  compiler
    .insertInto('users')
    .values(u)
    .compile()
);

const result = await batch(statements).execute(driver.executeMulti.bind(driver));
\`\`\`

## Parameter Handling

The query compiler handles parameter arrays correctly. Each statement has its own parameter list, which the batch executor flattens:

\`\`\`ts
// stmt1.parameters => ['Alice', 'alice@example.com']
// stmt2.parameters => ['Bob', 'bob@example.com']

// After batch execute:
// Combined params => ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
\`\`\`

> [!WARNING]
> Batch does NOT guarantee atomicity by default. Wrap in a transaction if all-or-nothing semantics are required.

## Empty Batches

An empty batch returns an empty array immediately without calling the runner:

\`\`\`ts
const empty = batch([]);
const result = await empty.execute(async () => { throw new Error('Should not run'); });
// result => []
\`\`\`

> [!TIP]
> Use batch for independent operations. If operations have dependencies (e.g., insert then query the ID), use a transaction instead.

---

See also: [Set Operations](./set-operations.html) · [Query Compiler](./select.html) · [Drivers](./drivers.html)
`),
  'read-replicas': ok('Read Replicas', 'Transactions', `
Read replicas distribute read traffic across multiple database instances while writes always go to the primary. zmdb's \`withReplicas\` wrapper creates a composite driver that routes queries based on the SQL statement type.

## Configuring Replicas

Pass a primary driver and an array of replica drivers:

\`\`\`ts
import { withReplicas, type ReplicaOptions } from '@zmdb/repository/replicas';
import { PgDriver } from './drivers';

const primary = new PgDriver(pool);
const replica1 = new PgDriver(replicaPool1);
const replica2 = new PgDriver(replicaPool2);

const driver = withReplicas({
  primary,
  replicas: [replica1, replica2],
});
\`\`\`

The composite driver implements the same \`Driver\` interface:

\`\`\`ts
// All repository operations use this driver
const repo = new UserRepository(driver);
const user = await repo.findById(1);  // May hit a replica
await repo.create({ name: 'Alice' });  // Always hits primary
\`\`\`

## How Routing Works

Writes (INSERT, UPDATE, DELETE) always go to the primary. Reads are round-robin'd across replicas:

\`\`\`ts
import { isWrite } from '@zmdb/repository/replicas';

isWrite('SELECT * FROM users');           // false
isWrite('INSERT INTO users ...');         // true
isWrite('UPDATE users SET ...');          // true
isWrite('DELETE FROM users ...');         // true
\`\`\`

> [!NOTE]
> There's no replication lag detection. Reads may return stale data. For use cases requiring strong consistency, query the primary explicitly.

## Custom Load Balancing

Provide a custom \`pick\` function to control replica selection:

\`\`\`ts
const driver = withReplicas({
  primary,
  replicas: [replica1, replica2, replica3],
  pick: (replicas, nextIndex) => {
    // Example: weighted random, health-based, or latency-based
    return replicas[nextIndex % replicas.length];
  },
});
\`\`\`

The \`pick\` function receives the replica list and the current round-robin index.

## Handling Failures

If a replica fails, the driver throws. For resilience, wrap individual replicas with retry logic:

\`\`\`ts
class ResilientDriver implements Driver {
  constructor(private driver: Driver, private retries = 3) {}

  async execute(query: CompiledQuery) {
    for (let i = 0; i < this.retries; i++) {
      try {
        return await this.driver.execute(query);
      } catch (e) {
        if (i === this.retries - 1) throw e;
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
      }
    }
    throw new Error('Unreachable');
  }
}
\`\`\`

> [!TIP]
> Use connection pool health checks to remove unhealthy replicas from the pool automatically. Most pool libraries support this.

## Zero Replicas

If you pass an empty replicas array, all queries go to primary:

\`\`\`ts
const driver = withReplicas({
  primary,
  replicas: [], // All queries hit primary
});
\`\`\`

This is useful for gradual rollout — start with zero replicas, add them as you validate.

---

See also: [Drivers](./drivers.html) · [Repository](./repository.html) · [Query Compiler](./select.html)
`),

  // ---------------- Migrations ----------------
  'migrations': ok('Migrations', 'Migrations', `
Migrations manage schema evolution over time. zmdb provides snapshot and diff utilities that compare your in-code schema definitions against the live database, generating the DDL needed to align them.

## Taking a Snapshot

Capture the current state of your schemas:

\`\`\`ts
import { snapshot, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';
import { UserSchema, OrderSchema } from './schemas';

const currentState: SchemaSnapshot = snapshot([UserSchema, OrderSchema]);

// currentState.version => 1
// currentState.tables => [{ name: 'users', columns: [...] }, ...]
\`\`\`

The snapshot captures table names, column types, nullability, and primary key status.

## Computing the Diff

Compare two snapshots to generate change operations:

\`\`\`ts
import { diff, type ChangeOp } from '@zmdb/query-compiler/migrations';

// After adding a new column
const newState = snapshot([UserSchema, OrderSchema, ProductSchema]);

const changes: readonly ChangeOp[] = diff(currentState, newState);

// changes => [
//   { kind: 'create_table', table: 'products', columns: [...] },
//   { kind: 'add_column', table: 'users', column: {...} }
// ]
\`\`\`

Change operations include:

- \`create_table\` — new table with all columns
- \`drop_table\` — removed table
- \`add_column\` — new column in existing table
- \`drop_column\` — removed column
- \`alter_column_type\` — type change

## Generating DDL

Convert change operations to SQL for your dialect:

\`\`\`ts
import { emitUp, emitDown } from '@zmdb/query-compiler/migrations';

for (const op of changes) {
  const upSql = emitUp(op, 'postgres');
  const downSql = emitDown(op, 'postgres');
  
  console.log('UP:', upSql);
  console.log('DOWN:', downSql);
}

// Output:
// UP: ALTER TABLE "users" ADD COLUMN "new_col" TEXT NOT NULL
// DOWN: ALTER TABLE "users" DROP COLUMN "new_col"
\`\`\`

> [!NOTE]
> Column renames are not detected — they're treated as drop + add. Track renames manually or use a naming convention.

## Version Table

The migration runner creates a \`_zmdb_migrations\` table to track applied versions:

\`\`\`sql
CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)
\`\`\`

> [!TIP]
> Always store migrations in version control. Pair with the CLI runner for local development.

---

See also: [Migrations CLI](./migrations-cli.html) · [Query Compiler](./select.html) · [Schema Core](./schema-declaration.html)
`),

  'migrations-cli': ok('Migrations CLI', 'Migrations', `
The migration CLI runs migration scripts against your database. It wraps the core migration runner and provides a simple command-line interface for applying, rolling back, and checking migration status.

## Running Migrations

\`\`\`ts
import { runCli, type Migration } from '@zmdb/query-compiler/migrations/runner';
import { MyMigrationConnection } from './connection';

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_users_table',
    up: \`CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL)\`,
    down: \`DROP TABLE "users"\`,
  },
  {
    version: 2,
    name: 'add_email_column',
    up: \`ALTER TABLE "users" ADD COLUMN "email" TEXT\`,
    down: \`ALTER TABLE "users" DROP COLUMN "email"\`,
  },
];

const conn = new MyMigrationConnection();

// Apply pending migrations
const output = runCli('up', conn, migrations);
// output => "applied: 1, 2"
\`\`\`

## Rollback

Roll back the most recent migration:

\`\`\`ts
const output = runCli('down', conn, migrations);
// output => "reverted: 2"
\`\`\`

Each \`down\` migration is the inverse of \`up\` — manually authored to undo the change.

## Check Status

View the status of all migrations:

\`\`\`ts
const output = runCli('status', conn, migrations);
// Output:
// [x] 1 create_users_table
// [x] 2 add_email_column
\`\`\`

> [!NOTE]
> The CLI is a thin wrapper around the runner. You need to provide a \`MigrationConnection\` implementation that matches your database driver.

## MigrationConnection Interface

Implement this interface for your database:

\`\`\`ts
export interface MigrationConnection {
  exec(sql: string): void;
  appliedVersions(): readonly number[];
  recordApplied(version: number, name: string): void;
  recordReverted(version: number): void;
}
\`\`\`

For SQLite (node:sqlite):

\`\`\`ts
class SqliteMigrationConnection implements MigrationConnection {
  constructor(private db: Database) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  appliedVersions(): readonly number[] {
    const rows = this.db.prepare('SELECT version FROM _zmdb_migrations').all() as { version: number }[];
    return rows.map(r => r.version);
  }

  recordApplied(version: number, name: string): void {
    this.db.prepare(
      'INSERT INTO _zmdb_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(version, name, Date.now());
  }

  recordReverted(version: number): void {
    this.db.prepare('DELETE FROM _zmdb_migrations WHERE version = ?').run(version);
  }
}
\`\`\`

## CLI Usage

Use the runner in your npm scripts:

\`\`\`json
{
  "scripts": {
    "migrate": "node -e \\"require('./migrations/cli').run('up')\\"",
    "rollback": "node -e \\"require('./migrations/cli').run('down')\\"",
    "status": "node -e \\"require('./migrations/cli').run('status')\\""
  }
}
\`\`\`

> [!TIP]
> Keep migrations small and focused. One logical change per migration makes rollback safer.

---

See also: [Migrations](./migrations.html) · [Drivers](./drivers.html) · [Query Compiler](./select.html)
`),

  'seeding': ok('Seeding', 'Migrations', `
Seeding generates deterministic test data from your schema. Use \`seedRows\` to create reproducible datasets — same seed always produces the same rows. This is useful for testing, demos, and development environments.

## Basic Usage

\`\`\`ts
import { seedRows, makeRng } from '@zmdb/schema-core/seeding';
import { UserSchema } from './schemas';

// Generate 100 rows with default seed (1)
const rows = seedRows(UserSchema, { count: 100 });

// rows => [{ id: 12345, name: 's3k1w9d', email: 's2m5p8k', ... }, ...]
\`\`\`

## Deterministic Generation

Pass a seed for reproducible output:

\`\`\`ts
// Same seed = same rows every time
const rows1 = seedRows(UserSchema, { seed: 42, count: 10 });
const rows2 = seedRows(UserSchema, { seed: 42, count: 10 });

// rows1 === rows2 (structurally equal)
\`\`\`

The PRNG uses mulberry32 — fast, deterministic, and seedable.

## Seed Options

\`\`\`ts
interface SeedOptions {
  seed?: number;      // PRNG seed (default: 1)
  count: number;      // number of rows to generate
}
\`\`\`

## Supported Column Types

The seeder handles these types:

| Type | Generated Value |
|------|-----------------|
| \`serial\`, \`integer\`, \`bigint\` | Random integer (0–1M) |
| \`numeric\` | Random decimal (0–1000) |
| \`boolean\` | Random boolean |
| \`timestamp\` | Random date |
| \`jsonEnum\` | Random enum value |
| \`text\`, \`varchar\` | Random string (\`s\` + base36 number) |

Columns with \`autoIncrement\` or \`hasDefault\` are skipped.

\`\`\`ts
const SchemaWithDefaults = defineSchema('t', {
  id: serial().primaryKey(),           // skipped (autoIncrement)
  createdAt: timestamp().defaultNow(), // skipped (hasDefault)
  name: text(),                         // generated
  active: boolean(),                    // generated
});
\`\`\`

> [!NOTE]
> Seeding doesn't respect custom types or validators. It generates raw values based on column type.

## Custom Generation

For complex data, extend the seeder or generate manually:

\`\`\`ts
import { makeRng } from '@zmdb/schema-core/seeding';

const rng = makeRng(123);

const users = Array.from({ length: 50 }, () => ({
  name: \`User_\${Math.floor(rng() * 1000)}\`,
  email: \`user\${Math.floor(rng() * 1000)}@example.com\`,
  role: rng() < 0.5 ? 'admin' : 'user',
}));
\`\`\`

## Integration with Repository

\`\`\`ts
async function seedDatabase(repo: UserRepository, count: number) {
  const rows = seedRows(UserSchema, { count });
  
  for (const row of rows) {
    await repo.create(row);
  }
}
\`\`\`

> [!TIP]
> Use a transaction for bulk seeds to improve performance and ensure atomicity.

---

See also: [Schema Core](./schema-declaration.html) · [Repository](./repository.html) · [Validation](./validators-is.html)
`),

  // ---------------- Validation ----------------
  'validators-is': ok('is()', 'Validation', `
A compile-time type guard: \`is<T>(value)\` returns \`boolean\` and **narrows** the
input on success. With the [AOT transform](./aot-setup.html) it inlines to the
exact structural checks \`T\` implies — no runtime schema, no reflection.

## Usage

\`\`\`ts
import { is } from '@zmdb/aot-validator';

if (is<CreateUser>(payload)) {
  // payload is narrowed to CreateUser here
  await users.create(payload);
}
\`\`\`

## What the transform emits

For a type like \`{ email: string; age: number }\`, the call site compiles to a
straight-line boolean expression:

\`\`\`ts
// authored
is<{ email: string; age: number }>(d)
// compiled (AOT)
(typeof d === "object" && d !== null &&
 typeof d.email === "string" && typeof d.age === "number")
\`\`\`

> [!NOTE]
> This is the same single boolean-chain shape typia emits — and in our
> [benchmarks](../benchmarks/index.html) it out-performs \`new Function()\` JIT
> validators. Without the transform wired in, \`is\` falls back to a slower runtime
> walk of the type descriptor.

## Related

- [assert()](./validators-assert.html) — throw with the failing path
- [validate()](./validators-validate.html) — collect every error
- [Special tags](./validators-tags.html) — constraints like \`Minimum\`/\`Pattern\`
`),

  'validators-assert': ok('assert()', 'Validation', `
The \`assert\` function validates a value against a TypeDescriptor and throws an \`AssertError\` if validation fails. Unlike \`validate\` which returns a result object, \`assert\` is designed for cases where you want validation failures to halt execution immediately — perfect for guard clauses and early returns.

> [!IMPORTANT]
> The AssertError contains a \`issues\` array with all validation failures, not just the first one. This enables displaying comprehensive error messages to users.

## Basic Usage

\`\`\`ts
import { assert, tags } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    username: { kind: 'string', maxLength: 20 },
    score: { kind: 'number', minimum: 0 },
  },
};

// Success — returns the value cast to T
const user = assert({ username: 'alice', score: 100 }, descriptor);
// user: { username: 'alice', score: 100 }

// Failure — throws AssertError
try {
  assert({ username: 'thisusernameistoolong', score: -5 }, descriptor);
} catch (e) {
  // e instanceof AssertError === true
  // e.issues contains all failures
}
\`\`\`

## AssertError Shape

When validation fails, an \`AssertError\` is thrown with detailed error information:

\`\`\`ts
class AssertError extends Error {
  readonly issues: readonly ValidationIssue[] = [];
}

// Each issue provides exact path and expected type
interface ValidationIssue {
  readonly path: string;      // e.g., 'input.score'
  readonly expected: string;  // e.g., 'number >= 0'
  readonly value: unknown;    // -5
  readonly message: string;   // 'expected number >= 0'
}
\`\`\`

\`\`\`sql
-- Generated error output (for debugging):
-- path: input.username, expected: maxLength 20, value: "thisusernameistoolong"
-- path: input.score, expected: number >= 0, value: -5
\`\`\`

## Excess Property Checking

Use \`assertEquals\` for strict mode — it enforces that no extra properties exist beyond what the descriptor defines:

\`\`\`ts
import { assertEquals } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    name: { kind: 'string' },
  },
};

// OK — only declared properties
assertEquals({ id: 1, name: 'test' }, descriptor);

// Throws — excess property 'extra' not in descriptor
assertEquals({ id: 1, name: 'test', extra: 'oops' }, descriptor);
// Issues: [{ path: 'input', expected: 'no excess properties', ... }]
\`\`\`

> [!WARNING]
> The \`equals\` and \`assertEquals\` functions check for excess properties recursively. Objects with nested structures must not contain properties not defined in the nested descriptor.

## Using with Primitive Tags

The validation system integrates with tags for rich constraint checking:

\`\`\`ts
import { assert, tags } from '@zmdb/aot-validator';
import { validate } from '@zmdb/aot-validator';

const emailDescriptor = { kind: 'string', pattern: '^[^@]+@[^@]+$' };
const ageDescriptor = { kind: 'number', minimum: 21 };

// Using tags directly (for inline validation)
assert('user@example.com', { kind: 'string', pattern: '^[^@]+@[^@]+$' });

// Combining with validate() for programmatic flow
const result = validate({ email: 'bad', age: 17 }, {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 21 },
  },
});

if (!result.success) {
  // Handle errors gracefully
  console.log(result.errors);
}
\`\`\`

## AOT Inlining

In production with the AOT transformer, authored validation code like:

\`\`\`ts
// Authored source:
assert(value, { kind: 'string', pattern: '^\\\\d+$' });
\`\`\`

Becomes inlined at build time:

\`\`\`ts
// AOT output (no function call, no descriptor allocation):
(typeof value === 'string' && /^\\d+$/.test(value) ? value : (() => { throw ...; })())
\`\`\`

This eliminates all runtime validation overhead — the check becomes a simple boolean expression.

- [validate](./validators-validate.html) — non-throwing variant
- [is](./validators-tags.html) — boolean guard (no throws)
- [random](./random.html) — generate valid test data
`),

  'validators-validate': ok('validate()', 'Validation', `
The \`validate\` function performs non-throwing validation, returning a structured result object that indicates success or failure. Unlike \`assert\`, it never throws — making it ideal for scenarios where you need to handle validation failures gracefully without disrupting control flow.

> [!NOTE]
> The runtime validator uses a TypeDescriptor structure to describe expected types. In production with the AOT transformer enabled, the descriptor is inlined at build time, eliminating the runtime overhead entirely.

## Basic Usage

The \`validate\` function accepts an input value and a TypeDescriptor, returning \`{ success: boolean; data?: T; errors?: ValidationIssue[] }\`.

\`\`\`ts
import { validate, tags } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

const result = validate({ email: 'user@example.com', age: 25 }, descriptor);
// { success: true, data: { email: 'user@example.com', age: 25 } }

const invalid = validate({ email: 'invalid', age: 15 }, descriptor);
// { success: false, errors: [{ path: 'input.email', expected: 'pattern ...', value: 'invalid', message: 'expected pattern ...' }, ...] }
\`\`\`

## Error Structure

Each validation issue contains precise location information:

\`\`\`ts
interface ValidationIssue {
  readonly path: string;      // e.g., 'input.items[2].name'
  readonly expected: string;  // e.g., 'string', 'maxLength 50'
  readonly value: unknown;    // the actual invalid value
  readonly message: string;   // human-readable message
}
\`\`\`

When validating nested structures, the path reflects the exact location:

\`\`\`ts
const deepDescriptor = {
  kind: 'object',
  fields: {
    users: {
      kind: 'array',
      of: {
        kind: 'object',
        fields: {
          name: { kind: 'string', maxLength: 10 },
        },
      },
    },
  },
};

validate({ users: [{ name: 'LongNameTooLong' }] }, deepDescriptor);
// Error path: 'input.users[0].name' — shows array index + field
\`\`\`

## Using with Schema Definitions

Combine validation with schema-defined descriptors for type-safe validation:

\`\`\`ts
import { defineSchema, text, integer } from '@zmdb/schema-core';
import { validate } from '@zmdb/aot-validator';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+$')),
  age: integer().validate(tags.Minimum(18)),
});

// Extract descriptor from schema for validation
const descriptor = /* derived from schema */ {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

const result = validate({ email: 'test@test.com', age: 17 }, descriptor);
// result.success === false, result.errors?.[0].path === 'input.age'
\`\`\`

> [!TIP]
> In AOT mode, the descriptor is inlined at build time — the validate call becomes a straight-line type check with zero runtime descriptor allocation.

## Integration with Repository

The repository layer automatically validates inputs using the same validation system:

\`\`\`ts
class UserRepository extends BaseRepository<typeof UserSchema> {
  async create(data: CreateDTO<typeof UserSchema>) {
    // validate() is called internally before INSERT
    return super.create(data);
  }
}

const repo = new UserRepository(driver);
await repo.create({ email: 'new@example.com', age: 25 }); // OK
await repo.create({ email: 'bad', age: 10 }); // throws validation error
\`\`\`

- [assert](./validators-assert.html) — throwing variant
- [tags](./validators-tags.html) — validation rules (Minimum, Pattern, etc.)
- [unions-refinements](./unions-refinements.html) — union types and custom refinements
`),

  'validators-tags': ok('Special Tags', 'Validation', `
The validation tags system provides a declarative way to express constraints on primitive values. These tags (\`Minimum\`, \`Maximum\`, \`MinLength\`, \`MaxLength\`, \`Pattern\`, \`Enum\`) are building blocks that can be combined with schema definitions or used directly in validation code.

> [!TIP]
> Tags are the primitive constraint language — they compose with the \`validate()\` and \`assert()\` functions, and the AOT transformer inlines them to zero-overhead runtime checks.

## Available Tags

The \`@zmdb/aot-validator\` package exports a \`tags\` object with all validation rules:

\`\`\`ts
import { tags, validate } from '@zmdb/aot-validator';

tags.Minimum(18)    // number >= 18
tags.Maximum(100)   // number <= 100
tags.MinLength(1)   // string length >= 1
tags.MaxLength(255) // string length <= 255
tags.Pattern('^\\\\d+$') // matches regex
tags.Enum('admin', 'user', 'guest') // one of these values
\`\`\`

## Using Tags with Schema

Tags integrate directly with schema definitions:

\`\`\`ts
import { defineSchema, text, integer, jsonEnum } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text()
    .notNull()
    .validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$'))
    .validate(tags.MaxLength(255)),
  age: integer().validate(tags.Minimum(0)).validate(tags.Maximum(150)),
  role: jsonEnum(['admin', 'user', 'guest'])
    .notNull()
    .defaultTo('user'),
});
\`\`\`

\`\`\`sql
-- Generated DDL includes inline CHECK constraints where supported:
-- CREATE TABLE "users" (
--   "id" serial PRIMARY KEY,
--   "email" varchar(255) NOT NULL CHECK ("email" ~* '^[^@]+@[^@]+\\.[^@]+$'),
--   "age" integer CHECK ("age" >= 0 AND "age" <= 150),
--   "role" varchar CHECK ("role" IN ('admin', 'user', 'guest')) DEFAULT 'user'
-- );
\`\`\`

## Direct Validation with Tags

Tags can be used directly with the \`validate()\` function for ad-hoc validation:

\`\`\`ts
import { validate, tags } from '@zmdb/aot-validator';

// Validate a number is within range
validate(25, { kind: 'number', minimum: 18, maximum: 65 });

// Validate a string matches a pattern
validate('user@example.com', { kind: 'string', pattern: '^[^@]+@[^@]+$' });

// Validate an enum value
validate('admin', { kind: 'enum', values: ['admin', 'user', 'guest'] });
\`\`\`

> [!NOTE]
> The \`validate\` function from \`@zmdb/aot-validator\` takes a TypeDescriptor object, not individual tags. Use the schema's \`.validate()\` method to attach tags to columns.

## Tag Semantics

| Tag | Input Type | Constraint |
|-----|------------|------------|
| \`Minimum(n)\` | number | value >= n |
| \`Maximum(n)\` | number | value <= n |
| \`MinLength(n)\` | string | value.length >= n |
| \`MaxLength(n)\` | string | value.length <= n |
| \`Pattern(regex)\` | string | regex.test(value) |
| \`Enum(...values)\` | string | values.includes(value) |

## Runtime vs AOT

The runtime fallback validates by evaluating each tag rule:

\`\`\`ts
// Runtime fallback (what runs without AOT):
function validate(rule: Rule, expr: unknown): boolean {
  switch (rule.kind) {
    case 'Minimum':
      return typeof expr === 'number' && expr >= rule.args[0];
    case 'Pattern':
      return typeof expr === 'string' && new RegExp(rule.args[0]).test(expr);
    // ...
  }
}
\`\`\`

With AOT transformation enabled, the same validation becomes inlined:

\`\`\`ts
// Authored:
validate(tags.Minimum(18), userAge)

// AOT output:
(typeof userAge === "number" && userAge >= 18)
\`\`\`

> [!IMPORTANT]
> The AOT transformer currently inlines \`validate(tags.X(...), expr)\` calls. Complex compositions may still fall back to the runtime validator in some cases.

- [validate](./validators-validate.html) — non-throwing validation
- [assert](./validators-assert.html) — throwing validation
- [unions-refinements](./unions-refinements.html) — custom validation rules
`),

  'unions-refinements': ok('Unions, Refinements & Transforms', 'Validation', `
The validation system supports advanced composition through union types and custom refinements. Unions allow modeling "one of many" scenarios, while refinements enable arbitrary predicate-based validation beyond what tags provide.

> [!NOTE]
> These advanced features are designed for the AOT transformer — the runtime fallback evaluates them via \`evalRule()\`, but full AOT inlining unlocks maximum performance.

## Union Types

Use \`union()\` to create a validation rule that passes if any branch passes:

\`\`\`ts
import { union, refine, validateObject } from '@zmdb/aot-validator';

const stringOrNumber = union(
  { kind: 'string' },
  { kind: 'number' }
);

// validateObject evaluates the union:
const result = validateObject('hello', { value: stringOrNumber }, 'strip');
// { success: true, issues: [] }

const result2 = validateObject(true, { value: stringOrNumber }, 'strip');
// { success: false, issues: [{ path: 'input.value', ... }] }
\`\`\`

## Discriminated Unions

For tagged union patterns, use \`discriminated()\` to validate based on a discriminator key:

\`\`\`ts
import { discriminated, validateObject } from '@zmdb/aot-validator';

const paymentMethod = discriminated('type', {
  credit: { kind: 'object', fields: { cardNumber: { kind: 'string' } } },
  debit: { kind: 'object', fields: { bankCode: { kind: 'string' } } },
  cash: { kind: 'object', fields: {} },
});

const validPayment = {
  type: 'credit',
  cardNumber: '4111111111111111',
};

const result = validateObject(validPayment, { payment: paymentMethod }, 'strip');
// { success: true, issues: [] }
\`\`\`

## Custom Refinements

The \`refine()\` function creates a custom validation rule with an arbitrary predicate:

\`\`\`ts
import { refine, validateObject } from '@zmdb/aot-validator';

// Predicate source is a string that gets compiled to a function
const adultAge = refine('v >= 18', 'must be at least 18 years old');
const oddNumber = refine('v % 2 === 1', 'must be an odd number');

const result = validateObject({ age: 17 }, { age: adultAge }, 'strip');
// { success: false, issues: [{ path: 'input.age', expected: 'v >= 18', message: 'must be at least 18 years old' }] }
\`\`\`

> [!TIP]
> The predicate source string is what enables AOT inlining — the transformer can emit direct JavaScript rather than calling a runtime function.

## Transform Rules

Use \`transform()\` to apply a transformation during validation:

\`\`\`ts
import { transform, validateObject } from '@zmdb/aot-validator';

const trimAndLowercase = transform('v.trim().toLowerCase()');

const result = validateObject(
  { name: '  ALICE  ' },
  { name: transform('v.trim().toLowerCase()') },
  'strip'
);
// Result has { name: 'alice' } after transform applied
\`\`\`

## Strict Mode and Excess Properties

The third parameter to \`validateObject\` controls how excess properties are handled:

\`\`\`ts
import { validateObject } from '@zmdb/aot-validator';

const schema = {
  id: { kind: 'number' },
  name: { kind: 'string' },
};

// 'strip' — removes unknown properties (PostgreSQL default behavior)
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'strip');
// { success: true, issues: [], data: { id: 1, name: 'a' } }

// 'strict' — rejects unknown properties
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'strict');
// { success: false, issues: [{ path: 'input.extra', expected: 'no excess property', ... }] }

// 'passthrough' — allows unknown properties
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'passthrough');
// { success: true, issues: [], data: { id: 1, name: 'a', extra: 'x' } }
\`\`\`

## Branded Types (Nominal Typing)

Use the \`Brand\` type to create nominally-typed versions of base types:

\`\`\`ts
import { Brand } from '@zmdb/aot-validator';

type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

const userId: UserId = 123 as UserId;
const orderId: OrderId = 456 as OrderId;

// TypeScript sees these as distinct types
// But at runtime they are just numbers (zero footprint)
\`\`\`

> [!WARNING]
> Branded types are compile-time only — they erase to the base type at runtime. This is intentional for performance; use runtime checks if you need to validate brand at runtime.

- [validate](./validators-validate.html) — base validation
- [assert](./validators-assert.html) — throwing validation
- [json-schema](./json-schema.html) — JSON Schema generation
`),

  // ---------------- JSON & Serialization ----------------
  'json-stringify': ok('stringify()', 'JSON & Serialization', `
The \`stringify\` function serializes JavaScript values to JSON strings. It wraps \`JSON.stringify\` with consistent error handling and explicit bigint rejection — the AOT transformer will eventually emit fast concatenation for known shapes.

> [!IMPORTANT]
> Unlike \`JSON.stringify\`, \`stringify\` explicitly throws on bigint values. This is intentional — bigint serialization is database-dependent and should be handled explicitly by the caller.

## Basic Usage

\`\`\`ts
import { stringify } from '@zmdb/aot-validator';

const json = stringify({ name: 'alice', age: 30, active: true });
// '{"name":"alice","age":30,"active":true}'

const arr = stringify([1, 2, 3]);
// '[1,2,3]'

const nested = stringify({ user: { email: 'a@b.com' } });
// '{"user":{"email":"a@b.com"}}'
\`\`\`

## Working with Complex Types

\`\`\`ts
import { stringify } from '@zmdb/aot-validator';

// Arrays of objects
const users = stringify([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);
// '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]'

// Null and undefined handling (like JSON.stringify)
stringify(null);     // 'null'
stringify(undefined); // undefined (returns JSON.stringify result)

// Nested arrays
const matrix = stringify([[1, 2], [3, 4]]);
// '[[1,2],[3,4]]'
\`\`\`

## Bigint Handling

\`stringify\` throws a descriptive error for bigint values:

\`\`\`ts
import { stringify } from '@zmdb/aot-validator';

try {
  stringify({ id: 123n });
} catch (e) {
  // TypeError: Do not know how to serialize a BigInt
}
\`\`\`

> [!TIP]
> For PostgreSQL, use \`toString()\` on bigints before storing, or cast to \`text\` in your schema. The schema-core package provides the \`bigint\` column type for this purpose.

## Assert Stringify

The \`assertStringify\` function validates before serializing, throwing on invalid input:

\`\`\`ts
import { assertStringify } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

// Valid — returns JSON string
const json = assertStringify({ email: 'test@test.com', age: 25 }, descriptor);
// '{"email":"test@test.com","age":25}'

// Invalid — throws AssertError
try {
  assertStringify({ email: 'invalid', age: 15 }, descriptor);
} catch (e) {
  // AssertError with validation issues
}
\`\`\`

## Comparison with JSON.stringify

| Feature | JSON.stringify | stringify |
|---------|---------------|-----------|
| bigint | Serializes to empty object | Throws TypeError |
| Error objects | Converts to \`{}\` | Returns \`'{}'\` (standard JSON) |
| Circular references | Throws | Throws (same) |
| Custom replacer | Supported | Not supported (use JSON.stringify directly) |

## AOT Inlining

In AOT mode, \`stringify\` calls on known shapes become inline concatenation:

\`\`\`ts
// Authored:
const json = stringify({ name: user.name, age: user.age });

// AOT output (for known object shape):
const json = '{"name":' + JSON.stringify(user.name) + ',"age":' + JSON.stringify(user.age) + '}';
\`\`\`

This eliminates function call overhead for hot paths.

- [json-parse](./json-parse.html) — deserialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [openapi](./openapi.html) — OpenAPI spec generation
`),

  'json-parse': ok('parse()', 'JSON & Serialization', `
The \`parse\` function provides safe JSON parsing with structured error handling. Unlike \`JSON.parse()\` which throws on invalid JSON, \`parse\` returns a result object that indicates success or failure with detailed error information.

> [!NOTE]
> The \`parse\` function is the first step in the deserialize pipeline — it handles JSON syntax validation. For full type validation, use \`decode()\` which combines parsing with descriptor validation.

## Basic Usage

\`\`\`ts
import { parse } from '@zmdb/aot-validator';

const result = parse('{"name": "alice", "age": 30}');
// { success: true, data: { name: 'alice', age: 30 } }

const bad = parse('not valid json');
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', value: 'not valid json', message: 'Unexpected token o in JSON at position 0' }] }
\`\`\`

## Working with ParseResult

The \`ParseResult<T>\` type provides type-safe access to parsed data:

\`\`\`ts
import { parse } from '@zmdb/aot-validator';

interface User {
  name: string;
  age: number;
}

const result = parse<User>('{"name": "bob", "age": 25}');

if (result.success) {
  // TypeScript knows result.data is User
  console.log(result.data.name);
} else {
  // Handle parse error
  console.error(result.issues[0]?.message);
}
\`\`\`

## Error Handling

Parse errors include the original input and a helpful message:

\`\`\`ts
const result = parse('{"incomplete":');
// result.issues[0] contains:
// {
//   path: 'input',
//   expected: 'valid JSON',
//   value: '{"incomplete":',
//   message: 'Unexpected end of JSON input'
// }
\`\`\`

## Using decode for Parsing + Validation

The \`decode\` function combines parsing with type validation:

\`\`\`ts
import { decode } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

// Valid JSON + valid shape
const ok = decode('{"email": "test@example.com", "age": 25}', descriptor);
// { success: true, data: { email: 'test@example.com', age: 25 } }

// Valid JSON + invalid shape
const invalid = decode('{"email": "bad", "age": 15}', descriptor);
// { success: false, issues: [/* validation errors */] }

// Invalid JSON
const malformed = decode('not json', descriptor);
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', ... }] }
\`\`\`

> [!TIP]
> Use \`decode\` when you need to both parse JSON and validate its structure in one step. It's more efficient than calling \`parse\` then \`validate\` separately.

## Typed Decode

The \`decode\` function supports generic type parameters for full type safety:

\`\`\`ts
import { decode } from '@zmdb/aot-validator';

interface Order {
  id: number;
  status: 'pending' | 'shipped' | 'delivered';
  total: number;
}

const descriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    status: { kind: 'enum', values: ['pending', 'shipped', 'delivered'] },
    total: { kind: 'number', minimum: 0 },
  },
};

const result = decode<Order>('{"id": 1, "status": "shipped", "total": 99.99}', descriptor);

if (result.success) {
  // result.data is typed as Order
  console.log(result.data.status);
}
\`\`\`

## Integration with Repository

The repository layer uses these serialization functions when handling JSON columns:

\`\`\`ts
import { defineSchema, json } from '@zmdb/schema-core';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  // JSON column for flexible payload
  payload: json().notNull(),
});

// When reading, payload is automatically parsed
// When writing, object is automatically stringified
\`\`\`

- [json-stringify](./json-stringify.html) — serialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-validate](./validators-validate.html) — full validation
`),

  'json-schema': ok('JSON Schema', 'JSON & Serialization', `
The \`toJsonSchema\` function generates valid JSON Schema from zmdb schema definitions. This enables interoperability with tools that understand JSON Schema — validation libraries, API documentation systems, and code generation tools.

> [!NOTE]
> The schema generation is a build-time operation — it converts your TypeDescriptor into standard JSON Schema objects. There is no runtime reflection; the schema is derived from the declarative schema definition.

## Basic Generation

\`\`\`ts
import { defineSchema, text, integer, serial } from '@zmdb/schema-core';
import { toJsonSchema } from '@zmdb/schema-core/openapi';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().validate(tags.Minimum(0)),
});

const jsonSchema = toJsonSchema(UserSchema, 'entity');
\`\`\`

\`\`\`json
// Generated JSON Schema:
{
  "type": "object",
  "properties": {
    "id": { "type": "integer" },
    "email": { "type": "string" },
    "age": { "type": "integer", "minimum": 0 }
  },
  "required": ["id", "email", "age"]
}
\`\`\`

## Schema Variants

The second parameter controls which columns are included:

\`\`\`ts
// Entity (response) — all columns including auto-increment
toJsonSchema(UserSchema, 'entity');

// Create — excludes auto-increment columns
toJsonSchema(UserSchema, 'create');
// { type: 'object', properties: { email: {...}, age: {...} }, required: ['email'] }

// Update — all columns optional
toJsonSchema(UserSchema, 'update');
// { type: 'object', properties: { email: {...}, age: {...} }, required: [] }

// GET /list /search — same as entity (response)
toJsonSchema(UserSchema, 'get');
toJsonSchema(UserSchema, 'list');
toJsonSchema(UserSchema, 'search');
\`\`\`

> [!IMPORTANT]
> The \`create\` variant omits \`serial()\` (auto-increment) columns since those are generated by the database. The \`update\` variant marks all fields as optional since partial updates are allowed.

## Tag to JSON Schema Mapping

Validation tags map to JSON Schema keywords:

\`\`\`ts
import { tags } from '@zmdb/aot-validator';

// Minimum -> minimum
// Maximum -> maximum
// MinLength -> minLength
// MaxLength -> maxLength
// Pattern -> pattern
// Enum -> enum
\`\`\`

Generated schema includes these mappings:

\`\`\`ts
const schema = defineSchema('products', {
  name: text().validate(tags.MinLength(1)).validate(tags.MaxLength(100)),
  price: numeric().validate(tags.Minimum(0)),
  code: text().validate(tags.Pattern('^[A-Z]{3}$')),
  status: jsonEnum(['active', 'inactive']).notNull(),
});

const jsonSchema = toJsonSchema(schema, 'entity');
// {
//   "type": "object",
//   "properties": {
//     "name": { "type": "string", "minLength": 1, "maxLength": 100 },
//     "price": { "type": "number", "minimum": 0 },
//     "code": { "type": "string", "pattern": "^[A-Z]{3}$" },
//     "status": { "type": "string", "enum": ["active", "inactive"] }
//   },
//   "required": ["status", "name", "price", "code"]
// }
\`\`\`

## Nullable Handling

Nullable columns become union types in JSON Schema:

\`\`\`ts
const schema = defineSchema('profiles', {
  id: serial().primaryKey(),
  bio: text().nullable(),  // nullable column
  avatar: text(),           // required
});

const jsonSchema = toJsonSchema(schema, 'entity');
// {
//   "properties": {
//     "bio": { "type": ["string", "null"] },  // union with null
//     "avatar": { "type": "string" }
//   },
//   "required": ["id", "avatar"]
// }
\`\`\`

## Generating OpenAPI Components

Use \`toOpenApiComponents\` to generate a map of schemas for an entire API:

\`\`\`ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const schemas = toOpenApiComponents([UserSchema, OrderSchema, ProductSchema]);

// Returns: { schemas: { User: {...}, Order: {...}, Product: {...} } }
\`\`\`

\`\`\`json
// Output:
// {
//   "schemas": {
//     "User": { "type": "object", "properties": {...}, "required": [...] },
//     "Order": { "type": "object", "properties": {...}, "required": [...] },
//     "Product": { "type": "object", "properties": {...}, "required": [...] }
//   }
// }
\`\`\`

> [!TIP]
> The generated OpenAPI components can be directly merged into your OpenAPI spec's \`components.schemas\` field.

## List and Search Envelopes

For list/search responses, use \`toListSchema\` and \`toSearchSchema\`:

\`\`\`ts
import { toListSchema, toSearchSchema } from '@zmdb/schema-core/openapi';

const listSchema = toListSchema(UserSchema);
// {
//   "type": "object",
//   "properties": {
//     "items": { "type": "array", "items": <User schema> },
//     "total": { "type": "integer" },
//     "hasMore": { "type": "boolean" },
//     "cursor": { "type": "string" }
//   },
//   "required": ["hasMore", "items"]
// }

const searchSchema = toSearchSchema(UserSchema);
// Similar to list, but each item includes "_score" for FTS ranking
\`\`\`

- [openapi](./openapi.html) — OpenAPI spec integration
- [validators-tags](./validators-tags.html) — tag reference
- [json-parse](./json-parse.html) — parsing JSON
`),

  'openapi': ok('OpenAPI', 'JSON & Serialization', `
The OpenAPI generation system produces OpenAPI 3.x compatible component schemas from zmdb schema definitions. This enables automatic API documentation, client SDK generation, and validation layer interoperability.

> [!NOTE]
> OpenAPI schemas are derived at build time from your schema-core definitions. There's no runtime reflection — the generation is deterministic and happens during the build process.

## Generating Components

The \`toOpenApiComponents\` function generates a map of schemas ready for OpenAPI specification:

\`\`\`ts
import { defineSchema, text, integer, serial, jsonEnum } from '@zmdb/schema-core';
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
  age: integer().nullable(),
});

const { schemas } = toOpenApiComponents([UserSchema]);
\`\`\`

\`\`\`json
{
  "schemas": {
    "User": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "email": { "type": "string" },
        "role": { "type": "string", "enum": ["admin", "user"] },
        "age": { "type": ["integer", "null"] }
      },
      "required": ["id", "email", "role"]
    }
  }
}
\`\`\`

## DTO-Based Schema Generation

For API endpoints, generate schemas specific to each operation:

\`\`\`ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

// GET /users/{id} — single entity response
const getSchema = toJsonSchema(UserSchema, 'get');
// All fields required, includes auto-increment

// POST /users — create request
const createSchema = toJsonSchema(UserSchema, 'create');
// Excludes id (auto-increment), all fields required

// PATCH /users/{id} — update request
const updateSchema = toJsonSchema(UserSchema, 'update');
// All fields optional, excludes id

// GET /users — list response (includes pagination envelope)
import { toListSchema } from '@zmdb/schema-core/openapi';
const listSchema = toListSchema(UserSchema);
\`\`\`

> [!IMPORTANT]
> The \`get\`, \`list\`, and \`search\` variants include auto-increment columns since those are present in responses. The \`create\` variant excludes them because the database generates them.

## Integration with Express/Fastify

Combine OpenAPI generation with your HTTP framework:

\`\`\`ts
import { defineSchema, text, integer, serial } from '@zmdb/schema-core';
import { toJsonSchema, toListSchema } from '@zmdb/schema-core/openapi';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
});

// Endpoint definitions with OpenAPI schema
const routes = [
  {
    method: 'GET',
    path: '/users',
    schema: {
      response: {
        200: toListSchema(UserSchema),
      },
    },
    handler: async (req, reply) => {
      return repo.findAll();
    },
  },
  {
    method: 'GET',
    path: '/users/{id}',
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      response: { 200: toJsonSchema(UserSchema, 'get') },
    },
    handler: async (req, reply) => {
      return repo.findById(req.params.id);
    },
  },
];
\`\`\`

## Validation Tag Mapping

Tags in your schema map to OpenAPI schema keywords:

| Tag | OpenAPI Keyword | Example |
|-----|-----------------|---------|
| \`Minimum(n)\` | \`minimum\` | \`{ "minimum": 0 }\` |
| \`Maximum(n)\` | \`maximum\` | \`{ "maximum": 100 }\` |
| \`MinLength(n)\` | \`minLength\` | \`{ "minLength": 1 }\` |
| \`MaxLength(n)\` | \`maxLength\` | \`{ "maxLength": 255 }\` |
| \`Pattern(regex)\` | \`pattern\` | \`{ "pattern": "^\\\\d+$" }\` |
| \`Enum(...vals)\` | \`enum\` | \`{ "enum": ["a", "b"] }\` |

\`\`\`ts
const UserSchema = defineSchema('users', {
  email: text()
    .notNull()
    .validate(tags.Pattern('^[^@]+@[^@]+\\\\.[^@]+$'))
    .validate(tags.MaxLength(255)),
  age: integer().validate(tags.Minimum(0)),
});

const schema = toJsonSchema(UserSchema, 'entity');
// email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$', maxLength: 255 }
// age: { type: 'integer', minimum: 0 }
\`\`\`

## Full OpenAPI Spec Generation

Generate a complete spec by combining components:

\`\`\`ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const fullSpec = {
  openapi: '3.0.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        responses: {
          200: {
            description: 'User list',
            content: {
              'application/json': {
                schema: toListSchema(UserSchema),
              },
            },
          },
        },
      },
      post: {
        summary: 'Create user',
        requestBody: {
          content: {
            'application/json': {
              schema: toJsonSchema(UserSchema, 'create'),
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: toJsonSchema(UserSchema, 'entity'),
              },
            },
          },
        },
      },
    },
  },
  components: toOpenApiComponents([UserSchema]),
};
\`\`\`

> [!TIP]
> The generated spec can be exported as JSON/YAML and fed into tools like Swagger UI, Redoc, or OpenAPI Generator for client SDKs.

## Search Schema (Full-Text Search)

For full-text search endpoints, use \`toSearchSchema\` which includes relevance scoring:

\`\`\`ts
import { toSearchSchema } from '@zmdb/schema-core/openapi';

const searchSchema = toSearchSchema(UserSchema);
// {
//   "type": "object",
//   "properties": {
//     "items": {
//       "type": "array",
//       "items": {
//         "type": "object",
//         "properties": {
//           "id": { "type": "integer" },
//           "name": { "type": "string" },
//           ...
//           "_score": { "type": "number" }  // FTS ranking
//         },
//         "required": ["id", "name", ...]
//       }
//     },
//     "total": { "type": "integer" },
//     "hasMore": { "type": "boolean" },
//     "cursor": { "type": "string" }
//   },
//   "required": ["hasMore", "items"]
// }
\`\`\`

- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-tags](./validators-tags.html) — validation tags
- [random](./random.html) — test data generation
`),

  'random': ok('Random Generator', 'JSON & Serialization', `
The \`random\` function generates sample values that satisfy a TypeDescriptor by construction. This is invaluable for testing — you get valid test data without manually constructing fixtures, and the generated values respect all constraints (minimum values, patterns, enums, etc.).

> [!NOTE]
> The generated values are *valid* according to the descriptor — \`is(random(descriptor), descriptor) === true\`. However, they are not *deterministic* (except when seeding is added in a future version).

## Basic Usage

\`\`\`ts
import { random, is } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    name: { kind: 'string', maxLength: 20 },
    age: { kind: 'number', minimum: 18 },
    active: { kind: 'boolean' },
  },
};

const sample = random(descriptor);
// { name: 'sabc123', age: 42, active: true }

// Verify it's valid
is(sample, descriptor); // true
\`\`\`

## Generating Primitive Values

\`\`\`ts
import { random } from '@zmdb/aot-validator';

// String with maxLength
random({ kind: 'string', maxLength: 10 }); // 'sabc1234'

// Number with minimum
random({ kind: 'number', minimum: 100 }); // 150 (minimum + random offset)

// Boolean
random({ kind: 'boolean' }); // true or false

// Enum
random({ kind: 'enum', values: ['admin', 'user', 'guest'] }); // 'user'
\`\`\`

## Generating Complex Structures

\`\`\`ts
import { random } from '@zmdb/aot-validator';

// Array of objects
const users = random({
  kind: 'array',
  of: {
    kind: 'object',
    fields: {
      id: { kind: 'number', minimum: 1 },
      email: { kind: 'string' },
    },
  },
});
// [{ id: 5, email: 'sabc123@example.com' }, { id: 12, ... }, ...]

// Nested objects
const order = random({
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    items: {
      kind: 'array',
      of: {
        kind: 'object',
        fields: {
          productId: { kind: 'number' },
          quantity: { kind: 'number', minimum: 1 },
        },
      },
    },
  },
});
\`\`\`

> [!TIP]
> The array generator creates between 1-3 elements by default. This provides realistic array shapes for testing without extreme edge cases.

## Pattern Handling

For strings with patterns, the generator recognizes common patterns:

\`\`\`ts
import { random } from '@zmdb/aot-validator';

// Email pattern — generates valid-looking email
random({ kind: 'string', pattern: '^[^@]+@[^@]+$' });
// 'user123@example.com'

// Other patterns — falls back to safe single character
random({ kind: 'string', pattern: '^[A-Z]{3}$' });
// 'x' (fallback for unknown patterns)
\`\`\`

> [!WARNING]
> Complex patterns that aren't email-like fall back to a single character \`'x'\`. This ensures the generated value is always a string, even if it doesn't match the pattern perfectly.

## Using with Schema

Generate test data from schema definitions:

\`\`\`ts
import { defineSchema, text, integer, serial } from '@zmdb/schema-core';

// Define your schema
const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull().validate(tags.MaxLength(100)),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+$')),
  age: integer().validate(tags.Minimum(0)),
});

// Generate a random user (manually constructing descriptor from schema info)
const sampleUser = random({
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    name: { kind: 'string', maxLength: 100 },
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 0 },
  },
});
// { id: 42, name: 'sabc123', email: 'user456@example.com', age: 25 }
\`\`\`

## Integration with Testing

Use \`random\` to generate fixtures in tests:

\`\`\`ts
import { random, is, assertEquals } from '@zmdb/aot-validator';

describe('UserRepository', () => {
  const userDescriptor = {
    kind: 'object',
    fields: {
      email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
      name: { kind: 'string', maxLength: 50 },
      age: { kind: 'number', minimum: 18 },
    },
  };

  it('creates valid users', async () => {
    const input = random(userDescriptor);
    
    // Generated data is guaranteed valid
    is(input, userDescriptor); // true
    
    const created = await repo.create(input);
    
    // Verify round-trip
    assertEquals(created, userDescriptor);
  });

  it('rejects invalid input', async () => {
    const invalid = { email: 'not-email', name: 'x'.repeat(100), age: 15 };
    
    await expect(repo.create(invalid)).rejects.toThrow();
  });
});
\`\`\`

## Generated Value Ranges

| Type | Range/Behavior |
|------|----------------|
| \`number\` | \`minimum\` (or 0) + random(0-1000) |
| \`string\` | \`'s' + randomHex\` or email-like if pattern contains \`@\` |
| \`boolean\` | 50/50 true/false |
| \`enum\` | Random selection from values array |
| \`array\` | 1-3 elements, each recursively generated |
| \`object\` | All fields generated recursively |

> [!IMPORTANT]
> Generated values are *structurally valid* but not *meaningful* — a random email looks like an email but isn't a real address. Use for testing validation, not for seeding production data.

## Random for Fuzzing

Combine with property-based testing:

\`\`\`ts
import { random, is, validate } from '@zmdb/aot-validator';

// Generate many random inputs
for (let i = 0; i < 1000; i++) {
  const input = random(complexDescriptor);
  
  // Should always pass validation
  const result = validate(input, complexDescriptor);
  if (!result.success) {
    console.error('Generated invalid input:', input, result.errors);
  }
}
\`\`\`

- [validators-validate](./validators-validate.html) — validation
- [validators-assert](./validators-assert.html) — assertion
- [json-parse](./json-parse.html) — JSON parsing
`),

  // ---------------- Advanced ----------------
  'custom-types': ok('Custom Types & Codecs', 'Advanced', `
Custom types let you define domain-specific types with bidirectional encoding/decoding between your TypeScript runtime and the database. zmdb treats custom types as first-class citizens — they're not ORM magic but explicit contracts between your app and the database.

## Defining a Custom Type

Use \`defineType\` to create a custom type with explicit \`toDb\` and \`fromDb\` functions. The type is immutable and frozen — safe to share across your application.

\`\`\`ts
import { defineType, encodeValue, decodeValue } from '@zmdb/schema-core';

interface Money {
  amount: number;
  currency: string;
}

const MoneyType = defineType<Money, string>({
  sqlType: 'VARCHAR(50)',
  toDb: (m) => \`\${m.amount}:\${m.currency}\`,
  fromDb: (s) => {
    const [amount, currency] = s.split(':');
    return { amount: Number(amount), currency };
  },
});

// Usage
const dbValue = encodeValue(MoneyType, { amount: 100, currency: 'USD' });
// dbValue => "100:USD"

const appValue = decodeValue(MoneyType, '100:USD');
// appValue => { amount: 100, currency: 'USD' }
\`\`\`

> [!TIP]
> Keep \`toDb\` and \`fromDb\` as pure functions — no side effects. This ensures predictable behavior during serialization and deserialization.

## Using Custom Types in Schemas

Reference your custom type in a column definition. The \`sqlType\` becomes the DDL; the codec functions handle runtime conversion.

\`\`\`ts
import { defineSchema, text, defineType } from '@zmdb/schema-core';

const MoneyType = defineType<Money, string>({
  sqlType: 'VARCHAR(50)',
  toDb: (m) => \`\${m.amount}:\${m.currency}\`,
  fromDb: (s) => {
    const [amount, currency] = s.split(':');
    return { amount: Number(amount), currency };
  },
});

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  total: text().customType(MoneyType).notNull(),
});
\`\`\`

Generated DDL:

\`\`\`sql
CREATE TABLE "orders" (
  "id" SERIAL PRIMARY KEY,
  "total" VARCHAR(50) NOT NULL
)
\`\`\`

## JSON/Enum Variants

For complex enums or JSON columns, custom types shine. You can store structured data as JSON while maintaining type safety in your domain model.

\`\`\`ts
interface Priority {
  level: 'low' | 'medium' | 'high';
  escalated: boolean;
}

const PriorityType = defineType<Priority, string>({
  sqlType: 'JSONB',
  toDb: (p) => JSON.stringify(p),
  fromDb: (raw) => JSON.parse(raw) as Priority,
});

const TaskSchema = defineSchema('tasks', {
  id: serial().primaryKey(),
  priority: text().customType(PriorityType).notNull(),
});
\`\`\`

## Type Safety Guarantees

Custom types provide compile-time guarantees. If your \`toDb\` returns \`DB\` and \`fromDb\` accepts \`DB\`, the type system ensures you never accidentally pass raw values where decoded types are expected.

\`\`\`ts
// This compiles — types align
const encoded = encodeValue(MoneyType, { amount: 50, currency: 'EUR' });

// This fails — fromDb expects string, not number
// decodeValue(MoneyType, 42); // Type error
\`\`\`

> [!IMPORTANT]
> Custom types do NOT add runtime validation. If the database returns malformed data, \`fromDb\` will throw. Pair custom types with \`@zmdb/aot-validator\` for full runtime safety.

---

See also: [Schema Core](./schema-declaration.html) · [Validation](./validators-is.html) · [DTO Helpers](./read-dtos.html)
`),
  'set-operations': ok('Set Operations', 'Advanced', `
Set operations combine result sets from multiple queries — UNION, INTERSECT, and EXCEPT. Batch executes multiple statements in a single round-trip. zmdb's query compiler exposes both primitives directly, giving you full control over SQL generation.

## UNION / UNION ALL

Combine rows from two or more SELECT statements. Use \`union\` for distinct rows, \`unionAll\` to keep duplicates.

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query1 = compiler
  .selectFrom('users')
  .select(['id', 'name'])
  .where('active', '=', true)
  .compile();

const query2 = compiler
  .selectFrom('archived_users')
  .select(['id', 'name'])
  .compile();

import { setOperation, union } from '@zmdb/query-compiler/set-ops';

const combined = setOperation('union', [query1, query2], 'postgres');

// combined.text => SELECT ... UNION SELECT ...
// combined.parameters => [...]
\`\`\`

## INTERSECT & EXCEPT

\`INTERSECT\` returns rows present in both queries. \`EXCEPT\` returns rows from the first query that aren't in the second.

\`\`\`ts
import { setOperation } from '@zmdb/query-compiler/set-ops';

// Active users who have placed orders
const activeWithOrders = setOperation('intersect', [activeUsersQuery, ordersQuery], 'postgres');

// Users who have never ordered
const neverOrdered = setOperation('except', [allUsersQuery, ordersQuery], 'postgres');
\`\`\`

> [!NOTE]
> All queries in a set operation must have the same column count and compatible types. The query compiler doesn't validate this — your database will reject mismatched unions.

## Batch Execution

When you need to run multiple independent statements in one database round-trip, use \`batch\`. This is useful for bulk inserts, multi-table updates, or running migrations.

\`\`\`ts
import { batch, createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const stmt1 = compiler
  .insertInto('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .compile();

const stmt2 = compiler
  .insertInto('users')
  .values({ name: 'Bob', email: 'bob@example.com' })
  .compile();

const batchHandle = batch([stmt1, stmt2]);

// Execute against your driver
const results = await batchHandle.execute(async (statements) => {
  // Run all statements in a single transaction or call
  return driver.executeMulti(statements);
});
\`\`\`

Generated SQL (parameterized):

\`\`\`sql
INSERT INTO "users" ("name", "email") VALUES ($1, $2);
INSERT INTO "users" ("name", "email") VALUES ($3, $4);
-- Parameters: ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
\`\`\`

## Parameter Renumbering

The query compiler automatically renumbers positional parameters (\`$1\`, \`$2\`, ...) when combining queries. This ensures parameters remain valid across the combined statement.

\`\`\`ts
// Two queries with overlapping parameter positions
const q1 = compiler.selectFrom('orders').where('user_id', '=', 1).compile();
const q2 = compiler.selectFrom('products').where('category_id', '=', 2).compile();

// After union, q1's $1 stays $1, q2's $1 becomes $3
const combined = setOperation('union', [q1, q2], 'postgres');
// combined.parameters => [1, 2] (assuming q2 had one param)
\`\`\`

> [!WARNING]
> Batch does NOT guarantee transaction semantics by default. Wrap in a transaction if you need atomicity.

---

See also: [Query Compiler](./select.html) · [Repository](./repository.html) · [Migrations](./migrations.html)
`),
  'lifecycle-hooks': ok('Lifecycle Hooks & Events', 'Advanced', `
Lifecycle hooks let you react to entity events — beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete. zmdb's EventBus provides a simple pub/sub mechanism for injecting behavior into your repository operations without coupling to the data layer.

## The EventBus

The \`EventBus\` is a simple event emitter with subscription management. Subscribe to events, return an unsubscribe function to clean up.

\`\`\`ts
import { EventBus, type LifecycleEvent } from '@zmdb/repository';

const bus = new EventBus();

// Subscribe to beforeCreate
const unsub = bus.subscribe({
  on: 'beforeCreate',
  run: async (ctx: unknown) => {
    console.log('About to create:', ctx);
    // Add timestamps, generate slugs, etc.
  },
});

// Later: unsubscribe
unsub();
\`\`\`

## Hooks in the Repository

Inject the EventBus into your repository to trigger events around CRUD operations.

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';
import { EventBus, type LifecycleEvent } from '@zmdb/repository';

const eventBus = new EventBus();

class UserRepository extends BaseRepository<typeof UserSchema> {
  protected eventBus = eventBus;

  async create(data: CreateDTO<typeof UserSchema>) {
    await this.eventBus.emit('beforeCreate', data);
    const result = await super.create(data);
    await this.eventBus.emit('afterCreate', result);
    return result;
  }

  async update(id: number, data: UpdateDTO<typeof UserSchema>) {
    await this.eventBus.emit('beforeUpdate', { id, data });
    const result = await super.update(id, data);
    await this.eventBus.emit('afterUpdate', result);
    return result;
  }

  async delete(id: number) {
    await this.eventBus.emit('beforeDelete', { id });
    await super.delete(id);
    await this.eventBus.emit('afterDelete', { id });
  }
}
\`\`\`

## Use Cases

### Audit Logging

\`\`\`ts
bus.subscribe({
  on: 'afterCreate',
  run: async (ctx) => {
    await auditLog.insert({
      action: 'create',
      entity: 'user',
      data: ctx,
      timestamp: new Date(),
    });
  },
});
\`\`\`

### Soft Deletes

\`\`\`ts
bus.subscribe({
  on: 'beforeDelete',
  run: async (ctx: { id: number }) => {
    // Mark as deleted instead of removing
    await this.update(ctx.id, { deletedAt: new Date() } as any);
    // Prevent actual deletion
    throw new Error('Soft delete: operation intercepted');
  },
});
\`\`\`

> [!TIP]
> Hooks can be async. The repository waits for all handlers to complete before proceeding. Keep handlers fast — database calls in hooks add latency to every CRUD operation.

## Multiple Subscribers

Multiple subscribers can listen to the same event. They're executed in registration order.

\`\`\`ts
bus.subscribe({ on: 'beforeCreate', run: () => console.log('First') });
bus.subscribe({ on: 'beforeCreate', run: () => console.log('Second') });
// Output: "First" then "Second"
\`\`\`

> [!IMPORTANT]
> If a hook throws, the operation is aborted. For \`before*\` hooks, the CRUD operation never happens. For \`after*\` hooks, the data is already persisted — handle failures gracefully (e.g., log and rethrow).

---

See also: [Repository](./repository.html) · [Embeddables](./embeddables.html) · [Transactions](./transactions.html)
`),
  'embeddables': ok('Embeddables', 'Advanced', `
Embeddables let you compose complex value objects from multiple columns. Instead of storing a JSON blob, you get flat columns with type-safe access. zmdb provides \`flattenEmbeddable\` and \`liftEmbeddable\` utilities to transform between the flat database representation and nested TypeScript objects.

## Embedding a Value Object

Define an embeddable as a TypeScript interface, then use helper functions to map between flat and nested representations.

\`\`\`ts
import { defineSchema, serial, text, json } from '@zmdb/schema-core';
import { flattenEmbeddable, liftEmbeddable } from '@zmdb/repository';

interface Address {
  street: string;
  city: string;
  zip: string;
  country: string;
}

// No separate schema — just a type you compose
type AddressEmbed = {
  street: string;
  city: string;
  zip: string;
  country: string;
};

const CustomerSchema = defineSchema('customers', {
  id: serial().primaryKey(),
  name: text().notNull(),
  // Embed as separate columns
  address_street: text().notNull(),
  address_city: text().notNull(),
  address_zip: text().notNull(),
  address_country: text().notNull(),
});

// Flatten for inserts/updates
function toDbAddress(addr: Address): Record<string, unknown> {
  return flattenEmbeddable('address', addr);
}

// Lift from database rows
function fromDbAddress(row: Record<string, unknown>): Address {
  return liftEmbeddable('address', row) as Address;
}

// Usage in repository
class CustomerRepository extends BaseRepository<typeof CustomerSchema> {
  async createWithAddress(data: { name: string; address: Address }) {
    const flat = { name: data.name, ...toDbAddress(data.address) };
    return this.create(flat);
  }

  async findById(id: number) {
    const row = await super.findById(id);
    if (!row) return null;
    return { ...row, address: fromDbAddress(row) };
  }
}
\`\`\`

Generated DDL:

\`\`\`sql
CREATE TABLE "customers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address_street" TEXT NOT NULL,
  "address_city" TEXT NOT NULL,
  "address_zip" TEXT NOT NULL,
  "address_country" TEXT NOT NULL
)
\`\`\`

## JSON-Based Embeddables

For complex nested structures, store as JSON. The schema still defines each field explicitly for validation, but you can nest the type in TypeScript.

\`\`\`ts
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  // Single JSON column for complex embed
  metadata: json().notNull(),
});

// Type-safe access via projection
type OrderMetadata = {
  source: string;
  priority: number;
  tags: string[];
};
\`\`\`

> [!NOTE]
> Embeddables are a modeling pattern, not a database feature. You choose between flat columns (better indexability, SQL compatibility) or JSON (flexibility, nested structure). Both work with zmdb.

## Validation Integration

Embeddables integrate with \`@zmdb/aot-validator\`. Define the embeddable type, then validate it using the AOT inlined validators.

\`\`\`ts
import { is, assert, validate } from '@zmdb/aot-validator';

// Inline the embeddable schema
const AddressValidator = is(
  object({
    street: string,
    city: string,
    zip: string,
    country: string,
  })
);

// Validate incoming data
const result = validate(AddressValidator, incomingAddress);
if (!result.success) {
  throw new Error(result.errors.join(', '));
}
\`\`\`

> [!TIP]
> Keep embeddables as value objects — immutable, compared by value. They're not entities with identity.

---

See also: [Schema Core](./schema-declaration.html) · [Lifecycle Hooks](./lifecycle-hooks.html) · [Validation](./validators-is.html)
`),
  'inheritance': ok('Inheritance Mapping', 'Advanced', `
Inheritance lets you model entity hierarchies in a single database table using a discriminator column. zmdb provides \`SingleTableInheritance\` utilities to map rows to their correct subtypes at runtime.

## Single Table Inheritance

Store all subtypes in one table with a discriminator column. Each subtype has a subset of columns that apply to it.

\`\`\`ts
import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import { rowToSubtype, discriminatorFor } from '@zmdb/repository';

// Base event type
const EventSchema = defineSchema('events', {
  id: serial().primaryKey(),
  // Discriminator column
  type: text().notNull(),
  // Common fields
  created_at: timestamp().notNull(),
  // Type-specific fields (nullable in DB, populated per-type)
  title: text(),           // For "concert"
  venue: text(),           // For "concert"
  artist: text(),          // For "concert"
  opponent: text(),        // For "game"
  home_score: integer(),   // For "game"
  away_score: integer(),   // For "game"
});

// Define inheritance map
const sti = {
  discriminator: 'type',
  map: {
    concert: ['title', 'venue', 'artist'],
    game: ['opponent', 'home_score', 'away_score'],
  },
} as const;

// Map row to correct subtype
type Concert = { type: 'concert'; title: string; venue: string; artist: string };
type Game = { type: 'game'; opponent: string; home_score: number; away_score: number };
type Event = Concert | Game;

// In your repository
class EventRepository extends BaseRepository<typeof EventSchema> {
  findById(id: number) {
    return super.findById(id).then(row => {
      if (!row) return null;
      return rowToSubtype(sti, row) as Event;
    });
  }
}
\`\`\`

Generated DDL:

\`\`\`sql
CREATE TABLE "events" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL,
  "title" TEXT,
  "venue" TEXT,
  "artist" TEXT,
  "opponent" TEXT,
  "home_score" INTEGER,
  "away_score" INTEGER
)
\`\`\`

## Discriminator Values

Use \`discriminatorFor\` to generate the correct discriminator value for a subtype.

\`\`\`ts
import { discriminatorFor } from '@zmdb/repository';

const disc = discriminatorFor(sti, 'concert');
// disc => 'concert'

// Usage in create
async function createConcert(data: Omit<Concert, 'type'>) {
  return this.create({
    type: disc,
    ...data,
  });
}
\`\`\`

## Querying Subtypes

Query the base table and filter by discriminator to get specific subtypes.

\`\`\`ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

// Get all concerts
const concerts = compiler
  .selectFrom('events')
  .select(['id', 'title', 'venue', 'artist'])
  .where('type', '=', 'concert')
  .compile();

// concerts.text => SELECT ... WHERE "type" = $1
// concerts.parameters => ['concert']
\`\`\`

> [!NOTE]
> Inheritance in zmdb is a runtime pattern, not a database constraint. You must ensure data integrity (e.g., correct discriminator values) in your application code.

## Polymorphic Relations

Use the discriminator to route to the correct handler for polymorphic associations.

\`\`\`ts
async function handleEventAttachment(eventRow: Record<string, unknown>) {
  const { type, data } = rowToSubtype(sti, eventRow);

  switch (type) {
    case 'concert':
      return sendConcertNotification(data as Concert);
    case 'game':
      return updateScoreboard(data as Game);
  }
}
\`\`\`

> [!TIP]
> Keep discriminator columns indexed for efficient filtering. Add a partial index if your DB supports it (e.g., \`WHERE type IS NOT NULL\`).

---

See also: [Repository](./repository.html) · [Embeddables](./embeddables.html) · [Schema Core](./schema-declaration.html)
`),

  // ---------------- Integrations ----------------
  'drivers': ok('Drivers', 'Integrations', `
Drivers are zmdb's abstraction over database connections. A Driver is a simple interface — just an \`execute\` method that runs compiled SQL. zmdb ships **first-party adapters** so you don't have to write one, and the interface stays open for any other database.

## First-party drivers

\`\`\`ts
// node:sqlite — zero external dependencies
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';

const db = new DatabaseSync('app.db');
const users = new UserRepository(sqliteDriver(db), 'sqlite');
\`\`\`

\`\`\`ts
// pg (node-postgres)
import { Pool } from 'pg';
import { pgDriver } from '@zmdb/repository/drivers/pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const users = new UserRepository(pgDriver(pool), 'postgres');

// opt-in server-side prepared statements (caches the query plan):
const fast = pgDriver(pool, { prepared: true });
\`\`\`

> [!TIP]
> \`pg\` is an optional dependency — install it only if you use the pg driver. The
> sqlite driver uses the built-in \`node:sqlite\`, so a zero-dependency setup works
> out of the box. Prepared statements are opt-in to preserve the zero-state
> default (see the [benchmarks](../benchmarks/index.html) tail-latency note).

## The Driver Interface

\`\`\`ts
import type { CompiledQuery } from '@zmdb/query-compiler';

export interface Driver {
  execute(query: CompiledQuery): Promise<unknown>;
}
\`\`\`

A driver receives compiled SQL (text + parameters) and returns the raw database result. There's no ORM-layer magic — you control exactly what runs against your database.

## Implementing your own driver

Implement the interface for any other database. Here's a minimal node:sqlite driver:

\`\`\`ts
import Database from 'better-sqlite3';
import type { Driver } from '@zmdb/query-compiler';

class SqliteDriver implements Driver {
  constructor(private db: Database.Database) {}

  async execute(query: CompiledQuery) {
    const stmt = this.db.prepare(query.text);
    return stmt.all(...query.parameters);
  }
}

// Usage
const db = new Database('app.db');
const driver = new SqliteDriver(db);
\`\`\`

For PostgreSQL with \`pg\`:

\`\`\`ts
import { Pool } from 'pg';
import type { Driver, CompiledQuery } from '@zmdb/query-compiler';

class PgDriver implements Driver {
  constructor(private pool: Pool) {}

  async execute(query: CompiledQuery) {
    const result = await this.pool.query(query.text, query.parameters);
    return result.rows;
  }
}
\`\`\`

## Using Drivers with Repositories

Pass the driver when instantiating your repository:

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static schema = UserSchema;
}

const repo = new UserRepository(driver);

// All CRUD methods use the driver
const users = await repo.findAll();
\`\`\`

> [!NOTE]
> The driver is responsible for connection lifecycle, pooling, and transaction management. zmdb doesn't manage connections — you bring your own pool.

## Transactions

Wrap operations in a transaction using your driver's native transaction support:

\`\`\`ts
async function transferFunds(fromId: number, toId: number, amount: number) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Deduct from sender
    await driver.execute(
      compiler.update('accounts')
        .set({ balance: { $expr: 'balance - $1' } })
        .where('id', '=', fromId)
        .compile()
    );
    
    // Add to receiver
    await driver.execute(
      compiler.update('accounts')
        .set({ balance: { $expr: 'balance + $1' } })
        .where('id', '=', toId)
        .compile()
    );
    
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
\`\`\`

## Connection String Parsing

If your driver expects a connection string, parse it yourself — zmdb doesn't include connection string utilities. Use \`pg-connection-string\` or similar for PostgreSQL, or \`url\` from Node's built-in module:

\`\`\`ts
import { URL } from 'url';

function parsePgUrl(connStr: string) {
  const u = new URL(connStr);
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432'),
    database: u.pathname.slice(1),
    user: u.username,
    password: u.password,
  };
}
\`\`\`

> [!TIP]
> Use environment variables or a config file for connection strings. Never hardcode credentials in source.

---

See also: [Repository](./repository.html) · [Read Replicas](./read-replicas.html) · [Query Compiler](./select.html)
`),

  'framework-integrations': ok('Framework Integrations', 'Integrations', `
zmdb is framework-agnostic — it doesn't depend on Express, Hono, Fastify, or any other web framework. The \`makeEndpoint\` utility provides a thin adapter layer that converts your repository into an HTTP handler. Each framework wraps this in 1-2 lines.

## The Endpoint Handler

\`\`\`ts
import { makeEndpoint, type Handler, type EndpointResult } from '@zmdb/repository';

interface CreateUserInput {
  name: string;
  email: string;
}

const handler: Handler<CreateUserInput, User> = {
  validate: (raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid input');
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string') throw new Error('name required');
    if (typeof r.email !== 'string') throw new Error('email required');
    return r as CreateUserInput;
  },
  handle: async (input) => {
    return repo.create(input);
  },
};

const endpoint = makeEndpoint(handler);
// endpoint: (raw: unknown) => Promise<EndpointResult>
\`\`\`

## Express

\`\`\`ts
import express from 'express';

const app = express();
app.use(express.json());

app.post('/users', async (req, res) => {
  const result = await endpoint(req.body);
  res.status(result.status).send(result.body);
});
\`\`\`

## Hono

\`\`\`ts
import { Hono } from 'hono';

const app = new Hono();
app.post('/users', async (c) => {
  const result = await endpoint(await c.req.json());
  return c.body(result.body, result.status);
});
\`\`\`

## tRPC

\`\`\`ts
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();
export const appRouter = t.router({
  createUser: t.procedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(({ input }) => endpoint(input)),
});
\`\`\`

## NestJS

\`\`\`ts
import { Controller, Post, Body } from '@nestjs/common';

@Controller('users')
class UserController {
  @Post()
  async create(@Body() body: unknown) {
    const result = await endpoint(body);
    return JSON.parse(result.body);
  }
}
\`\`\`

> [!NOTE]
> The \`validate\` function should parse and validate input. Use \`@zmdb/aot-validator\` for compile-time inlined validation — zero runtime overhead.

## Serialization

The endpoint returns \`{ status: number; body: string }\`. Customize serialization by adding a \`serialize\` method to your handler:

\`\`\`ts
const handler: Handler<Input, Output> = {
  validate: /* ... */,
  handle: /* ... */,
  serialize: (out) => JSON.stringify(out), // default
  // Or use a custom serializer
  // serialize: (out) => YAML.stringify(out),
};
\`\`\`

> [!TIP]
> Keep handlers thin — delegate to your repository. The endpoint layer should only handle HTTP concerns (parsing, serialization, status codes).

---

See also: [Repository](./repository.html) · [Validation](./validators-is.html) · [DTO Helpers](./read-dtos.html)
`),
  'llm-function-calling': ok('LLM Function Calling', 'Integrations', `
zmdb can generate tool definitions from your schema for LLM function-calling. The \`toolFromSchema\` function converts your schema into a JSON Schema that describes the tool's parameters, enabling LLMs to call your repository methods with type-safe inputs.

## Generating Tool Specs

\`\`\`ts
import { toolFromSchema, type ToolSpec } from '@zmdb/schema-core/llm';
import { toJsonSchema } from '@zmdb/schema-core';

const spec: ToolSpec = toolFromSchema('createUser', UserSchema, {
  description: 'Create a new user in the system',
});

// spec.name => 'createUser'
// spec.description => 'Create a new user in the system'
// spec.parameters => JsonSchemaObject (OpenAPI-compatible)
\`\`\`

The generated spec follows the OpenAPI 3.0 JSON Schema format:

\`\`\`json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "email": { "type": "string", "format": "email" }
  },
  "required": ["name", "email"]
}
\`\`\`

## Parsing LLM Responses

When an LLM returns a function call, use \`lenientParse\` to extract and coerce the arguments:

\`\`\`ts
import { lenientParse, type ParseResult } from '@zmdb/schema-core/llm';

const llmResponse = \`{"name": "Alice", "email": "alice@example.com"}\`;

const result: ParseResult<UserInput> = lenientParse(llmResponse);
// result.success => true
// result.data => { name: 'Alice', email: 'alice@example.com' }
\`\`\`

The parser handles common LLM quirks:

\`\`\`ts
// Markdown code fences around the JSON are stripped before parsing.
// e.g. an LLM returns a fenced block; lenientParse handles it:
const fenced = '\`\`\`json\\n{"name":"Bob"}\\n\`\`\`';
lenientParse(fenced);
// => { success: true, data: { name: 'Bob' } }
\`\`\`

## Full Flow

\`\`\`ts
import { BaseRepository } from '@zmdb/repository';
import { toolFromSchema, lenientParse } from '@zmdb/schema-core/llm';

// 1. Generate tool spec from your repository's schema
const toolSpec = toolFromSchema('createUser', UserSchema);

// 2. Send to LLM (your HTTP client or provider SDK)
// const response = await openai.chat.completions.create({
//   tools: [{ type: 'function', function: toolSpec }]
// });

// 3. Parse the function call
const parseResult = lenientParse<UserInput>(llmText);
if (!parseResult.success) {
  throw new Error(parseResult.errors?.join(', '));
}

// 4. Execute against your repository
const created = await userRepo.create(parseResult.data);
\`\`\`

> [!IMPORTANT]
> Always validate parsed input before passing to the repository. \`lenientParse\` extracts JSON — it doesn't validate against your schema. Use \`@zmdb/aot-validator\` for that.

## Coercion

The \`coerce\` option lets you transform parsed data:

\`\`\`ts
interface UserInput {
  id?: number;
  name: string;
}

const result = lenientParse<UserInput>(
  '{"name": "Charlie"}',
  (v) => ({ name: (v as any).name.toUpperCase() })
);
// result.data => { name: 'CHARLIE' }
\`\`\`

> [!TIP]
> Use a schema validator in your \`handle\` function to catch malformed LLM output before it reaches the database.

---

See also: [Schema Core](./schema-declaration.html) · [Validation](./validators-is.html) · [Repository](./repository.html)
`),

  // ---------------- Web Framework ----------------
  'web-overview': ok('@zmdb/web — Overview', 'Web Framework', `
\`@zmdb/web\` is a **Stage-3 decorator web framework** for the zmdb ecosystem —
controllers, a typed request context, compile-time dependency injection and
compile-time domain state machines, with **zero \`reflect-metadata\` and zero
runtime reflection**. It sits above [\`@zmdb/repository\`](./repository.html) in the
architecture: controllers inject repositories, routes validate request bodies via
the [AOT validator](./aot-setup.html), and responses serialize through the same
zero-overhead path as the rest of zmdb.

> [!NOTE]
> \`@zmdb/web\` is in **early alpha**. This page documents the shipped **package
> baseline**; controllers/routing, the typed \`Ctx\`, DI, domain state machines,
> the request pipeline and the full NestJS-parity layers are being built out
> issue-by-issue (spec → tests → implementation → docs).

## Install

\`\`\`bash
npm add @zmdb/web@alpha
# or via the umbrella:
npm add zmdb@alpha   # then: import { metadataOf } from 'zmdb/web';
\`\`\`

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. Uses **Stage 3**
> standard decorators — set \`"experimentalDecorators": false\` (the default under
> a modern \`tsconfig\`). No \`reflect-metadata\`.

## Why Stage 3 (and not \`experimentalDecorators\`)?

NestJS-style frameworks rely on \`experimentalDecorators\` + \`emitDecoratorMetadata\`
+ \`reflect-metadata\`, which does **runtime type reflection** on every decorated
class. \`@zmdb/web\` rejects that: it uses the **standardized** Stage-3 decorators
and stores per-class data in the well-known **\`Symbol.metadata\`** record
(\`context.metadata\`). Route tables and the DI graph are resolved **once at
class-init**, never re-reflected per request — consistent with zmdb's
[zero-overhead](./inert-rows.html) philosophy.

## The metadata baseline

Every decorator in the framework builds on one primitive — reading the Stage-3
metadata a decorator wrote:

\`\`\`ts
import { metadataOf } from '@zmdb/web';

function Tagged(value: string) {
  return function <T extends abstract new (...args: never[]) => unknown>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ): void {
    context.metadata.tag = value; // stored in Symbol.metadata
  };
}

@Tagged('users')
class UsersController {}

metadataOf(UsersController).tag; // 'users'
\`\`\`

\`metadataOf(target)\` reads the well-known \`Symbol.metadata\` record off a decorated
class behind a runtime type-guard — **no \`as\`, no \`reflect-metadata\`**. For an
undecorated class it returns a frozen empty record (never \`undefined\`), so callers
can read slots unconditionally.

> [!NOTE]
> Node 26 / V8 does not yet expose \`Symbol.metadata\`. \`@zmdb/web\` ships a
> zero-dependency polyfill that installs the well-known symbol when absent (a
> no-op once a runtime ships it natively); it assigns only \`Symbol.metadata\` and
> mutates no other global.

## Design invariants

- **No \`as\` on the consumer surface.** You never need a type assertion to use the
  framework correctly.
- **No runtime reflection / no \`reflect-metadata\`.** Metadata lives in
  \`context.metadata\`; type information is erased.
- **Zero required third-party runtime dependencies.**
- **ESM-only, Node 26+, TS 7+, Stage 3.**

See the project [ARCHITECTURE](https://github.com/ambasta/zmdb/blob/main/ARCHITECTURE.md)
for where \`@zmdb/web\` fits in the package DAG and the language/perf policy.

## Roadmap

Controllers & routing · typed \`Ctx<Params, Body, Query>\` with path-param
derivation · compile-time DI (\`@Inject\`) · domain state machines · request
pipeline + adapters · repository integration — then full NestJS parity (modules,
guards/pipes/interceptors/filters, app bootstrap & lifecycle, OpenAPI, WS/SSE,
testing utilities).
`),

  'web-controllers': ok('Controllers & Routing', 'Web Framework', `
Define HTTP controllers with **Stage-3 decorators**. \`@Controller\` sets a path
prefix; \`@Get\`/\`@Post\`/\`@Put\`/\`@Patch\`/\`@Delete\` mark handler methods. All route
data is stored in the standard \`Symbol.metadata\` record — **no \`reflect-metadata\`,
no runtime type reflection**. The route table is resolved once via \`getRoutes\`.

## Declaring a controller

\`\`\`ts
import { Controller, Get, Post, Patch, Delete } from '@zmdb/web';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get() { /* ... */ }

  @Post()
  create() { /* ... */ }

  @Patch('/:id')
  update() { /* ... */ }

  @Delete('/:id')
  remove() { /* ... */ }
}
\`\`\`

> [!NOTE]
> Stage 3 has **no parameter decorators**, so handlers don't take \`@Param\`/\`@Body\`
> arguments. Instead they'll receive a single strongly-typed request context —
> see the [typed context](./web-overview.html) work (path params are *derived*
> from the route string). This page covers the route wiring itself.

## Reading the route table

\`getRoutes(ControllerClass)\` returns the resolved routes — the controller prefix
composed with each method path, normalized, in **declaration order**:

\`\`\`ts
import { getRoutes } from '@zmdb/web';

getRoutes(UsersController);
// [
//   { method: 'GET',    path: '/users/:id', handlerName: 'get' },
//   { method: 'POST',   path: '/users',     handlerName: 'create' },
//   { method: 'PATCH',  path: '/users/:id', handlerName: 'update' },
//   { method: 'DELETE', path: '/users/:id', handlerName: 'remove' },
// ]
\`\`\`

The table is computed by reading \`context.metadata\` — cache it freely; it is
stable after class initialization and never re-reflected per request.

## Path composition

| \`@Controller\` prefix | method path | resolved |
|---|---|---|
| \`/users\` | \`/:id\` | \`/users/:id\` |
| \`users\` (no slash) | *(none)* | \`/users\` |
| *(none)* | \`/health\` | \`/health\` |
| \`users/\` | \`/\` | \`/users\` |

Duplicate slashes collapse and a trailing slash is stripped (the root \`/\` stays
\`/\`).

## Design notes

- **No \`as\` on the consumer surface** — you never assert types to declare routes.
- Route/prefix data is kept in **symbol-keyed** slots inside \`context.metadata\`,
  off the public string keyspace.
- Granular import: \`import { getRoutes } from '@zmdb/web/routing'\`.

## Cross-links

- [@zmdb/web overview](./web-overview.html) — the Stage-3 baseline & invariants
`),

  'web-context': ok('Typed Request Context', 'Web Framework', `
Stage 3 has **no parameter decorators**, so \`@zmdb/web\` handlers take a single
strongly-typed **context** object instead of \`@Param\`/\`@Body\`/\`@Query\` arguments.
Crucially, the params type is **derived from the route string** at compile
time — you never hand-write it, and you never need an \`as\` cast.

## Path-param derivation

\`PathParams<Path>\` reads \`:name\` segments out of a route string via
template-literal types:

\`\`\`ts
import type { PathParams } from '@zmdb/web';

type A = PathParams<'/users/:id'>;                    // { id: string }
type B = PathParams<'/users/:id/posts/:postId'>;      // { id: string; postId: string }
type C = PathParams<'/health'>;                        // {} (no params)
type D = PathParams<'/files/:path'>;                   // { path: string }
\`\`\`

## The \`Ctx\` object

\`\`\`ts
interface Ctx<Params, Body, Query> {
  readonly params: Params;   // derived from the route path
  readonly body: Body;
  readonly query: Query;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}
\`\`\`

## Binding a handler to its route

\`HandlerFor<Path, Body>\` ties \`ctx.params\` to the route string, so a typo in a
param name is a **compile error** — no runtime surprise, no assertion:

\`\`\`ts
import type { HandlerFor } from '@zmdb/web';

const getUser: HandlerFor<'/users/:id', never> = (ctx) => {
  ctx.params.id;      // ✅ string
  // ctx.params.slug; // ✗ compile error — 'slug' is not a param of this route
  return ctx.params.id;
};
\`\`\`

## Extracting params at runtime

\`extractParams(pattern, path)\` is the small pure helper the dispatcher uses to
turn a matched request path into the params object (or \`undefined\` on a
mismatch):

\`\`\`ts
import { extractParams } from '@zmdb/web';

extractParams('/users/:id', '/users/42');                 // { id: '42' }
extractParams('/users/:id/posts/:postId', '/u/1/p/7');    // (mismatch) → undefined
extractParams('/health', '/health');                       // {}
\`\`\`

## Design notes

- **100% compile-time** param typing; \`extractParams\` is the only runtime code and
  allocates a single params object.
- **No \`as\` on the consumer surface** — params are typed by derivation, not by
  assertion.
- Granular import: \`import type { Ctx } from '@zmdb/web/context'\`.

## Cross-links

- [Controllers & routing](./web-controllers.html) — where routes are declared
- [@zmdb/web overview](./web-overview.html)
`),

  'web-di': ok('Dependency Injection', 'Web Framework', `
\`@zmdb/web\` provides dependency injection **without \`emitDecoratorMetadata\` or
\`reflect-metadata\`**. Instead of reflecting constructor parameter types at
runtime (the NestJS approach), you use explicit, **typed tokens** and a small
\`Container\`. The injected field's type is inferred from its token — so you never
write an \`as\` cast to satisfy the container.

## Tokens

A \`Token<T>\` carries its instance type at compile time and is identified by
reference:

\`\`\`ts
import { createToken } from '@zmdb/web';

class Logger { log(m: string) { console.log(m); } }

const LoggerToken = createToken<Logger>('Logger');
\`\`\`

## The container

\`\`\`ts
import { Container } from '@zmdb/web';

const container = new Container();
container.register(LoggerToken, new Logger());

container.resolve(LoggerToken);   // Logger  (typed — no cast)
container.has(LoggerToken);       // true

// container.register(LoggerToken, 42) → compile error (42 is not a Logger)
\`\`\`

Resolving an unregistered token throws \`UnresolvedTokenError\`:

\`\`\`ts
new Container().resolve(LoggerToken); // throws UnresolvedTokenError
\`\`\`

## \`@Inject\` fields

Declare a field and annotate it with \`@Inject(token)\`. Build the class through
the container to satisfy its injected fields:

\`\`\`ts
import { Inject } from '@zmdb/web';

class UserService {
  @Inject(LoggerToken)
  logger!: Logger;   // type inferred from the token — no 'as'

  greet() { this.logger.log('hi'); }
}

const svc = container.build(UserService);
svc.greet();
\`\`\`

> [!NOTE]
> Injection is resolved at \`container.build(...)\` (class-init) time and cached on
> the instance — **not** re-resolved per method call. The container is the one
> explicit, opt-in registry; there is no hidden global request-time state (the
> "current container" is set only for the duration of \`build\` and cleared in a
> \`finally\`).

## Design notes

- **No reflection / no \`reflect-metadata\`** — tokens are plain values; \`@Inject\`
  records requests in \`Symbol.metadata\`.
- **No \`as\` on the consumer surface** — the field type comes from the token. (The
  framework contains exactly one isolated, documented boundary cast for its
  internal heterogeneous token→instance map; see the source.)
- **O(1) resolution** keyed by token identity.
- Granular import: \`import { Container } from '@zmdb/web/di'\`.

## Cross-links

- [Controllers & routing](./web-controllers.html)
- [@zmdb/web overview](./web-overview.html)
`),

  'web-domain-state': ok('Domain State Machines', 'Web Framework', `
Model domain state so that **illegal transitions fail to compile**. \`@zmdb/web\`
uses branded (phantom) types: a \`DraftOrder\` and a \`PaidOrder\` are distinct types
even though both are just \`Order\` at runtime. Branding erases completely — **zero
runtime cost** beyond the value itself — and you never write an \`as\` cast.

## Branded states

\`\`\`ts
import { defineState, transition, type Brand } from '@zmdb/web';

interface Order { id: number; total: number; }

const Draft = defineState<'Draft', Order>();
const Paid  = defineState<'Paid', Order>();

type DraftOrder = Brand<Order, 'Draft'>;
type PaidOrder  = Brand<Order, 'Paid'>;
\`\`\`

## Constructing states (no \`as\`)

States are built through a **checked factory**, so you never cast:

\`\`\`ts
const order = Draft.create({ id: 1, total: 10 }); // DraftOrder
Draft.is(order);                                    // type guard → narrows to DraftOrder
\`\`\`

## Declaring transitions

\`transition(from, to, fn)\` produces a function that **only accepts the \`from\`
state**. Applying it to any other state is a compile error, and there is simply
no function for an undeclared edge:

\`\`\`ts
const pay = transition(Draft, Paid, (o) => ({ ...o, paidAt: Date.now() }));

const draft = Draft.create({ id: 1, total: 10 });
const paid  = pay(draft);   // ✅ PaidOrder

// pay(paid);  // ✗ compile error — 'pay' expects a Draft order, not a Paid one
\`\`\`

This makes "pay an already-paid order" or "ship an unpaid order" **unrepresentable**
in code that type-checks.

## Design notes

- **Compile-time only.** Brands are phantom; \`create\` is an identity at runtime,
  so a state machine adds **0 bytes** to your objects.
- **No \`as\` on the consumer surface** — construction goes through \`create\`. (The
  framework contains one isolated, documented brand-attach boundary internally.)
- Granular import: \`import { defineState } from '@zmdb/web/state'\`.

## Cross-links

- [Dependency injection](./web-di.html)
- [@zmdb/web overview](./web-overview.html)
`),

  'web-pipeline': ok('Request Pipeline & Adapters', 'Web Framework', `
The router ties everything together. Register a controller instance and the
router reads its [routes](./web-controllers.html) **once**, then dispatches each
request through: **match → build [Ctx](./web-context.html) → validate body →
invoke handler → serialize**. Thin adapters connect it to \`node:http\` or any
Fetch runtime (Hono, edge) with **no hard dependency** on either.

## Creating a router

\`\`\`ts
import { createRouter } from '@zmdb/web';
import { Controller, Get, Post } from '@zmdb/web';
import type { Ctx } from '@zmdb/web';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) { return { id: ctx.params.id }; }

  @Post()
  create(ctx: Ctx<Record<never, string>, { name: string }>) { return { created: ctx.body.name }; }
}

const router = createRouter();
router.register(new UsersController(), {
  // optional per-handler body validation — runs BEFORE the handler
  create: { validateBody: (raw) => assertCreateUser(raw) },
});
\`\`\`

## The pipeline

\`router.handle(req)\` returns \`{ status, body, headers }\`:

| step | behavior |
|------|----------|
| **match** | method + path against the cached table (params via \`extractParams\`); no match → **404** |
| **validate** | if the route has \`validateBody\`, run it on the raw body; throw → **400**, handler **not** called |
| **invoke** | call the handler with the typed \`Ctx\` |
| **serialize** | JSON-encode the result → **200**; a thrown handler → **500** |

\`\`\`ts
await router.handle({ method: 'GET', path: '/users/42', headers: {} });
// { status: 200, body: '{"id":"42"}', ... }

await router.handle({ method: 'POST', path: '/users', headers: {}, rawBody: { nope: 1 } });
// { status: 400, ... }  — validateBody threw; create() never ran
\`\`\`

> [!IMPORTANT]
> Validation runs **before** the handler, so an invalid body never reaches your
> code. Pair \`validateBody\` with \`@zmdb/aot-validator\`'s \`assert\` for
> zero-runtime-parser validation against a schema DTO.

## Adapters (no hard deps)

\`\`\`ts
import { toNodeHandler, toFetchHandler } from '@zmdb/web';
import { createServer } from 'node:http';

// node:http
createServer(toNodeHandler(router)).listen(3000);

// Fetch (Hono, Bun, Deno, edge)
const handler = toFetchHandler(router); // (Request) => Promise<Response>
\`\`\`

Both adapters are **structurally typed** — \`@zmdb/web\` does not depend on
\`node:http\` or Hono; you bring the runtime.

## Design notes

- **No per-request reflection.** The route table is resolved at \`register\` time;
  each request allocates one \`Ctx\` + one result object.
- **No \`as\` on the consumer surface.** (Internally, two isolated+documented
  boundary casts read the controller constructor and the handler method.)
- Granular import: \`import { createRouter } from '@zmdb/web/pipeline'\`.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Typed context](./web-context.html) · [Dependency injection](./web-di.html)
`),

  'web-data-integration': ok('Building an API with zmdb', 'Web Framework', `
This is where \`@zmdb/web\` meets the [data layer](./repository.html). A controller
**injects a repository** via [DI](./web-di.html), validates the request body
against your **schema-derived DTO**, and returns typed entities — all on the same
zero-overhead path as the rest of zmdb.

## Define once, wire it up

\`\`\`ts
import { DatabaseSync } from 'node:sqlite';
import { defineSchema, serial, integer, numeric } from '@zmdb/schema-core';
import { defineRepository, type BaseRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { Container, Inject, Controller, Get, Post, createRouter, repositoryToken, validateWith } from '@zmdb/web';
import type { Ctx } from '@zmdb/web';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: numeric().notNull(),
});

// A typed DI token for the repository over this schema.
const OrderRepo = repositoryToken<typeof OrderSchema>('OrderRepo');
\`\`\`

## The controller injects the repository

\`\`\`ts
@Controller('/orders')
class OrdersController {
  @Inject(OrderRepo)
  repo!: BaseRepository<typeof OrderSchema>;   // fully typed — no 'as'

  @Post()
  create(ctx: Ctx<Record<never, string>, { userId: number; total: number }>) {
    return this.repo.create(ctx.body);          // validated CreateDTO → persisted
  }

  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) {
    return this.repo.findById(Number(ctx.params.id));
  }
}
\`\`\`

## Bind, validate, serve

\`\`\`ts
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total NUMERIC NOT NULL)');

const container = new Container();
container.register(OrderRepo, defineRepository(OrderSchema, sqliteDriver(db), { dialect: 'sqlite' }));

const controller = container.build(OrdersController);   // @Inject satisfied here
const router = createRouter();
router.register(controller, {
  // validateWith adapts any validator — e.g. the AOT assert<CreateDTO<S>> — into
  // the pipeline's validate-before-handler hook. No runtime parser is embedded.
  create: { validateBody: validateWith((raw) => assertCreateOrder(raw)) },
});

await router.handle({ method: 'POST', path: '/orders', headers: {}, rawBody: { userId: 1, total: 42 } });
// 200 → the persisted, typed order
\`\`\`

> [!IMPORTANT]
> The body is validated **before** \`create\` runs — an invalid payload never
> reaches the repository (→ 400). Use \`@zmdb/aot-validator\`'s \`assert\` for
> zero-runtime-parser validation bound to the schema DTO.

## Design notes

- **No \`as\`** — the repository token carries the schema, so the injected field is
  \`BaseRepository<OrderSchema>\`.
- The repository is a plain [zmdb repository](./repository.html): no proxies, no
  identity map, [inert rows](./inert-rows.html).
- First-class validation/serialization *pipes* (the \`@nestjs/swagger\`/
  \`ClassSerializerInterceptor\` analogues) build on this — coming with the
  middleware layer.

## Cross-links

- [Repository](./repository.html) · [Dependency injection](./web-di.html) · [Request pipeline](./web-pipeline.html)
`),

  'web-modules': ok('Modules & Providers', 'Web Framework', `
Organize controllers and providers into composable **modules** over the
[DI container](./web-di.html) — the NestJS \`@Module\` analogue, resolved
**statically** at compile time (no per-request graph walk, no reflection).

## Declaring a module

\`\`\`ts
import { Module, createToken } from '@zmdb/web';

class Clock { now() { return Date.now(); } }
const ClockToken = createToken<Clock>('Clock');

@Module({
  providers: [{ token: ClockToken, useValue: new Clock() }],
  exports: [ClockToken],   // visible to modules that import this one
})
class SharedModule {}

@Module({
  imports: [SharedModule],           // ClockToken becomes resolvable here
  controllers: [TimeController],     // built through the container
  providers: [
    { token: CounterToken, useFactory: (c) => makeCounter(), scope: 'transient' },
  ],
})
class AppModule {}
\`\`\`

## Provider kinds & scopes

| provider | shape | resolution |
|---|---|---|
| value | \`{ token, useValue }\` | returns the bound value |
| factory (singleton) | \`{ token, useFactory }\` | runs once, then **cached** |
| factory (transient) | \`{ token, useFactory, scope: 'transient' }\` | runs **every** \`resolve\` |

## Compiling the graph

\`\`\`ts
import { compileModule } from '@zmdb/web';

const { container, controllers } = compileModule(AppModule);
// providers registered (imports resolved first), controllers built with their
// @Inject-ed dependencies satisfied. Import cycles throw.
\`\`\`

## Design notes

- **Static wiring** — the module graph is walked once; \`resolve\` is O(1). No
  per-request reflection.
- **Acyclic** — a circular \`imports\` graph throws at \`compileModule\`.
- **No \`as\` on the consumer surface** — provider tokens carry their type.
- Granular import: \`import { Module } from '@zmdb/web/modules'\`.

## Cross-links

- [Dependency injection](./web-di.html) · [Controllers & routing](./web-controllers.html)
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
