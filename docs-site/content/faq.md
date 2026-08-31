## Do I have to run the transformer?

Yes, if you use `is`, `assert`, `validate`, `stringify`, `parse` or `random`. Those functions accept an optional `TypeDescriptor` and the transformer's job is to fill it in from `T`. Without the transformer, a call like `assert<User>(raw)` has nothing to check against.

The schema, DTO types, query compiler and repository all work without the transformer — those are types plus plain functions. See [AOT Setup](./aot-setup.html).

## Why is there no `zmdb` command?

Because it is not built yet. The engine is: `snapshot()`, `diff()`, `emitUp()` and the migration runner are all public API, and the [CLI pages](./cli-overview.html) show the ~20-line script that does each drizzle-kit command today. Packaging that as an executable is tracked, not done.

## Does zmdb support MongoDB?

No. The compiler emits SQL text, so a document store needs a second compiler target. See [MongoDB](./dialect-mongodb.html).

## Which dialects work?

`'postgres'`, `'mysql'` and `'sqlite'`. Anything wire-compatible with one of those works through it — Neon, Supabase, PlanetScale, Turso, D1 and Cockroach all connect. Dialect-specific DDL and types for Cockroach, SingleStore and SQL Server are not handled. See [Dialects](./dialect-postgres.html).

## Why does `findById` return `Entity<S> | undefined` and not throw?

Because "no row" is an ordinary outcome of a lookup and a thrown exception is not a good way to model it. If you want the throwing version, `assert` the result — that keeps the decision at the call site where you know whether absence is an error.

## Can I get the SQL that will run?

Yes, and without a database:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const q = createQueryCompiler('postgres').selectFrom('users').where('email', '=', 'a@example.com').compile();

q.text; // 'SELECT * FROM "users" WHERE "email" = $1'
q.parameters; // ['a@example.com']
```

This is the same object the driver receives. See [Raw SQL](./raw-sql.html).

## Why are there no entity classes?

Because the moment the ORM owns your objects it has to track them, and tracking is what produces identity maps, proxies and flush-order bugs. A read returns plain data; what you build from it is yours. See [Why fetched rows are inert](./inert-rows.html).

## Do I need `reflect-metadata`?

No. Nothing in zmdb reads runtime type metadata. The `@zmdb/web` decorators record routes and providers in ordinary maps.

## How do relations get loaded?

Explicitly. `populate` issues one additional query per requested relation, batched with an `IN` over the collected keys; `findJoined` / `joinRelation` produce a single joined statement. A relation you did not ask for is absent from the _type_, so there is no accidental lazy load. See [Loading Strategies](./loading-strategies.html).

## Is there an `ON CONFLICT` / upsert?

Not yet — see [Upsert](./upsert.html) for the gap and the two-statement workaround.

## Can I use Zod alongside zmdb?

Yes, through JSON Schema — `toJsonSchema()` in either direction. You do not need it for validation, and mixing the two means two validators over one type. See [Zod](./interop-zod.html).

## Why is `@zmdb/web`'s `WebResponse.body` a string?

Because streaming responses are not modelled yet. It is the single blocker behind [streaming files](./web-streaming-files.html), [compression](./web-compression.html) and [static file serving](./web-static-files.html).

## What is the Node version floor?

Node 26. zmdb is ESM-only and uses `node:sqlite`, `AsyncDisposable` and modern decorators.

## How do I run the benchmarks?

`yarn bench`. It initialises the three upstream benchmark suites as submodules, applies the zmdb participant patches, runs what is feasible on your machine, and writes the dashboard JSON. See [Benchmarks](./benchmarks.html).

## Something is marked ToDo. Is it rejected or deferred?

Deferred. Anything genuinely rejected is on the [anti-patterns page](./anti-patterns.html) with the argument for rejecting it. A **ToDo** page names the specific missing piece and where it would plug in.

---

See also: [Gotchas](./gotchas.html) · [Goodies](./goodies.html) · [Why zmdb](./why-zmdb.html) · [Anti-patterns](./anti-patterns.html)
