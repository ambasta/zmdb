Small things that are easy to miss.

## Get the SQL without a database

Every builder ends in `.compile()`, which returns `{ text, parameters }`. No connection, no mocking:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const { text, parameters } = createQueryCompiler('postgres')
  .selectFrom('users')
  .where('age', '>=', 18)
  .orderBy('email', 'asc')
  .limit(10)
  .compile();
```

Assert on `text` in a unit test. This is the same value the driver gets.

## Compile the same query for three dialects

```ts
for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
  console.log(createQueryCompiler(dialect).selectFrom('users').where('id', '=', 1).compile().text);
}
// SELECT * FROM "users" WHERE "id" = $1
// SELECT * FROM `users` WHERE `id` = ?
// SELECT * FROM "users" WHERE "id" = ?
```

Useful for spotting portability problems before deploy, and for tests that must pass on both SQLite locally and Postgres in CI.

## Generate realistic fixtures from the schema

```ts
import { seedRows } from '@zmdb/schema-core/seeding';

const rows = seedRows(users, { count: 50, seed: 1234 });
```

Deterministic for a given seed, and shaped by the column types and validation rules — so a `varchar(20)` gets a string that fits and a `jsonEnum` gets a member. See [Seed Value Generators](./seed-functions.html).

## Generate a value from any type, not just a schema

```ts
import { random } from '@zmdb/aot-validator/utilities';

const u = random<User>();
```

The transformer derives the generator from `User` itself. Handy for property-based tests. See [Random Generator](./random.html).

## `stringify` is faster than `JSON.stringify` for known types

```ts
import { stringify, assertStringify } from '@zmdb/aot-validator/serialization';

stringify(user); // no key discovery at runtime
assertStringify<User>(user); // validate, then serialize
```

The transformer knows the key set, so there is no `Object.keys` walk and no property-order surprise. See [stringify()](./json-stringify.html).

## `parse` returns a result, it does not throw

```ts
const r = parse<User>(text);
if (!r.success) return badRequest(r.errors);
useUser(r.data);
```

Errors carry the path that failed, so `"user.addresses[2].zip"` rather than "invalid input".

## `validate()` collects every error, `assert()` stops at the first

Use `validate` for form submissions where the user wants the whole list, `assert` on internal boundaries where one failure is enough.

## Derive OpenAPI components for a whole schema set in one call

```ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const { schemas } = toOpenApiComponents([users, posts, comments]);
```

Six variants per schema (`entity`, `create`, `update`, `get`, `list`, `search`), with relations resolved as `$ref`s. See [OpenAPI](./openapi.html).

## Turn a schema into an LLM tool spec

```ts
import { toolFromSchema } from '@zmdb/schema-core/llm';

const tool = toolFromSchema('create_user', users, { description: 'Create a user' });
```

See [LLM Function Calling](./llm-function-calling.html).

## `lenientParse` survives fenced JSON from a model

````ts
import { lenientParse } from '@zmdb/schema-core/llm';

lenientParse<User>('```json\n{"email":"a@b.c"}\n```');
````

Strips code fences and leading prose before parsing, which is what models actually emit. See [Structured Output](./llm-structured-output.html).

## The test harness boots the real app

```ts
import { createTestApp } from '@zmdb/web/testing';

await using app = createTestApp(RootModule, { overrides: [{ token: DbToken, useValue: fakeDriver }] });
const res = await app.request({ method: 'GET', path: '/users/1' });
```

Same router, same middleware chain, same DI graph — with `await using` for teardown. See [Testing](./web-testing.html).

## Count metadata reads to prove there are none

```ts
import { countMetadataReads } from '@zmdb/web/bench';

const counter = countMetadataReads(MyController);
// ... boot the app ...
counter.count; // 0
```

This is how the "no runtime reflection" claim is tested rather than asserted. See [Web Performance & Benchmarks](./web-benchmarks.html).

## `whereExists` takes any compilable

```ts
qc.selectFrom('authors').whereExists(qc.selectFrom('posts').where('author_id', '=', 1));
```

Anything with a `compile()` works, including a hand-built `CompiledQuery`. See [Parents with at least one child](./guide-exists-subquery.html).

## Partial indexes

`IndexDef` takes a `where` clause:

```ts
createIndexDdl(
  { name: 'active_email', table: 'users', columns: ['email'], unique: true, where: 'deleted_at IS NULL' },
  'postgres',
);
```

---

See also: [FAQ](./faq.html) · [Gotchas](./gotchas.html) · [Query Utilities](./query-utils.html)
