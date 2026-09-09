Small things that are easy to miss.

## Get the SQL without a database

Every builder ends in `.compile()`, which returns `{ text, parameters }`. No connection, no mocking:

```ts {"mode":"compile","id":"example-001"}
import { createQueryCompiler } from '@zmdb/sql';
import { postgres } from '@zmdb/postgres';

const { text, parameters } = createQueryCompiler(postgres).selectFrom('users').where('age', '>=', 18).orderBy('email', 'asc').limit(10).compile();
```

Assert on `text` in a unit test. This is the same value the driver gets.

## Compile the same query for six dialects

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies createQueryCompiler; this excerpt does not repeat those declarations."}
for (const dialect of ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore'] as const) {
  console.log(createQueryCompiler(dialect).selectFrom('users').where('id', '=', 1).compile().text);
}
// SELECT * FROM "users" WHERE "id" = $1
// SELECT * FROM `users` WHERE `id` = ?
// SELECT * FROM "users" WHERE "id" = ?
// SELECT * FROM [users] WHERE [id] = @p1
// SELECT * FROM "users" WHERE "id" = $1
// SELECT * FROM `users` WHERE `id` = ?
```

Useful for spotting portability problems before deploy, and for tests that must pass on both SQLite locally and Postgres in CI.

## Generate realistic fixtures from the schema

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies userSchema; this excerpt does not repeat those declarations."}
import { seedRows } from '@zmdb/orm/seeding';

const rows = seedRows(userSchema, { count: 50, seed: 1234 });
```

Deterministic for a given seed, and shaped by the column's whole declaration rather than only its SQL type — a literal union gets a member, a `timestamp` gets a `Date`, a `Min<18>` column gets a
number at least eighteen. It is the same sampler [`random<T>()`](./random.html) uses, so the rows satisfy `repo.create`'s own validator. See [Seed Value Generators](./seed-functions.html).

## Generate a value from any type, not just a schema

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { random } from '@zmdb/validator';

const u = random<User>();
```

The transformer derives the generator from `User` itself. Handy for property-based tests. See [Random Generator](./random.html).

## `stringify` is faster than `JSON.stringify` for known types

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies User, user; this excerpt does not repeat those declarations."}
import { stringify, assertStringify } from '@zmdb/validator/serialization';

stringify(user); // no key discovery at runtime
assertStringify<User>(user); // validate, then serialize
```

The transformer knows the key set, so there is no `Object.keys` walk and no property-order surprise. See [stringify()](./json-stringify.html).

## `parse` returns a result, it does not throw

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies User, parse, text, useUser; this excerpt does not repeat those declarations."}
const r = parse<User>(text);
if (!r.success) return badRequest(r.errors);
useUser(r.data);
```

Errors carry the path that failed, so `"user.addresses[2].zip"` rather than "invalid input".

## `validate()` collects every error, `assert()` stops at the first

Use `validate` for form submissions where the user wants the whole list, `assert` on internal boundaries where one failure is enough.

## Derive OpenAPI components for a whole schema set in one call

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies comments, posts, users; this excerpt does not repeat those declarations."}
import { toOpenApiComponents } from '@zmdb/schema/openapi';

const { schemas } = toOpenApiComponents([users, posts, comments]);
```

Six variants per schema (`entity`, `create`, `update`, `get`, `list`, `search`), with relations resolved as `$ref`s. See [OpenAPI](./openapi.html).

## Turn a schema into an LLM tool spec

Install the provider-neutral package with `yarn add @zmdb/ai@1.0.0-beta.2`; it adds no provider SDK or framework peer.

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies users; this excerpt does not repeat those declarations."}
import { toolFromSchema } from '@zmdb/ai';

const tool = toolFromSchema('create_user', users, { description: 'Create a user' });
```

See [LLM Function Calling](./llm-function-calling.html).

## `lenientParse` survives fenced JSON from a model

````ts {"mode":"illustrative","id":"example-009","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { lenientParse } from '@zmdb/ai';

lenientParse<User>('```json\n{"email":"a@b.c"}\n```');
````

Strips a leading or trailing code fence before parsing, which is what a model wraps JSON in when you asked for JSON. Prose before the fence is not stripped. See
[Structured Output](./llm-structured-output.html).

## The test harness boots the real app

```ts {"mode":"illustrative","id":"example-010","reason":"The surrounding example supplies DbToken, RootModule, fakeDriver; this excerpt does not repeat those declarations."}
import { createTestApp } from '@zmdb/web/testing';

await using app = createTestApp(RootModule, { overrides: [{ token: DbToken, useValue: fakeDriver }] });
const res = await app.request({ method: 'GET', path: '/users/1' });
```

Same router, same middleware chain, same DI graph — with `await using` for teardown. See [Testing](./web-testing.html).

## Count metadata reads to prove there are none

The repository-private `countMetadataReads` probe wraps a controller's `Symbol.metadata` property, boots the real router, then proves repeated requests add zero reads. This is how the "no runtime
reflection" claim is tested rather than asserted; it is test support, not a published application entry point. See [Web Performance & Benchmarks](./web-benchmarks.html).

## `whereExists` takes any compilable

```ts {"mode":"illustrative","id":"example-011","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
qc.selectFrom('authors').whereExists(qc.selectFrom('posts').where('author_id', '=', 1));
```

Anything with a `compile()` works, including a hand-built `CompiledQuery`. See [Parents with at least one child](./guide-exists-subquery.html).

## Partial indexes

`IndexDef` takes a `where` clause:

```ts {"mode":"illustrative","id":"example-012","reason":"The surrounding example supplies createIndexDdl; this excerpt does not repeat those declarations."}
createIndexDdl({ name: 'active_email', table: 'users', columns: ['email'], unique: true, where: 'deleted_at IS NULL' }, 'postgres');
```

---

See also: [FAQ](./faq.html) · [Gotchas](./gotchas.html) · [Query Utilities](./query-utils.html)
