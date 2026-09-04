# zmdb

> A TypeScript data layer framework that eliminates schema drift maintenance hell.
> Written entire by LLMs

```text
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.         │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package                                             | Status | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zmdb/schema-core`](./packages/schema-core)       | ✅     | The tag vocabulary + the IR + type derivation (Entity/CreateDTO/UpdateDTO/ReadDTO, relations, OpenAPI) + LLM tool specs, a bounded chat loop, and MCP server/client cores                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [`@zmdb/query-compiler`](./packages/query-compiler) | ✅     | SELECT/INSERT/UPDATE/DELETE + dialects + JOINs + aggregations + FTS + catalog introspection/declaration emission + migration diff/DDL/runner                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`@zmdb/aot-validator`](./packages/aot-validator)   | ✅     | AOT inlining + full/shallow is/assert/validate, equals/random, unions, transforms, JSON Ser/De and protobuf descriptors/codecs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`@zmdb/repository`](./packages/repository)         | ✅     | Auto-validating CRUD + hooks + transactions + populate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [`@zmdb/web`](./packages/web)                       | ✅     | Stage-3 decorator web framework: controllers, startup-built API versioning, typed `Ctx`, compile-time DI, domain state machines, request pipeline + adapters, streaming, confined static files, gzip/deflate compression, modules, guards/pipes/interceptors/filters, app bootstrap + lifecycle, DTO validation/serialization, OpenAPI, health probes, opt-in tracing/metrics and transport propagation, typed application events and command boundaries, Redis/NATS/RabbitMQ strategies, SQL-backed queues, cron and interval scheduling, WS/SSE, testing — zero `reflect-metadata`, zero runtime reflection |

> Status legend:
> ✅ complete.
> 🚧 in progress.
> 🔜 planned.
>
> Measured status: **2,281 tests green** across 212 files, with **144 expected-failing tests**.
> Of 742 upstream public-API suites, 503 are covered and 239 are argued against.
> Of 276 docs-site pages, 223 are supported, 41 are TODO, and 12 are not planned.

## Quick Start

Install once — the `zmdb` umbrella package re-exports the whole ecosystem:

```bash
npm add zmdb@alpha
```

```typescript
import { DatabaseSync } from 'node:sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

// Define once — a table is a type. The tags say what TypeScript has no syntax for,
// and they are phantom symbols, so this declaration compiles to no JavaScript.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// Wire a fully typed repository in one call — no subclass, no hand-written driver
const users = defineRepository(schemaOf<User>(), sqliteDriver(new DatabaseSync('app.db')), { dialect: 'sqlite' });

await users.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
const admins = await users.find({ role: 'admin' }); // typed WhereDTO<S>
const page = await users.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
```

`schemaOf<T>()` is a compile-time call: its answer is a function of a type argument,
and type arguments do not exist at runtime. Wire the build plugin (or run the codegen
CLI) once — see [AOT setup](https://ambasta.github.io/zmdb/docs/aot-setup.html). An
untransformed build throws a message saying so; it does not hand back an empty schema.

Prefer granular installs (`@zmdb/schema-core`, …) and subclassing `BaseRepository`?
Both are fully supported — see the [Quick Start](https://ambasta.github.io/zmdb/docs/quick-start.html).

## Documentation

📚 **Full documentation site:** **<https://ambasta.github.io/zmdb/>** schema, CRUD, relations, transactions, migrations, the query builder, validators and Ser/De are written up in full.
**Every page has a body**: The read/query DTOs, filters, pagination, projections, populate/join/aggregate results, schema objects, set operations, batch, read replicas, custom types, seeding, entity
modeling, framework integrations, and the LLM harness are all documented.

Features that are **anti-patterns** for a zero-overhead / no-proxy / AOT data layer (identity map, unit-of-work auto-flush, lazy proxy relations, JIT mappers, …) are deliberately excluded and
explained on the [Anti-patterns](https://ambasta.github.io/zmdb/docs/anti-patterns.html) page.

See also [ARCHITECTURE.md](./ARCHITECTURE.md) and the [COOKBOOK.md](./COOKBOOK.md).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full details, and the [COOKBOOK.md](./COOKBOOK.md) for real-world usage (model definition, CRUD, transactions, relations, validation, Ser/De, JSON/OpenAPI).

## Benchmarks

We run zmdb inside the **actual upstream benchmark harnesses** against the **real competitor libraries** — including the real drizzle-benchmarks method (HTTP server per ORM + k6 load) against
**PostgreSQL 16**. This honestly surfaces both throughput and, crucially, **which routes/cases zmdb cannot express** (each listed individually, never summed into a score):

- **ORM** — [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
  routes + k6 vs Drizzle / Kysely. **zmdb now serves all 13 routes (0 DNF)** - joins (#85/#88), aggregations (#90/#93), and full-text search (#95/#97) are implemented and each previously-DNF route
  returns HTTP 200 with correct data, verified on real Postgres. On the **full 13-route k6 run** (real Northwind, 427k-request replay) zmdb leads on throughput (2,916 req/s) and average latency
  (102ms); **drizzle keeps the best tail** (p95 173.8ms vs zmdb 215.5) — a real trade-off, not a "fastest ORM" claim. Server-side prepared statements (`ZMDB_PREPARED=1`) reproducibly lift
  zmdb to 3,068 req/s / 97ms avg and narrow the tail (p95 209.5) — kept opt-in to preserve the zero-state default. (Aggregate routes also use a different projection shape; see RESULTS.md.)
- **Validation** — [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks) runner vs Zod v3/v4, Valibot, Ajv, TypeBox, ArkType, myzod. zmdb covers all 4
  cases (no DNF) but runs its **runtime** validator (the AOT transformer is not yet a wired build plugin), so JIT/AOT libraries are 6–24× faster on assert - the AOT premise is unproven here and not claimed.

**Honesty policy:** DNF routes/cases are enumerated individually, not aggregated. Typia (needs its AOT build) and Prisma (engine not installed) are DNF. We never silently skip or fake an in-scope
case, and we do not claim a "fastest" title we have not earned across the full workload.

Full results + per-route/per-case DNF listings:
[`benchmarks/RESULTS.md`](./benchmarks/RESULTS.md). Reproduction (HTTP servers + k6 + Postgres-via-podman): [`benchmarks/harness/`](./benchmarks/harness).

📊 **Interactive dashboard** (charts + Node/Bun/Deno tabs, like the upstream sites): **<https://ambasta.github.io/zmdb/benchmarks/>**

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](./LICENSE).
