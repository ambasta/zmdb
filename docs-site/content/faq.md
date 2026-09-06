## Do I have to run the transformer?

Yes, if you write a type argument. The eight calls it rewrites are `is`, `assert`, `equals`, `assertEquals`, `validate`, `random`, `toJsonSchema` and `schemaOf` — it replaces each with code emitted
from the reflected type. Without it, `assert<User>(raw)` has nothing to check against and **throws**; it does not quietly accept.

`schemaOf<T>()` is on that list, which is the part worth noticing: the schema _value_ your repository takes comes from the build step even though the repository does not.

`stringify`, `parse`, `decode` and `assertStringify` are _not_ transformed, and neither are the DTO types, the query compiler, the migration engine or `@zmdb/web` — those are types plus plain
functions. See [AOT Setup](./aot-setup.html) and [Pure TypeScript](./pure-typescript.html).

## What does the `zmdb` command cover?

The installed executable owns project and component scaffolds, migrations, catalog pull, checks, DDL export, module inspection, the REPL, and the local read-only Studio. It keeps the underlying
snapshot, diff, introspection, and migration-runner APIs public, so applications can still assemble a narrower workflow. See the [CLI overview](./cli-overview.html).

## Does zmdb support MongoDB?

No. The compiler seam can already drive a non-SQL builder; the refused parts are the data model and public repository contract — `Serial` keys, SQL-specific aggregation callbacks and savepoints. See
[MongoDB](./dialect-mongodb.html).

## Which dialects work?

`'postgres'`, `'mysql'`, `'sqlite'`, `'mssql'`, `'cockroach'`, and `'singlestore'`. Cockroach inherits the Postgres wire grammar with dedicated types, refusals, and retry classification; SingleStore
inherits MySQL and adds shard, sort, and rowstore DDL. SQL Server has its own compiler path and first-party pool adapter. See [SQL Server](./dialect-mssql.html),
[CockroachDB](./dialect-cockroach.html), and [SingleStore](./dialect-singlestore.html).

## Why does `findById` return `Entity<S> | undefined` and not throw?

Because "no row" is an ordinary outcome of a lookup and a thrown exception is not a good way to model it. If you want the throwing version, `assert` the result — that keeps the decision at the call
site where you know whether absence is an error.

## Can I get the SQL that will run?

Yes, and without a database:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';
import { postgres } from '@zmdb/postgres';

const q = createQueryCompiler(postgres).selectFrom('users').where('email', '=', 'a@example.com').compile();

q.text; // 'SELECT * FROM "users" WHERE "email" = $1'
q.parameters; // ['a@example.com']
```

This is the same object the driver receives. See [Raw SQL](./raw-sql.html).

## Why are there no entity classes?

Because the moment the ORM owns your objects it has to track them, and tracking is what produces identity maps, proxies and flush-order bugs. A read returns plain data; what you build from it is
yours. See [Why fetched rows are inert](./inert-rows.html).

## Do I need `reflect-metadata`?

No. Nothing in zmdb reads runtime type metadata. The `@zmdb/web` decorators record routes and providers in ordinary maps.

## How do relations get loaded?

Explicitly. `populate` issues one additional query per requested relation, batched with an `IN` over the collected keys; `findJoined` / `joinRelation` produce a single joined statement. A relation you
did not ask for is absent from the _type_, so there is no accidental lazy load. See [Loading Strategies](./loading-strategies.html).

## Is there an `ON CONFLICT` / upsert?

Not yet — see [Upsert](./upsert.html) for the gap and the two-statement workaround.

## Can I use Zod alongside zmdb?

Yes, through JSON Schema — `toJsonSchema()` in either direction. You do not need it for validation, and mixing the two means two validators over one type. See [Zod](./interop-zod.html).

## Can `@zmdb/web` stream a response?

Yes. `WebResponse.body` is a tagged text/bytes/stream union, with `stream()`, `bytes()` and `file()` factories. Compression and confined static-file serving remain separate features. See
[Streaming Files](./web-streaming-files.html).

## What is the Node version floor?

Node 26. zmdb is ESM-only and uses `node:sqlite`, `AsyncDisposable` and modern decorators.

## How do I run the benchmarks?

`yarn bench`. It initialises the three upstream benchmark suites as submodules, applies the zmdb participant patches, runs what is feasible on your machine, and writes the dashboard JSON. See
[Benchmarks](./benchmarks.html).

## Something is marked ToDo. Is it rejected or deferred?

Deferred. Anything genuinely rejected is on the [anti-patterns page](./anti-patterns.html) with the argument for rejecting it. A **ToDo** page names the specific missing piece and where it would plug
in.

---

See also: [Gotchas](./gotchas.html) · [Goodies](./goodies.html) · [Why zmdb](./why-zmdb.html) · [Anti-patterns](./anti-patterns.html)
