# Product Requirements Document — zmdb

## One TypeScript backend ecosystem: NestJS + Typia + MikroORM + Kysely, replaced under a single umbrella

> **Status:** unified PRD — the single product requirement of record. Replaces `Stage3_Decorator_Framework_PRD.md` and `zero_maintenance_data_layer_prd.md`, both absorbed in full and **now deleted**
> (history in git). See §13 for the clause-by-clause reconciliation, including the four places where the source documents contradicted each other or the shipped code. **Baseline (hard floor):**
> Node.js **26+**, TypeScript **7+**, **ESM-only**, Stage 3 standard decorators. **Companion docs:** `ARCHITECTURE.md` (how we build it), each package's `SPEC.md` (component contracts),
> `benchmarks/RESULTS.md` (what is measured), `COOKBOOK.md` (how it is used). **Last revised:** 2026-09-02.

---

## 1. Executive summary

A TypeScript backend commonly combines **NestJS** for HTTP and dependency injection, **Typia** for boundary validation, **MikroORM** for entities and repositories, and **Kysely** for SQL. A schema
change then has to be carried through several independently maintained layers. The stack may also repeat work at runtime through reflection, proxies, schema parsing, and metadata lookups.

**zmdb is one ecosystem that replaces all four**, built on a single thesis:

> **Every unit of work that can happen before runtime must happen before runtime.** Types derive at type-check time. Validators inline at build time. Routes and the DI graph resolve at init time.
> Runtime does only the irreducible work: one SQL round-trip, a boolean chain, one object shape.

The product is built around two goals:

1. **Zero-maintenance schema** — the developer edits one file; entities, create/update/read DTOs, query filters, validators, response serializers, OpenAPI, and controller signatures all re-derive, and
   anything left inconsistent is a **compile error**, not a production 500.
2. **Zero-overhead runtime** — no `reflect-metadata`, no proxies, no identity map, no change tracking, no runtime parser, no dynamic route lookup. What ships is the code the developer would have
   written by hand.

Six packages, one install (`zmdb`), zero required third-party runtime dependencies.

---

## 2. The problem — two halves of one tax

### 2.1 The maintenance half (data layer)

Adding `orders.discount_code` to a conventional stack requires edits to: the SQL migration, the ORM entity, the Zod/TypeBox validation schema, the inbound `CreateOrderDto`, the `UpdateOrderDto`, and
the outbound API response type. Six edits, one intent. Miss one and the failure surfaces at runtime, in production, as a silently dropped field or a 500. This is a routine source of schema drift.

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

Both halves are the same defect: **work located to the right of where it belongs.** A framework that fixes only the data half still pays the reflection tax at the HTTP boundary; one that fixes only
the HTTP half still forces hand-maintained DTOs. The unification is the product: **the schema is the single source of truth for the _whole_ request lifecycle**, from URL to SQL and back.

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

Granular installs (`@zmdb/schema-core`, `@zmdb/query-compiler`, …) remain fully supported and independently useful — a user who wants **only** the Kysely replacement, or **only** the Typia
replacement, must be able to install exactly that (**REQ-UM-2**).

### 3.3 Non-goals (explicit)

- **Not a Prisma replacement.** We do not ship a separate schema language, a code-gen step producing a client, or a native query engine binary.
- **Not a Rails/Django.** The CLI has narrow project/component scaffolds and a read-only loopback data viewer, but no admin UI, templating, automatic module edits, or hidden runtime conventions.
- **Not backwards-compatible with the ecosystem's past.** No CommonJS, no `experimentalDecorators`, no `reflect-metadata` interop shim, no Node < 26. Every one of these is a _feature_: it is code we
  get to delete (`ARCHITECTURE.md` §5).
- **Not a drop-in NestJS port.** Stage 3 has no parameter decorators; `@Body()`/`@Param()` cannot and will not exist. The typed `Ctx` object is the replacement, and migration is a mechanical rewrite,
  not a config flag (§8.4).

---

## 4. Product principles (non-negotiable)

Ordered. When two conflict, the lower number wins and the conflict is documented at the call site.

### P1 — Push work left of runtime

```
type-check time   →   build time   →   install time   →   RUNTIME
(free for users)      (once, CI)       (once, npm i)       (per request — minimize!)
```

Anything at runtime that could have been resolved earlier is a **defect**, not a trade-off. Allocation, indirection, reflection, and dynamic dispatch on the hot path are defects.

### P2 — Single source of truth, pure derivation

- **One change vector.** A schema parameter changes in exactly _one_ file.
- **Dependent derivation.** Entities, create/update payloads, where-filters, order-by, pagination, projections, response shapes, validators, and OpenAPI are **derived**, never authored.
- **Zero duplicate properties.** Hand-writing a property that already exists in the schema is forbidden in framework code and unnecessary in consumer code.

### P3 — Compile-time enforcement over runtime checking

Domain invariants, illegal state transitions, route/param typing, and the DI graph are expressed in the type system (template literal types, branded/phantom types, conditional types). An invalid
route, payload, injection, or state transition **must fail `tsc`**.

### P4 — Type safety without public escape hatches (no escape hatches on the public surface)

- **Consumer code: zero assertions.** If a user must write `as` to use zmdb correctly, that is our bug.
- **Framework code: a reviewed, enumerated, shrinking exception list.** `any`, `unknown`-casting, `as T`, and `!` are defects _except_ at an enumerated **trust boundary** (driver row → `Entity<S>`,
  `JSON.parse` → `T`, `context.metadata` slot → typed record, brand attach), each carrying a `// boundary:` comment stating the runtime guarantee that makes it sound. Preference order: type guard >
  carrying generic > `satisfies` > commented boundary cast.

> The source PRD said "zero escape hatches", although four of its own examples used them (§13). The enforceable policy is narrower: the public API requires no assertions, internal trust boundaries are
> listed and explained, and their count cannot rise unnoticed.
>
> The 2026-09-04 count covers 176 shipped files: **55 framework assertions with 55 `// boundary:` comments**, no double casts, no `any`, no non-null assertions, no `@ts-expect-error` in source, one
> explained lint suppression, and no consumer-facing casts in the documentation.
>
> The first audit on 2026-08-31 found 91 assertions, 14 boundary comments, 19 non-null assertions, and four `as any` uses across 67 files. Four structural fixes removed 63 of those cases (§9.4). The
> remaining 55 are trust boundaries, not a claim of zero internal assertions.
>
> `yarn verify:escape-hatches` now fails when the count rises or an assertion has no explanation. P4 therefore means: _an assertion-free public surface, with individually justified internal boundaries
> whose count is ratcheted down._

### P5 — Zero third-party dependencies on the hot path; ESM-only

Query execution, type derivation, validation, and repository operations depend only on other `@zmdb/*` packages and Node built-ins. Third-party integrations (a `pg` driver, a Hono adapter) are
optional and **structurally typed**, so the dependency is never forced. The tooling exception is `oxfmt`, pinned by query-compiler because generated declarations must be formatted by the same engine
as the repository. One module format, one `exports` map, no `.cjs`.

### P6 — Reproducible measurement

Performance claims use upstream benchmark harnesses and the actual competitor libraries. Results include unsupported cases and trade-offs instead of hiding them inside an aggregate score.

---

## 5. Product architecture

### 5.1 The unified stack

```
                    ┌───────────────────────────────────────┐
                    │   SINGLE SOURCE OF TRUTH — a type     │
                    │   interface Orders extends            │
                    │       Table<'orders'> { … }           │
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
@zmdb/query-compiler  (lower-level SQL + introspection; oxfmt only for declaration emission)
        ▼
@zmdb/schema-core     (the schema SoT; reuses compiler query/quoting/naming utilities)
        ▼
@zmdb/aot-validator   (reflection and generated boundary validation)
        └───────────────┐
                        ▼
        @zmdb/repository   (+ direct schema-core/query-compiler deps; drivers: node:sqlite, pg optional)
               ▼
        @zmdb/web                              (controllers inject repositories)
               ▼
            zmdb                               (umbrella — curated re-exports, ZERO logic)
```

### 5.3 Package responsibilities

| Package                | Replaces                               | Responsibility                                                                                                                                                                                                                            | Runtime deps                           |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@zmdb/schema-core`    | MikroORM entities, Zod/TypeBox schemas | Schema DSL, compile-time type derivation (Entity / Create / Update / read DTOs), relations, custom types, seeding, OpenAPI, LLM tool schemas, the bounded chat runtime, and pure MCP server/client cores                                  | query-compiler                         |
| `@zmdb/query-compiler` | **Kysely**                             | SQL-first compiler: select/insert/update/delete, joins, aggregations, FTS, set ops, schema-object DDL, migration diff, catalog introspection/declaration emission, dialects                                                               | oxfmt (emitter only)                   |
| `@zmdb/aot-validator`  | **Typia**                              | AOT transformer + `is`/`assert`/`validate`/`equals`/`random`, tags, unions, transforms, JSON Ser/De                                                                                                                                       | none (`typescript` is a devDep)        |
| `@zmdb/repository`     | **MikroORM** EM/repos                  | Auto-validating typed CRUD, `defineRepository`, transactions, populate, read replicas, lifecycle events, entity modeling, drivers                                                                                                         | schema-core, query-compiler            |
| `@zmdb/web`            | **NestJS**                             | Stage-3 controllers, routing, typed `Ctx`, compile-time DI, domain state machines, request pipeline + adapters, modules, guards/pipes/interceptors/filters, bootstrap + lifecycle, DTO validation/serialization, OpenAPI, WS/SSE, testing | schema-core, aot-validator, repository |
| `zmdb`                 | the whole stack                        | Umbrella meta-package (curated root + subpath re-exports)                                                                                                                                                                                 | all of the above                       |

---

## 6. Functional requirements

Requirement IDs are stable and citable in issues/PRs. Each carries an acceptance criterion (**AC**) that is machine-checkable.

### 6.1 Schema core — the single source of truth (REQ-SC)

| ID           | Requirement                                                                                                                                                                                                                                                                                            | AC                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-SC-1** | A schema is declared once as a TypeScript type: an `interface` extending `Table<'name'>` whose properties are the app type intersected with tags (`Sql<'integer'>`, `PrimaryKey`, `Serial`, `Unique`, `HasDefault`, `References<'users.id'>`, `Min<0>`, …). See §6.7 for the vocabulary and its gates. | Type test: the declared column types survive into `Entity<T>` without widening. `yarn verify:no-defineschema` fails if a builder DSL reappears. |
| **REQ-SC-2** | `Entity<S>` is the selectable row shape.                                                                                                                                                                                                                                                               | `Expect<Equal<Entity<S>, …>>` matches the column set exactly; nullable columns include `null`.                                                  |
| **REQ-SC-3** | `CreateDTO<S>` **automatically strips** DB-generated values (identity/serial keys, defaulted columns, generated timestamps) and makes them optional.                                                                                                                                                   | `@ts-expect-error` on supplying a serial PK; omitting a defaulted column type-checks.                                                           |
| **REQ-SC-4** | `UpdateDTO<S>` is a partial of `CreateDTO<S>` preserving every structural constraint (no constraint loss through `Partial`).                                                                                                                                                                           | Type test: a tag/constraint present on a create field is present on the update field.                                                           |
| **REQ-SC-5** | Read/query DTOs are derived too: `WhereDTO<S>`, order-by, pagination, projection, and typed populate/join/aggregate result shapes.                                                                                                                                                                     | Unknown column in a where-clause is a compile error.                                                                                            |
| **REQ-SC-6** | Validation constraints are expressed with **native zmdb tags**, not a third-party tag library.                                                                                                                                                                                                         | No third-party import appears in any schema example or in `schema-core`'s dependency set.                                                       |
| **REQ-SC-7** | OpenAPI schemas and LLM function-calling tool schemas derive from the same schema object.                                                                                                                                                                                                              | Generated OpenAPI for a table matches its column set; adding a column changes the document.                                                     |
| **REQ-SC-8** | schema-core imports **no sibling package**.                                                                                                                                                                                                                                                            | Dependency lint: `@zmdb/schema-core` has zero `@zmdb/*` and zero third-party runtime deps.                                                      |

### 6.2 Query compiler — the Kysely replacement (REQ-QC)

| ID           | Requirement                                                                                                                                                                                                 | AC                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **REQ-QC-1** | Queries compile to a **parameterized SQL string + params array**. No runtime query-object interpretation, no ORM-side filtering.                                                                            | `compile()` returns `{ sql, params }`; snapshot tests per dialect.                     |
| **REQ-QC-2** | Full DML/DQL surface: select, insert, update, delete, joins (inner/left/right/full), aggregations + `GROUP BY`/`HAVING`, subqueries, set operations, batch, full-text search.                               | Every route of the drizzle-benchmarks suite is expressible (0 DNF).                    |
| **REQ-QC-3** | Dialect-aware emission for **postgres, mysql, sqlite, mssql, cockroach, singlestore** with dialect-specific identifier quoting, placeholders, and FTS syntax.                                               | Per-dialect snapshot suite green.                                                      |
| **REQ-QC-4** | Column and table references are **type-checked against the schema**; an unknown column cannot compile.                                                                                                      | `@ts-expect-error` tests on misspelled columns.                                        |
| **REQ-QC-5** | DDL + **migration diffing**: compare desired schema objects (tables, columns, indexes, views, sequences, generated columns, namespaces, RLS) against current state and emit ordered, reversible statements. | Diff of two schema versions produces an applied-and-rolled-back migration in E2E test. |
| **REQ-QC-6** | No hidden N+1: any operation that would issue per-row queries must be either impossible or explicit in the API.                                                                                             | Populate/join E2E asserts query counts.                                                |

### 6.3 AOT validator — the Typia replacement (REQ-AV)

| ID           | Requirement                                                                                                                                                                                                    | AC                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REQ-AV-1** | A build-time transformer rewrites `is<T>()` / `assert<T>()` / `validate<T>()` call sites into **inlined straight-line JavaScript** — boolean chains, no helper calls, no allocation on the success path.       | An inlined anonymous type calls **nothing but JS intrinsics** (`Array.isArray`, `Number.isNaN`) and allocates nothing; a named type calls **exactly one** emitted helper. AC amended 2026-09-02 — see below. |
| **REQ-AV-2** | **No runtime parsing engine on the hot path**, ever. No Zod/Valibot/Yup/Ajv dependency, and no `new Function()`/`eval` (CSP-safe static emission). ✅ met — see §9.5.                                          | Dependency lint + parsed `Function` constructor / `eval` call sites (**0**) + function-only `refine`/`transform` signatures and emitter reachability/probes.                                                 |
| **REQ-AV-3** | The compiled path ships as a **wired build step** for the mainstream toolchains — a bundler plugin where there is a bundler, and `zmdb-codegen` where there is not — documented end-to-end. ✅ met — see §9.2. | Two consumer fixtures in CI, one per route (`fixtures/consumer-cli/`, `fixtures/consumer-plugin/`): identical accept/reject, identical emitted checks, both measured.                                        |
| **REQ-AV-4** | A **behaviourally identical pure-runtime fallback** exists for consumers who cannot run the transformer.                                                                                                       | The same conformance suite passes against both paths, asserting identical accept/reject sets.                                                                                                                |
| **REQ-AV-5** | Full API parity surface: `is`, `assert`, `validate`, `equals`, `random`, tags/constraints, discriminated + non-discriminated unions, transforms, JSON Ser/De.                                                  | Parity checklist test per symbol.                                                                                                                                                                            |
| **REQ-AV-6** | `parse<T>` returns the validated input **as-is** for plain structural types — no defensive object rebuild.                                                                                                     | Identity assertion (`result === input`) + the measured non-regression in `benchmarks/`.                                                                                                                      |
| **REQ-AV-7** | Error reporting (`validate`) yields a structured path + expected-type list without allocating on the success path.                                                                                             | Success path allocation probe; failure path asserts `path`/`expected`/`value`.                                                                                                                               |

**REQ-AV-1's AC, amended 2026-09-02.** It read _"contains no function call and no object literal on the happy path"_, and taken literally that is not achievable — nor desirable. Two calls survive on
purpose, and the AC now names both rather than being quietly treated as met:

- **JS intrinsics.** A check for `number` is `typeof x === 'number' && !Number.isNaN(x)`; a check that a value is an object and not an array calls `Array.isArray`. Those calls _are_ the check. A
  hand-written predicate would make exactly the same two, and inlining them further would mean emitting slower code to satisfy a sentence.
- **One hoisted helper per named type.** The emitter inlines an anonymous type and hoists a named one, because a name is the signal that a type may recur or appear twice — a self-referential interface
  has no inline form at all, and duplicating a shared one multiplies bundle size by its use count. So `is<{ n: number }>(x)` is one boolean expression with no zmdb call in it, and `is<User>(x)` is one
  call to one `_zmdbCheckUser` shared by every site.

Both halves are asserted, on the real bundle, in `packages/aot-validator/src/cli/consumer-fixtures.spec.ts`. What the AC was reaching for — no interpreter, no descriptor walk, no allocation to answer
a yes/no question — holds, and is the part REQ-AV-2 states directly.

### 6.4 Repository — the MikroORM replacement (REQ-RP)

| ID           | Requirement                                                                                                                                                              | AC                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-RP-1** | A fully typed repository is obtained in **one call** — `defineRepository(Schema, driver, { dialect })` — with `BaseRepository` subclassing available for domain methods. | Quickstart compiles in ≤ 3 lines after the schema; no hand-written CRUD.                                                                                                                                                                                                                                                                                                                                                                                             |
| **REQ-RP-2** | Inherited CRUD: `findById`, `find`, `list`, `create`, `update`, `delete`, plus batch/set-op and aggregate/populate variants — all typed off the schema.                  | `findById` returns `Entity<S> \| undefined`; `find` takes `WhereDTO<S>`.                                                                                                                                                                                                                                                                                                                                                                                             |
| **REQ-RP-3** | Write methods accept `unknown` at the boundary and **validate against the derived DTO before touching the database**, throwing `ValidationError` with a structured path. | `create({ ...valid, bogus: 1 })` and `create({ ...valid, id: 5 })` on a serial `id` both reject at runtime with a path naming the offending key, _and_ fail `tsc` when typed (`packages/repository/src/repository.spec.ts`). The check is the payload's own type — `objectTypeFromShape` of the `create`/`update` shape — walked by `@zmdb/aot-validator`, so a write enforces every bound the schema declares and nothing is validated twice from two vocabularies. |
| **REQ-RP-4** | **No proxies, no identity map, no change tracking.** Reads return plain inert objects.                                                                                   | `Object.getPrototypeOf(row) === Object.prototype`; no dirty-flag properties.                                                                                                                                                                                                                                                                                                                                                                                         |
| **REQ-RP-5** | Explicit transactions with `using`-style resource management, savepoints, and a typed transactional repository handle.                                                   | E2E: rollback leaves zero rows; nested savepoint partial rollback works.                                                                                                                                                                                                                                                                                                                                                                                             |
| **REQ-RP-6** | Relations via **explicit `populate`** (no lazy proxy relation loading), with typed result shapes.                                                                        | Type test on populated result; query-count assertion.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **REQ-RP-7** | Lifecycle events (before/after create/update/delete), embeddables, and entity inheritance are supported without introducing a proxy or a flush cycle.                    | Hook ordering tests; inheritance/embeddable E2E.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **REQ-RP-8** | Read replicas: reads routable to replicas, writes pinned to primary, with explicit override.                                                                             | Replica routing test asserts which connection served each statement.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **REQ-RP-9** | Drivers: `node:sqlite` built in (zero-dependency quickstart); `pg` and others **optional and structurally typed**.                                                       | Installing `zmdb` alone runs the sqlite quickstart with no third-party install.                                                                                                                                                                                                                                                                                                                                                                                      |

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

| ID           | Requirement                                                                                                                                                                                                                    | AC                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **REQ-UM-1** | `zmdb` re-exports the ecosystem through a curated root + subpath map (`zmdb`, `zmdb/tags`, `zmdb/derive`, `zmdb/ir`, `zmdb/dto`, `zmdb/relations`, `zmdb/web`, `zmdb/drivers/*`, `zmdb/unplugin`) and contains **zero logic**. | Re-export parity test; no non-re-export statement in the package. |
| **REQ-UM-2** | Every sub-package remains independently installable and tree-shakeable; the umbrella is convenience, not coupling.                                                                                                             | Each package builds and tests in isolation in CI.                 |
| **REQ-UM-3** | No `export *` — every public symbol is enumerated, with type exports separated.                                                                                                                                                | Lint rule forbidding star re-exports.                             |

### 6.7 Type-first declaration (REQ-TF)

The design goal that makes **P2** and **P3** literally true rather than aspirational: the declaration is a _type_, and every runtime artefact is generated from it. `defineSchema` inverted this — the
column facts lived in a value and the types were a shadow of that value — and it has been deleted rather than kept working alongside the tagged form (REQ-TF-12).

Full rationale and encoding are in [DESIGN-type-first.md](DESIGN-type-first.md); the phased implementation plan is in [PLAN-type-first.md](PLAN-type-first.md), whose five shaping decisions were all
resolved on 2026-09-02 — notably the removal above, and that a column has three types, rendered per layer (REQ-TF-13).

**Where this stands (2026-09-03).** All thirteen requirements are met, and each row below names the script or test that enforces it rather than asserting the outcome. `yarn verify:tf-acceptance`
audits that claim: every row has to name a gate or a spec, every file and every quoted test name it cites has to exist, and every gate it cites has to be a script `ci.yml` actually runs. A row nobody
can execute fails the build.

REQ-TF-9 was the last row carrying a ⚠️, and what closed it was deleting the type rather than ratcheting its count. `TypeDescriptor` and the `irFromDescriptor` bridge are gone, the entry points take a
`TypeIR` and nothing else, and the four specs that used to write the legacy input form now build the generated one. `verify:no-descriptors` holds the count at zero with an empty allow-list, and the
`PARTIAL_ON_PURPOSE` exemption in `verify:tf-coverage` went with it.

| ID            | Requirement                                                                                                                                                                                                                                                                                                                                      | AC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-TF-1**  | A domain type declared as a plain `interface` plus zmdb type tags expresses **everything** `defineSchema` can express: SQL type, primary key, serial, unique, default, length, sensitive, references, table name, FTS table, and every validation constraint.                                                                                    | ✅ Met. `ir/vocabulary.type-test.ts` fails to compile if a `SqlType` member, a `ColumnFlags` member or a `ValidationRule.kind` has no tag equivalent; `yarn verify:tf-coverage` fails if a tag has no IR field, an IR field is never read by the reflection, or a constraint reader reads four of five. See the note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **REQ-TF-2**  | Facts TypeScript already models are expressed **natively**, not as tags: nullability is `\| null`, optionality is `?`, an enum is a literal union, a JSON column is a nested interface, an array is `T[]`.                                                                                                                                       | ✅ Met. `ir/vocabulary.type-test.ts` enumerates every `ColumnFlags` member against its tag and names nullability as the deliberate exception; `Nullable<T>` is an alias for `T \| null` with no slot behind it. The reflection reads nullability by splitting `null` off the union (`reflect/index.ts` `#inferSql`) and a literal union straight into `jsonEnum`, so a `Nullable`/`Enum` tag would have nothing to add.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **REQ-TF-3**  | A tag carries **zero runtime cost and zero type-level computation** — an optional `unique symbol` slot, never a conditional or recursive type.                                                                                                                                                                                                   | ✅ Met, with the cost published rather than claimed to be nil. `tags/erasure.spec.ts` compares a tagged fixture's emitted output with its tag-stripped twin byte for byte; `yarn verify:instantiations` measures a 512-table schema against that same twin and ratchets what the tags add. It is not zero — see the note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **REQ-TF-4**  | The whole DTO suite derives from the tagged type: `Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO`, `ReadDTO`, `PrimaryKeyOf`, order-by, pagination, projection, and populated/join shapes. Each takes the tagged type only — no dispatch on a schema value.                                                                                       | ✅ Met, including the dispatch. Every name in the list takes the declared type and only that: `derive/tagged-dto.type-test.ts` covers the suite, `derive/type-derivation-tagged.type-test.ts` holds the REQ-SC-2…5 key sets and optionality against it. There is no schema-value twin left to dispatch to — the suite that compared the two families is deleted along with the family it existed to compare against, `derive/query.ts` re-exports the query shapes from `./dto` rather than restating them, and `CoreSchema` no longer takes a column-map parameter, because nothing reads one. Every derivation is also _constrained_ to a declaration — `DeclaredTable` in `schema-core/src/derive/index.ts` is `Table<string>`, whose weak-type rule refuses a schema value outright, so `Entity<typeof userSchema>` is a compile error rather than the value's own five properties dressed up as a row. A caller holding a value crosses to its type once, by inference, at a boundary that declares `TaggedSchema<T>`; `schema-of.type-test.ts` gates that crossing in both directions, including that an untagged `CoreSchema<string>` is refused rather than deriving something empty and that a tagged one cannot be handed to `Entity` at all. Two conditionals survive on purpose and each says so where it is written — a relations map names its child by value, so `RelationEntity` in the repository and `TargetEntityOf`/`ColumnNameOf` in `relations/index.ts` read the phantom explicitly. Not literally _unchanged_ from the value-side spelling; that contradicted REQ-TF-5, see the note below. |
| **REQ-TF-5**  | Constraints survive every derivation. `Omit`, `Pick` and `Partial` must not drop a tag.                                                                                                                                                                                                                                                          | ✅ Met. `derive/tagged-dto.type-test.ts` (from "constraints survive Omit / Pick / Partial") asserts the tag is still on the property after each, and `dto/dto.type-test.ts` records the consequence — a `WhereDTO` value type is tagged too, which is why nothing may be compared with `Equal` against a bare `string`. `yarn verify:tf-coverage` closes the other half: it fails if the reflection reads four of the five constraint keywords, which is the bug that made `Min<18> & Max<120>` validate differently depending on the walker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **REQ-TF-6**  | `Sensitive` is enforced by the **type**: `ReadDTO<T>` cannot name a sensitive column, so a leak is a compile error rather than a serializer responsibility.                                                                                                                                                                                      | ✅ Met, by both routes. `derive/tagged-dto.type-test.ts` pins `SensitiveKeys<User>` and `@ts-expect-error`s the read; `reflect/documents.spec.ts` ("never names a sensitive column, in any document or anywhere in the output") greps the whole emitted module, not just the schemas, because a column dropped from a document and left in a hoisted constant is still a leak. `Entity<T>` and `CreateDTO<T>` deliberately **keep** the column — the repository has to write and redact it — so `jsonSchemaFromShape` filters at the last step in every variant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **REQ-TF-7**  | The JSON Schema suite is type-driven with unchanged output contracts: `toJsonSchema<T>()` and the `entity`/`create`/`update`/`get`/`list`/`search` variants, `toJsonSchemaWithRelations`, `toOpenApiComponents`, `toListSchema`, `toSearchSchema`, `toolFromSchema`.                                                                             | ✅ Met. `reflect/documents.spec.ts` ("`toJsonSchema<T>` vs `toJsonSchema(schema, variant)`") asserts byte-identical documents for both routes, that the fixture's every document is covered, that no call survives the transform, and that each distinct document is hoisted once and frozen all the way down. `toJsonSchema<T>()` produces the `entity` variant; a request body is the two-argument form, because a variant name is a value. `toJsonSchemaWithRelations` produces the same document from one fewer argument: the relations come off `schema.ir`, so a generated document cannot name a relation its table does not declare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **REQ-TF-8**  | The AOT transformer resolves types with the **TypeScript checker**, not a text parser, and generates the runtime checks the tags declare — bounds, lengths, patterns, integrality, enum membership, nullability.                                                                                                                                 | ✅ Met. `parseType` is deleted — `grep -r parseType packages/` returns nothing — and `reflect/reflect.spec.ts` plus `emit/__testing__/project.ts` drive the real checker over a temp project for `is`/`assert`/`validate`/`equals`/`random`/`toJsonSchema`/`schemaOf` on named types, mapped types and derived DTOs. `reflect/schema-values.spec.ts` ("a declaration a table cannot be made of") pins the refusals, which are by name rather than by silence. One deviation from DESIGN §8 item 4: `transformCode` survives, because rule-first `validate(tags.X, expr)` is a value-shaped call the checker path has no reason to handle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **REQ-TF-9**  | No `TypeDescriptor` is hand-written anywhere — not in the packages, not in the benchmark harness.                                                                                                                                                                                                                                                | ✅ Met, and at zero rather than ratcheted. `yarn verify:no-descriptors` scans 296 files with an empty allow-list and finds none. The type itself is deleted: there is no `TypeDescriptor`, no `RuntimeSchema` union and no `irFromDescriptor` bridge, so `is`/`assert`/`validate`/`equals`/`assertEquals`/`random`/`issuesFor`/`assertStringify`/`decode` all take a `TypeIR` and nothing else — a shape that is generated, from a type the compiler checked, rather than a mirror of one written out by hand. The four specs that tested the legacy front-end build the IR instead, and the gate's third signal is a _declaration_ of the name, so the shape cannot come back by being re-declared somewhere new. The `PARTIAL_ON_PURPOSE` exemption in `verify:tf-coverage` is empty for the same reason: the only shape that could not express `maximum` no longer exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **REQ-TF-10** | The runtime schema value the query compiler needs for SQL is **generated** from the type, not authored. Types may generate runtime data; they are not the runtime data.                                                                                                                                                                          | ✅ Met. `reflect/schema-values.spec.ts` pins what `schemaOf<T>()` emits; `schema-core/src/schema-of.type-test.ts` asserts the generated value derives the same types as the declaration it came from; `repository/src/tagged-schema.type-test.ts` does it from the caller's side (`defineRepository(schemaOf<User>(), driver)`); and `repository/src/tagged-to-ddl.spec.ts` takes it through to DDL per dialect — including the two places the snapshot format loses information, which it asserts rather than hides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **REQ-TF-11** | Checker cost is paid **once per build**, not once per file.                                                                                                                                                                                                                                                                                      | ✅ Met. `plugin.spec.ts` asserts one `API` instance for the bundler path; `yarn verify:build-budget` does it for the CLI over a generated 64-module project, and adds the sharper form of "not once per file" — the snapshot-update log is identical at 8 modules and at 64. Build time is published in that script's output. See the note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **REQ-TF-12** | There is exactly **one** way to declare a table. `defineSchema` is removed rather than maintained alongside the tagged form, and a codemod converts an existing project. Until it is removed it is a proving device: the IR derived from the value must equal the IR derived from the type.                                                      | ✅ Met, and the proving device has served its purpose and gone. `yarn verify:no-defineschema` imports all seven published surfaces and reads their **export names** — exact rather than syntactic — then scans every file `git ls-files` knows about, committed or not, for `defineSchema`/`irFromSchema` used as code; `ALLOWED` is the codemod, its four corpora, four one-shot issue scripts and one docs page title, and a stale entry fails too. `reflect/codemod.spec.ts` converts the corpus and asserts the output line for line. The equivalence test is gone with the value side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **REQ-TF-13** | A column has **three** types and each layer renders the one it owns: wire (what arrives over HTTP), app (what handler code sees), db (what the dialect declares). `timestamp` is an ISO-8601 `string` in JSON Schema, a `Date` in `Entity<T>`, and `timestamptz` in Postgres DDL. The IR stores the abstract type; dialects render the spelling. | ✅ Met. `packages/zmdb/src/three-types.spec.ts` is the cross-package test — one case per dialect, asserting the DDL spelling, the `Entity<T>` validator and the JSON Schema for one `timestamp` column agree; `query-compiler/src/migrations/sql-types.spec.ts` pins `ddlType` per dialect (`TIMESTAMPTZ` on Postgres, `DATETIME(3)` on MySQL, `TEXT` on SQLite) and `reflect/payload-types.spec.ts` pins `objectTypeFromIR` against the derived type. No code path accepts `Date \| string`. The wire layer _checks_ the ISO string rather than only declaring it: a `format` is an annotation in JSON Schema and neither validator walk reads one, so it is lowered to a `pattern` — RFC 3339, offset required, because an offset-less string is read as local time and that is the lost-offset bug `timestamptz` prevents. `int64` reuses the decoder's expression, so the wire validator accepts exactly what `decodeWireValue` can convert. Three renderings from one walk is the whole claim, so `yarn verify:one-walker` gates it: outside `schema-core/src/ir/`, six library files may name `ColumnMeta`/`ColumnsMap`/`SqlType` and three may read a column's flags or rules, each with the reason written next to it, and a stale exemption fails too.                                                                                                                                                                                                                                                                                                                                                     |

#### REQ-TF-1: what a type test cannot state, and what it missed

REQ-TF-1's criterion is a type test, and a type test is the right instrument for most of it: `Equal<(typeof SQL_TYPES)[number], SqlType>` is a compile error the moment somebody adds a SQL type without
adding it to the list, which is exactly when you want to hear about it.

Three parts of the same requirement are not statable that way, and all three fail silently.

A tag is an optional `unique symbol` slot, and the reflection cannot import the tags — the module is types-only, by design — so it recognises them by the **escaped symbol name** (`__@zmdbSerial@1`)
through the `TAG_NAMES` table. Nothing in the type system connects a `declare const zmdbFts` to its row in that table: a tag with no row compiles, derives correctly, and is quietly absent from the
emitted validator.

`FLAG_TO_TAG` has the same problem one level up — it names its tags as _strings_, because the tags are parameterised differently and a heterogeneous map of them is not writable, so a rename leaves it
naming something that no longer exists.

And `Constraints` has five optional fields, so a reader that handles four of them is not a type error; that is precisely the bug the IR was introduced to end, where `TypeDescriptor` carried `minimum`
and `maxLength` but not `maximum` or `minLength` and `Min<18> & Max<120>` validated differently depending on which walker you asked.

There were five such walkers in the end, not four. The fifth was the seeder's `genValue`, which read `col.type` and an enum flag and nothing else, so a `Min<18> & Max<120>` column got whatever the
PRNG produced and every seeded row failed the table's own validator — inside tests whose subject was something else.

It was removed in the same way as the other four: generation now starts from the IR and uses the emitter's sampler. This also moved seeding to `@zmdb/repository/seeding`, because the sampler lives in
`@zmdb/aot-validator` and `schema-core` cannot depend on it without reversing the package graph. No existing check found the extra walker.

The four were found by reading the code with the question in hand; the fifth was found the same way, eight phases later. `yarn verify:one-walker` is the answer to "and the sixth?" — it names who may
read column metadata at all, so the next one has to argue for itself in a diff rather than arrive as two convenient lines.

`yarn verify:tf-coverage` checks those off a parse tree, and found four tags — `Fts`, `OneToOne`, `ManyToMany` and `AnyRelation` — that were published, documented, and written by no test or fixture
anywhere in the repo. The reflection's code for reading an FTS table had never run.

All four are covered now: `Fts<'users_fts'>` went into `reflect/__fixtures__/tables.ts`, where the golden pins the `ftsTable` it produces, and the boolean spelling `Fts<true>` plus the two missing
cardinalities went in beside it as assertions of their own. `Fts<true>` is also declared in `ir.spec.ts`, `tagged-to-ddl.spec.ts` and the codemod's corpus, so the two spellings are checked at every
stage they pass through.

A vocabulary entry nothing has ever declared is an entry whose behaviour is a guess, so "is every tag exercised" is now part of the gate rather than an assumption.

#### REQ-TF-3: "zero type-level computation", measured

REQ-TF-3 claims a tag costs the compiler nothing, and the acceptance criterion asks for typecheck wall-time against an untagged baseline. `yarn verify:instantiations` generates both sides from one
code path — 512 tables, 4,096 tagged columns, and the same 512 interfaces with every tag stripped — and reports what separates them. The claim survives, but not in the form it was written in.

**Declarations add little type-checking work.** Across 512 tagged tables, the measured cost was 6.01 type instantiations per table above an empty project; the untagged version added none. The 6.01
figure tracks the six tag arguments that differ between generated tables.

The checker caches an instantiation per distinct type argument, so `Sql<'varchar'>` is instantiated once for a program however many thousand columns carry it, and only the arguments that vary — the
table name, and this fixture's per-table lengths, patterns and bounds — cost anything. So the enforceable statement is stronger than "cheap": the cost of declaring is proportional to the number of
_distinct tag arguments_, not to the number of tagged columns.

Rewriting one tag as a conditional type takes that row from 6.01 to 8.01 and fails the gate.

That finding cost a false result first. The original fixture used identical tag arguments for every table and reported 523 instantiations for the whole 512-table schema — one per table, nothing per
column, apparently free. It was measuring the cache. The same conditional-tag mutation moved it by two instantiations in total and passed.

**Deriving is not free, and the number is now published.** The DTO suite over a tagged table costs 606 instantiations against the untagged twin's 505 — 1.20x — and about 0.25ms of checker time per
table. The key filters are conditional types and that is what the tags are _for_, so the ratio is above 1 by design; what the ratchet enforces is that it does not climb.

Wall-time is the wrinkle: the tagged program's check time is near 2.1x the untagged one's, higher than the instantiation ratio, so the checker is doing work on a tagged declaration that is not an
instantiation.

In absolute terms the whole difference across a 512-table schema is 130ms of check time, which is why the gate on that row is deliberately loose — it is there to catch a change of kind, and the
instantiation count, which is reproducible to the digit across runs, is what catches a change of degree.

#### REQ-TF-4 vs REQ-TF-5: why "unchanged" became "substituted"

REQ-TF-4's acceptance criterion originally said the REQ-SC-2…REQ-SC-5 type tests must pass **unchanged**. They cannot, and the reason is REQ-TF-5 immediately below it.

REQ-SC-2 asserts `Equal<Entity<S>['email'], string>`. On the tagged side that property is `string & Sql<'text'>`, because REQ-TF-5 requires every tag to survive `Omit`, `Pick` and `Partial` — the tags
are what the validator is generated from, so a derivation that dropped one would emit a weaker check on update than on insert. The two criteria are in direct tension and REQ-TF-5 wins.

Almost nothing is lost by that. A tag is an optional unique-symbol slot, so `string` and `string & Sql<'text'>` are _mutually assignable_: a consumer supplies a plain string, reads a plain string, and
never names a tag. So the criterion is now the three things that actually matter — identical key sets, identical optionality, and mutual assignability with the schema-value twin — asserted in
`packages/schema-core/src/derive/type-derivation-tagged.type-test.ts`, which is `type-derivation.type-test.ts` with `S` rebound.

**"Only `Equal` can see the difference" is not quite true, and finding out where cost a redesign.** A tag erases against an _untagged_ type, but two tagged columns see each other's tags, and a tag
payload sits in an invariant position: `Sql<'serial'>` and `Sql<'integer'>` were unrelated types. So `orders.create({ userId: user.id })` — a serial key read out of one table and written into another
table's integer foreign key, which is in the quickstart — did not compile.

The fix was to stop spelling one fact twice: `serial` left the tag vocabulary (`ColumnSqlType` is `Exclude<SqlType, 'serial'>`), a generated key is now `number & Sql<'integer'> & Serial`, and the
reflection maps `integer` + `Serial` back to `sql: 'serial'` so the IR, every dialect's DDL and the equivalence corpus are unchanged.

The residue is real and much smaller, and is recorded rather than papered over: `varchar` and `text` columns still do not interchange, because unlike the serial case those two columns genuinely are
different types. `packages/schema-core/src/tags/serial-foreign-key.type-test.ts` pins both halves.

One genuine behavioural change came out of it, and it is a breaking one: `exactOptionalPropertyTypes` is on repo-wide, and the tagged `CreateDTO`/`UpdateDTO` are plain `Partial`s, so
`{ email: undefined }` is now an error where the value-side DTOs accepted it. `{}` and `{ email: null }` are how "leave it alone" and "set it to NULL" are spelled; the widened form bought a third
spelling for one of two meanings.

The strict tagged DTO is still assignable everywhere the widened one was — only the reverse fails.

#### REQ-TF-11: "once per build", and the number that turned out not to matter

The criterion asks for one `API` instance across a multi-file build plus a published build-time measurement. `yarn verify:build-budget` writes a 64-module project — each module a tagged interface with
`is`, `assert`, `validate` and `toJsonSchema` over it — runs the real `codegen` on a session it owns so it can watch it, and then does the same at 8 modules.

The gate is two integers, and neither is a clock. **One compiler API** for the 64-module build, which is the requirement as written. And, the sharper half, **a snapshot-update log that does not depend
on the file count**: `[open, refresh]` at 8 modules and `[open, refresh]` at 64.

That is what "not once per file" means operationally, because telling the compiler about a new file re-checks it, and it is why `cli/index.ts` writes every witness before transforming any of them — an
ordering that reads like an arbitrary choice and is the only reason the second number is 2 instead of 65. Moving those two calls inside the loop is a one-line tidy-up that takes the log to 65 updates;
the gate fails.

The clock is published rather than enforced. The mutation moved the per-module time from 6.0ms to 8.2ms — 37%, comfortably inside any ceiling loose enough for a shared runner. Conversely, on
2026-09-05 the exact same source measured 9.5ms locally and 47.5ms on GitHub while both deterministic rows stayed identical. A wall-time threshold would either let the structural regression through or
reject the runner rather than the code.

The published split also corrects the intuition the requirement is usually justified with. Opening the project is about 20ms and **does not grow with the file count**, because the compiler defers the
expensive work until something asks it a question; generating costs about 6ms per module, linear, and at 64 modules that dominates the load by a factor of twenty.

So "the fixed cost dominates" is false here. The claim that is true is the narrower one the requirement actually makes: the load is paid once, and a codegen that reopened the project per file would
pay that 20ms sixty-four times for nothing.

One thing the measurement forced into the open. `codegen` rewrites the source files it just read, so when it returns, the snapshot its session holds is stale — a second pass on the same session
refuses with "changed on disk since the project loaded; run again".

That is correct behaviour and a clear message, but it means a rebuild is a new session, not a reused one, which is how the script measures `--check`. On a clean tree that check's log is `[open]` and
nothing else: verifying a generated tree in CI costs one project load and no re-checks at all.

---

## 7. The unified seam — one schema, one request lifecycle

This section is the **substance of the unification**: the point where the data-layer PRD and the decorator-framework PRD stop being two products.

### 7.1 The derivation contract

```
interface Orders extends Table<'orders'> { … }     ← the ONE change vector
      │
      ├─ Entity<Orders>        → repository read results → HTTP response type → OpenAPI response schema
      ├─ CreateDTO<Orders>     → POST body type → AOT-inlined body validator → OpenAPI requestBody
      ├─ UpdateDTO<Orders>     → PATCH body type → AOT-inlined partial validator
      ├─ ReadDTO<Orders>       → the same response shape, minus every `Sensitive` column
      ├─ WhereDTO<Orders>      → query-string filter type → SQL WHERE clause
      └─ schemaOf<Orders>()    → the column IR → DDL + migration diff
```

Five of those six are types, from `zmdb/derive`, applied to the declaration itself; they contribute nothing to a bundle. The sixth is the only value in the list — an object literal the transformer
writes at build time, which is what the DDL and the inlined validators are generated from. `zmdb`'s root publishes the same `Entity`/`CreateDTO`/`UpdateDTO` as `zmdb/derive` — one definition,
re-exported, taking `Orders` and never the value; there is no second family keyed by `typeof ordersSchema` (`packages/schema-core/SPEC.md` §4).

**REQ-SEAM-1:** A column added to the schema must appear — with no other edit — in the repository's typed methods, the controller's body/response types, the AOT-generated validator, and the OpenAPI
document.

**REQ-SEAM-2:** A column **removed or renamed** must produce a compile error at every dependent site (repository call, controller handler, service, projection, filter) until resolved. Silent tolerance
of a stale reference is a P0 defect.

**REQ-SEAM-3:** The HTTP boundary and the database boundary validate against the **same derived DTO**, from the same source, with the same inlined code — never two schemas kept in sync by hand.

### 7.2 End-to-end worked example

```ts
// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SINGLE SOURCE OF TRUTH — the only file that changes when the model does
// ─────────────────────────────────────────────────────────────────────────────
import type { HasDefault, Min, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface Orders extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  totalPrice: number & Sql<'numeric'> & Min<0>;
  status: ('pending' | 'paid' | 'shipped' | 'delivered') & HasDefault;
}

// Every import above is `import type`, and every tag is a phantom symbol, so this
// file compiles to nothing. The enum is a declared union — there is no tag for it.

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATA LAYER — one call. Entity/CreateDTO/UpdateDTO/WhereDTO are already derived.
// ─────────────────────────────────────────────────────────────────────────────
import { DatabaseSync } from 'node:sqlite';
import { BaseRepository, schemaOf } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';

// The one build-time call: the transformer reads `Orders` and replaces this with a
// frozen object literal. Untransformed, it throws — it never returns an empty schema.
export const ordersSchema = schemaOf<Orders>();

// Inherited CRUD + auto-validation OOTB; write only domain-specific queries.
export class OrderRepository extends BaseRepository<Orders> {
  static readonly schema = ordersSchema;

  async findPendingByUser(userId: number) {
    return this.find({ userId, status: 'pending' }); // typed WhereDTO — unknown column = compile error
  }
}

export const orders = new OrderRepository(sqliteDriver(new DatabaseSync('app.db')), 'sqlite');

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOMAIN INVARIANTS — illegal transitions are tsc errors, 0 bytes at runtime
// ─────────────────────────────────────────────────────────────────────────────
import { defineState, transition } from 'zmdb/web';
import type { Entity } from 'zmdb/derive';

type OrderRow = Entity<Orders>;
//   { id: number; userId: number; totalPrice: number; status: 'pending' | 'paid' | 'shipped' | 'delivered' }

const Pending = defineState<'PendingOrder', OrderRow>();
const Paid = defineState<'PaidOrder', OrderRow>();

// A pending order may be paid. A paid order may not be paid again — enforced by types.
const pay = transition(Pending, Paid, order => ({ ...order, status: 'paid' as const }));

// ─────────────────────────────────────────────────────────────────────────────
// 4. WEB LAYER — Stage 3 decorators, typed Ctx, token DI, zero reflection
// ─────────────────────────────────────────────────────────────────────────────
import { Controller, Get, Post, Inject, Module, createApp, repositoryToken, type Ctx } from 'zmdb/web';
import type { CreateDTO } from 'zmdb/derive';

const OrdersRepo = repositoryToken<Orders>('OrdersRepo');

@Controller('/orders')
class OrderController {
  @Inject(OrdersRepo)
  orders!: BaseRepository<Orders>; // type must match the token — no cast

  @Get('/:id')
  async getOrder(ctx: Ctx<{ id: string }>) {
    // ctx.params.id is `string`; ctx.params.nope would NOT compile.
    return await this.orders.findById(Number(ctx.params.id)); // Entity<Orders> | undefined
  }

  @Post('/')
  async createOrder(ctx: Ctx<Record<never, string>, CreateDTO<Orders>>) {
    // Body already validated by the AOT-inlined validator for CreateDTO<Orders>.
    // `id` is absent from CreateDTO (Serial — the database generates it, so naming it
    // is a compile error) and `status` is present but optional (HasDefault — supplying
    // one is legitimate). That distinction is why the two tags are separate.
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
  providers: [{ token: OrdersRepo, useValue: orders }],
})
class AppModule {}

// Route table + DI graph resolved ONCE here. Per request: 0 metadata reads, 0 reflection.
export const app = createApp(AppModule);
```

Sections 2–4 use decorators, so they are application files rather than published ones. zmdb's own source has to load under Node's type stripping — that is how the tests, the dev loop and the consumer
fixtures run it — and stripping admits no syntax that is not type syntax; `target: ESNext` then means a decorator that did get in would survive the emit into `dist` and reach a runtime with no
decorators either.

The declaration in section 1 has that property by construction, which is a large part of why it is a type and not a builder call.

**What this example demonstrates against the four incumbents:**

| Line of code               | Incumbent equivalent                                             | What we removed                            |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `CreateDTO<Orders>`        | a hand-written `CreateOrderDto` + a Zod schema + an entity field | 3 duplicate declarations                   |
| `Ctx<{ id: string }>`      | `@Param('id') id: string`                                        | parameter decorators + `reflect-metadata`  |
| `@Inject(OrdersRepo)`      | constructor DI via `emitDecoratorMetadata`                       | runtime type reflection                    |
| `this.orders.find({ … })`  | MikroORM `EntityManager` + proxy entities                        | identity map, change tracking, flush cycle |
| `pay(Pending.create(row))` | a runtime `if (order.status !== 'pending') throw`                | a class of production bugs, moved to `tsc` |
| body validation            | `ZodValidationPipe` parsing per request                          | the runtime parser                         |

---

## 8. Developer experience workflows

### 8.1 Add a new domain to the stack

1. Write **one** `interface` extending `Table<'name'>`, with the tags the columns need.
2. `defineRepository(schemaOf<T>(), driver, { dialect })` (one call) — or subclass `BaseRepository` for domain queries.
3. Write a controller whose bodies/responses are the derived DTOs.
4. Register both in a `@Module`.

**REQ-DX-1:** Steps 2–4 must total **under ~10 lines of declarative wiring** per domain, with **zero hand-written CRUD** and **zero hand-written DTO properties**.

### 8.2 Change an existing column (the money workflow)

Edit the property in the interface. Then:

- `tsc` fails at every stale reference (**REQ-SEAM-2**).
- The migration diff proposes the DDL (**REQ-QC-5**).
- The validator re-inlines at the next build (**REQ-AV-1**).
- The OpenAPI document changes on next boot (**REQ-WB-12**).

**REQ-DX-2:** The developer's total edit surface for a column change is **the file holding the interface, plus whatever genuinely needed a decision** — never a mechanical re-typing of the same field
in four places.

### 8.3 Incremental adoption

**REQ-DX-3:** Each layer must be adoptable alone, against an existing stack:

| Adopt only                   | Sits next to                       | Requirement                                                              |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `query-compiler`             | an existing Kysely/knex codebase   | Compiles SQL for any table; does not require the repository or web layer |
| `aot-validator`              | an existing NestJS/Express app     | Drop-in for Typia/Zod call sites; no schema-core requirement             |
| `schema-core` + `repository` | an existing NestJS app             | Repositories injectable into Nest providers as plain objects             |
| `web`                        | an existing hand-rolled data layer | Repositories are optional providers; any object can be a provider        |

### 8.4 Migration from the incumbents

**REQ-DX-4:** Ship a documented migration path per incumbent, stating plainly what is mechanical and what requires redesign:

| From         | Mechanical                                                 | Requires redesign                                                                              |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **NestJS**   | `@Controller`/`@Get`/`@Module`/guards/interceptors map 1:1 | `@Body()`/`@Param()`/`@Query()` → one `Ctx` object; constructor DI → `@Inject(token)` field DI |
| **Typia**    | `is`/`assert`/`validate`/`random`/tags map 1:1             | Build-plugin wiring differs; tag namespace is zmdb's                                           |
| **MikroORM** | Repository methods, transactions, hooks, populate          | Code relying on identity map, auto-flush, or lazy proxy relations must become explicit         |
| **Kysely**   | Query-builder shape is familiar; SQL output comparable     | Types come from the tagged declaration, not a separately declared `DB` interface               |

---

## 9. Non-functional requirements

### 9.1 Performance targets

Targets are per layer, measured **by the real upstream harness**, reported in `benchmarks/RESULTS.md` and the dashboard.

| ID           | Layer      | Requirement                                                                                                                                                                                                                                 |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-NF-1** | Validation | The AOT path must be **within noise of Typia** and **an order of magnitude+ above runtime parsers** on the `typescript-runtime-type-benchmarks` cases, across Node/Bun/Deno.                                                                |
| **REQ-NF-2** | Validation | Success path: **zero allocation**. `parse<T>` returns the input identity for plain structural types.                                                                                                                                        |
| **REQ-NF-3** | ORM        | Serve **all** drizzle-benchmarks routes (0 DNF) on real PostgreSQL and be competitive with Drizzle/Kysely on throughput under k6.                                                                                                           |
| **REQ-NF-4** | ORM        | **Zero allocation footprint** for raw reads: no per-row metadata records, no proxy wrappers, no identity-map retention.                                                                                                                     |
| **REQ-NF-5** | Web        | **Zero per-request metadata reads and zero reflection** — machine-asserted by a unit guard, independent of any HTTP load number.                                                                                                            |
| **REQ-NF-6** | Web        | Throughput in the **same-machine peer head-to-head** (the-benchmarker contract, identical `oha` invocation) must be **in the same band as the mainstream Node frameworks** (Fastify/Hono/Koa) — a decorator framework must not cost a tier. |
| **REQ-NF-7** | All        | SQL compilation overhead must be negligible against the round-trip (target: sub-microsecond per query).                                                                                                                                     |

### 9.2 Measured status (2026-08-31)

| Requirement  | Status                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-NF-1     | ✅ met (with a caveat)        | Transformer-produced `zmdb-aot`: **83.3M** parseSafe / **55.7M** parseStrict / **93.2M** assertLoose / **51.7M** assertStrict ops/s. The recorded Typia row is 100.7M/38.9M/78.1M/31.1M. Only the zmdb rows were refreshed in that upstream table, so competitor gaps are approximate; the local harness consumes every result and is the preferred comparison.                                                                                                                                           |
| REQ-NF-2     | ✅ met                        | `parse<T>` identity fix measured **1.56×** faster in a low-noise probe.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| REQ-NF-3     | ✅ coverage met; ⚠️ trade-off | **13/13 routes, 0 DNF** on real Postgres. Repeated full-replay sessions put zmdb, Drizzle, and Kysely within a few percent on throughput, with the ordering changing between runs. Drizzle keeps the better tail (p95 173.8 ms vs zmdb 215.5 ms in the recorded run). Opt-in `ZMDB_PREPARED=1` measured 3,068 req/s / 97 ms / p95 209.5 ms. Aggregate routes use a different projection shape.                                                                                                            |
| REQ-NF-4     | ✅ met                        | Reads return objects with `prototype === Object.prototype`; no identity map exists.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| REQ-NF-5     | ✅ met                        | `countMetadataReads()` guard in `packages/web/src/bench` asserts 0 per-request reads.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| REQ-NF-6     | ✅ met                        | Same-machine, contract-verified, interleaved per-core `GET /`: **@zmdb/web 29,698 req/s** vs fastify 25,441 · hono-node 22,385 · koa 20,099 · express 16,440. Pass spreads were at most 1.08× for these Node rows.                                                                                                                                                                                                                                                                                        |
| **REQ-AV-3** | ✅ met (2026-09-02)           | Closed by the second route. A bundler plugin only helps a project that has a bundler, so `zmdb-codegen` compiles the checks into files beside the source and rewrites the call sites to import them — no plugin, no transform, no bundler, runnable under plain `node`. Both routes are consumer fixtures in CI (`fixtures/`), and they emit the **same code**: `is<Order>` measures **27.1M ops/s** compiled by the CLI and **33.3M** through the plugin, a spread that is measurement order, not route. |

### 9.3 Build, type, and quality requirements

| ID            | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-NF-8**  | tsconfig floor for every package: `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, and `experimentalDecorators: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **REQ-NF-9**  | Type-level behaviour is **tested**, not assumed — in a file the typechecker actually compiles: `Expect<Equal<…>>` in `*.type-test.ts` for positives, `@ts-expect-error` for every documented compile error. **`expectTypeOf` is banned**: vitest only _runs_ specs, so those calls are runtime no-ops (see §9.6). **67 type-test files and 242 `@ts-expect-error` assertions** today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **REQ-NF-10** | Spec-first: a concern gets a frozen `SPEC.md`, then failing tests, then implementation, then docs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **REQ-NF-11** | Branded/phantom types must contribute **0 bytes** to bundle output and **0 ns** of runtime evaluation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **REQ-NF-12** | Publishing: ESM-only, single `exports` map, Trusted Publishing (OIDC) with provenance, `latest` tracking highest-precedence release. License **GPL-3.0-or-later**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **REQ-NF-13** | Every capability must be documented on the docs site before it counts as shipped (**0 TODO** policy), including an **Anti-patterns** page explaining each deliberate exclusion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **REQ-NF-14** | ✅ **Met.** Framework `as`/assertion count is tracked in CI and must be **monotonically non-increasing**, with every remaining assertion carrying a `// boundary:` comment. Enforced by `yarn verify:escape-hatches`, which recomputes every row of §9.4 off a parse tree and fails on an increase or on an undocumented assertion. Ratchet (2026-09-04): **55 assertions, 55 boundary comments, 0 double casts, 0 non-null `!`, 0 `any`, 1 argued lint suppression** — see §9.4.                                                                                                                                                                                                                                                                                                                                                                           |
| **REQ-NF-15** | ✅ **Met (2026-09-03).** Every public export is exercised by a functional test, and "public" is decided by reading the export names off each published subpath rather than by grepping. The bar for _enough_ tests is set outside this repo: the **742 public-API test suites (9,258 assertions)** Drizzle, Kysely, MikroORM, NestJS and Typia run are inventoried at a pinned commit, and each is either mapped to a zmdb test or argued against with a reason. Enforced by `yarn verify:api-coverage`; re-harvested deliberately by `scripts/harvest-api-tests.mjs`, never in CI. Today: **503 suites answered by 311 of our 1,952 tests, 239 argued against under 48 distinct rationales** — and the gate prints its widest credits (currently 64 suites resting on one populate test) so that fan-in stays visible instead of averaging into the total. |

### 9.4 Escape-hatch audit — ratcheted in CI as of 2026-09-04

**`yarn verify:escape-hatches` is the audit.** The table below is what `.github/scripts/verify-escape-hatches.mjs` prints, and CI fails on any row that goes up or on any assertion whose enclosing
function has no `// boundary:` comment. RISK-7 — "P4 holds today but nothing keeps it holding" — is closed by that script, not by this section.

Counted off a real parse tree, per package, over the **176 shipped source files** in `packages/*/src`. Tests are excluded and the script says why: `*.spec.ts`, `*.type-test.ts`, `__testing__/` and
`__fixtures__/`. A file whose job is to prove a type _rejects_ something is expected to contain `@ts-expect-error`; those directives are not framework escape hatches.

| Metric                                     | 2026-08-31 (grep, 67 files) | 2026-09-02 (parse tree, 84 files) | 2026-09-03 (DSL deleted) | 2026-09-04 current | Ceiling |
| ------------------------------------------ | --------------------------: | --------------------------------: | -----------------------: | -----------------: | ------: |
| `: any` / `<any>` / `any[]` / `as any`     |                       **0** |                             **0** |                    **0** |              **0** |       0 |
| `@ts-expect-error` / `@ts-ignore` in src   |                       **0** |                             **0** |                    **0** |              **0** |       0 |
| `as unknown as` double casts               |                       **1** |                             **2** |                    **1** |              **0** |       0 |
| Type assertions (`as T`, excl. `as const`) |                      **28** |                            **65** |                   **62** |             **55** |      55 |
| `// boundary:` comments                    |                      **37** |                            **56** |                   **54** |             **55** |       — |
| Non-null assertions (`!`)                  |                       **0** |                             **0** |                    **0** |              **0** |       0 |
| `eslint-disable` / `oxlint-disable` in src |                       **0** |                             **1** |                    **1** |              **1** |       1 |
| `Function` constructor / `eval` call sites |                       **0** |                             **0** |                    **0** |              **0** |       0 |

The third column is plan D2 landing: `defineSchema`, ten column builders and eight function-style modifiers deleted. It took three assertions and one double cast with it, and they are the good kind of
removal — nothing was rewritten to dodge a cast, the code that needed the cast is gone.

Both ceilings came down in the same commit, which is the direction this table is supposed to move; see the four structural fixes at the end of this section for the shape of the argument.

Subsequent work had already brought the assertion ceiling from 62 to 61. The shallow validator public surface then replaced the three successful validator-return casts with one shared `certified`
boundary, taking the measured count from 61 to 59 without weakening a check. Repository loader work then replaced `attachRelations`' asserted populated-row return with checked overloads, taking the
count from 59 to 57 and the double-cast count from one to zero. Composite-key queries then moved from asserted runtime `where` objects to the compiler's typed `where` methods, taking the count from 57
to 55.

Three rows moved between the first two columns, and none of them because the code got worse:

- **Assertions 28 → 65.** The tree grew by 18 files: the reflection front-end, the emitter, the codegen CLI, the `zmdb-codemod` and the test-time bridge — the whole type-first spine, which did not
  exist on 2026-08-31. Reflection is where casts live: the `typescript@7` client hands back a `Type` and answers "is this an array?" with a `boolean` rather than a predicate, so the check that makes
  `getTypeArguments` legal cannot narrow its own argument. Every one of the 65 carries a `// boundary:` comment, which is the part the script actually enforces.

  The 65th is the one raise in this table, and it is a raise rather than a swap, so it needs its own sentence: `schemasFrom<{ User: User }>(url, ['User'])` in `aot-validator/src/testing` returns
  `{ [Name in Names[number]]: SchemaIR }`, and it builds that object in a loop keyed by strings. The keys are values at that point — that is what the function is for — and no way of writing the loop
  lets the compiler read them back off the array. The loop throws on a name it cannot resolve, so the promise the assertion makes is kept by the code above it rather than by the cast.

- **Double casts 1 → 2 → 1 → 0.** The second was `attachRelations`' populated-row return in `@zmdb/repository`. The first was `makeColumn`, and it went away with the column builders in plan D2, as
  this said it would — a column was not a `Column` until `Object.defineProperties` had attached the fluent methods to it, and there is no way to express that as a type-changing operation. Repository
  loader work replaced `attachRelations`' asserted return with checked overloads, so none remain.
- **Lint suppressions 0 → 1.** `toJsonSchema<T>(): JsonSchemaObject`'s overload in `schema-core/src/openapi`, which declares a type parameter it never mentions in a parameter — that is the whole point
  of a type-first signature, and there is nowhere else for `T` to appear. `oxlint`'s `no-unused-vars` is right about the shape and wrong about the intent, so the suppression names the reason. It is
  the only one in the tree.

Per-package distribution of the 2026-09-04 recount:

| Package                | Assertions | `// boundary:` | What the boundaries are                                                              |
| ---------------------- | ---------: | -------------: | ------------------------------------------------------------------------------------ |
| `@zmdb/aot-validator`  |         26 |             16 | checker `Type` → `TypeReference`, `JSON.parse` → `T`, one certified validator return |
| `@zmdb/schema-core`    |         12 |             10 | untrusted DTO payload reads, the custom-type registry, `every` as a predicate        |
| `@zmdb/repository`     |          6 |              6 | driver row → `Entity<S>`, the subclass statics, cursor payload                       |
| `@zmdb/web`            |         10 |             22 | decorator-metadata reads, DI token → instance, brand attach                          |
| `@zmdb/query-compiler` |          1 |              1 | the `compile()` duck-type guard                                                      |
| `zmdb` (umbrella)      |          0 |              0 | —                                                                                    |

`@zmdb/web` has more boundary comments than assertions, which is the intended direction: a boundary is a place where types stop proving things, and several of them are guards and `unknown` reads
rather than casts.

**Writing the ratchet found four hatches nobody had counted**, all fixed by removing them rather than documenting them: a stale `oxlint-disable` in `schema-core`; two non-null assertions in
`query-compiler`; and `validate()`'s `Pattern` rule reading `r.args[0] as string` unchecked, so a `Pattern` with a number in it compiled a regex out of the coerced number instead of answering `false`
like every other rule with a bad argument.

That last one was a bug, not a style problem, which is the argument for the script in one sentence.

**Conclusion.** `ARCHITECTURE.md` §2.1's rule — "each with a `// boundary:` comment stating _why it is sound_" — holds in every package, and now holds mechanically. This is still not "zero escape
hatches": the survivors are heterogeneous `Map`s, `Function.prototype.constructor`, `JSON.parse`, decorator-metadata slots, driver rows, and a compiler client whose predicates are booleans. Lowering a
ceiling is a normal commit; raising one has to be argued here.

Most of the reduction came from four structural fixes rather than one-off cast edits:

1. **Generic-erasure returns in the column builders** (`schema-core/src/index.ts`) — `makeColumn(): Column` erased `T`/`F`, so each of the **19** builders and function-style modifiers ended in its own
   `as never`. Making the helper generic in its _result_ type (`makeColumn<C extends Column>`, inferred from the caller's declared return type) removed all 19, leaving one `as unknown as C` inside it
   carrying the soundness argument. Plan D2 then deleted the builders outright and that last one with them, which is the better ending: the cast was sound and well-argued and the right fix was to stop
   needing it.
2. **`CoreSchema<string>` widening in the repository** — `list()` cast its typed DTOs down to `CoreSchema<string>` to reach the schema-core helpers, cast the builder through `any` to reach
   `applyOrderBy`/`applyPagination`, and cast the result back. Making those helpers generic in `S` removed the round-trip, all four `as any`, both lint suppressions **and** the consumer-facing
   `COOKBOOK.md` cast that the same erasure forced on users.
3. **`satisfies` instead of `as` for rule construction** (`aot-validator/src/advanced`) — `Object.freeze({ … } as UnionRule)` checks nothing about the literal; `satisfies UnionRule` checks it and
   keeps the literal type. Paired with an `isRecord` type guard for keyed reads off `unknown`, that removed ~20 casts from one file.
4. **Re-check instead of assert on the validator fallback path** — `validate()` read rule arguments as `r.args[0] as number`. `args` is `readonly unknown[]`, so the assertion was unchecked; a
   `typeof arg === 'number'` guard is free after JIT folding and this is the fallback path anyway (the AOT emission is what the benchmarks measure).

Non-null `!` went the same way: `?.` plus an explicit fallback, which is what `noUncheckedIndexedAccess` was asking for all along.

### 9.5 CSP safety (REQ-AV-2) — resolved

`@zmdb/aot-validator`'s `refine()` and `transform()` used to compile a user-supplied source string with **`new Function()`** in the runtime-fallback path, contradicting REQ-AV-2's "no
`new Function()`/`eval`" and narrowing "static CSP-safe emission, no runtime eval" to the core `is`/`assert` path. Under a strict CSP those two builders threw.

**Resolved via option (a):** both now take a **real function value** (`RefinePredicate` / `TransformFn`) and record `source` through the intrinsic `Function.prototype.toString` for inspection. The
current type-first emitter does not consume advanced-rule source. There are **zero** direct `Function` constructor / `eval` call sites in `packages/*/src`; a predicate passed as a function is also
typechecked at its call site, which a source string never was, and both runtime constructors reject non-functions for plain JavaScript callers. RISK-7b is closed, and `yarn verify:escape-hatches`
checks the signatures plus separation from both emission paths rather than inferring safety from those zero tokens alone.

### 9.6 The type-safety gate was not actually a gate (2026-08-31)

REQ-NF-9 said type-level behaviour is tested. It was not — the assertions existed but nothing ran them. Three compounding causes, all now fixed:

1. **`expectTypeOf` in `.spec.ts` files.** vitest only _executes_ specs; `expectTypeOf(...)` is a runtime no-op unless `vitest typecheck` runs, which it never did. Every such assertion — path-param
   derivation, brand nominality, DI token binding, DTO shapes — was decoration. All of them are now `Expect<Equal<…>>` in **67 `*.type-test.ts` files** that `tsc` compiles; `expectTypeOf` is banned
   outright.
2. **Specs were excluded from every package tsconfig.** So the `@ts-expect-error` directives in them were inert too: a directive in a file outside the program cannot fail. Specs are now inside the
   program, which turns each of the **242** directives into a real assertion — and `tsc` reports an _unused_ `@ts-expect-error`, so a directive that stops being needed also fails the build.
3. **CI typechecked four packages, not seven.** The workflow ran a hand-written `for p in schema-core query-compiler aot-validator repository` loop; `web` and `zmdb` were never typechecked. `web` was
   doubly outside: its tsconfig also remapped `@zmdb/*` to `../*/dist/*.d.ts` — gitignored build output, absent in a fresh checkout and stale whenever a sibling source changed. `scripts/typecheck.mjs`
   now discovers projects from the filesystem and CI calls `yarn typecheck`, so adding a package cannot silently opt out.

Bringing the excluded files into the program surfaced **34 real type errors**, including one that invalidated a frozen SPEC: `findById(id, { populate })` returned `Entity<S>`, not a populated type, so
the "no lazy getters, typed populate" acceptance criterion had never been met and specs papered over it with casts.

`Populated` now derives the attached fields, `find` accepts `populate` too, and an unknown relation name is a compile error rather than a runtime throw. (It derived them from a relations map at the
time; it reads the relation off the declared type now, and the map is gone — see §9.4's note on the type-first work.)

**Lesson recorded, not just fixed:** a type-level assertion is only a gate if the file it lives in is inside a program that CI compiles. Anything else is a comment.

### 9.7 Toolchain and repo hygiene (2026-08-31)

Findings from the same audit that are not type-safety but would have broken a fresh clone:

- **Manifest ↔ lockfile drift.** Six `package.json` files declared `typescript: 5.9.2` / `tsup: 8.5.0` while the lock resolved TS 7.0.2 and tsup 8.5.1, `benchmarks` had `kysely` in `devDependencies`
  at a version the lock did not carry, and `oxlint`/`oxfmt` were used by the root scripts without being declared at all. `yarn install --immutable` — what CI runs — therefore **failed**, meaning CI
  could not have been green. All manifests now match the lock and `yarn install --immutable` completes clean.
- **Yarn linker.** `nodeLinker: node-modules` is now explicit in `.yarnrc.yml`. PnP's resolution does not agree with `tsc`'s `paths`-based source resolution used here, so the two gates disagreed about
  what a `@zmdb/*` import meant.
- **Root `typecheck` script never worked.** It was `tsc --build`, which needs a root `tsconfig.json` (none exists) and project references with `composite`, which needs declaration emit, which every
  `noEmit` package refuses. It failed with TS6053 — a passing-looking script that had never typechecked anything. Replaced by `scripts/typecheck.mjs`.
- **Remaining:** the root pins `@types/node: "*"`. It is pinned exactly in the lockfile, so builds are reproducible today, but a lock refresh can silently cross a major. Pin it to the Node 26 line at
  the next online lock refresh.

---

## 10. Definition of done

The unified product is "done" for a release when **all** hold:

1. Every REQ above is either met with a passing test or explicitly listed as a gap with an owner and an issue.
2. **0 DNF** in both upstream harnesses (ORM routes, validation cases), with each remaining trade-off enumerated individually.
3. The `@zmdb/web` contract check passes and same-machine peer numbers are refreshed.
4. A greenfield app — schema → repository → controller → served OpenAPI — is buildable from the quickstart with **`npm add zmdb` and nothing else** (`node:sqlite` driver).
5. Consumer-facing code in every doc example contains **zero `as`** (✅ **0 violations** — §9.4).
6. Every framework assertion carries a `// boundary:` comment (✅ **64/64** — §9.4) **and the CI counter is wired** (✅ `yarn verify:escape-hatches`, 2026-09-02) and the runtime-code-generation guard
   passes (✅ **0 sites**, checked by the same script, §9.5).
7. `REQ-AV-3` is closed (✅ **2026-09-02**, §9.2): there is a documented build step for a project with a bundler and for a project without one, both covered by a consumer fixture in CI, and both
   emitting the same compiled checks.

---

## 11. Risks & open questions

| ID          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-1**  | ~~**The AOT premise is unearned out of the box.**~~ **Closed 2026-09-02.** The premise needed a route that did not assume a bundler, and `zmdb-codegen` is it: it compiles the checks to files next to the source, rewrites the call sites to import them, and `--check` fails a build whose committed output is stale. Both routes are fixtures in CI, emitting the same code (§9.2).                                                                | Keep it closed by keeping the fixtures representative: `yarn verify:fixtures` runs the published binary in CI, and `consumer-fixtures.spec.ts` fails if the two fixtures stop being the same program. **Residual risk:** a consumer who wires neither still gets the runtime path, so the remaining work is loudness, not capability — a build-time warning when a `is<T>()` call reaches runtime uncompiled.                                                                                                                                                                                                                                                                                                    |
| **RISK-2**  | **ORM tail latency** (p95 behind Drizzle) is inherent to the stateless, zero-state design; the compile step (~254 ns) is not the cause.                                                                                                                                                                                                                                                                                                               | Server-side prepared statements exist as opt-in (`ZMDB_PREPARED=1`, verified +4–5% req/s and a narrower tail); a plan cache is planned, kept opt-in to preserve the zero-state default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **RISK-3**  | **Node 26 / TS 7 / ESM-only floor** excludes much of the current market.                                                                                                                                                                                                                                                                                                                                                                              | Deliberate and permanent. It is what lets us delete shims and use `node:sqlite`, `using`, Stage 3 metadata. Marketed as a forward-looking stack, not a migration target for legacy apps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **RISK-4**  | **No parameter decorators** is the biggest DX shock for NestJS migrants.                                                                                                                                                                                                                                                                                                                                                                              | `Ctx` is strictly more type-safe (params derived from the path literal); document the 1:1 rewrite table (§8.4) and provide codemod guidance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **RISK-5**  | **Breadth vs. maintainability** — six packages spanning four incumbents, maintained by a small team.                                                                                                                                                                                                                                                                                                                                                  | Splitting doctrine (`ARCHITECTURE.md` §3.1): subpath exports are the default, a new package is the exception, and dissolving a package is an encouraged refactor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **RISK-6**  | ~~**Type-level derivation cost** — heavy conditional types can slow consumer `tsc`.~~ **Closed 2026-09-02.** Budgets are in CI and the numbers are published: `yarn verify:instantiations` ratchets what a tag costs at 512 tables against the same schema untagged, and `derive/instantiation-budget.spec.ts` holds the 8-table ceiling and the 4x-scaling factor. Both measure through one module, so they cannot disagree about what they measure. | Keep both in CI, and treat a `tsc` regression as a perf regression — the P1 north star applies to _the consumer's_ build too. The residual risk is that the fixture is generated: it says what 512 uniform tables cost, not what one awkward real schema costs, and writing it showed how easily a generated fixture measures the compiler's instantiation cache instead of the design (see the REQ-TF-3 note). A nested JSON column, a deep relation graph and a 40-member literal union are the shapes it does not have.                                                                                                                                                                                       |
| **RISK-7**  | ~~**P4 holds today but nothing keeps it holding.**~~ **Closed 2026-09-02.** `yarn verify:escape-hatches` recomputes every row of §9.4 off a parse tree, fails on any increase, fails on an assertion whose enclosing function has no `// boundary:` comment, and carries the direct `Function` constructor / `eval` presence check REQ-AV-2 asks for. Writing it found four uncounted hatches, one of which was a bug (§9.4).                         | Keep it in CI. Lowering a ceiling is a normal commit; raising one has to be argued in §9.4, which is where the failure message points. The residual risk is scope: it measures `packages/*/src` and deliberately not tests, so a hatch moved into a `__testing__/` helper that ships would not be seen.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **RISK-7b** | ~~**`new Function()` in `refine`/`transform`**~~ **Closed.** Both take and runtime-check a real function value; `source` is the intrinsic function text for inspection, not input to the current emitter, and there are 0 direct `Function` constructor / `eval` call sites (§9.5).                                                                                                                                                                   | Kept closed by `verify:escape-hatches`: it checks every public signature remains callable-only and string-free, probes the no-checker emitter with ordinary and prototype-chain source strings, proves the checker-driven call set excludes both constructors, and rejects import reachability from either emitter into the advanced-rule module. The direct runtime-code-generation call-site count remains a separate zero ceiling.                                                                                                                                                                                                                                                                            |
| **RISK-7c** | **The type-safety gate was decorative** (§9.6): `expectTypeOf` in specs is a runtime no-op, specs were outside every tsconfig so their `@ts-expect-error` directives were inert, and CI typechecked 4 of 7 projects. Fixing it surfaced 34 real errors, one of which invalidated the frozen typed-populate SPEC.                                                                                                                                      | Fixed: 67 `*.type-test.ts` files, specs inside the program, `scripts/typecheck.mjs` discovering projects from the filesystem, and CI running `yarn typecheck`/`yarn lint`/`yarn fmt:check`. Residual risk is cultural — a new `expectTypeOf` call would pass review unless the counter script bans it too.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **RISK-8**  | **`defineSchema` inverted P2** — resolved 2026-09-03. The column facts lived in a runtime value and the types were derived from it, so the runtime data was the source of truth and the type system was downstream: the opposite of what P2 and P3 claim. It was also why the AOT transformer could not see a named type, and why `benchmarks/harness/framework/app.ts` hand-wrote a `TypeDescriptor`.                                                | Type-first declaration (§6.7, `REQ-TF-*`, `DESIGN-type-first.md`) shipped: the tags are on the interface, the TS 7 checker resolves it, and both the checks and the runtime schema value are generated from that. `defineSchema` was deleted rather than kept as a peer — `yarn verify:no-defineschema` fails if it comes back — and `reflect/codemod.spec.ts` carries an existing project across. Nothing named here is still open: the hand-written descriptor is gone from the harness and from the four spec files that used to test that path, and `TypeDescriptor` itself is deleted — `verify-tf-coverage.mjs` tolerates no partial reader, because the shape that needed the tolerance no longer exists. |
| **OPEN-1**  | Should the DI container be promoted from a `@zmdb/web` sub-module to its own package?                                                                                                                                                                                                                                                                                                                                                                 | Deferred until it is independently useful per the §3.1 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **OPEN-2**  | Native/WASM kernels for the validator emitter or SQL string assembly.                                                                                                                                                                                                                                                                                                                                                                                 | Not justified today. Gated on a committed benchmark showing a _consumer_ hot-path bottleneck, and must ship with an identical-behaviour pure-JS fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 12. Out of scope — deliberate exclusions

These are excluded **on principle**, not from lack of time, and each is documented on the docs site's Anti-patterns page:

- Identity map, unit-of-work with auto-flush, dirty checking, lazy proxy relations, JIT entity mappers — incompatible with P1.
- `reflect-metadata`, parameter decorators, `emitDecoratorMetadata` — incompatible with P1 and P3.
- Runtime schema parsers on the hot path; `new Function()`/`eval` codegen (also CSP-hostile).
- CommonJS output, dual publishing, polyfills, Node < 26 / TS < 7 support.
- Implicit magic query objects, and any API that can produce a hidden N+1.
- A separate non-TypeScript schema language plus a code-generated client (the Prisma model).

---

## 13. Reconciliation of the two source PRDs

Both source documents are absorbed in full. Where they conflicted with each other, with `ARCHITECTURE.md`, or with the shipped code, this PRD resolves as follows:

| Source clause                                                                                                                                                                                    | Resolution here                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage-3 PRD: _"Strict Type Verification (Zero Escape Hatches)"_ — no `as` anywhere, while its own sample code used `as DraftOrder`, `as PaidOrder`, `as RouteDefinition[]`, and `any` four times | **P4.** Assertion-free _public surface_; framework internals hold an enumerated, commented, CI-tracked boundary-cast list driven toward zero. `defineState`/`transition` give consumers branding with no `as`.                                   |
| Data-layer PRD: `totalPrice: numeric().validate(typia.tags.Min<0>())` — depends on Typia, which we are replacing, and contradicts the zero-dependency rule                                       | **REQ-SC-6.** Native `tags` from `@zmdb/aot-validator`. No third-party validator appears in any API or example.                                                                                                                                  |
| Data-layer PRD: `defineCoreSchema(...)`, `this.rawEngine.selectFrom(...)`                                                                                                                        | Unified on the shipped API: a tagged `interface` plus `schemaOf<T>()`, `defineRepository(...)`/`BaseRepository`, typed `find`/`list` plus the query compiler for raw SQL.                                                                        |
| Stage-3 PRD: DI via a static global `Container.register/resolve` with `Constructor` tokens and `throw` on miss                                                                                   | **REQ-WB-5/6.** Module-scoped container with explicit `createToken`/`repositoryToken`, graph validated at `compileModule` time (fails _before_ serving), resolved at class-init. No module-level mutable singleton on the hot path.              |
| Stage-3 PRD: `Ctx<Params, Body>` with `Params = Record<string, string>` default                                                                                                                  | **REQ-WB-3.** `Ctx<Params, Body, Query>` with `headers`/`method`/`path`, and params **derived from the path literal** via `PathParams<Path>` so an undeclared param is a compile error rather than `string`.                                     |
| Stage-3 PRD: _"benchmark within <2% variance of native HTTP router speeds"_                                                                                                                      | **REQ-NF-5 + REQ-NF-6.** Split into the claim we can actually machine-verify (0 per-request metadata reads/reflection) and a contract-verified, same-machine peer comparison. The original single-number target was unfalsifiable as written.    |
| Data-layer PRD: _"10x–100x faster than runtime parsing"_ as an assumed property                                                                                                                  | **REQ-NF-1 + §9.2.** Measured: ~40–100× the runtime path, in typia's league — **but only for a build that compiles the checks**, which is now two documented routes with a fixture each rather than an assumption (REQ-AV-3, closed 2026-09-02). |
| Both PRDs: four packages / a data layer with a separate framework                                                                                                                                | **§5.** Six packages in one acyclic DAG, with the schema as the shared source of truth for _both_ the SQL boundary and the HTTP boundary (§7 — the seam).                                                                                        |

**Supersession:** `Stage3_Decorator_Framework_PRD.md` and `zero_maintenance_data_layer_prd.md` have been **deleted**; their content is absorbed above and their history is in git
(`git log --follow -- Stage3_Decorator_Framework_PRD.md`). This document is the single product requirement of record; `ARCHITECTURE.md` remains the architecture of record and takes precedence on
implementation policy.
