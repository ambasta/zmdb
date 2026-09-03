# zmdb

> A TypeScript data layer framework that eliminates schema drift maintenance hell.

```
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.        │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package                                             | Status | Description                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zmdb/schema-core`](./packages/schema-core)       | ✅     | The tag vocabulary + the IR + type derivation (Entity/CreateDTO/UpdateDTO/ReadDTO, relations, OpenAPI)                                                                                                                                                                                                                    |
| [`@zmdb/query-compiler`](./packages/query-compiler) | ✅     | SELECT/INSERT/UPDATE/DELETE + dialects + JOINs + aggregations + FTS + migration diff/DDL/runner                                                                                                                                                                                                                           |
| [`@zmdb/aot-validator`](./packages/aot-validator)   | ✅     | AOT inlining + is/assert/validate/equals/random, unions, transforms, Ser/De                                                                                                                                                                                                                                               |
| [`@zmdb/repository`](./packages/repository)         | ✅     | Auto-validating CRUD + hooks + transactions + populate                                                                                                                                                                                                                                                                    |
| [`@zmdb/web`](./packages/web)                       | ✅     | Stage-3 decorator web framework: controllers, routing, typed `Ctx`, compile-time DI, domain state machines, request pipeline + adapters, modules, guards/pipes/interceptors/filters, app bootstrap + lifecycle, DTO validation/serialization, OpenAPI, WS/SSE, testing — zero `reflect-metadata`, zero runtime reflection |

> Status legend: ✅ complete (all tracked sub-issues closed) · 🚧 in progress · 🔜 planned.
> All capability epics are complete — **every tracked issue is closed** across
> the original core (#1–#10, #62), benchmarking (#68), the perf/DNF epics
> (#75–#78), and the follow-up feature-gap epics: the read/query **DTO family**
> (Get/List/Search/Projection, typed WhereDTO/OrderBy/Pagination, typed
> populate/join/aggregate results, OpenAPI get/list/search), **schema objects**
> (indexes, views, sequences, generated columns, namespaces, RLS), **set
> operations + batch**, **read replicas**, **custom types & codecs**,
> **seeding**, **entity modeling** (lifecycle events, embeddables, inheritance),
> **framework integrations**, and an **LLM function-calling** harness. **1,186
> tests green** across 154 files, including real `node:sqlite` E2E, a Kysely
> head-to-head, and the full validation + ORM benchmark suites (real PostgreSQL).
> Alongside them, **157 expected-failing tests** hold the frozen specs of features
> not yet built: each one calls the API the spec requires and carries the output
> today's code produces, so a gap is a number in the summary line rather than a
> paragraph in a design document.
> Those tests are held against the 742 public-API suites Drizzle, Kysely,
> MikroORM, NestJS and Typia run between them: 453 are answered by a named zmdb
> test, 289 are argued against in writing, and `yarn verify:api-coverage` fails
> on a suite that is neither.
> Of the 276 docs-site pages, 191 document a capability that exists and 85 are
> marked `todo` — a page that argues for a feature gap rather than describing one,
> counted by `yarn verify:docs-coverage`.

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

📚 **Full documentation site:** **https://ambasta.github.io/zmdb/** — schema,
CRUD, relations, transactions, migrations, the query builder, validators and
Ser/De are written up in full. The docs incorporate the union of the
[MikroORM](https://mikro-orm.io/docs/guide),
[Drizzle](https://orm.drizzle.team/docs/overview) and
[Typia](https://typia.io/docs) documentation surfaces — 396 upstream pages, every
one either mapped to a zmdb page or argued against, which is what
`yarn verify:docs-coverage` checks. **Every page has a body**: the read/query
DTOs, filters, pagination, projections, populate/join/aggregate results, schema
objects, set operations, batch, read replicas, custom types, seeding, entity
modeling, framework integrations, and the LLM harness are all documented. A page
marked `todo` is one whose subject zmdb does not do yet; it says so, says what it
would take, and shows the workaround. Features that are
**anti-patterns** for a zero-overhead / no-proxy / AOT data layer (identity map,
unit-of-work auto-flush, lazy proxy relations, JIT mappers, …) are deliberately
excluded and explained on the
[Anti-patterns](https://ambasta.github.io/zmdb/docs/anti-patterns.html) page.

See also [ARCHITECTURE.md](./ARCHITECTURE.md) and the [COOKBOOK.md](./COOKBOOK.md).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full details, and the
[COOKBOOK.md](./COOKBOOK.md) for real-world usage (model definition, CRUD,
transactions, relations, validation, Ser/De, JSON/OpenAPI).

## Benchmarks

We run zmdb inside the **actual upstream benchmark harnesses** against the
**real competitor libraries** — including the real drizzle-benchmarks method
(HTTP server per ORM + k6 load) against **real PostgreSQL 16**. This honestly
surfaces both throughput and, crucially, **which routes/cases zmdb cannot
express** (each listed individually, never summed into a score):

- **ORM** — [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
  routes + k6 vs Drizzle / Kysely. **zmdb now serves all 13 routes (0 DNF)** —
  joins (#85/#88), aggregations (#90/#93), and full-text search (#95/#97) are
  implemented and each previously-DNF route returns HTTP 200 with correct data,
  verified on real Postgres. On the **full 13-route k6 run** (real Northwind,
  427k-request replay) zmdb leads on throughput (2,916 req/s) and average latency
  (102ms); **drizzle keeps the best tail** (p95 173.8ms vs zmdb 215.5) — a real
  trade-off, not a "fastest ORM" claim. Server-side prepared statements
  (`ZMDB_PREPARED=1`) reproducibly lift zmdb to 3,068 req/s / 97ms avg and narrow
  the tail (p95 209.5) — kept opt-in to preserve the zero-state default. (Aggregate
  routes also use a different projection shape; see RESULTS.md.)
- **Validation** — [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
  runner vs Zod v3/v4, Valibot, Ajv, TypeBox, ArkType, myzod. zmdb covers all 4
  cases (no DNF) but runs its **runtime** validator (the AOT transformer is not
  yet a wired build plugin), so JIT/AOT libraries are 6–24× faster on assert —
  the AOT premise is unproven here and not claimed.

**Honesty policy:** DNF routes/cases are enumerated individually, not aggregated.
Typia (needs its AOT build) and Prisma (engine not installed) are DNF. We never
silently skip or fake an in-scope case, and we do not claim a "fastest" title we
have not earned across the full workload.

Full results + per-route/per-case DNF listings:
[`benchmarks/RESULTS.md`](./benchmarks/RESULTS.md). Reproduction (HTTP servers +
k6 + Postgres-via-podman): [`benchmarks/harness/`](./benchmarks/harness).

📊 **Interactive dashboard** (charts + Node/Bun/Deno tabs, like the upstream
sites): **https://ambasta.github.io/zmdb/benchmarks/**

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](./LICENSE).
