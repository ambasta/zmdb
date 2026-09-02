# Product Requirements Document — zmdb

## One TypeScript backend ecosystem: NestJS + Typia + MikroORM + Kysely, replaced under a single umbrella

> **Status:** unified PRD — the single product requirement of record. Replaces
> `Stage3_Decorator_Framework_PRD.md` and `zero_maintenance_data_layer_prd.md`, both
> absorbed in full and **now deleted** (history in git). See §13 for the clause-by-clause
> reconciliation, including the four places where the source documents contradicted each
> other or the shipped code.
> **Baseline (hard floor):** Node.js **26+**, TypeScript **7+**, **ESM-only**, Stage 3 standard decorators.
> **Companion docs:** `ARCHITECTURE.md` (how we build it), each package's `SPEC.md` (component contracts),
> `benchmarks/RESULTS.md` (what is measured), `COOKBOOK.md` (how it is used).
> **Last revised:** 2026-09-02.

---

## 1. Executive summary

A TypeScript backend team today assembles its stack from four unrelated
libraries — **NestJS** (HTTP framework + DI), **Typia** (boundary validation),
**MikroORM** (entities + repositories), **Kysely** (SQL) — and then pays, forever,
for the seams between them. The seams cost two things: **maintenance** (one column
added → 4–5 hand-edited layers) and **runtime performance** (reflection lookups,
proxy traps, runtime schema parsing, per-request metadata reads).

**zmdb is one ecosystem that replaces all four**, built on a single thesis:

> **Every unit of work that can happen before runtime must happen before runtime.**
> Types derive at type-check time. Validators inline at build time. Routes and the
> DI graph resolve at init time. Runtime does only the irreducible work: one SQL
> round-trip, a boolean chain, one object shape.

This yields the two product guarantees that the source PRDs asked for separately,
now as one:

1. **Zero-maintenance schema** — the developer edits one file; entities, create/update/read
   DTOs, query filters, validators, response serializers, OpenAPI, and controller
   signatures all re-derive, and anything left inconsistent is a **compile error**, not a
   production 500.
2. **Zero-overhead runtime** — no `reflect-metadata`, no proxies, no identity map, no
   change tracking, no runtime parser, no dynamic route lookup. What ships is the code
   the developer would have written by hand.

Six packages, one install (`zmdb`), zero required third-party runtime dependencies.

---

## 2. The problem — two halves of one tax

### 2.1 The maintenance half (data layer)

Adding `orders.discount_code` to a conventional stack requires edits to: the SQL
migration, the ORM entity, the Zod/TypeBox validation schema, the inbound `CreateOrderDto`,
the `UpdateOrderDto`, and the outbound API response type. Six edits, one intent. Miss one
and the failure surfaces at runtime, in production, as a silently dropped field or a 500.
This is **schema drift maintenance hell**.

### 2.2 The performance half (framework layer)

The same stack pays per request, forever, for work that was knowable at build time:

| Incumbent cost                              | Where it is paid     | zmdb's answer                              |
| ------------------------------------------- | -------------------- | ------------------------------------------ |
| `Reflect.getMetadata()` route/param lookup  | every request        | routes resolved once at boot (`getRoutes`) |
| `emitDecoratorMetadata` DI reflection       | every instantiation  | explicit tokens, resolved at class-init    |
| Runtime schema parsing (Zod/Valibot)        | every payload        | AOT-inlined boolean chains                 |
| Entity proxies / identity map / dirty flags | every read and write | plain inert objects, explicit writes       |
| Runtime query-object interpretation         | every query          | direct SQL string compilation              |

### 2.3 Why they are one problem

Both halves are the same defect: **work located to the right of where it belongs.** A
framework that fixes only the data half still pays the reflection tax at the HTTP
boundary; one that fixes only the HTTP half still forces hand-maintained DTOs. The
unification is the product: **the schema is the single source of truth for the _whole_
request lifecycle**, from URL to SQL and back.

---

## 3. Vision & positioning

### 3.1 The replacement matrix

| Incumbent    | Replaced by                              | What we keep                                                                                                                     | What we deliberately drop                                                                                              |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **NestJS**   | `@zmdb/web`                              | Controllers, decorators, modules, DI, guards/pipes/interceptors/filters, lifecycle, WS/SSE, OpenAPI, testing utils               | `reflect-metadata`, parameter decorators, `emitDecoratorMetadata`, runtime type reflection, per-request metadata reads |
| **Typia**    | `@zmdb/aot-validator`                    | `is`/`assert`/`validate`/`equals`/`random`, tags, unions, transforms, JSON Ser/De, AOT inlining                                  | dependence on a single bundler path; a separate schema language from the ORM's                                         |
| **MikroORM** | `@zmdb/schema-core` + `@zmdb/repository` | Entity modeling, repositories, relations/populate, transactions, lifecycle events, embeddables, inheritance, seeding, migrations | Identity map, unit-of-work auto-flush, lazy proxy relations, change tracking, JIT mappers                              |
| **Kysely**   | `@zmdb/query-compiler`                   | Typed SELECT/INSERT/UPDATE/DELETE, joins, aggregations, FTS, set ops, dialects, DDL, migration diff                              | A query builder that doesn't know about your entities (ours shares the schema)                                         |

### 3.2 The umbrella promise

```bash
npm add zmdb          # the whole ecosystem, one dependency, zero transitive third-party runtime deps
```

Granular installs (`@zmdb/schema-core`, `@zmdb/query-compiler`, …) remain fully supported
and independently useful — a user who wants **only** the Kysely replacement, or **only**
the Typia replacement, must be able to install exactly that (**REQ-UM-2**).

### 3.3 Non-goals (explicit)

- **Not a Prisma replacement.** We do not ship a separate schema language, a code-gen
  step producing a client, or a native query engine binary.
- **Not a Rails/Django.** No admin UI, no scaffolding CLI beyond migrations, no templating.
- **Not backwards-compatible with the ecosystem's past.** No CommonJS, no
  `experimentalDecorators`, no `reflect-metadata` interop shim, no Node < 26. Every one of
  these is a _feature_: it is code we get to delete (`ARCHITECTURE.md` §5).
- **Not a drop-in NestJS port.** Stage 3 has no parameter decorators; `@Body()`/`@Param()`
  cannot and will not exist. The typed `Ctx` object is the replacement, and migration is a
  mechanical rewrite, not a config flag (§8.4).

---

## 4. Product principles (non-negotiable)

Ordered. When two conflict, the lower number wins and the conflict is documented at the
call site.

### P1 — Push work left of runtime

```
type-check time   →   build time   →   install time   →   RUNTIME
(free for users)      (once, CI)       (once, npm i)       (per request — minimize!)
```

Anything at runtime that could have been resolved earlier is a **defect**, not a
trade-off. Allocation, indirection, reflection, and dynamic dispatch on the hot path are
defects.

### P2 — Single source of truth, pure derivation

- **One change vector.** A schema parameter changes in exactly _one_ file.
- **Dependent derivation.** Entities, create/update payloads, where-filters, order-by,
  pagination, projections, response shapes, validators, and OpenAPI are **derived**, never
  authored.
- **Zero duplicate properties.** Hand-writing a property that already exists in the
  schema is forbidden in framework code and unnecessary in consumer code.

### P3 — Compile-time enforcement over runtime checking

Domain invariants, illegal state transitions, route/param typing, and the DI graph are
expressed in the type system (template literal types, branded/phantom types, conditional
types). An invalid route, payload, injection, or state transition **must fail `tsc`**.

### P4 — Honest type safety (no escape hatches on the public surface)

- **Consumer code: zero assertions.** If a user must write `as` to use zmdb correctly,
  that is our bug.
- **Framework code: a reviewed, enumerated, shrinking exception list.** `any`,
  `unknown`-casting, `as T`, and `!` are defects _except_ at an enumerated **trust
  boundary** (driver row → `Entity<S>`, `JSON.parse` → `T`, `context.metadata` slot →
  typed record, brand attach), each carrying a `// boundary:` comment stating the runtime
  guarantee that makes it sound. Preference order: type guard > carrying generic >
  `satisfies` > commented boundary cast.

> This replaces the source PRD's absolute "zero escape hatches" claim, which its own
> sample code violated four times (§13). The honest invariant is: **assertion-free public
> surface, enumerated internal boundaries, count tracked toward zero.**
>
> ✅ **As of the 2026-09-01 recount (§9.4), P4 as written is met**: **28 framework
> assertions, all documented, under 37 `// boundary:` comments**, **0 `any`**, **0 non-null `!`**,
> **0 `@ts-expect-error` in src**, and **0 consumer-facing `as`** in the docs. The first
> audit on 2026-08-31 found **91 assertions / 14 boundary comments / 19 non-null `!` / 4 `as any`**;
> the gap was mechanical, not irreducible — four structural fixes account for all 63, see §9.4.
>
> This is still **not** "zero escape hatches": 28 assertions remain, each an argued trust
> boundary, and nothing in CI yet stops the count climbing back (RISK-7). The claim to make is
> the precise one — _assertion-free public surface, enumerated and individually justified
> internal boundaries, count ratcheted downward._

### P5 — Zero required runtime dependencies; ESM-only

Packages depend only on other `@zmdb/*` packages and Node built-ins. Third-party
integrations (a `pg` driver, a Hono adapter) are optional and **structurally typed**, so
the dependency is never forced. One module format, one `exports` map, no `.cjs`.

### P6 — Honest measurement

Performance claims are produced by the **real upstream benchmark harnesses** against the
**real competitor libraries**. Gaps, DNFs, and trade-offs are enumerated individually —
never averaged into a flattering score, never silently skipped. We do not claim a
"fastest" title we have not earned across a full workload.

---

## 5. Product architecture

### 5.1 The unified stack

```
                    ┌───────────────────────────────────────┐
                    │   SINGLE SOURCE OF TRUTH              │
                    │   defineSchema('orders', { … })       │
                    └───────────────────┬───────────────────┘
                                        │  (type-check time — 0 runtime cost)
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
┌───────────────┐            ┌───────────────────┐            ┌─────────────────┐
│ Entity<S>     │            │ CreateDTO<S>      │            │ WhereDTO<S>     │
│ (selectable)  │            │ UpdateDTO<S>      │            │ OrderBy/Page    │
│               │            │ (insertable)      │            │ Projection      │
└───────┬───────┘            └─────────┬─────────┘            └────────┬────────┘
        │                              │  (build time — AOT inlining)  │
        │                              ▼                               │
        │                    ┌───────────────────┐                      │
        │                    │ inlined validator │                      │
        │                    │ straight-line JS  │                      │
        │                    └─────────┬─────────┘                      │
        └──────────────┬───────────────┴───────────────┬────────────────┘
                       ▼                               ▼
        ┌──────────────────────────┐      ┌──────────────────────────────┐
        │  REPOSITORY ENGINE       │      │  WEB LAYER (@zmdb/web)       │
        │  • validates at boundary │◀─────│  • Stage 3 controllers       │
        │  • compiles native SQL   │  DI  │  • typed Ctx<Params,Body,Q>  │
        │  • no proxy, no identity │      │  • init-time route table     │
        │    map, no dirty check   │      │  • compile-time DI graph     │
        └──────────────┬───────────┘      │  • branded domain states     │
                       ▼                  │  • AOT response serializer   │
              ┌────────────────┐          │  • derived OpenAPI           │
              │  SQL + driver  │          └──────────────────────────────┘
              └────────────────┘
```

### 5.2 Package DAG (must stay acyclic)

```
@zmdb/schema-core  (root — the SoT; depends on nothing, imports no sibling)
        ├──────────────┬──────────────────┐
        ▼              ▼                  │
@zmdb/query-compiler   @zmdb/aot-validator│   (siblings; mutually unaware)
        └──────┬───────┘                  │
               ▼                          │
        @zmdb/repository ◀────────────────┘   (+ drivers: node:sqlite built-in, pg optional)
               ▼
        @zmdb/web                              (controllers inject repositories)
               ▼
            zmdb                               (umbrella — curated re-exports, ZERO logic)
```

### 5.3 Package responsibilities

| Package                | Replaces                               | Responsibility                                                                                                                                                                                                                            | Runtime deps                           |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@zmdb/schema-core`    | MikroORM entities, Zod/TypeBox schemas | Schema DSL, compile-time type derivation (Entity / Create / Update / read DTOs), relations, custom types, seeding, OpenAPI, LLM tool schemas                                                                                              | none                                   |
| `@zmdb/query-compiler` | **Kysely**                             | SQL-first compiler: select/insert/update/delete, joins, aggregations, FTS, set ops, schema-object DDL, migration diff, dialects                                                                                                           | none                                   |
| `@zmdb/aot-validator`  | **Typia**                              | AOT transformer + `is`/`assert`/`validate`/`equals`/`random`, tags, unions, transforms, JSON Ser/De                                                                                                                                       | none (`typescript` is a devDep)        |
| `@zmdb/repository`     | **MikroORM** EM/repos                  | Auto-validating typed CRUD, `defineRepository`, transactions, populate, read replicas, lifecycle events, entity modeling, drivers                                                                                                         | schema-core, query-compiler            |
| `@zmdb/web`            | **NestJS**                             | Stage-3 controllers, routing, typed `Ctx`, compile-time DI, domain state machines, request pipeline + adapters, modules, guards/pipes/interceptors/filters, bootstrap + lifecycle, DTO validation/serialization, OpenAPI, WS/SSE, testing | schema-core, aot-validator, repository |
| `zmdb`                 | the whole stack                        | Umbrella meta-package (curated root + subpath re-exports)                                                                                                                                                                                 | all of the above                       |

---

## 6. Functional requirements

Requirement IDs are stable and citable in issues/PRs. Each carries an acceptance
criterion (**AC**) that is machine-checkable.

### 6.1 Schema core — the single source of truth (REQ-SC)

| ID           | Requirement                                                                                                                                                                                                                                                   | AC                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **REQ-SC-1** | A schema is declared once via `defineSchema(table, columns)` with a chainable/typed column DSL (`serial`, `integer`, `text`, `numeric`, `jsonEnum`, …) plus modifiers (`primaryKey`, `notNull`, `nullable`, `unique`, `references`, `defaultTo`, `validate`). | Type test: the schema literal's column types survive into `Entity<S>` without widening.        |
| **REQ-SC-2** | `Entity<S>` is the selectable row shape.                                                                                                                                                                                                                      | `Expect<Equal<Entity<S>, …>>` matches the column set exactly; nullable columns include `null`. |
| **REQ-SC-3** | `CreateDTO<S>` **automatically strips** DB-generated values (identity/serial keys, defaulted columns, generated timestamps) and makes them optional.                                                                                                          | `@ts-expect-error` on supplying a serial PK; omitting a defaulted column type-checks.          |
| **REQ-SC-4** | `UpdateDTO<S>` is a partial of `CreateDTO<S>` preserving every structural constraint (no constraint loss through `Partial`).                                                                                                                                  | Type test: a tag/constraint present on a create field is present on the update field.          |
| **REQ-SC-5** | Read/query DTOs are derived too: `WhereDTO<S>`, order-by, pagination, projection, and typed populate/join/aggregate result shapes.                                                                                                                            | Unknown column in a where-clause is a compile error.                                           |
| **REQ-SC-6** | Validation constraints are expressed with **native zmdb tags**, not a third-party tag library.                                                                                                                                                                | No third-party import appears in any schema example or in `schema-core`'s dependency set.      |
| **REQ-SC-7** | OpenAPI schemas and LLM function-calling tool schemas derive from the same schema object.                                                                                                                                                                     | Generated OpenAPI for a table matches its column set; adding a column changes the document.    |
| **REQ-SC-8** | schema-core imports **no sibling package**.                                                                                                                                                                                                                   | Dependency lint: `@zmdb/schema-core` has zero `@zmdb/*` and zero third-party runtime deps.     |

### 6.2 Query compiler — the Kysely replacement (REQ-QC)

| ID           | Requirement                                                                                                                                                                                                 | AC                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **REQ-QC-1** | Queries compile to a **parameterized SQL string + params array**. No runtime query-object interpretation, no ORM-side filtering.                                                                            | `compile()` returns `{ sql, params }`; snapshot tests per dialect.                     |
| **REQ-QC-2** | Full DML/DQL surface: select, insert, update, delete, joins (inner/left/right/full), aggregations + `GROUP BY`/`HAVING`, subqueries, set operations, batch, full-text search.                               | Every route of the drizzle-benchmarks suite is expressible (0 DNF).                    |
| **REQ-QC-3** | Dialect-aware emission for **postgres, mysql, sqlite** with dialect-specific identifier quoting, placeholders, and FTS syntax.                                                                              | Per-dialect snapshot suite green.                                                      |
| **REQ-QC-4** | Column and table references are **type-checked against the schema**; an unknown column cannot compile.                                                                                                      | `@ts-expect-error` tests on misspelled columns.                                        |
| **REQ-QC-5** | DDL + **migration diffing**: compare desired schema objects (tables, columns, indexes, views, sequences, generated columns, namespaces, RLS) against current state and emit ordered, reversible statements. | Diff of two schema versions produces an applied-and-rolled-back migration in E2E test. |
| **REQ-QC-6** | No hidden N+1: any operation that would issue per-row queries must be either impossible or explicit in the API.                                                                                             | Populate/join E2E asserts query counts.                                                |

### 6.3 AOT validator — the Typia replacement (REQ-AV)

| ID           | Requirement                                                                                                                                                                                              | AC                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **REQ-AV-1** | A build-time transformer rewrites `is<T>()` / `assert<T>()` / `validate<T>()` call sites into **inlined straight-line JavaScript** — boolean chains, no helper calls, no allocation on the success path. | Transformer output snapshot contains no function call and no object literal on the happy path.                                |
| **REQ-AV-2** | **No runtime parsing engine on the hot path**, ever. No Zod/Valibot/Yup/Ajv dependency, and no `new Function()`/`eval` (CSP-safe static emission). ✅ met — see §9.5.                                    | Dependency lint + a grep guard for `new Function`/`eval` in shipped code (**0 sites**).                                       |
| **REQ-AV-3** | The transformer ships as a **wired build plugin** for the mainstream toolchains (tsc transformer + bundler plugin), documented end-to-end.                                                               | A consumer fixture project builds with the plugin and its emitted bundle contains inlined checks. **Gap: see §9.2 / RISK-1.** |
| **REQ-AV-4** | A **behaviourally identical pure-runtime fallback** exists for consumers who cannot run the transformer.                                                                                                 | The same conformance suite passes against both paths, asserting identical accept/reject sets.                                 |
| **REQ-AV-5** | Full API parity surface: `is`, `assert`, `validate`, `equals`, `random`, tags/constraints, discriminated + non-discriminated unions, transforms, JSON Ser/De.                                            | Parity checklist test per symbol.                                                                                             |
| **REQ-AV-6** | `parse<T>` returns the validated input **as-is** for plain structural types — no defensive object rebuild.                                                                                               | Identity assertion (`result === input`) + the measured non-regression in `benchmarks/`.                                       |
| **REQ-AV-7** | Error reporting (`validate`) yields a structured path + expected-type list without allocating on the success path.                                                                                       | Success path allocation probe; failure path asserts `path`/`expected`/`value`.                                                |

### 6.4 Repository — the MikroORM replacement (REQ-RP)

| ID           | Requirement                                                                                                                                                              | AC                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-RP-1** | A fully typed repository is obtained in **one call** — `defineRepository(Schema, driver, { dialect })` — with `BaseRepository` subclassing available for domain methods. | Quickstart compiles in ≤ 3 lines after the schema; no hand-written CRUD.                                                                                                                                                                                                                                                                                                      |
| **REQ-RP-2** | Inherited CRUD: `findById`, `find`, `list`, `create`, `update`, `delete`, plus batch/set-op and aggregate/populate variants — all typed off the schema.                  | `findById` returns `Entity<S> \| undefined`; `find` takes `WhereDTO<S>`.                                                                                                                                                                                                                                                                                                      |
| **REQ-RP-3** | Write methods accept `unknown` at the boundary and **validate against the derived DTO before touching the database**, throwing `ValidationError` with a structured path. | `create({ ...valid, bogus: 1 })` and `create({ ...valid, id: 5 })` on a serial `id` both reject at runtime with a path naming the offending key, _and_ fail `tsc` when typed. **Not met today:** `validatePayload` whitelists by column and drops both silently; `create({ bogus: 1 })` rejects only because required columns are missing. See `PLAN-type-first.md` Phase 7b. |
| **REQ-RP-4** | **No proxies, no identity map, no change tracking.** Reads return plain inert objects.                                                                                   | `Object.getPrototypeOf(row) === Object.prototype`; no dirty-flag properties.                                                                                                                                                                                                                                                                                                  |
| **REQ-RP-5** | Explicit transactions with `using`-style resource management, savepoints, and a typed transactional repository handle.                                                   | E2E: rollback leaves zero rows; nested savepoint partial rollback works.                                                                                                                                                                                                                                                                                                      |
| **REQ-RP-6** | Relations via **explicit `populate`** (no lazy proxy relation loading), with typed result shapes.                                                                        | Type test on populated result; query-count assertion.                                                                                                                                                                                                                                                                                                                         |
| **REQ-RP-7** | Lifecycle events (before/after create/update/delete), embeddables, and entity inheritance are supported without introducing a proxy or a flush cycle.                    | Hook ordering tests; inheritance/embeddable E2E.                                                                                                                                                                                                                                                                                                                              |
| **REQ-RP-8** | Read replicas: reads routable to replicas, writes pinned to primary, with explicit override.                                                                             | Replica routing test asserts which connection served each statement.                                                                                                                                                                                                                                                                                                          |
| **REQ-RP-9** | Drivers: `node:sqlite` built in (zero-dependency quickstart); `pg` and others **optional and structurally typed**.                                                       | Installing `zmdb` alone runs the sqlite quickstart with no third-party install.                                                                                                                                                                                                                                                                                               |

### 6.5 Web — the NestJS replacement (REQ-WB)

| ID            | Requirement                                                                                                                                                                                                            | AC                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **REQ-WB-1**  | Routing via **Stage 3 standard decorators** — `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` — storing data strictly in `context.metadata` (only data the decorator itself wrote; never type reflection). | `experimentalDecorators: false` in the package tsconfig, asserted by a test.                                           |
| **REQ-WB-2**  | **No parameter decorators, no `reflect-metadata`, no `emitDecoratorMetadata`.** Handlers take one strongly-typed `Ctx<Params, Body, Query>`.                                                                           | Dependency lint: `reflect-metadata` absent; grep guard for `Reflect.getMetadata`.                                      |
| **REQ-WB-3**  | Path params are **derived from the route string literal** (`PathParams<'/users/:id'>` → `{ id: string }`). Reading an undeclared param is a compile error; no `as` is needed to type params.                           | `@ts-expect-error` test on `ctx.params.nope`.                                                                          |
| **REQ-WB-4**  | The route table is built **once at boot** (`getRoutes` → router). **Zero metadata reads and zero reflection per request.**                                                                                             | `countMetadataReads()` guard in `packages/web/src/bench` asserts 0 reads across N requests.                            |
| **REQ-WB-5**  | DI uses **explicit tokens** with a Stage 3 field decorator `@Inject(token)`; injected types must match the token's type at compile time with no cast. Resolution happens at class-init, not per request.               | `@ts-expect-error` on a mismatched token/field pair; `UnresolvedTokenError` at compile-module time, not first request. |
| **REQ-WB-6**  | Modules (`@Module({ controllers, providers, imports, exports })`) compile to a validated container graph at boot; an unresolvable or cyclic graph fails **before serving**.                                            | `compileModule` throws on missing provider and on cycles.                                                              |
| **REQ-WB-7**  | Repositories are first-class providers via `repositoryToken(...)`, so a controller injects a typed repository — **this is the seam between the two source PRDs**.                                                      | End-to-end example in §7 compiles and serves.                                                                          |
| **REQ-WB-8**  | Request pipeline parity with NestJS: guards, pipes, interceptors, exception filters, middleware, with a deterministic, documented execution order.                                                                     | Ordering test asserting the full chain sequence.                                                                       |
| **REQ-WB-9**  | Boundary validation and response serialization use the **AOT validator** against schema-derived DTOs (`validationPipe`, `dtoChain`, `serializationInterceptor`). The framework embeds no parser of its own.            | A malformed body yields 400 with a structured path, produced by inlined checks.                                        |
| **REQ-WB-10** | Compile-time **domain state machines**: `defineState` + `transition` brand domain values so an illegal state transition is a `tsc` error. Branding costs **0 bytes** and **0 ns** at runtime.                          | `@ts-expect-error` test: paying an already-paid order fails to compile; runtime identity of `create`.                  |
| **REQ-WB-11** | Adapters to host runtimes: Node `http` (`toNodeHandler`) and Fetch/WinterCG (`toFetchHandler`); optional structurally-typed adapters for Hono/Fastify-style hosts.                                                     | The same app serves under Node, Bun, and Deno in the framework harness.                                                |
| **REQ-WB-12** | OpenAPI documents derive from routes + schema DTOs (`toOpenApi`, `serveOpenApi`) — no hand-authored spec, no decorator duplication.                                                                                    | Adding a column changes the served document without touching controller code.                                          |
| **REQ-WB-13** | WebSocket/SSE support (`@Gateway`, `@Subscribe`, `sseStream`) sharing the same DI and validation path.                                                                                                                 | Gateway dispatch test; SSE stream E2E.                                                                                 |
| **REQ-WB-14** | First-class testing utilities (`createTestApp`) allowing controller/DI testing without a network listener.                                                                                                             | Test-app suite exercises routes in-process.                                                                            |

### 6.6 Umbrella (REQ-UM)

| ID           | Requirement                                                                                                                                                            | AC                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **REQ-UM-1** | `zmdb` re-exports the ecosystem through a curated root + subpath map (`zmdb`, `zmdb/dto`, `zmdb/relations`, `zmdb/web`, `zmdb/drivers/*`) and contains **zero logic**. | Re-export parity test; no non-re-export statement in the package. |
| **REQ-UM-2** | Every sub-package remains independently installable and tree-shakeable; the umbrella is convenience, not coupling.                                                     | Each package builds and tests in isolation in CI.                 |
| **REQ-UM-3** | No `export *` — every public symbol is enumerated, with type exports separated.                                                                                        | Lint rule forbidding star re-exports.                             |

### 6.7 Type-first declaration (REQ-TF)

The design goal that makes **P2** and **P3** literally true rather than aspirational:
the declaration is a _type_, and every runtime artefact is generated from it. Today
`defineSchema` inverts this — the column facts live in a value and the types are a
shadow of that value. Full rationale, encoding, and the runnable prototype are in
[DESIGN-type-first.md](DESIGN-type-first.md); the phased implementation plan is in
[PLAN-type-first.md](PLAN-type-first.md), whose five shaping decisions were all
resolved on 2026-09-02 — notably that `defineSchema` is removed rather than kept
working (REQ-TF-12), and that a column has three types, rendered per layer
(REQ-TF-13).

| ID            | Requirement                                                                                                                                                                                                                                                                                                                                      | AC                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-TF-1**  | A domain type declared as a plain `interface` plus zmdb type tags expresses **everything** `defineSchema` can express: SQL type, primary key, serial, unique, default, length, sensitive, references, table name, FTS table, and every validation constraint.                                                                                    | Type test that fails if a `SqlType` member, a `ColumnFlags` member, or a `ValidationRule.kind` has no tag equivalent.                                                                                                                                                                    |
| **REQ-TF-2**  | Facts TypeScript already models are expressed **natively**, not as tags: nullability is `\| null`, optionality is `?`, an enum is a literal union, a JSON column is a nested interface, an array is `T[]`.                                                                                                                                       | No `Nullable`/`Enum`/`Optional` flag exists in the tag vocabulary; `Nullable<T>` is an alias for `T \| null`.                                                                                                                                                                            |
| **REQ-TF-3**  | A tag carries **zero runtime cost and zero type-level computation** — an optional `unique symbol` slot, never a conditional or recursive type.                                                                                                                                                                                                   | Emitted output contains no tag symbol; typecheck wall-time does not regress against the untagged baseline.                                                                                                                                                                               |
| **REQ-TF-4**  | The whole DTO suite derives from the tagged type: `Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO`, `ReadDTO`, `PrimaryKeyOf`, order-by, pagination, projection, and populated/join shapes. Each takes the tagged type only — no dispatch on a schema value.                                                                                       | The REQ-SC-2…REQ-SC-5 type tests, re-run with the tagged interface substituted for `typeof Schema`: identical key sets and optionality, and every derivation mutually assignable with its schema-value twin. Not literally _unchanged_ — that contradicted REQ-TF-5, see the note below. |
| **REQ-TF-5**  | Constraints survive every derivation. `Omit`, `Pick` and `Partial` must not drop a tag.                                                                                                                                                                                                                                                          | A `Min`/`Pattern` tag on a create field generates the same runtime check on the update field (extends REQ-SC-4).                                                                                                                                                                         |
| **REQ-TF-6**  | `Sensitive` is enforced by the **type**: `ReadDTO<T>` cannot name a sensitive column, so a leak is a compile error rather than a serializer responsibility.                                                                                                                                                                                      | `@ts-expect-error` on reading a sensitive field off `ReadDTO<T>`; no sensitive key in any generated read/list/OpenAPI schema.                                                                                                                                                            |
| **REQ-TF-7**  | The JSON Schema suite is type-driven with unchanged output contracts: `toJsonSchema<T>()` and the `entity`/`create`/`update`/`get`/`list`/`search` variants, `toJsonSchemaWithRelations`, `toOpenApiComponents`, `toListSchema`, `toSearchSchema`, `toolFromSchema`.                                                                             | Byte-identical documents for the equivalent value-driven and type-driven inputs; the call is replaced at build time by an object literal.                                                                                                                                                |
| **REQ-TF-8**  | The AOT transformer resolves types with the **TypeScript checker**, not a text parser, and generates the runtime checks the tags declare — bounds, lengths, patterns, integrality, enum membership, nullability.                                                                                                                                 | `is`/`assert`/`validate`/`equals` on any named type, mapped type, or derived DTO is transformed; `parseType` is deleted.                                                                                                                                                                 |
| **REQ-TF-9**  | No `TypeDescriptor` is hand-written anywhere — not in the packages, not in the benchmark harness.                                                                                                                                                                                                                                                | Grep guard: zero hand-authored descriptor literals in `packages/` and `benchmarks/`.                                                                                                                                                                                                     |
| **REQ-TF-10** | The runtime schema value the query compiler needs for SQL is **generated** from the type, not authored. Types may generate runtime data; they are not the runtime data.                                                                                                                                                                          | The generated `const` round-trips to the same SQL as today's `defineSchema` call for every dialect snapshot.                                                                                                                                                                             |
| **REQ-TF-11** | Checker cost is paid **once per build**, not once per file.                                                                                                                                                                                                                                                                                      | A test asserts a single `API` instance across a multi-file build; published build-time measurement.                                                                                                                                                                                      |
| **REQ-TF-12** | There is exactly **one** way to declare a table. `defineSchema` is removed rather than maintained alongside the tagged form, and a codemod converts an existing project. Until it is removed it is a proving device: the IR derived from the value must equal the IR derived from the type.                                                      | `verify:no-defineschema` finds zero `defineSchema` calls and zero `irFromSchema` references; the codemod converts every in-repo schema; while both exist, an equivalence test asserts identical IR.                                                                                      |
| **REQ-TF-13** | A column has **three** types and each layer renders the one it owns: wire (what arrives over HTTP), app (what handler code sees), db (what the dialect declares). `timestamp` is an ISO-8601 `string` in JSON Schema, a `Date` in `Entity<T>`, and `timestamptz` in Postgres DDL. The IR stores the abstract type; dialects render the spelling. | One test per dialect asserts the DDL, the `Entity<T>` validator and the JSON Schema for a `timestamp` column agree with that table; no code path accepts `Date \| string`.                                                                                                               |

#### REQ-TF-4 vs REQ-TF-5: why "unchanged" became "substituted"

REQ-TF-4's acceptance criterion originally said the REQ-SC-2…REQ-SC-5 type tests must pass
**unchanged**. They cannot, and the reason is REQ-TF-5 immediately below it.

REQ-SC-2 asserts `Equal<Entity<S>['email'], string>`. On the tagged side that property is
`string & Sql<'text'>`, because REQ-TF-5 requires every tag to survive `Omit`, `Pick` and
`Partial` — the tags are what the validator is generated from, so a derivation that dropped one
would emit a weaker check on update than on insert. The two criteria are in direct tension and
REQ-TF-5 wins.

Nothing is lost by that. A tag is an optional unique-symbol slot, so `string` and
`string & Sql<'text'>` are _mutually assignable_: a consumer supplies a plain string, reads a
plain string, and never names a tag. Only `Equal` can see the difference. So the criterion is
now the three things that actually matter — identical key sets, identical optionality, and
mutual assignability with the schema-value twin — asserted in
`packages/schema-core/src/derive/type-derivation-tagged.type-test.ts`, which is
`type-derivation.type-test.ts` with `S` rebound.

One genuine behavioural change came out of it, and it is a breaking one:
`exactOptionalPropertyTypes` is on repo-wide, and the tagged `CreateDTO`/`UpdateDTO` are plain
`Partial`s, so `{ email: undefined }` is now an error where the value-side DTOs accepted it.
`{}` and `{ email: null }` are how "leave it alone" and "set it to NULL" are spelled; the
widened form bought a third spelling for one of two meanings. The strict tagged DTO is still
assignable everywhere the widened one was — only the reverse fails.

---

## 7. The unified seam — one schema, one request lifecycle

This section is the **substance of the unification**: the point where the data-layer PRD
and the decorator-framework PRD stop being two products.

### 7.1 The derivation contract

```
defineSchema('orders', { … })                      ← the ONE change vector
      │
      ├─ Entity<OrdersSchema>       → repository read results → HTTP response type → OpenAPI response schema
      ├─ CreateDTO<OrdersSchema>    → POST body type → AOT-inlined body validator → OpenAPI requestBody
      ├─ UpdateDTO<OrdersSchema>    → PATCH body type → AOT-inlined partial validator
      ├─ WhereDTO<OrdersSchema>     → query-string filter type → SQL WHERE clause
      └─ column metadata            → DDL + migration diff
```

**REQ-SEAM-1:** A column added to the schema must appear — with no other edit — in the
repository's typed methods, the controller's body/response types, the AOT-generated
validator, and the OpenAPI document.

**REQ-SEAM-2:** A column **removed or renamed** must produce a compile error at every
dependent site (repository call, controller handler, service, projection, filter) until
resolved. Silent tolerance of a stale reference is a P0 defect.

**REQ-SEAM-3:** The HTTP boundary and the database boundary validate against the **same
derived DTO**, from the same source, with the same inlined code — never two schemas kept
in sync by hand.

### 7.2 End-to-end worked example

```ts
// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SINGLE SOURCE OF TRUTH — the only file that changes when the model does
// ─────────────────────────────────────────────────────────────────────────────
import {
  defineSchema,
  serial,
  integer,
  numeric,
  jsonEnum,
  primaryKey,
  notNull,
  references,
  defaultTo,
  validate,
  tags,
} from 'zmdb';

export const OrdersSchema = defineSchema('orders', {
  id: primaryKey(serial()),
  userId: references(notNull(integer()), 'users.id'),
  totalPrice: validate(notNull(numeric()), tags.minimum(0)),
  status: defaultTo(notNull(jsonEnum(['pending', 'paid', 'shipped', 'delivered'])), 'pending'),
});

export type OrdersSchema = typeof OrdersSchema;

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATA LAYER — one call. Entity/CreateDTO/UpdateDTO/WhereDTO are already derived.
// ─────────────────────────────────────────────────────────────────────────────
import { defineRepository, BaseRepository } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
import { DatabaseSync } from 'node:sqlite';

const driver = sqliteDriver(new DatabaseSync('app.db'));

// Inherited CRUD + auto-validation OOTB; write only domain-specific queries.
export class OrderRepository extends BaseRepository<OrdersSchema> {
  async findPendingByUser(userId: number) {
    return this.find({ userId, status: 'pending' }); // typed WhereDTO — unknown column = compile error
  }
}

export const orders = new OrderRepository(OrdersSchema, driver, { dialect: 'sqlite' });

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOMAIN INVARIANTS — illegal transitions are tsc errors, 0 bytes at runtime
// ─────────────────────────────────────────────────────────────────────────────
import { defineState, transition, type Entity } from 'zmdb/web';

type OrderRow = Entity<OrdersSchema>;

const Pending = defineState<'PendingOrder', OrderRow>();
const Paid = defineState<'PaidOrder', OrderRow>();

// A pending order may be paid. A paid order may not be paid again — enforced by types.
const pay = transition(Pending, Paid, order => ({ ...order, status: 'paid' as const }));

// ─────────────────────────────────────────────────────────────────────────────
// 4. WEB LAYER — Stage 3 decorators, typed Ctx, token DI, zero reflection
// ─────────────────────────────────────────────────────────────────────────────
import { Controller, Get, Post, Inject, Module, createApp, repositoryToken, type Ctx, type CreateDTO } from 'zmdb/web';

const OrdersRepo = repositoryToken<OrdersSchema>('OrdersRepo');

@Controller('/orders')
class OrderController {
  @Inject(OrdersRepo)
  private readonly orders!: BaseRepository<OrdersSchema>; // type must match the token — no cast

  @Get('/:id')
  async getOrder(ctx: Ctx<{ id: string }>) {
    // ctx.params.id is `string`; ctx.params.nope would NOT compile.
    return await this.orders.findById(Number(ctx.params.id)); // Entity<OrdersSchema> | undefined
  }

  @Post('/')
  async createOrder(ctx: Ctx<Record<never, string>, CreateDTO<OrdersSchema>>) {
    // Body already validated by the AOT-inlined validator for CreateDTO<OrdersSchema>.
    // `id` and `status` are absent from CreateDTO (serial / defaulted) — supplying them
    // is a compile error, not a silently-ignored field.
    return await this.orders.create(ctx.body);
  }

  @Post('/:id/pay')
  async payOrder(ctx: Ctx<{ id: string }>) {
    const row = await this.orders.findById(Number(ctx.params.id));
    if (row === undefined) return { status: 404 };

    const paid = pay(Pending.create(row)); // ✅ pending → paid
    // pay(paid);  ❌ tsc: Brand<OrderRow,'PaidOrder'> is not assignable to Brand<OrderRow,'PendingOrder'>

    await this.orders.update(paid.id, { status: paid.status });
    return { status: 'success', order: paid };
  }
}

@Module({
  controllers: [OrderController],
  providers: [{ token: OrdersRepo, value: orders }],
})
class AppModule {}

// Route table + DI graph resolved ONCE here. Per request: 0 metadata reads, 0 reflection.
export const app = createApp(AppModule);
```

**What this example demonstrates against the four incumbents:**

| Line of code               | Incumbent equivalent                                             | What we removed                            |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `CreateDTO<OrdersSchema>`  | a hand-written `CreateOrderDto` + a Zod schema + an entity field | 3 duplicate declarations                   |
| `Ctx<{ id: string }>`      | `@Param('id') id: string`                                        | parameter decorators + `reflect-metadata`  |
| `@Inject(OrdersRepo)`      | constructor DI via `emitDecoratorMetadata`                       | runtime type reflection                    |
| `this.orders.find({ … })`  | MikroORM `EntityManager` + proxy entities                        | identity map, change tracking, flush cycle |
| `pay(Pending.create(row))` | a runtime `if (order.status !== 'pending') throw`                | a class of production bugs, moved to `tsc` |
| body validation            | `ZodValidationPipe` parsing per request                          | the runtime parser                         |

---

## 8. Developer experience workflows

### 8.1 Add a new domain to the stack

1. Write **one** `defineSchema(...)` block.
2. `defineRepository(...)` (one call) — or subclass `BaseRepository` for domain queries.
3. Write a controller whose bodies/responses are the derived DTOs.
4. Register both in a `@Module`.

**REQ-DX-1:** Steps 2–4 must total **under ~10 lines of declarative wiring** per domain,
with **zero hand-written CRUD** and **zero hand-written DTO properties**.

### 8.2 Change an existing column (the money workflow)

Edit the schema. Then:

- `tsc` fails at every stale reference (**REQ-SEAM-2**).
- The migration diff proposes the DDL (**REQ-QC-5**).
- The validator re-inlines at the next build (**REQ-AV-1**).
- The OpenAPI document changes on next boot (**REQ-WB-12**).

**REQ-DX-2:** The developer's total edit surface for a column change is **the schema file
plus whatever genuinely needed a decision** — never a mechanical re-typing of the same
field in four places.

### 8.3 Incremental adoption

**REQ-DX-3:** Each layer must be adoptable alone, against an existing stack:

| Adopt only                   | Sits next to                       | Requirement                                                              |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `query-compiler`             | an existing Kysely/knex codebase   | Compiles SQL for any table; does not require the repository or web layer |
| `aot-validator`              | an existing NestJS/Express app     | Drop-in for Typia/Zod call sites; no schema-core requirement             |
| `schema-core` + `repository` | an existing NestJS app             | Repositories injectable into Nest providers as plain objects             |
| `web`                        | an existing hand-rolled data layer | Repositories are optional providers; any object can be a provider        |

### 8.4 Migration from the incumbents

**REQ-DX-4:** Ship a documented migration path per incumbent, stating honestly what is
mechanical and what requires redesign:

| From         | Mechanical                                                 | Requires redesign                                                                              |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **NestJS**   | `@Controller`/`@Get`/`@Module`/guards/interceptors map 1:1 | `@Body()`/`@Param()`/`@Query()` → one `Ctx` object; constructor DI → `@Inject(token)` field DI |
| **Typia**    | `is`/`assert`/`validate`/`random`/tags map 1:1             | Build-plugin wiring differs; tag namespace is zmdb's                                           |
| **MikroORM** | Repository methods, transactions, hooks, populate          | Code relying on identity map, auto-flush, or lazy proxy relations must become explicit         |
| **Kysely**   | Query-builder shape is familiar; SQL output comparable     | Types come from the zmdb schema, not a separately declared `DB` interface                      |

---

## 9. Non-functional requirements

### 9.1 Performance targets

Targets are per layer, measured **by the real upstream harness**, reported in
`benchmarks/RESULTS.md` and the dashboard.

| ID           | Layer      | Requirement                                                                                                                                                                                                                                 |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-NF-1** | Validation | The AOT path must be **within noise of Typia** and **an order of magnitude+ above runtime parsers** on the `typescript-runtime-type-benchmarks` cases, across Node/Bun/Deno.                                                                |
| **REQ-NF-2** | Validation | Success path: **zero allocation**. `parse<T>` returns the input identity for plain structural types.                                                                                                                                        |
| **REQ-NF-3** | ORM        | Serve **all** drizzle-benchmarks routes (0 DNF) on real PostgreSQL and be competitive with Drizzle/Kysely on throughput under k6.                                                                                                           |
| **REQ-NF-4** | ORM        | **Zero allocation footprint** for raw reads: no per-row metadata records, no proxy wrappers, no identity-map retention.                                                                                                                     |
| **REQ-NF-5** | Web        | **Zero per-request metadata reads and zero reflection** — machine-asserted by a unit guard, independent of any HTTP load number.                                                                                                            |
| **REQ-NF-6** | Web        | Throughput in the **same-machine peer head-to-head** (the-benchmarker contract, identical `oha` invocation) must be **in the same band as the mainstream Node frameworks** (Fastify/Hono/Koa) — a decorator framework must not cost a tier. |
| **REQ-NF-7** | All        | SQL compilation overhead must be negligible against the round-trip (target: sub-microsecond per query).                                                                                                                                     |

### 9.2 Measured status (2026-08-31 — honest)

| Requirement  | Status                        | Evidence                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-NF-1     | ✅ met (with a caveat)        | Transformer-produced `zmdb-aot`: **101.7M** parseSafe / **40.0M** parseStrict / **108.9M** assertLoose / **42.3M** assertStrict ops/s vs typia 100.7M/38.9M/78.1M/31.1M and zod v4 8.7M/4.9M/4.2M/4.2M. Leads all four cases on Node and Deno; Bun's JIT favours typia on strict (~2.4×) and DCE-fakes assertLoose.                                                         |
| REQ-NF-2     | ✅ met                        | `parse<T>` identity fix measured **1.56×** faster in a low-noise probe.                                                                                                                                                                                                                                                                                                     |
| REQ-NF-3     | ✅ coverage met; ⚠️ trade-off | **13/13 routes, 0 DNF** on real Postgres. Full-replay k6: zmdb **2,916 req/s / 102ms avg** leads throughput and average latency; **Drizzle keeps the better tail** (p95 173.8 vs 215.5). Opt-in `ZMDB_PREPARED=1` → 3,068 req/s / 97ms / p95 209.5. Aggregate routes use a different projection shape. **No "fastest ORM" claim.**                                          |
| REQ-NF-4     | ✅ met                        | Reads return objects with `prototype === Object.prototype`; no identity map exists.                                                                                                                                                                                                                                                                                         |
| REQ-NF-5     | ✅ met                        | `countMetadataReads()` guard in `packages/web/src/bench` asserts 0 per-request reads.                                                                                                                                                                                                                                                                                       |
| REQ-NF-6     | ✅ met                        | Same-machine, same-`oha`, contract-verified, level 256 `GET /`: **@zmdb/web 13,294 req/s** vs koa 13,285 · hono-node 13,828 · fastify 14,799 · express 9,941. Same band as mainstream Node peers; Go/Rust peers (actix 33,080, fasthttp 28,146) are a tier up, as expected.                                                                                                 |
| **REQ-AV-3** | 🚧 **the one real gap**       | The transformer is real and its output is what was benchmarked, but the **shipped default is still the runtime validator unless the consumer enables the plugin** — and the runtime path loses to zod v4. Until the plugin is a documented, wired, one-line build step, the ecosystem's headline claim is unearned for the average consumer. **Top priority — see RISK-1.** |

### 9.3 Build, type, and quality requirements

| ID            | Requirement                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-NF-8**  | tsconfig floor for every package: `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, and `experimentalDecorators: false`.                                                                                                                                                                                    |
| **REQ-NF-9**  | Type-level behaviour is **tested**, not assumed — in a file the typechecker actually compiles: `Expect<Equal<…>>` in `*.type-test.ts` for positives, `@ts-expect-error` for every documented compile error. **`expectTypeOf` is banned**: vitest only _runs_ specs, so those calls are runtime no-ops (see §9.6). **11 type-test files, 18 `@ts-expect-error` assertions** today.         |
| **REQ-NF-10** | Spec-first: a concern gets a frozen `SPEC.md`, then failing tests, then implementation, then docs.                                                                                                                                                                                                                                                                                        |
| **REQ-NF-11** | Branded/phantom types must contribute **0 bytes** to bundle output and **0 ns** of runtime evaluation.                                                                                                                                                                                                                                                                                    |
| **REQ-NF-12** | Publishing: ESM-only, single `exports` map, Trusted Publishing (OIDC) with provenance, `latest` tracking highest-precedence release. License **GPL-3.0-or-later**.                                                                                                                                                                                                                        |
| **REQ-NF-13** | Every capability must be documented on the docs site before it counts as shipped (**0 TODO** policy), including an **Anti-patterns** page explaining each deliberate exclusion.                                                                                                                                                                                                           |
| **REQ-NF-14** | Framework `as`/assertion count is tracked in CI and must be **monotonically non-increasing**, with every remaining assertion carrying a `// boundary:` comment. Ratchet (2026-09-01 recount): **28 assertions, 37 boundary comments, 0 non-null `!`** — see §9.4. The counter itself is still not wired in CI (RISK-7), which is why the number drifted up by 5 between audits unnoticed. |

### 9.4 Escape-hatch audit (2026-08-31, re-audited) — P4 as written is **met**

Measured across the **67 non-spec source files** in `packages/*/src`. Both columns use the
**same** greps — `as <Type>` excluding comment lines, `as const`, mapped-type key remapping
(`K in keyof C as …`) and import aliases — so they are comparable: "before" is commit
`ececa0b`, the last commit prior to this cleanup; "after" is the current tree.

| Metric                                     | Before |  After | Verdict                                                   |
| ------------------------------------------ | -----: | -----: | --------------------------------------------------------- |
| `: any` / `<any>` / `any[]` / `as any`     |      4 |  **0** | ✅ eliminated (all 4 were in `repository`'s old `list()`) |
| `@ts-expect-error` / `@ts-ignore` in src   |      0 |  **0** | ✅ none, before or after                                  |
| `as unknown as` double casts               |      4 |  **1** | ✅ one, in `makeColumn` — see structural fix 1            |
| Type assertions (`as T`, excl. `as const`) |     91 | **28** | ✅ each an argued trust boundary                          |
| `// boundary:` comments covering them      |     14 | **37** | ✅ every assertion documented, plus 9 non-cast boundaries |
| Non-null assertions (`!`)                  |     19 |  **0** | ✅ eliminated                                             |
| `eslint-disable` / `oxlint-disable` in src |     14 |  **0** | ✅ none; oxlint runs with zero suppressions               |
| `new Function` / `eval` call sites         |      2 |  **0** | ✅ §9.5 resolved                                          |
| Consumer-facing `as` in docs/examples      |      1 |  **0** | ✅ every doc code fence is assertion-free                 |

> The first pass of this audit reported 93 / 14 / 17 and **0 `any`**. The 93 and 17 were
> one-off greps that differ from the method above by a couple of hits; the "0 `any`" was
> simply **wrong** — `repository/src/index.ts` carried `applyOrderBy(b as any, … as any)`
> under two `eslint-disable @typescript-eslint/no-explicit-any` comments, which that pass
> mistook for stale suppressions. Recorded here rather than quietly corrected.

Per-package assertion distribution:

| Package                | Before | After | Documented | What the surviving boundaries are                                    |
| ---------------------- | -----: | ----: | ---------: | -------------------------------------------------------------------- |
| `@zmdb/schema-core`    |     30 |     8 |          8 | `makeColumn`, frozen column map, computed relation key, DTO builders |
| `@zmdb/repository`     |     26 |     6 |          6 | driver row → `Entity<S>`, cursor payload, `WhereDTO` from a PK       |
| `@zmdb/aot-validator`  |     25 |     5 |          5 | `JSON.parse` → `T`, and `input as T` after certification             |
| `@zmdb/web`            |      9 |     9 |          9 | decorator-metadata reads, DI token→instance, brand attach            |
| `@zmdb/query-compiler` |      1 |     0 |          — | —                                                                    |
| `zmdb` (umbrella)      |      0 |     0 |          — | —                                                                    |

**Conclusion.** `ARCHITECTURE.md` §2.1's rule — "each with a `// boundary:` comment stating
_why it is sound_" — now holds in every package, not just `@zmdb/web`. The 28 survivors are
irreducible without paying runtime cost: heterogeneous `Map`s, `Function.prototype.constructor`,
`JSON.parse`, decorator-metadata slots, and driver rows. **This is still not "zero escape
hatches"**, and RISK-7 stays open until the count is _ratcheted in CI_ — that part is not
built yet, so nothing stops the number climbing back.

The 68-assertion drop came from four structural fixes, not 68 individual edits:

1. **Generic-erasure returns in the column builders** (`schema-core/src/index.ts`) —
   `makeColumn(): Column` erased `T`/`F`, so each of the **19** builders and function-style
   modifiers ended in its own `as never`. Making the helper generic in its _result_ type
   (`makeColumn<C extends Column>`, inferred from the caller's declared return type) removed
   all 19; the single surviving `as unknown as C` inside it carries the soundness argument.
2. **`CoreSchema<string>` widening in the repository** — `list()` cast its typed DTOs down to
   `CoreSchema<string>` to reach the schema-core helpers, cast the builder through `any` to
   reach `applyOrderBy`/`applyPagination`, and cast the result back. Making those helpers
   generic in `S` removed the round-trip, all four `as any`, both lint suppressions **and**
   the consumer-facing `COOKBOOK.md` cast that the same erasure forced on users.
3. **`satisfies` instead of `as` for rule construction** (`aot-validator/src/advanced`) —
   `Object.freeze({ … } as UnionRule)` checks nothing about the literal; `satisfies UnionRule`
   checks it and keeps the literal type. Paired with an `isRecord` type guard for keyed reads
   off `unknown`, that removed ~20 casts from one file.
4. **Re-check instead of assert on the validator fallback path** — `validate()` read rule
   arguments as `r.args[0] as number`. `args` is `readonly unknown[]`, so the assertion was
   unchecked; a `typeof arg === 'number'` guard is free after JIT folding and this is the
   fallback path anyway (the AOT emission is what the benchmarks measure).

Non-null `!` went the same way: `?.` plus an explicit fallback, which is what
`noUncheckedIndexedAccess` was asking for all along.

### 9.5 CSP safety (REQ-AV-2) — resolved

`@zmdb/aot-validator`'s `refine()` and `transform()` used to compile a user-supplied source
string with **`new Function()`** in the runtime-fallback path, contradicting REQ-AV-2's "no
`new Function()`/`eval`" and narrowing "static CSP-safe emission, no runtime eval" to the
core `is`/`assert` path. Under a strict CSP those two builders threw.

**Resolved via option (a):** both now take a **real function value** (`RefinePredicate` /
`TransformFn`) and recover `source` from `Function.prototype.toString` purely so the AOT
transformer can still inline the body. There are **zero** `new Function`/`eval` call sites in
`packages/*/src`, so the grep guard REQ-AV-2 asks for passes; a predicate passed as a
function is also typechecked at its call site, which a source string never was. RISK-7b is
closed. What remains is to _wire_ that grep guard into CI so it cannot regress.

### 9.6 The type-safety gate was not actually a gate (2026-08-31)

REQ-NF-9 said type-level behaviour is tested. It was not — the assertions existed but nothing
ran them. Three compounding causes, all now fixed:

1. **`expectTypeOf` in `.spec.ts` files.** vitest only _executes_ specs; `expectTypeOf(...)`
   is a runtime no-op unless `vitest typecheck` runs, which it never did. Every such
   assertion — path-param derivation, brand nominality, DI token binding, DTO shapes — was
   decoration. All of them are now `Expect<Equal<…>>` in **11 `*.type-test.ts` files** that
   `tsc` compiles; `expectTypeOf` is banned outright.
2. **Specs were excluded from every package tsconfig.** So the `@ts-expect-error` directives
   in them were inert too: a directive in a file outside the program cannot fail. Specs are
   now inside the program, which turns each of the **18** directives into a real assertion —
   and `tsc` reports an _unused_ `@ts-expect-error`, so a directive that stops being needed
   also fails the build.
3. **CI typechecked four packages, not seven.** The workflow ran a hand-written
   `for p in schema-core query-compiler aot-validator repository` loop; `web` and `zmdb` were
   never typechecked. `web` was doubly outside: its tsconfig also remapped `@zmdb/*` to
   `../*/dist/*.d.ts` — gitignored build output, absent in a fresh checkout and stale
   whenever a sibling source changed. `scripts/typecheck.mjs` now discovers projects from the
   filesystem and CI calls `yarn typecheck`, so adding a package cannot silently opt out.

Bringing the excluded files into the program surfaced **34 real type errors**, including one
that invalidated a frozen SPEC: `findById(id, { populate })` returned `Entity<S>`, not a
populated type, so the "no lazy getters, typed populate" acceptance criterion had never been
met and specs papered over it with casts. `Populated<S, R, K>` now derives the attached
fields from the relations map, `find` accepts `populate` too, and populate keys are
`keyof R` — an unknown relation name is a compile error, not a runtime throw.

**Lesson recorded, not just fixed:** a type-level assertion is only a gate if the file it
lives in is inside a program that CI compiles. Anything else is a comment.

### 9.7 Toolchain and repo hygiene (2026-08-31)

Findings from the same audit that are not type-safety but would have broken a fresh clone:

- **Manifest ↔ lockfile drift.** Six `package.json` files declared `typescript: 5.9.2` /
  `tsup: 8.5.0` while the lock resolved TS 7.0.2 and tsup 8.5.1, `benchmarks` had `kysely`
  in `devDependencies` at a version the lock did not carry, and `oxlint`/`oxfmt` were used by
  the root scripts without being declared at all. `yarn install --immutable` — what CI runs —
  therefore **failed**, meaning CI could not have been green. All manifests now match the
  lock and `yarn install --immutable` completes clean.
- **Yarn linker.** `nodeLinker: node-modules` is now explicit in `.yarnrc.yml`. PnP's
  resolution does not agree with `tsc`'s `paths`-based source resolution used here, so the
  two gates disagreed about what a `@zmdb/*` import meant.
- **Root `typecheck` script never worked.** It was `tsc --build`, which needs a root
  `tsconfig.json` (none exists) and project references with `composite`, which needs
  declaration emit, which every `noEmit` package refuses. It failed with TS6053 — a
  passing-looking script that had never typechecked anything. Replaced by
  `scripts/typecheck.mjs`.
- **Remaining:** the root pins `@types/node: "*"`. It is pinned exactly in the lockfile, so
  builds are reproducible today, but a lock refresh can silently cross a major. Pin it to the
  Node 26 line at the next online lock refresh.

---

## 10. Definition of done

The unified product is "done" for a release when **all** hold:

1. Every REQ above is either met with a passing test or explicitly listed as a gap with an
   owner and an issue.
2. **0 DNF** in both upstream harnesses (ORM routes, validation cases), with each remaining
   trade-off enumerated individually.
3. The `@zmdb/web` contract check passes and same-machine peer numbers are refreshed.
4. A greenfield app — schema → repository → controller → served OpenAPI — is buildable from
   the quickstart with **`npm add zmdb` and nothing else** (`node:sqlite` driver).
5. Consumer-facing code in every doc example contains **zero `as`** (✅ **0 violations** —
   §9.4).
6. Every framework assertion carries a `// boundary:` comment (✅ **28/28** — §9.4) **and the
   CI counter is wired** (❌ not built; the ratchet is still a number in a document, §9.4) and
   the `new Function` guard passes (✅ **0 sites**, but likewise not yet wired, §9.5).
7. `REQ-AV-3` is closed: the AOT plugin is a documented one-line build step, and the
   shipped default for a plugin-enabled build is the AOT path.

---

## 11. Risks & open questions

| ID          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                 | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-1**  | **The AOT premise is unearned out of the box.** Without the plugin wired, consumers get a runtime validator slower than zod v4 — the opposite of the pitch.                                                                                                                                                                                                                                                          | Highest priority. Ship + document the plugin for tsc and the mainstream bundlers; add a consumer fixture to CI; consider a loud build-time warning when the plugin is absent.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **RISK-2**  | **ORM tail latency** (p95 behind Drizzle) is inherent to the stateless, zero-state design; the compile step (~254 ns) is not the cause.                                                                                                                                                                                                                                                                              | Server-side prepared statements exist as opt-in (`ZMDB_PREPARED=1`, verified +4–5% req/s and a narrower tail); a plan cache is planned, kept opt-in to preserve the zero-state default.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **RISK-3**  | **Node 26 / TS 7 / ESM-only floor** excludes much of the current market.                                                                                                                                                                                                                                                                                                                                             | Deliberate and permanent. It is what lets us delete shims and use `node:sqlite`, `using`, Stage 3 metadata. Marketed as a forward-looking stack, not a migration target for legacy apps.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **RISK-4**  | **No parameter decorators** is the biggest DX shock for NestJS migrants.                                                                                                                                                                                                                                                                                                                                             | `Ctx` is strictly more type-safe (params derived from the path literal); document the 1:1 rewrite table (§8.4) and provide codemod guidance.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **RISK-5**  | **Breadth vs. maintainability** — six packages spanning four incumbents, maintained by a small team.                                                                                                                                                                                                                                                                                                                 | Splitting doctrine (`ARCHITECTURE.md` §3.1): subpath exports are the default, a new package is the exception, and dissolving a package is an encouraged refactor.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **RISK-6**  | **Type-level derivation cost** — heavy conditional types can slow consumer `tsc`.                                                                                                                                                                                                                                                                                                                                    | Add type-instantiation-count budgets to CI alongside runtime benchmarks; treat a `tsc` regression as a perf regression (P1 north star applies to _the consumer's_ build too).                                                                                                                                                                                                                                                                                                                                                                                                               |
| **RISK-7**  | **P4 holds today but nothing keeps it holding.** The structural causes are fixed (91 → 28 assertions, all documented, 0 `any`, 0 `!`, 0 lint suppressions, 0 consumer-facing casts — §9.4), but the REQ-NF-14 ratchet is a **number in a document**, not a CI check. It has already drifted: the published figure was 23, and a recount on 2026-09-01 found 28 — the ratchet went the wrong way and nothing noticed. | Wire the counter: a script that recomputes the §9.4 table, fails on any increase, and fails on an assertion without a `// boundary:` comment within its enclosing function. Same script should carry the `new Function`/`eval` grep guard REQ-AV-2 asks for. Until that lands, treat the numbers here as a snapshot, not an invariant.                                                                                                                                                                                                                                                      |
| **RISK-7b** | ~~**`new Function()` in `refine`/`transform`**~~ **Closed.** Both take a real function value; `source` is recovered via `Function.prototype.toString` for AOT inlining only, and there are 0 `new Function`/`eval` call sites (§9.5).                                                                                                                                                                                | Keep it closed by wiring the grep guard as part of RISK-7's counter script.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **RISK-7c** | **The type-safety gate was decorative** (§9.6): `expectTypeOf` in specs is a runtime no-op, specs were outside every tsconfig so their `@ts-expect-error` directives were inert, and CI typechecked 4 of 7 projects. Fixing it surfaced 34 real errors, one of which invalidated the frozen typed-populate SPEC.                                                                                                     | Fixed: 11 `*.type-test.ts` files, specs inside the program, `scripts/typecheck.mjs` discovering projects from the filesystem, and CI running `yarn typecheck`/`yarn lint`/`yarn fmt:check`. Residual risk is cultural — a new `expectTypeOf` call would pass review unless the counter script bans it too.                                                                                                                                                                                                                                                                                  |
| **RISK-8**  | **`defineSchema` inverts P2.** The column facts live in a runtime value and the types are derived from it, so the runtime data is the source of truth and the type system is downstream — the opposite of what P2 and P3 claim. It is also why the AOT transformer cannot see a named type and why `benchmarks/harness/framework/app.ts` hand-writes a `TypeDescriptor`.                                             | Type-first declaration (§6.7, `REQ-TF-*`, `DESIGN-type-first.md`): tag the interface, resolve it with the TS 7 checker, generate the checks and the runtime schema value. Prototyped end-to-end in `scripts/prototypes/type-first/`. `defineSchema` is removed rather than kept as a peer, so the inversion is fixed rather than tolerated; a codemod carries existing projects across, and the value→type IR equivalence test is what proves the tagged path before the old one is deleted (REQ-TF-12). The unresolved parts are build wiring and checker cost per build, not feasibility. |
| **OPEN-1**  | Should the DI container be promoted from a `@zmdb/web` sub-module to its own package?                                                                                                                                                                                                                                                                                                                                | Deferred until it is independently useful per the §3.1 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **OPEN-2**  | Native/WASM kernels for the validator emitter or SQL string assembly.                                                                                                                                                                                                                                                                                                                                                | Not justified today. Gated on a committed benchmark showing a _consumer_ hot-path bottleneck, and must ship with an identical-behaviour pure-JS fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 12. Out of scope — deliberate exclusions

These are excluded **on principle**, not from lack of time, and each is documented on the
docs site's Anti-patterns page:

- Identity map, unit-of-work with auto-flush, dirty checking, lazy proxy relations, JIT
  entity mappers — incompatible with P1.
- `reflect-metadata`, parameter decorators, `emitDecoratorMetadata` — incompatible with P1 and P3.
- Runtime schema parsers on the hot path; `new Function()`/`eval` codegen (also CSP-hostile).
- CommonJS output, dual publishing, polyfills, Node < 26 / TS < 7 support.
- Implicit magic query objects, and any API that can produce a hidden N+1.
- A separate non-TypeScript schema language plus a code-generated client (the Prisma model).

---

## 13. Reconciliation of the two source PRDs

Both source documents are absorbed in full. Where they conflicted with each other, with
`ARCHITECTURE.md`, or with the shipped code, this PRD resolves as follows:

| Source clause                                                                                                                                                                                    | Resolution here                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage-3 PRD: _"Strict Type Verification (Zero Escape Hatches)"_ — no `as` anywhere, while its own sample code used `as DraftOrder`, `as PaidOrder`, `as RouteDefinition[]`, and `any` four times | **P4.** Assertion-free _public surface_; framework internals hold an enumerated, commented, CI-tracked boundary-cast list driven toward zero. `defineState`/`transition` give consumers branding with no `as`.                                         |
| Data-layer PRD: `totalPrice: numeric().validate(typia.tags.Min<0>())` — depends on Typia, which we are replacing, and contradicts the zero-dependency rule                                       | **REQ-SC-6.** Native `tags` from `@zmdb/aot-validator`. No third-party validator appears in any API or example.                                                                                                                                        |
| Data-layer PRD: `defineCoreSchema(...)`, `this.rawEngine.selectFrom(...)`                                                                                                                        | Unified on the shipped API: `defineSchema(...)`, `defineRepository(...)`/`BaseRepository`, typed `find`/`list` plus the query compiler for raw SQL.                                                                                                    |
| Stage-3 PRD: DI via a static global `Container.register/resolve` with `Constructor` tokens and `throw` on miss                                                                                   | **REQ-WB-5/6.** Module-scoped container with explicit `createToken`/`repositoryToken`, graph validated at `compileModule` time (fails _before_ serving), resolved at class-init. No module-level mutable singleton on the hot path.                    |
| Stage-3 PRD: `Ctx<Params, Body>` with `Params = Record<string, string>` default                                                                                                                  | **REQ-WB-3.** `Ctx<Params, Body, Query>` with `headers`/`method`/`path`, and params **derived from the path literal** via `PathParams<Path>` so an undeclared param is a compile error rather than `string`.                                           |
| Stage-3 PRD: _"benchmark within <2% variance of native HTTP router speeds"_                                                                                                                      | **REQ-NF-5 + REQ-NF-6.** Split into the claim we can actually machine-verify (0 per-request metadata reads/reflection) and an honest, contract-verified, same-machine peer comparison. The original single-number target was unfalsifiable as written. |
| Data-layer PRD: _"10x–100x faster than runtime parsing"_ as an assumed property                                                                                                                  | **REQ-NF-1 + §9.2.** Measured: ~40–100× the runtime path, in typia's league — **but only with the plugin enabled**, which is tracked as an open gap (RISK-1) rather than assumed.                                                                      |
| Both PRDs: four packages / a data layer with a separate framework                                                                                                                                | **§5.** Six packages in one acyclic DAG, with the schema as the shared source of truth for _both_ the SQL boundary and the HTTP boundary (§7 — the seam).                                                                                              |

**Supersession:** `Stage3_Decorator_Framework_PRD.md` and
`zero_maintenance_data_layer_prd.md` have been **deleted**; their content is absorbed above
and their history is in git (`git log --follow -- Stage3_Decorator_Framework_PRD.md`). This
document is the single product requirement of record; `ARCHITECTURE.md` remains the
architecture of record and takes precedence on implementation policy.
