# zmdb

> A TypeScript data layer that keeps schemas, types, validation, and SQL in sync. The codebase was written entirely by LLMs.

```text
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.         │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package                                             | Status | What it provides                                                                     |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| [`@zmdb/client`](./packages/client)                 | ✅     | Dependency-free generated-client transport, cancellation, authentication, and errors |
| [`@zmdb/query-compiler`](./packages/query-compiler) | ✅     | SQL compilation, dialect support, introspection, DDL, and migrations                 |
| [`@zmdb/schema-core`](./packages/schema-core)       | ✅     | Schema tags, the shared IR, derived DTOs, relations, and OpenAPI                     |
| [`@zmdb/ai`](./packages/ai)                         | ✅     | Provider-neutral tool documents, bounded chat, invocation, and OpenAPI tools         |
| [`@zmdb/ai-anthropic`](./packages/ai-anthropic)     | ✅     | Optional Anthropic Messages driver for the provider-neutral chat contract            |
| [`@zmdb/ai-langchain`](./packages/ai-langchain)     | ✅     | Optional LangChain structured-tool integration over the shared AI contract           |
| [`@zmdb/ai-vercel`](./packages/ai-vercel)           | ✅     | Optional Vercel AI SDK tool integration with caller-owned schema branding            |
| [`@zmdb/mcp`](./packages/mcp)                       | ✅     | Transport-neutral MCP client/server cores, identity, validation, and call budgets    |
| [`@zmdb/protobuf`](./packages/protobuf)             | ✅     | Zero-dependency protobuf calls, typed gRPC artifacts, and generated-code wire ABI    |
| [`@zmdb/aot-validator`](./packages/aot-validator)   | ✅     | Build-time validation, serialization, reflection, and artifact emission              |
| [`@zmdb/repository`](./packages/repository)         | ✅     | Typed CRUD, transactions, relations, loaders, caching, and streaming                 |
| [`@zmdb/app`](./packages/app)                       | ✅     | Protocol-neutral metadata, DI, modules, lifecycle, commands, events, and CQRS        |
| [`@zmdb/web`](./packages/web)                       | ✅     | HTTP controllers, middleware, OpenAPI, gateways, testing, and runtime adapters       |
| [`zmdb`](./packages/zmdb)                           | ✅     | The curated one-install product facade and CLI                                       |

> Status legend: ✅ complete. 🚧 in progress. 🔜 planned.
>
> The workspace publishes **14 packages** across **126 export-map entry points**. The current suite has **2,862 passing tests** across 260 files, plus **84 expected failures** that describe work still
> to be done. The compatibility inventory covers 504 of 742 upstream API suites and explains why the other 238 are out of scope. The documentation site contains 261 supported pages, 3 TODO pages, and
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
import { defineRepository, schemaOf } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

// A table is a TypeScript type. Tags carry the database details that TypeScript
// cannot express on its own, and disappear from the emitted JavaScript.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// Create a typed repository without a subclass.
const users = defineRepository(schemaOf<User>(), sqliteDriver(new DatabaseSync('app.db')), { dialect: 'sqlite' });

await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
```

`schemaOf<T>()` is resolved at build time because TypeScript erases type arguments before the program runs. Set up the build plugin, or run the code generator, as described in
[AOT setup](https://ambasta.github.io/zmdb/docs/aot-setup.html). Calling untransformed code fails with a clear error instead of returning an empty schema.

You can also install individual packages or subclass `BaseRepository`. The [full quick start](https://ambasta.github.io/zmdb/docs/quick-start.html) covers both approaches.

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
