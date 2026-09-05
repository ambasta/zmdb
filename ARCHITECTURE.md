# zmdb — Architecture

> **Status:** living architecture (supersedes the 2026-08-29 component blueprint). **Baseline (hard floor):** Node.js **26+**, TypeScript **7+**, **ESM-only**. Stage 3 ECMAScript proposals are
> first-class. Nothing older is supported — ever. We do not ship CommonJS, we do not ship compat shims, we do not test against older engines.
>
> 📖 Component-level API docs live on the docs site (https://ambasta.github.io/zmdb/) and in each package's `SPEC.md`. This file is the **project-wide** architecture: the north stars, the
> package-splitting doctrine, the implementation-language policy, and the opinionated directives that every package must obey.

---

## 1. North stars

There are exactly two, in priority order. When they conflict, **(1) wins**, and the conflict is documented at the call site.

1. **Fastest possible runtime for the consuming application.** Every design choice is measured by its cost in the _user's_ hot path — per request, per query, per validation. Work that can happen at
   build time, install time, or type-check time must _not_ happen at runtime. Allocation, indirection, reflection, and dynamic dispatch on the hot path are defects, not trade-offs.

2. **Maintainability.** The framework must stay small, legible, and changeable by a small team. A feature that cannot be maintained is not shipped. Clever code that no one can safely modify is a
   liability regardless of speed.

Everything else — ergonomics, breadth, parity with incumbents — is subordinate to these two and justified in their terms.

### 1.1 Corollary: the cost model

We reason about cost in **four buckets**, and we push work as far left as possible:

```
type-check time   →   build time   →   install time   →   RUNTIME
(free for users)      (once, CI)       (once, npm i)       (per request — minimize!)
```

- **Type-check time** (free for the consumer): schema→type derivation, illegal states, route/param typing, DI graph validation. Prefer this above all.
- **Build time** (paid once by the consumer's bundler/tsc): AOT validator inlining, SQL compilation where the query is static.
- **Install time** (paid once): our own `dist` build; native/WASM artifact download.
- **Runtime** (paid every time): only the irreducible work — the actual SQL round-trip, the inlined validation booleans, one object shape. Anything else here must justify itself against north star
  (1).

---

## 2. Opinionated design directives (non-negotiable)

These are not preferences; they are invariants. A change that violates one is rejected regardless of how convenient it is.

1. **No runtime proxies, identity maps, or change tracking.** Reads return plain, inert objects (`prototype === Object.prototype`). Writes are explicit (`create`/`update`/`delete`). This is the single
   largest source of our speed.
2. **No runtime reflection.** No `reflect-metadata`, no runtime schema inspection, no `emitDecoratorMetadata`. Type information is erased; derivation is compile-time. Stage 3 decorators may use
   `context.metadata`, but only for data the decorator itself wrote (never type reflection).
3. **No runtime parsing/validation engine.** Validation is AOT-inlined to straight-line JavaScript booleans. No Zod/Valibot/Yup on the hot path, ever.
4. **Explicit SQL.** The query layer compiles to parameterized SQL strings. No implicit magic query objects; no hidden N+1.
5. **No `as` / no escape hatches.** `any`, `unknown`-casting, `as T` assertions, and non-null `!` in framework code are **defects**. If a type can't be proven, redesign the type, don't assert it. The
   only permitted assertions are a small, enumerated, individually-justified set of **boundary casts** (§2.1) — each commented with _why it is sound_. Consumer-facing APIs must be assertion-free: a
   user should never need `as` to use zmdb correctly.
6. **ESM-only, no dual publishing.** One module format. `"type": "module"`, single `exports` map, no `.cjs`.
7. **Zero third-party dependencies on the query/validation hot path.** Runtime execution depends only on `@zmdb/*` packages and Node built-ins. Third-party integrations (a `pg` driver, a Hono adapter)
   are _optional_ and structurally typed. The tooling exception is `oxfmt`, pinned by query-compiler because declaration emission must invoke the same formatter as the repository.
8. **Reproducible measurement.** Performance claims are backed by the real upstream benchmark harnesses. The results include unsupported cases and trade-offs instead of reducing them to a single score
   (see the benchmarks dashboard).
9. **One front-end: a table is a type.** There is no builder DSL and no schema value to maintain. A TypeScript interface with phantom tags is reflected once into `TypeIR`. DDL, DTOs, JSON Schema, and
   generated validators all consume that same IR.

   `yarn verify:no-defineschema` protects the single front-end by checking every published export. `yarn verify:one-walker` protects the back-end by listing the few places allowed to inspect column
   metadata, together with the reason for each exception. It fails when another metadata reader appears or an existing exception is no longer needed.

10. **The source runs as-is; the build only mirrors it.** In the repo every `exports` target is a `.ts` file and Node reads it directly, stripping the types. Tests, local development, and consumer
    fixtures use those source exports, and `yarn verify:exports` imports every published subpath that way.

    Relative imports still use NodeNext-style `.js` specifiers. Node does not resolve those to source `.ts` files, so source entry points load the small `scripts/ts-specifier-hook.mjs` resolver. The
    hook only substitutes a `.ts` sibling when the requested `.js` file does not exist. Real JavaScript files, including generated files and `dist`, are left alone. Source modules must also avoid
    runtime syntax that Node's type stripping cannot parse, including decorators.

    Published packages use a file-for-file `tsc` build in `dist`, with `src` included for source maps. A build is required because Node refuses to strip types inside `node_modules`; workspace symlinks
    would otherwise hide that failure. `yarn verify:publish` catches it by packing each package, installing it outside the workspace, and importing every subpath.

### 2.1 The `as`-free rule and its narrow exceptions

"No `as`" is a hard project goal. In practice a typed system that touches an untyped world (a DB driver returning `Record<string, unknown>`, `JSON.parse`, `context.metadata`) has a finite number of
**trust boundaries** where a value crosses from "the runtime promises this shape" into "the type system knows this shape." The policy:

- **Consumer code: zero assertions.** If a user must write `as` to satisfy our API, that is our bug.
- **Framework code: assertions are a reviewed, enumerated exception**, allowed _only_ at a trust boundary (driver row → `Entity<S>`, parsed JSON → `T`, metadata slot → typed record), each with a
  `// boundary:` comment stating the runtime guarantee that makes it sound. We prefer, in order: (a) a type-guard function that _proves_ the shape, (b) a generic that carries the type without
  assertion, (c) a `satisfies` check, and only then (d) a commented boundary cast. New assertions require justification in review; the count is tracked and driven toward zero.

> The public API is assertion-free. Framework internals use a documented exception list for places where runtime data crosses into a TypeScript type.
>
> As of 2026-09-05, the 243 shipped files covered by `verify:escape-hatches` contain 53 assertions and 54 `// boundary:` comments. They contain no `any`, no non-null assertions, no `as unknown as`,
> and one lint suppression. The consumer documentation contains no required casts.
>
> The count rose from 28 during the type-first work. Of the 53 current assertions, 26 are in `aot-validator`, mainly around checker values, parsed JSON, and validated return values. Each assertion
> records the runtime guarantee behind its assertion.
>
> `yarn verify:escape-hatches` enforces both the comments and a per-package count ceiling. It fails when a count rises, when an assertion lacks its boundary comment, or when a ceiling can be lowered.
> This closes the gap that previously let the total move from 23 to 28 without a failing check (PRD RISK-7).

---

## 3. Package architecture & separation of responsibility

### 3.1 The splitting doctrine — _when_ a concern earns its own package

We split aggressively along **responsibility seams**, not by file count. A new package is justified **only** when it satisfies most of these tests:

1. **Distinct responsibility.** It owns one clearly-nameable concern that the others should not know about (e.g. "compile SQL" vs "derive types" vs "validate at the boundary").
2. **Independent consumability.** A real user would install it _alone_ — e.g. someone who wants only the query compiler, or only the AOT validator, with no interest in the rest.
3. **Independent versioning value.** Its API changes on a different cadence than its siblings, and forcing a lockstep bump would be user-hostile.
4. **A one-directional dependency edge.** It can sit at a clean layer in the DAG (below its consumers, above its providers) with **no cycles**. If two candidate packages would need to depend on each
   other, they are one package.
5. **Independent testability.** Its contract can be tested without standing up the others.

If a concern fails these tests it stays a **sub-module** (`src/<concern>/` with its own `SPEC.md` and a subpath export) inside an existing package — cheaper to maintain, still separable later.
**Subpath exports are the default; a new package is the exception.** We would rather ship `@zmdb/schema-core/dto` than a premature `@zmdb/dto`.

Conversely, we **merge** packages that have grown a bidirectional dependency or that no one installs independently — dissolving a package is a valid, encouraged refactor.

### 3.2 The current dependency DAG (must stay acyclic)

This is the shipped graph before the database-vertical extraction frozen in §3.4.

```
      ┌────────────────┐
      │@zmdb/query-    │  (runtime dep: oxfmt, declaration-emitter path only)
      │  compiler      │
      └───────┬────────┘
              ▼
      ┌───────────────────┐
      │ @zmdb/schema-core │  (the schema SoT + type derivation)
      └─────────┬─────────┘
                ▼
      ┌────────────────┐
      │    @zmdb/ai    │  (also depends directly on schema-core)
      │ (neutral tools)│
      └───┬────────┬───┘
          │        ▼
          │  ┌────────────────┐
          │  │   @zmdb/mcp    │  (depends only on AI; platform APIs)
          │  │ (MCP protocol) │
          │  └────────────────┘
          ▼
      ┌────────────────┐
      │@zmdb/aot-      │  (also depends directly on schema-core)
      │  validator     │
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │@zmdb/repository│  (also depends directly on schema-core + query-compiler)
      │  + drivers/*   │   optional peer: pg; built-in: node:sqlite
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │   @zmdb/app    │  (also depends directly on schema-core,
      │ (app kernel)   │   query-compiler, and aot-validator)
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │   @zmdb/web    │  (also depends directly on schema-core,
      │(decorator HTTP)│   query-compiler, repository, and aot-validator)
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │      zmdb      │  (curated umbrella; ZERO logic)
      └────────────────┘
```

`@zmdb/client` and `@zmdb/protobuf` are independent roots. The opt-in `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, and `@zmdb/ai-vercel` packages depend inward only on `@zmdb/ai`; each integration
alone declares its SDK/framework peer. `@zmdb/mcp` depends only on `@zmdb/ai`. None of these optional packages or the provider-neutral AI package is re-exported by the umbrella.

**Rules enforced by this DAG:**

- **query-compiler is the lower-level SQL/tooling package.** Its declaration emitter is the only framework path that requires `oxfmt`; ordinary query compilation does not invoke it.
- **schema-core is the semantic Single Source of Truth.** It reuses lower-level compiler query, quoting, and naming utilities but must not import validator, repository, or web.
- **AI depends on schema-core, never the reverse.** Its provider-neutral implementations and public names are physically owned by `@zmdb/ai`.
- **AI integrations depend inward on AI.** `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, and `@zmdb/ai-vercel` own their provider/framework adapters; their optional peers do not reach schema-core or
  provider-neutral AI.
- **MCP depends only on AI.** It owns the transport-neutral MCP client/server protocol, uses only platform APIs, and is not re-exported by the umbrella.
- **aot-validator depends on schema-core and AI, never the reverse.** Reflection remains above the declaration vocabulary; `toolFor` compilation consumes AI's document boundary.
- **repository is the composition layer** — it wires schema + compiler + validator into CRUD, and currently owns the driver adapters (built-in `node:sqlite`, structurally injected `pg` and `mssql`).
- **app sits above repository** — it owns one protocol-neutral metadata, DI, module, lifecycle, command, event, CQRS, state, health, and observability kernel.
- **web sits above app and repository** — controllers inject repositories, routes validate via the AOT validator, responses serialize via the AOT serializer, and HTTP composition reuses the one
  app-owned construction and lifecycle graph.
- **`zmdb` (umbrella) contains no logic** — only curated re-exports. It is the default install; the sub-packages remain the tree-shakeable/advanced path.

### 3.3 Current package map

| Package                | Responsibility                                                                                                                                         | Runtime deps                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `@zmdb/client`         | Dependency-free structural HTTP transport, deterministic request planning, response reading, cancellation, authentication injection, and typed errors  | none                                                             |
| `@zmdb/query-compiler` | SQL-first compiler, DDL/migrations, introspection, declaration emission, the vendor-neutral dialect protocol, and current built-in dialect definitions | oxfmt                                                            |
| `@zmdb/schema-core`    | Tags, `TypeIR`, derived DTOs, relations, JSON Schema, seeding, and custom types; no AI source, export, or peer                                         | query-compiler                                                   |
| `@zmdb/ai`             | Provider-neutral tool documents and dialects, lenient parsing, bounded chat orchestration, shared invocation, and OpenAPI-derived tools                | schema-core                                                      |
| `@zmdb/ai-anthropic`   | Optional Anthropic Messages API driver over the provider-neutral chat contract                                                                         | ai; `@anthropic-ai/sdk` (optional peer)                          |
| `@zmdb/ai-langchain`   | Optional LangChain structured-tool contract and the sole `@langchain/core` peer                                                                        | ai; `@langchain/core` (optional peer)                            |
| `@zmdb/ai-vercel`      | Optional Vercel AI SDK tool fields with caller-owned schema branding and validation                                                                    | ai; `ai` (optional peer)                                         |
| `@zmdb/mcp`            | Transport-neutral MCP client/server protocol handling, authenticated identity injection, validation, and bounded remote calls                          | ai                                                               |
| `@zmdb/protobuf`       | Dependency-free protobuf calls, descriptors, generated-code wire ABI, and typed gRPC artifacts                                                         | none                                                             |
| `@zmdb/aot-validator`  | Reflection, AOT transformation, `zmdb-codegen`, validation/serialization utilities, and artifact emission                                              | ai, schema-core                                                  |
| `@zmdb/repository`     | Auto-validating typed CRUD, transactions, relations, populate, loaders, lifecycle events, and current driver adapters                                  | aot-validator, query-compiler, schema-core                       |
| `@zmdb/app`            | Protocol-neutral metadata, DI, modules, lifecycle/extensions, commands, events, CQRS, state, health contracts, and observability ports                 | aot-validator, query-compiler, repository, schema-core           |
| `@zmdb/web`            | Stage-3 HTTP framework: controllers, routing, request pipeline, OpenAPI, gateways, HTTP-aware testing, and runtime adapters                            | app, aot-validator, query-compiler, repository, schema-core      |
| `zmdb`                 | Curated product facade and CLI; no AI or MCP public re-export                                                                                          | app, aot-validator, query-compiler, repository, schema-core, web |

**Watch-list for future splits** (kept as sub-modules until they earn §3.1):

- `@zmdb/aot-validator` may split its **transformer plugin** from its **runtime fallback** if the plugin grows a heavy `typescript` coupling that hurts the runtime package's install weight.
- `@zmdb/web` keeps HTTP concerns as sub-modules unless one becomes independently useful; the protocol-neutral application kernel has already moved to `@zmdb/app`.
- Native/WASM hot-path kernels (§4) would ship as their own artifact packages (`@zmdb/<x>-native`) loaded optionally, never as a hard dependency.

### 3.4 Frozen database-vertical target

Issue #666 froze this target for epic #665. Issue #668 now ships the vendor-neutral injection seam inside the existing package boundaries: one frozen `SqlDialect` object carries resolved compiler
traits, total capabilities, a migration dialect and an introspector; the compiler accepts it, migration wrappers and the driver adapter delegate through it, callers can use its introspector directly,
and repositories derive and cache its limits, retries and returning support.

The package extraction is still pending. The six built-in definitions and temporary six-name overloads remain in `@zmdb/query-compiler`, the three bundled drivers remain in `@zmdb/repository`, and the
umbrella still exposes the old `zmdb/drivers/*` subpaths. The object protocol below is current behavior; the ownership graph remains the completion target.

A database package is a **complete vertical**, not a syntax table. It owns the database's query traits, DDL and migration behavior, introspector, official driver adapter, capability/refusal metadata,
golden SQL, real-server qualification and packed-consumer evidence. Generic packages retain the algorithms and protocols that can serve an unknown third-party database.

The complete permitted internal graph is:

| Dependency                                                   | Consumer                                                       | Kind                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@zmdb/query-compiler`                                       | `@zmdb/repository`                                             | required generic edge                                                 |
| `@zmdb/query-compiler`, `@zmdb/repository`                   | `@zmdb/sqlite`, `@zmdb/postgres`, `@zmdb/mysql`, `@zmdb/mssql` | required vertical edges                                               |
| `@zmdb/query-compiler`, `@zmdb/repository`, `@zmdb/postgres` | `@zmdb/cockroach`                                              | required child edge                                                   |
| `@zmdb/query-compiler`, `@zmdb/repository`, `@zmdb/mysql`    | `@zmdb/singlestore`                                            | required child edge                                                   |
| current generic product packages                             | `zmdb`                                                         | required facade edges, as in §3.2                                     |
| a selected database package                                  | `zmdb/<database>`                                              | optional peer identity edge, only if that facade subpath is published |

The two family edges are the only permitted database-package edges: Cockroach extends PostgreSQL, and SingleStore extends MySQL. A generic package never imports an official database package; a parent
database package never imports its child; and no database package imports `zmdb`. `zmdb` must not make all six database packages hard dependencies: a database facade subpath, if retained, resolves an
optional peer selected by the application. The exact protocol types live below the database packages in `@zmdb/query-compiler` and `@zmdb/repository`, so the graph has no reverse edge.

Database selection is explicit:

- A consumer imports a database object from its package and passes that object to compiler, repository, config and tooling surfaces. The final architecture has no mutable registry, no
  `registerDialect()`, and no import-for-side-effect convention.
- A package root may construct and freeze its own object, but importing it must not alter process-global state.
- The umbrella may expose explicit `zmdb/sqlite`, `zmdb/postgres`, `zmdb/mysql`, `zmdb/mssql`, `zmdb/cockroach` and `zmdb/singlestore` identity re-exports backed by optional peers. Its root does not
  select, resolve or eagerly instantiate a database.
- Official driver adapters are structurally typed. A database client may be a development dependency for conformance tests, but it is not a hard runtime dependency unless a future adapter proves that
  structural injection is insufficient. Consequently, installing `zmdb` must not install `pg`, `mysql2`, `mssql` or another database client.

#### 3.4.1 When a database earns a package

All of these conditions are mandatory:

1. **Substantive ownership.** The database owns non-trivial behavior in at least two of SQL compilation, DDL/migrations, introspection, transactions and wire-driver handling.
2. **A complete installable vertical.** The package exposes one coherent database object and official driver adapter rather than a constant, URL parser or connection recipe.
3. **Distinct capabilities or refusals.** Differences are executable metadata and tests, not prose or an implicit fallback to a parent dialect.
4. **Real-server evidence.** A required CI lane exercises generated DDL, migrations, introspection and CRUD against the named server and version.
5. **Packed-consumer evidence.** A project outside the workspace installs the tarball, typechecks without path mappings and runs the public entry points.
6. **An acyclic owner.** Every implementation unit has one package owner, and any family reuse follows one of the two permitted parent edges above.
7. **Independent documentation.** The database can state its installation, capabilities, refusals, client requirement and evidence without borrowing another package's unsupported claims.

Neon, Supabase, Amazon RDS, Aurora, PlanetScale, Vercel Postgres and similar hosted products remain documentation recipes while they only change connection details. A framework or provider gets a
package only after it satisfies the same criteria with behavior that cannot live in its underlying database package.

#### 3.4.2 What "supported" means

`supported` is earned by evidence, not by membership in a string union. Every official database package must have:

- a total capability table in which each construct is either an exact expectation or an explicit `UnsupportedFeatureError`;
- golden SQL and type-level conformance at the package's public boundary;
- a real-server lane covering schema creation, migration application, introspection round-trip, transactions and CRUD;
- driver lifecycle tests for every claimed stream, cancellation and transaction behavior;
- a packed external consumer that imports every published subpath and installs only declared dependencies; and
- documentation generated from or checked against the same capability metadata.

A local run may report that an optional service is unavailable, but a release-qualification lane assigned to that database must fail rather than silently skip. Until all evidence above exists, the
package or capability is experimental and documentation must say which evidence is missing.

### 3.5 Frozen shared HTTP-contract and generated-client target

Issue #681 ships the inert contract declarations, deterministic compiler and contract-aware router registration shown below. Issue #682 ships the dependency-free `@zmdb/client` execution runtime,
issue #683 makes OpenAPI a pure emitter over the same `HttpContractIR`, and issue #684 ships deterministic typed operation modules with AOT response validation. Config and CLI generation remain on a
later migration step.

```text
@zmdb/schema-core/ir
          │
          ▼
@zmdb/aot-validator/{reflect,emit}
          │
          ▼
@zmdb/web/contract/compiler ──> emitted HttpContractIR
                                      ├──> @zmdb/web runtime
                                      ├──> @zmdb/web/openapi
                                      └──> generated application client ──> @zmdb/client
```

`@zmdb/web/contract` owns HTTP declarations and serialisable IR. Its compiler reuses one AOT reflection session; AOT never imports web. Routing, OpenAPI, and generated clients consume the same
compilation result without recollecting controllers, parsing OpenAPI, or defining another type walk.

`@zmdb/client` owns only a zero-dependency transport/runtime ABI and stable errors. It imports no web, AOT, schema-core, Node built-in, or framework adapter. Generated source contains no controller,
credential, TypeIR walker, or workspace path. Optional UI adapters remain the separate client-framework layer frozen by #688.

The complete contract is [`packages/web/src/contract/SPEC.md`](./packages/web/src/contract/SPEC.md) and [`packages/client/SPEC.md`](./packages/client/SPEC.md).

### 3.6 Frozen client-framework adapter target

Issue #688 freezes the optional UI and meta-framework package boundary for epic #687. An integration earns a package only when it owns framework-native lifecycle, DI/context, SSR isolation, hydration
or server/browser export behaviour that cannot be expressed as a short recipe over the generated client. A wrapper that only calls a client factory remains documentation.

The target graph is one-way:

```text
@zmdb/client
├── @zmdb/react ── @zmdb/react-native, @zmdb/next
├── @zmdb/angular
├── @zmdb/vue ──── @zmdb/nuxt
├── @zmdb/svelte ─ @zmdb/sveltekit
└── @zmdb/solid
```

Framework runtimes are required peers of their adapter package. The default `zmdb` package neither depends on nor re-exports these optional packages: one cohesive client contract and documentation
journey does not justify installing every framework peer. Server/client exports remain physically separate in meta-framework packages, imports perform no I/O or global registration, and a packed
consumer must prove the qualifying framework behaviour before the package ships.

The complete qualification rule, cancellation/state semantics, peer ranges, export map and nine-package matrix are frozen in
[`packages/zmdb/src/client-integrations/SPEC.md`](./packages/zmdb/src/client-integrations/SPEC.md).

### 3.7 AI integration ownership migration (Issues #703 and #705–#710)

Issue #705 published the provider-neutral `@zmdb/ai` boundary and moved AOT/generated consumers to it. Issue #706 moved the Anthropic driver and its SDK peer to `@zmdb/ai-anthropic`; issue #707
published `@zmdb/ai-langchain` and moved its real-package contract tests and peer; issue #708 physically moved the Vercel adapter, tests, and peer to `@zmdb/ai-vercel`; issue #709 moved the MCP
client/server, protocol tests, and public root into `@zmdb/mcp`; and issue #710 moved the remaining provider-neutral and LangChain implementations, removed the temporary forwarders, and deleted every
schema-core LLM export and source file.

Provider-neutral schema-derived tool documents, parsing, bounded chat orchestration, shared invocation and OpenAPI-derived tools now live in `@zmdb/ai`. Anthropic SDK translation, LangChain framing
and Vercel AI SDK framing each live in one opt-in integration package. The pure MCP client/server ships from `@zmdb/mcp`.

```text
@zmdb/ai-anthropic ──┐
@zmdb/ai-langchain ──┼──> @zmdb/ai ──> @zmdb/schema-core
@zmdb/ai-vercel ─────┤         ▲
@zmdb/mcp ───────────┘         │
                               │
@zmdb/aot-validator ───────────┘
         └────────────────────> @zmdb/schema-core
```

Arrows point from consumer to direct dependency. `@zmdb/schema-core` has no reverse AI edge, no LLM export and no provider peer in the final graph. Integration SDKs are optional peers of only their
own opt-in packages; the Vercel adapter receives the branded factory and never imports the SDK. Installing the provider-neutral packages does not install or resolve an SDK. `@zmdb/mcp` uses platform
APIs and depends only on `@zmdb/ai`.

`toolFor<T>()` remains an AOT callee; its declared source and generated witness imports are `@zmdb/ai`, and the emitter consumes the shared document producer through `@zmdb/ai/compiler`. Generated
OpenAPI-tool modules import `OpenApiGeneratedTool` from `@zmdb/ai/http`.

The migration could not preserve an old path by making schema-core forward to AI or MCP, because AI already depends on schema-core and MCP depends on AI. The completed cutover therefore has no
compatibility subpath or forwarding module: every AI/MCP export resolves to source physically owned by its package.

The user-facing [LLM package and migration guide](./docs-site/content/llm-strategy.md) gives the install and direct replacement for all six removed schema-core LLM subpaths.

The exact 32-file ownership map, public exports, peer matrix, publish order and final-removal checks are frozen in [`packages/ai/SPEC.md`](./packages/ai/SPEC.md). Package-specific boundaries are in
[`packages/ai-anthropic/SPEC.md`](./packages/ai-anthropic/SPEC.md), [`packages/ai-langchain/SPEC.md`](./packages/ai-langchain/SPEC.md), [`packages/ai-vercel/SPEC.md`](./packages/ai-vercel/SPEC.md) and
[`packages/mcp/SPEC.md`](./packages/mcp/SPEC.md).

### 3.8 Frozen optional server-integration target (#654)

This section is the target frozen for epic #653, not a claim about the current tree. The measured starting point has protobuf calls, service artifacts and wire primitives in `@zmdb/aot-validator`; six
external peers on `@zmdb/web`; and six integration subpaths under web.

Implementation status: #656 has completed the `@zmdb/protobuf` row and removed the two old AOT public surfaces. The six transport/jobs/telemetry packages remain later slices of the same target.

The final manifest graph is:

| Package                    | Direct internal dependencies  | Sole external peer               |
| -------------------------- | ----------------------------- | -------------------------------- |
| `@zmdb/protobuf`           | none                          | none                             |
| `@zmdb/transport-grpc`     | `@zmdb/app`, `@zmdb/protobuf` | `@grpc/grpc-js@^1.14.0`          |
| `@zmdb/transport-nats`     | `@zmdb/app`                   | `@nats-io/transport-node@^3.4.0` |
| `@zmdb/transport-rabbitmq` | `@zmdb/app`                   | `amqplib@^2.0.1`                 |
| `@zmdb/transport-redis`    | `@zmdb/app`                   | `redis@^6.2.1`                   |
| `@zmdb/jobs-postgres`      | `@zmdb/jobs`                  | `pg@^8.23.0`                     |
| `@zmdb/otel`               | `@zmdb/app`                   | `@opentelemetry/api@^1.9.0`      |

The peers are required by the package that selects them, not optional peers of a core package. `@zmdb/app`, `@zmdb/web`, `@zmdb/jobs`, `zmdb`, `@zmdb/protobuf` and `@zmdb/aot-validator` declare none
of them. The default product therefore remains cohesive without installing every broker, database client or telemetry API.

`@zmdb/aot-validator` keeps the only reflection session, protobuf/service-IR walk and emitter. `@zmdb/protobuf` owns the five source calls, service-artifact types and generated wire runtime, but no
checker, emitter or descriptor parser. The compiler recognises bindings from the canonical `@zmdb/protobuf` root and emits `ProtoReader`/`ProtoWriter` imports from `@zmdb/protobuf/wire`; this is a
build-time protocol, not a reverse runtime package edge.

Ownership moves once, with no compatibility forwarding:

| Removed surface                                         | New owner                  |
| ------------------------------------------------------- | -------------------------- |
| protobuf/gRPC artifact exports at `@zmdb/aot-validator` | `@zmdb/protobuf`           |
| `@zmdb/aot-validator/protobuf/wire`                     | `@zmdb/protobuf/wire`      |
| `@zmdb/web/microservices/grpc`                          | `@zmdb/transport-grpc`     |
| `@zmdb/web/microservices/nats`                          | `@zmdb/transport-nats`     |
| `@zmdb/web/microservices/rabbitmq`                      | `@zmdb/transport-rabbitmq` |
| `@zmdb/web/microservices/redis`                         | `@zmdb/transport-redis`    |
| `@zmdb/web/queues/backends/pg`                          | `@zmdb/jobs-postgres`      |
| `@zmdb/web/otel`                                        | `@zmdb/otel`               |

Generic messaging and observability ports belong to `@zmdb/app`; queue and worker ports belong to `@zmdb/jobs`. Concrete integrations import those public contracts and never private web/jobs source.
Core packages never import an optional integration, and `zmdb` does not re-export them.

Resource ownership is explicit:

- transport and gRPC extension instances are application-owned; they open resources during start and close them through the bounded extension shutdown contract;
- typed gRPC clients are caller-owned and expose `close()`/`Symbol.dispose`;
- the PostgreSQL jobs adapter borrows a caller-owned pool/client and never closes or releases it;
- the OpenTelemetry adapter borrows caller-owned tracer/meter objects and never registers or shuts down a provider; and
- protobuf imports allocate no long-lived resource and perform no I/O.

Release publication follows the manifest DAG: publish `@zmdb/protobuf`, `@zmdb/app` and `@zmdb/jobs` before their dependants, publish the compiler version that recognises the new protobuf owner only
after `@zmdb/protobuf` exists, then publish each integration independently. A release is qualified only when every package packs, installs, imports and typechecks outside the workspace; real gRPC,
NATS, RabbitMQ, Redis and PostgreSQL evidence runs against the named peer, and a missing required service fails rather than silently skipping. `@zmdb/otel` is proven with real API/SDK objects but owns
no collector or exporter.

The exact public exports, lifecycle, install commands and evidence are frozen in [`packages/protobuf/SPEC.md`](./packages/protobuf/SPEC.md),
[`packages/transport-grpc/SPEC.md`](./packages/transport-grpc/SPEC.md), [`packages/transport-nats/SPEC.md`](./packages/transport-nats/SPEC.md),
[`packages/transport-rabbitmq/SPEC.md`](./packages/transport-rabbitmq/SPEC.md), [`packages/transport-redis/SPEC.md`](./packages/transport-redis/SPEC.md),
[`packages/jobs-postgres/SPEC.md`](./packages/jobs-postgres/SPEC.md) and [`packages/otel/SPEC.md`](./packages/otel/SPEC.md).

### 3.9 Frozen one-product facade and catalog target (#618)

The repository ships one product, `zmdb`, through independently useful package firebreaks. The normal application journey starts with one install and one documented import/configuration vocabulary;
the internal workspace graph is advanced architecture, not a set of products a beginner must assemble.

The target facade has three layers:

1. The `zmdb` root exposes only the schema, validation, repository and HTTP vocabulary needed by the packed one-install application.
2. Stable `zmdb/*` concern subpaths expose advanced schema, SQL, validator, ORM, web, compiler, migrations, testing, CLI and configuration capabilities without mirroring implementation-package names.
3. Optional database and external-technology integrations remain explicit, technology-selected entry points and are never eagerly loaded by the root.

Facade modules delegate or re-export by identity. They do not implement query compilation, validation, reflection, migrations, drivers, routing, configuration discovery or another product algorithm.
Importing the root must not reach the CLI, config loader, compiler, migration filesystem runner, build tools, database clients, brokers, telemetry SDKs, frontend frameworks or native bindings.
`defineConfig` may be exposed from a dependency-free contract module; filesystem-backed discovery and loading remain behind `zmdb/config`.

`zmdb/config` is the sole public project-configuration contract. CLI commands, compiler adapters, schema discovery, naming, migrations, introspection, Studio and scaffolding consume the same resolved
configuration rather than declaring another `ZmdbConfig`, repeating discovery or applying private defaults. The implementation may move between tooling packages while the public entry point remains
stable.

The read-only catalog at `scripts/product/catalog.mjs` is the sole authority for official package membership and product exposure. Each row identifies the package directory and npm name, its unique
product role, root/subpath facade visibility, product optionality, documentation owner and packed-consumer evidence. Facade verification, package-reference generation, support matrices and
consumer-fixture discovery consume that catalog instead of copying package lists.

The catalog deliberately does not own versions, dependency ranges, changelogs, npm tags, publication credentials, publish order, compatibility timing or partial-release behavior. Those policies belong
to architecture-governance EPIC #721 and its release implementation #728; release tooling may read catalog membership only.

The exact measured 74-symbol root inventory, 13-entry export map, target root/subpath taxonomy and eager-import rules are frozen in [`packages/zmdb/SPEC.md`](./packages/zmdb/SPEC.md). Configuration
ownership is frozen in [`packages/zmdb/src/config/SPEC.md`](./packages/zmdb/src/config/SPEC.md), and the fourteen-package inventory plus required catalog consumers and rejection rules are frozen in
[`scripts/product/SPEC.md`](./scripts/product/SPEC.md). The catalog-backed documentation surface begins at [`docs-site/content/package-reference.md`](./docs-site/content/package-reference.md).

### 3.10 Canonical architecture policy and enforcement (#722, #724, #725, #727)

The canonical policy, read-only architecture model, workspace-edge verifier and package-metadata verifier now exist; runtime reachability and release governance remain later slices of epic #721.
Product membership stays owned by the product catalog in [`scripts/product/catalog.mjs`](./scripts/product/catalog.mjs). [`scripts/architecture/policy.mjs`](./scripts/architecture/policy.mjs) attaches
exactly one constraint row to every admitted package, and [`scripts/architecture/index.mjs`](./scripts/architecture/index.mjs) rejects missing or stale rows without discovering a second package list
from the filesystem, a workflow loop or a publish script.

Zones are ordered from inward to outward:

```text
foundation < runtime < application < integration < tooling < facade
```

A package may depend only on its own or an inward zone, every direct workspace dependency must also be named explicitly by that package's policy row, and the dependency's numeric ring must be lower
than the consumer's. Rings are canonical rather than decorative: a package with no workspace dependency is ring 0; every other package is `1 + max(direct dependency rings)`. The current fourteen
catalog members therefore freeze as:

| Catalog id       | Zone          | Ring | Direct workspace dependencies                                                |
| ---------------- | ------------- | ---: | ---------------------------------------------------------------------------- |
| `client`         | `foundation`  |    0 | none                                                                         |
| `protobuf`       | `foundation`  |    0 | none                                                                         |
| `query-compiler` | `foundation`  |    0 | none                                                                         |
| `schema-core`    | `foundation`  |    1 | `query-compiler`                                                             |
| `ai`             | `runtime`     |    2 | `schema-core`                                                                |
| `ai-anthropic`   | `integration` |    3 | `ai`                                                                         |
| `ai-langchain`   | `integration` |    3 | `ai`                                                                         |
| `ai-vercel`      | `integration` |    3 | `ai`                                                                         |
| `aot-validator`  | `runtime`     |    3 | `ai`, `schema-core`                                                          |
| `mcp`            | `integration` |    3 | `ai`                                                                         |
| `repository`     | `runtime`     |    4 | `aot-validator`, `query-compiler`, `schema-core`                             |
| `app`            | `application` |    5 | `aot-validator`, `query-compiler`, `repository`, `schema-core`               |
| `web`            | `application` |    6 | `app`, `aot-validator`, `query-compiler`, `repository`, `schema-core`        |
| `zmdb`           | `facade`      |    7 | `app`, `aot-validator`, `query-compiler`, `repository`, `schema-core`, `web` |

Roadmap-only directories do not receive policy rows. A package is added to this table only when it has a publishable manifest and is admitted to the product catalog; admission and policy must land
atomically once the catalog exists.

The read-only model resolves package and export lookups from catalog-owned manifests, builds the policy DAG and returns deterministic dependency-first catalog ids.
[`verify-architecture-zones.mjs`](./.github/scripts/verify-architecture-zones.mjs) starts from every manifest export and executable, counts production type-only imports for ownership, rejects private
cross-package source imports, requires policy, manifest and observed workspace edges to agree, verifies canonical rings and prints complete shortest cycles. It accepts `--root` for the committed
architecture fixtures and is run by `yarn verify:architecture-zones` in CI. [`verify-package-metadata.mjs`](./.github/scripts/verify-package-metadata.mjs) checks one manifest schema, required package
files, lockstep versions, source and publish dependency ranges, export/bin targets, repository directories and optional-peer evidence before root builds or publication. Runtime reachability is checked
separately from emitted entry points: ordinary exports cannot reach compiler/build tools, REPL/devtools modules or an optional peer assigned to another entry. Tooling exports and optional peers are
explicit per-package exceptions, never inferred from a directory name. Relative source imports retain NodeNext `.js` specifiers, and `allowImportingTsExtensions` remains `false`.

All catalog packages form one lockstep release train. They carry one version, use `workspace:^` for committed internal ranges, derive publish order from the policy DAG, share one root changelog and
must agree with an exact `v<version>` release tag. Product membership, architecture constraints, release content and npm credentials remain four separate authorities.

The complete `PackagePolicy` schema, all fourteen rows, discovery/graph API, reachability rules, fixture-root contract and exact violation/remediation semantics are in
[`scripts/architecture/SPEC.md`](./scripts/architecture/SPEC.md). Changelog, release-plan, tag and publication ordering remain separately frozen in [PUBLISHING.md](./PUBLISHING.md) for #728.

### 3.11 Frozen tooling-package target (#626)

Issue #626 freezes the implementation-package boundary beneath the one-product facade in §3.9. It is a target, not a claim about the current tree: compiler logic still lives in `@zmdb/aot-validator`,
migration/introspection logic still lives in `@zmdb/query-compiler`, and the executable implementation still lives in `zmdb`.

```text
query/schema/validator protocols ──> @zmdb/compiler
query/database protocols ──────────> @zmdb/migrations
@zmdb/compiler ─┐
@zmdb/migrations├──────────────────> @zmdb/cli
@zmdb/web ──────┘ optional, verb-selected only

@zmdb/compiler ───> zmdb/compiler + zmdb/config
@zmdb/migrations ─> zmdb/migrations
@zmdb/cli ─────────> zmdb/cli + the sole "zmdb" executable
```

The three implementation packages are independently callable:

- `@zmdb/compiler` owns the one TypeScript front end, `TypeIR` production, AOT emitters, transforms, unplugin/Metro adapters, lint integration, compiler testing utilities and the canonical
  filesystem-backed config implementation.
- `@zmdb/migrations` owns snapshots, diffs, DDL plans, migration files, ledger and embedded runners, generic catalog introspection, drift checks and declaration emission. Database packages inject
  database-specific DDL, catalog and connection behavior, and the SQL hot path keeps no formatter dependency.
- `@zmdb/cli` owns argument/config/output orchestration and the only executable. Every command delegates to a public library operation; application/web commands load optional public dependencies only
  after their verb is selected.

This extraction does not create three products. `zmdb/compiler`, `zmdb/migrations`, `zmdb/cli` and `zmdb/config` remain the stable product vocabulary frozen by #618 and are identity facade modules,
not duplicated implementations. The root does not eagerly import them. The old `zmdb/unplugin` spelling is governed as a compatibility alias by #721/#728 rather than by this ownership move.

Runtime package roots never reach the tooling packages. Generated application code may call the runtime validator ABI, but it never imports `@zmdb/compiler`. The measured move policy is
[`verify-tooling-ownership.SPEC.md`](./.github/scripts/verify-tooling-ownership.SPEC.md): 138 current shipped/build-input paths, 42 current export keys, two current binaries, 17 current manifest edges
and 12 checked-in generated artifacts are each assigned exactly once.

The package contracts are [`packages/compiler/SPEC.md`](./packages/compiler/SPEC.md), [`packages/migrations/SPEC.md`](./packages/migrations/SPEC.md) and
[`packages/cli/SPEC.md`](./packages/cli/SPEC.md). Until their manifests exist they remain roadmap-only directories under §3.10. Their manifests, product-catalog rows and architecture-policy rows must
be admitted atomically; release membership and deterministic publish order then come only from the catalog and policy DAG, never from a second tooling-package list.

### 3.12 Target server package DAG and facade (#645)

The current `@zmdb/web` package has outgrown the sub-module default: its measured public surface is 36 manifest entries, 318 distinct symbols and 58 shipped non-test/non-generated source files. Those
symbols span three independently usable responsibilities and six third-party peers. The target is one server product with package boundaries as dependency firebreaks:

```text
@zmdb/query-compiler
        |
@zmdb/schema-core
        |
@zmdb/aot-validator
        |
@zmdb/repository
        |
@zmdb/app ----------------------.
  |                              |
  +--> @zmdb/web                 +--> @zmdb/jobs
  |      (HTTP only)                   (queues/scheduling)
  |
  +--> optional transports / OpenTelemetry

@zmdb/jobs --> @zmdb/jobs-postgres
zmdb --> @zmdb/app, @zmdb/web and @zmdb/jobs by explicit re-export only
```

The exact direct edges are:

| Package      | Allowed direct workspace runtime dependencies                              | Third-party runtime peers |
| ------------ | -------------------------------------------------------------------------- | ------------------------- |
| `@zmdb/app`  | aot-validator, query-compiler, repository, schema-core                     | none                      |
| `@zmdb/web`  | app, aot-validator, repository, schema-core                                | none                      |
| `@zmdb/jobs` | app, query-compiler, repository                                            | none                      |
| `zmdb`       | app, web, jobs plus the existing product packages it explicitly re-exports | none                      |

`app -> web`, `app -> jobs`, `web -> jobs`, `jobs -> web`, any core-to-optional edge, and any server package importing another package's private source are forbidden. Optional integrations depend
inward on the one core SPI they adapt; the core never imports back out.

Ownership is semantic, not directory-based:

- **app** owns metadata, DI, modules, lifecycle, command applications, events, CQRS, state machines, observability ports, health checks and transport-neutral messaging;
- **web** owns only HTTP request/response concerns, including HTTP-aware testing and devtools;
- **jobs** owns queueing, workers, dead letters, leases, scheduling and the built-in SQLite memory backend;
- **optional packages** own protobuf/gRPC, NATS, RabbitMQ, Redis, PostgreSQL jobs and OpenTelemetry;
- benchmark helpers remain repository-private.

`createApplication` is the single protocol-neutral lifecycle engine. Extensions start in declaration order after application bootstrap, roll back and stop in reverse order, receive one remaining
application-wide grace budget, and cannot add work to a request hot path. `createApp` composes one router over that same application; it does not create another container or lifecycle.

Moved implementations are deleted from their old locations. Old package subpaths do not forward, warn or survive as deprecated aliases. The `zmdb`, `zmdb/app`, `zmdb/web` and `zmdb/jobs` surfaces use
explicit re-exports, so direct-package and facade runtime values are identical (`===`) and type declarations have one canonical owner.

### 3.13 Target runtime foundation — issue #635

Sections 3.2–3.3 describe the packages that ship at the issue #635 baseline, while §§3.4–3.12 freeze intermediate ownership extractions. After those exits, the hard-cutover target is four
runtime-foundation packages:

```text
@zmdb/schema ───────> @zmdb/validator
      │                         │
      └──────────┐              │
                 v              v
              @zmdb/orm <── @zmdb/sql
```

Arrows point from a dependency to its consumer.

- `@zmdb/schema` and `@zmdb/sql` are independent roots.
- `@zmdb/validator` depends only on `@zmdb/schema`.
- `@zmdb/orm` depends exactly on schema, SQL, and validator. It is the only foundation layer that composes all three.
- Foundation manifests have no external production, optional, or peer dependency. Their `node:*` allowlist is empty; concrete SQLite is an optional package, not an ORM built-in.
- Compiler, migrations, CLI, AI/MCP, web/jobs, and concrete database packages point inward. A foundation export cannot reach them directly or transitively.

The cutover deletes `@zmdb/schema-core`, `@zmdb/query-compiler`, `@zmdb/aot-validator`, and `@zmdb/repository` and all of their old subpaths. They do not survive as forwarding packages. After #656
extracted protobuf and #710 extracted the remaining AI source, the measured 126-file and 47-foundation-subpath move map is normative in
[`.github/scripts/verify-runtime-foundation.SPEC.md`](./.github/scripts/verify-runtime-foundation.SPEC.md).

---

## 4. Implementation-language policy

**We target the TypeScript ecosystem; we are not obligated to implement in TypeScript.** The public surface (types, tags, decorators) is and will remain TypeScript, because that is the _product_. But
the _implementation_ of any hot path is chosen purely by north star (1): whatever gives the consumer the fastest runtime while remaining maintainable.

### 4.1 The decision rule

For each unit of work, pick the leftmost option that meets the perf bar:

1. **Type-level (0 runtime).** If it can be a compile-time type, it is not code. _(derivation, path-param typing, DI-graph checks, domain state machines)_
2. **AOT-generated JS (0 marginal runtime).** If it can be inlined at the consumer's build, emit straight-line JavaScript. _(validation, static SQL)_
3. **Hand-written modern JS/TS (fast enough, most maintainable).** The default for everything not on a measured hot path. Node 26's V8 is the target; write monomorphic, allocation-light code.
4. **Native (N-API) or WASM kernel (last resort, measured).** Only when (1)–(3) are proven insufficient by a benchmark, and only for a **small, stable, pure-function kernel** with a clean boundary
   (bytes in → bytes/values out).

### 4.2 Guardrails for reaching down to native/WASM

Because native code trades maintainability for speed, it is gated:

- **Must be justified by a committed benchmark** showing the JS path is the bottleneck in a _consumer_ hot path (not a micro-benchmark of our internals).
- **Must ship as an optional, separately-versioned artifact** with a **pure-JS fallback of identical behaviour** — installs must never _require_ a native build, and consumers on any platform must work
  (slower) without it.
- **WASM is preferred over N-API** for portability (no node-gyp, no per-platform binaries, works in edge runtimes), unless N-API is measurably faster for the specific kernel.
- **The boundary must be tiny and value-typed** (e.g. "compile this AST to a SQL string", "hash these bytes") — never a chatty API that crosses the JS↔native boundary per row.

### 4.3 Current state

Today **everything is TypeScript**, compiled to ESM `.js` + `.d.ts` by `tsc` (`scripts/build-package.mjs`), and it already meets our validation/ORM benchmark targets on Node/Bun/Deno. The AOT
validator's inlined output _is_ our "generated JS" tier.

**No native/WASM kernel exists or is currently justified.** The policy above is the rule we'll apply _if and when_ a measured bottleneck appears — we do not add native complexity speculatively (north
star 2). The realistic first candidates, should they ever be needed, are the AOT validator's JS emitter and the query compiler's string assembly — both pure, both boundary-clean.

---

## 5. What Node 26 / TS 7 lets us delete

Committing to a hard floor is itself an architecture decision — it removes code:

- **No CommonJS interop, no dual `exports`, no `__dirname` shims.** ESM-only.
- **No transpilation of modern syntax** — `using`/`await using` (explicit resource mgmt), top-level `await`, `Array.fromAsync`, `Object.groupBy`, `Promise.withResolvers`, `structuredClone`, and
  **`node:sqlite`** are assumed present. The built-in `node:sqlite` driver is why our quickstart is zero-dependency.
- **Stage 3 standard decorators** (`experimentalDecorators: false`) with `Symbol.metadata` — the foundation of `@zmdb/web`. No `reflect-metadata`.
- **No polyfills** in shipped code. If a runtime feature isn't in Node 26, we don't use it; we don't shim it.

---

## 6. Cross-cutting standards (every package)

- **`SPEC.md` per concern, frozen before code** (spec → failing tests → impl → docs). Type-level behaviour is tested in a `*.type-test.ts` file next to the module with `Expect<Equal<…>>` and
  `@ts-expect-error`, never with `expectTypeOf`: vitest only _runs_ specs, so `expectTypeOf(...)` there is a runtime no-op. Those files hold no runtime code — they are a **compilation** gate, run by
  `yarn typecheck` (which is what CI runs). See PRD §9.6.
- **Coverage follows upstream documentation and tests.** `yarn verify:docs-coverage` maps 396 documentation pages. `yarn verify:api-coverage` maps the 742 public API suites and 9,258 assertions run by
  Drizzle, Kysely, MikroORM, NestJS, and Typia.

  Each upstream suite in `tests/api-coverage/inventory.mjs` either points to a zmdb test or explains why the behavior is out of scope. At present, 334 zmdb tests cover 504 suites and the remaining 238
  have recorded exclusions. These totals are not a quality score: one behavior may appear in many upstream suites, and a single broad zmdb test may receive many credits. The gate prints its broadest
  mappings so they can be reviewed directly.

  The inventory is pinned to specific upstream commits. Maintainers refresh it with `scripts/harvest-api-tests.mjs`; CI uses the pinned copy so an upstream change cannot break this repository without
  review.

- **tsconfig:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`; `@zmdb/web` additionally pins `noImplicitAny` and asserts
  `experimentalDecorators: false`.
- **Build:** `scripts/build-package.mjs` runs `tsc` to produce ESM `.js` and `.d.ts` files in a layout that mirrors `src`.
- **Publish:** Trusted Publishing (OIDC, no token) via CI; `latest` dist-tag tracks the highest-precedence release (stable > rc > beta > alpha); provenance attested. License **GPL-3.0-or-later**.
- **No hidden state.** No module-level mutable singletons on the hot path (the DI container in `@zmdb/app` is the one explicit, opt-in registry, and it is resolved at class-init, not per request).

---

## 7. Superseded

This document replaces the 2026-08-29 "Zero-Maintenance Data Layer — Architecture Specification." Notably it **reverses** that document's §4 recommendation ("TypeScript for all packages") in favour of
the north-star-driven language policy in §4 here, and it records the eleven implementation-package reality (including `@zmdb/client`, `@zmdb/ai`, both opt-in AI integrations, `@zmdb/protobuf`,
`@zmdb/app`, and `@zmdb/web`) rather than the original four. Component-level details in the old doc that remain accurate now live in each package's `SPEC.md` and the docs site.
