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

```ts {"mode":"compile","id":"example-001"}
import { createQueryCompiler, trustedTable } from '@zmdb/sql';
import { postgres } from '@zmdb/postgres';

const q = createQueryCompiler(postgres).selectFrom(trustedTable('users')).where('email', '=', 'a@example.com').compile();

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

## Can I build a closed-source product or a paid service on zmdb?

Yes, either one. zmdb is [MPL-2.0](https://github.com/ambasta/zmdb/blob/main/LICENSE), which is file-level copyleft: it covers zmdb's own source files and nothing else. Your application is a "Larger
Work" under Section 3.3 and you license it however you want — proprietary, commercial, or never published at all. There is no network clause anywhere in the license, so running zmdb inside a hosted
service triggers nothing.

## What do I have to publish, then?

Only zmdb's own files, and only if you change them and ship the result to someone. That person is entitled to your modified version of those files (Section 3.2(a)); you can hand them a patch, a fork
URL, or a tarball. Upstreaming is welcome but never required, and if you never distribute your changes you owe nobody anything.

## Does the code zmdb generates into my repository become MPL?

No. Compiler output, generated clients and OpenAPI documents, migrations, and CLI scaffolding are explicitly excluded by the
[Generated Output Exception](https://github.com/ambasta/zmdb/blob/main/LICENSE-EXCEPTION.md), granted under MPL Section 10.2. That covers the ahead-of-time transform rewriting your own modules in
place, which is the case worth being explicit about: the code the transform inlines into your file is yours, and inlining, bundling, minifying, or tree-shaking it changes nothing.

## My bundler inlines zmdb into one output file. What changes?

Your obligation is still limited to zmdb's source. Bundling makes zmdb's code part of what you distribute, so recipients are entitled to _zmdb's_ source — which you discharge by pointing at the
published npm package or the matching Git tag. It does not pull your own modules into the license, and MPL Section 3.2(b) says so directly: you may distribute the executable form of a Larger Work
under your own terms as long as the Covered Software's source stays available.

---

See also: [Gotchas](./gotchas.html) · [Goodies](./goodies.html) · [Why zmdb](./why-zmdb.html) · [Anti-patterns](./anti-patterns.html)
