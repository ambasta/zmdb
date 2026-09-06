# zmdb

> A TypeScript data layer that keeps schemas, types, validation, and SQL in sync. The codebase was written entirely by LLMs.

```text
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.         │
└─────────────────────────────────────────────────────────────┘
```

## Product and packages

Install `zmdb` for the cohesive schema, validation, typed ORM, migration, HTTP, configuration, and CLI product facade, then add the selected database vertical explicitly. SQLite applications install
`@zmdb/sqlite`; MySQL applications install `@zmdb/mysql` with `mysql2`. The other independently installable `@zmdb/*` packages are advanced dependency firebreaks, integrations, and tooling rather than
a second beginner setup. Their membership, product roles, facade exposure, documentation ownership, and external-consumer evidence come from the
[canonical product catalog](./scripts/product/catalog.mjs); the [package reference](./docs-site/content/package-reference.md) renders that inventory.

CockroachDB is selected through `@zmdb/cockroach`, a one-way child of `@zmdb/postgres` that owns Cockroach-specific types, migrations, catalog normalization, retries, and its real-server acceptance.
SingleStore is selected through `@zmdb/singlestore`, a one-way child of `@zmdb/mysql` that owns storage/distribution DDL, catalog normalization, conservative refusals, and mandatory packed real-server
acceptance.

AI and MCP stay outside the product facade: install provider-neutral `@zmdb/ai`, then add only the Anthropic, LangChain, Vercel AI SDK, or MCP package the application uses. The
[LLM package and migration guide](./docs-site/content/llm-strategy.md) lists the exact installs, optional peers, and replacements for every removed schema-core LLM subpath.

Background jobs are selected the same way: install `@zmdb/jobs` only when an application needs queues or schedules, then pass `jobsExtension(...)` through the existing application lifecycle. The
default `zmdb` install has no jobs dependency and deliberately exposes no `zmdb/jobs` compatibility facade.

React is opt-in as well: install `@zmdb/react` only when a generated client needs React context and component-lifecycle ownership.

React Native is opt-in too: install `@zmdb/react-native` with React and React Native when the same generated client needs AppState cancellation, explicit offline policy, and application-selected
connectivity and credential storage.

Angular is opt-in too: install `@zmdb/angular` with Angular core and RxJS when a generated client needs dependency injection, signals, `DestroyRef`, and Observable cancellation.

Vue is opt-in too: install `@zmdb/vue` with Vue 3 when a generated client needs application injection, reactive query/mutation state, scope cancellation, and per-application SSR isolation.

Svelte is opt-in too: install `@zmdb/svelte` only when a generated client needs typed Svelte context, subscription-aware stores, and component-lifecycle cancellation.

SvelteKit is a separate opt-in layer: install `@zmdb/sveltekit` when server loads need request-local `event.fetch`, explicit credential forwarding, native framework errors, and abandoned-navigation
cancellation. Its browser entry reuses `@zmdb/svelte`; its server entry is physically separate.

Next.js is opt-in: install `@zmdb/next` for request-scoped App Router server clients and browser bindings over `@zmdb/react`, without adding Next or React to the default product.

Nuxt is opt-in too: install `@zmdb/nuxt` for request-scoped Nitro transport, native hydration, and browser bindings over `@zmdb/vue`, without adding Nuxt or Vue to the default product.

Solid is opt-in too: install `@zmdb/solid` with Solid 1 when a generated client needs typed context, native resources, owner cancellation, and native Suspense/error propagation.

All nine UI and meta-framework packages consume the same generated HTTP client. The [Client Applications guide](./docs-site/content/framework-integrations.md) compares their CSR, SSR, hydration,
cancellation, and native-lifecycle ownership before linking to one framework-native guide per package.

Optional server integrations stay outside the `zmdb` default install:

- `@zmdb/protobuf` has no peer or external resource; `@zmdb/compiler` emits its artifacts.
- `@zmdb/mssql` requires `mssql@^12.7.0`; the application constructs and owns the pool while the package supplies the complete T-SQL compiler, migration, structural-driver, and catalog-introspection
  vertical.
- `@zmdb/singlestore` accepts a consumer-owned `mysql2@^3.24.3` pool and binds it to the SingleStore dialect without installing the client as a hard dependency.
- `@zmdb/transport-grpc` requires `@grpc/grpc-js@^1.14.0`; the application owns the server extension and the caller closes each client.
- `@zmdb/transport-nats` requires `@nats-io/transport-node@^3.4.0`; the application extension starts, drains, and closes its connection.
- `@zmdb/transport-rabbitmq` requires `amqplib@^2.0.1`; the application extension owns its connection, channels, retry, and dead-letter setup.
- `@zmdb/transport-redis` requires `redis@^6.2.1`; the application extension owns its publisher/subscriber clients and bounded drain.
- `@zmdb/jobs-postgres` requires `pg@^8.23.0`; the caller owns the pool/client and the adapter never closes or releases it.
- `@zmdb/otel` requires `@opentelemetry/api@^1.9.0`; the caller owns providers, exporters, tracers, meters, and shutdown.

`@zmdb/protobuf` owns source calls, typed gRPC artifacts, and the generated-code wire ABI. `@zmdb/compiler` owns build-time reflection and emission, while `@zmdb/aot-validator` is the compiler-free
validation runtime.

Compiler tooling is independently usable: install `@zmdb/compiler` when a build, linter, Metro project, or no-bundler workflow needs the TypeScript front end directly. The
[installation guide](./docs-site/content/installation.md) and package-specific guides contain copy-pasteable commands.

> The workspace publishes **38 packages** across **185 export-map entry points**. The current suite has **3,346 passing tests** across 312 files, plus **57 expected failures** that describe work still
> to be done. The compatibility inventory covers 504 of 742 upstream API suites and explains why the other 238 are out of scope. The documentation site contains 271 supported pages, 3 TODO pages, and
> 13 pages for features we do not plan to add.

## Quick Start

Create a formatter-clean SQLite project with the packaged CLI:

```bash
npx zmdb@alpha new project blog
cd blog
npm install
npm run check
npm run build
npm start
```

The generated project includes a strict TypeScript config, AOT build adapter, health route and behavioural test, and `zmdb.config.ts`. Add a table declaration, then generate and apply its reviewed
migration through the same executable:

```bash
npx zmdb new schema user
npx zmdb generate --name initial
npx zmdb migrate
```

```typescript
import { DatabaseSync } from 'node:sqlite';
import { defineRepository, schemaOf, type HasDefault, type PrimaryKey, type Serial, type Sql, type Table } from 'zmdb';
import { sqliteDriver } from 'zmdb/sqlite';

// A table is a TypeScript type. Tags carry the database details that TypeScript
// cannot express on its own, and disappear from the emitted JavaScript.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// Create a typed repository without a subclass.
const users = defineRepository(schemaOf<User>(), sqliteDriver(new DatabaseSync('app.db')));

await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
```

The default import is the lazy, logic-free application surface. Focused APIs remain available from `zmdb/schema`, `zmdb/sql`, `zmdb/validator`, `zmdb/orm`, `zmdb/web`, `zmdb/migrations`,
`zmdb/compiler`, and `zmdb/testing`; optional integrations are installed separately.

`schemaOf<T>()` is resolved at build time because TypeScript erases type arguments before the program runs. Set up the build plugin, or run the code generator, as described in
[AOT setup](https://ambasta.github.io/zmdb/docs/aot-setup.html). Calling untransformed code fails with a clear error instead of returning an empty schema.

You can also install individual packages or subclass `BaseRepository` from `zmdb/orm`. The [full quick start](https://ambasta.github.io/zmdb/docs/quick-start.html) covers both approaches.

## One HTTP contract, two public artifacts

An explicit `@zmdb/web/contract` declaration drives runtime routing, OpenAPI, and generated client code. `npx zmdb client generate` emits OpenAPI JSON and a typed TypeScript client as sibling outputs;
`--check` rejects stale committed bytes and `--watch` follows the compiled contract dependency set.

The generated module imports only the dependency-free `@zmdb/client` runtime, accepts caller-supplied authentication and cancellation, and runs in browser or Node bundles. The
[generated-client guide](https://ambasta.github.io/zmdb/docs/generated-client.html) covers the complete journey and the separate low-level manual `@zmdb/client` path.

## Documentation

The [documentation site](https://ambasta.github.io/zmdb/) covers schemas, CRUD, relations, transactions, migrations, query building, validation, serialization, the web framework, and the remaining
roadmap.

Some familiar ORM features conflict with zmdb's no-proxy, ahead-of-time design. The [anti-patterns guide](https://ambasta.github.io/zmdb/docs/anti-patterns.html) explains why identity maps, automatic
unit-of-work flushes, lazy relation proxies, and JIT mappers are not part of the project.

See also [ARCHITECTURE.md](./ARCHITECTURE.md) and the [COOKBOOK.md](./COOKBOOK.md).

## Architecture

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the policy-generated package graph and admission workflow, [PUBLISHING.md](./PUBLISHING.md) for the current executable publication workflow,
[`scripts/release/SPEC.md`](./scripts/release/SPEC.md) for the frozen release-group and compatibility contract, and [COOKBOOK.md](./COOKBOOK.md) for practical examples.

## Benchmarks

The benchmark suite uses the upstream projects and their normal workloads. The ORM comparison runs the 13 [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks) routes against
PostgreSQL 16 and replays them with k6. zmdb supports every route, including joins, aggregates, and full-text search.

In the recorded Northwind run, zmdb handled 2,916 requests per second with 102 ms average latency. Drizzle had the better tail latency: 173.8 ms at p95, compared with 215.5 ms for zmdb. Enabling
prepared statements with `ZMDB_PREPARED=1` raised zmdb to 3,068 requests per second, lowered the average to 97 ms, and brought p95 down to 209.5 ms. Prepared statements remain opt-in because the
default repository does not keep hidden statement state.

The validation comparison uses [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks). The runtime validator covers all four cases, but it is slower than
libraries that generate or compile validators. The separate AOT benchmark measures zmdb's generated path.

Unsupported cases are listed individually. Typia is omitted when its build step is unavailable, and Prisma is omitted when its engine is not installed.

See [`benchmarks/RESULTS.md`](./benchmarks/RESULTS.md) for the full results and [`benchmarks/harness/`](./benchmarks/harness) for reproduction instructions.

📊 **Interactive dashboard** (charts + Node/Bun/Deno tabs, like the upstream sites): **<https://ambasta.github.io/zmdb/benchmarks/>**

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](./LICENSE).
