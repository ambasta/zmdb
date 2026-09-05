# zmdb

> A TypeScript data layer that keeps schemas, types, validation, and SQL in sync. The codebase was written entirely by LLMs.

```text
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.         │
└─────────────────────────────────────────────────────────────┘
```

## Product and packages

Install `zmdb` for the curated product facade and CLI, plus the database vertical selected by the application. The SQLite quick start uses `@zmdb/sqlite`. The other independently installable `@zmdb/*`
packages are advanced dependency firebreaks, integrations, and tooling rather than a second beginner setup. Their membership, product roles, facade exposure, documentation ownership, and
external-consumer evidence come from the [canonical product catalog](./scripts/product/catalog.mjs); the [package reference](./docs-site/content/package-reference.md) renders that inventory.

AI and MCP stay outside the umbrella: install provider-neutral `@zmdb/ai`, then add only the Anthropic, LangChain, Vercel AI SDK, or MCP package the application uses. The
[LLM package and migration guide](./docs-site/content/llm-strategy.md) lists the exact installs, optional peers, and replacements for every removed schema-core LLM subpath.

OpenTelemetry is also opt-in: install `@zmdb/otel` only when adapting caller-owned tracers and meters to the application observability ports.

Core NATS messaging is opt-in: install `@zmdb/transport-nats` with `@nats-io/transport-node`; neither the application kernel nor the HTTP package owns that peer.

React is opt-in as well: install `@zmdb/react` only when a generated client needs React context and component-lifecycle ownership.

Typed gRPC is opt-in: install `@zmdb/transport-grpc` with grpc-js when an application needs generated protobuf services, streaming clients and a bounded server extension.

RabbitMQ is opt-in too: install `@zmdb/transport-rabbitmq` with `amqplib` only when an application selects its confirmed retry and dead-letter transport.

> The workspace publishes **21 packages** across **125 export-map entry points**. The current suite has **2,996 passing tests** across 273 files, plus **159 expected failures** that describe work
> still to be done. The compatibility inventory covers 504 of 742 upstream API suites and explains why the other 238 are out of scope. The documentation site contains 262 supported pages, 3 TODO
> pages, and 13 pages for features we do not plan to add.

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
import { sqlite, sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

// A table is a TypeScript type. Tags carry the database details that TypeScript
// cannot express on its own, and disappear from the emitted JavaScript.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// Create a typed repository without a subclass.
const users = defineRepository(schemaOf<User>(), sqliteDriver(new DatabaseSync('app.db')), { dialect: sqlite });

await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
```

`schemaOf<T>()` is resolved at build time because TypeScript erases type arguments before the program runs. Set up the build plugin, or run the code generator, as described in
[AOT setup](https://ambasta.github.io/zmdb/docs/aot-setup.html). Calling untransformed code fails with a clear error instead of returning an empty schema.

You can also install individual packages or subclass `BaseRepository`. The [full quick start](https://ambasta.github.io/zmdb/docs/quick-start.html) covers both approaches.

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

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and [COOKBOOK.md](./COOKBOOK.md) for practical examples.

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
