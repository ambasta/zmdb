# zmdb — Architecture

> **Status:** living architecture (supersedes the 2026-08-29 component blueprint).
> **Baseline (hard floor):** Node.js **26+**, TypeScript **7+**, **ESM-only**.
> Stage 3 ECMAScript proposals are first-class. Nothing older is supported —
> ever. We do not ship CommonJS, we do not ship compat shims, we do not test
> against older engines.
>
> 📖 Component-level API docs live on the docs site
> (https://ambasta.github.io/zmdb/) and in each package's `SPEC.md`. This file is
> the **project-wide** architecture: the north stars, the package-splitting
> doctrine, the implementation-language policy, and the opinionated directives
> that every package must obey.

---

## 1. North stars

There are exactly two, in priority order. When they conflict, **(1) wins**, and
the conflict is documented at the call site.

1. **Fastest possible runtime for the consuming application.** Every design
   choice is measured by its cost in the _user's_ hot path — per request, per
   query, per validation. Work that can happen at build time, install time, or
   type-check time must _not_ happen at runtime. Allocation, indirection,
   reflection, and dynamic dispatch on the hot path are defects, not trade-offs.

2. **Maintainability.** The framework must stay small, legible, and changeable by
   a small team. A feature that cannot be maintained is not shipped. Clever code
   that no one can safely modify is a liability regardless of speed.

Everything else — ergonomics, breadth, parity with incumbents — is subordinate
to these two and justified in their terms.

### 1.1 Corollary: the cost model

We reason about cost in **four buckets**, and we push work as far left as possible:

```
type-check time   →   build time   →   install time   →   RUNTIME
(free for users)      (once, CI)       (once, npm i)       (per request — minimize!)
```

- **Type-check time** (free for the consumer): schema→type derivation, illegal
  states, route/param typing, DI graph validation. Prefer this above all.
- **Build time** (paid once by the consumer's bundler/tsc): AOT validator
  inlining, SQL compilation where the query is static.
- **Install time** (paid once): our own `dist` build; native/WASM artifact
  download.
- **Runtime** (paid every time): only the irreducible work — the actual SQL
  round-trip, the inlined validation booleans, one object shape. Anything else
  here must justify itself against north star (1).

---

## 2. Opinionated design directives (non-negotiable)

These are not preferences; they are invariants. A change that violates one is
rejected regardless of how convenient it is.

1. **No runtime proxies, identity maps, or change tracking.** Reads return plain,
   inert objects (`prototype === Object.prototype`). Writes are explicit
   (`create`/`update`/`delete`). This is the single largest source of our speed.
2. **No runtime reflection.** No `reflect-metadata`, no runtime schema
   inspection, no `emitDecoratorMetadata`. Type information is erased; derivation
   is compile-time. Stage 3 decorators may use `context.metadata`, but only for
   data the decorator itself wrote (never type reflection).
3. **No runtime parsing/validation engine.** Validation is AOT-inlined to
   straight-line JavaScript booleans. No Zod/Valibot/Yup on the hot path, ever.
4. **Explicit SQL.** The query layer compiles to parameterized SQL strings. No
   implicit magic query objects; no hidden N+1.
5. **No `as` / no escape hatches.** `any`, `unknown`-casting, `as T` assertions,
   and non-null `!` in framework code are **defects**. If a type can't be
   proven, redesign the type, don't assert it. The only permitted assertions are
   a small, enumerated, individually-justified set of **boundary casts**
   (§2.1) — each commented with _why it is sound_. Consumer-facing APIs must be
   assertion-free: a user should never need `as` to use zmdb correctly.
6. **ESM-only, no dual publishing.** One module format. `"type": "module"`,
   single `exports` map, no `.cjs`.
7. **Zero required runtime dependencies.** Packages depend only on other `@zmdb/*`
   packages and Node built-ins. Third-party integrations (a `pg` driver, a Hono
   adapter) are _optional_ and structurally typed so the dep is never forced.
8. **Honest measurement.** Performance claims are backed by the real upstream
   benchmark harnesses; gaps and trade-offs are enumerated individually, never
   averaged into a flattering score, never silently skipped (see the benchmarks
   dashboard).
9. **One front-end: a table is a type.** There is no builder DSL and no schema
   value you author by hand. A declaration is a TypeScript interface carrying
   phantom tags, the reflection reads it once into a `TypeIR`, and every back-end
   — DDL, DTOs, JSON Schema, the emitted validator — reads that IR and nothing
   else. Two front-ends would mean two answers to "what are this table's
   columns", and the emitted validator can only ever agree with one of them.
   Enforced by `yarn verify:no-defineschema`, which imports every published
   surface and reads its export names rather than grepping for a spelling. The
   back-end half has its own gate, because it decays differently: the four walks
   this replaced were each two convenient lines in a package that needed one more
   fact about a column, and a fifth had already grown in the seeder before anyone
   looked. `yarn verify:one-walker` names the files that may read column metadata
   at all — the producer, the DDL boundary, one flag in the repository — with the
   reason beside each, and fails on a new reader or a stale exemption.
10. **The source runs as-is; the build only mirrors it.** In the repo every
    `exports` target is a `.ts` file and Node reads it directly, stripping the
    types — that is how the tests, the dev loop and the consumer fixtures all
    run, and `yarn verify:exports` imports all 62 subpaths that way. So a
    relative specifier must name the file that exists (`'./errors.ts'`, not
    `'./errors.js'` — `tsc` and vitest both map the latter back, Node does not),
    and no module on a path reachable from an entry point may contain syntax that
    is not type syntax, which rules out a decorator. What ships is `dist`, a
    file-for-file `tsc` emit of `src` (`scripts/build-package.mjs`); the source
    ships beside it for the maps. It has to be a build, because Node refuses to
    strip types under `node_modules` — an `exports` target of `./src/index.ts`
    throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` once installed, which
    the workspace's own symlinks hide. `yarn verify:publish` is the check that
    does not get fooled: it packs, installs and imports every subpath from a
    directory that is not this one.

### 2.1 The `as`-free rule and its narrow exceptions

"No `as`" is a hard project goal. In practice a typed system that touches an
untyped world (a DB driver returning `Record<string, unknown>`, `JSON.parse`,
`context.metadata`) has a finite number of **trust boundaries** where a value
crosses from "the runtime promises this shape" into "the type system knows this
shape." The policy:

- **Consumer code: zero assertions.** If a user must write `as` to satisfy our
  API, that is our bug.
- **Framework code: assertions are a reviewed, enumerated exception**, allowed
  _only_ at a trust boundary (driver row → `Entity<S>`, parsed JSON → `T`,
  metadata slot → typed record), each with a `// boundary:` comment stating the
  runtime guarantee that makes it sound. We prefer, in order: (a) a type-guard
  function that _proves_ the shape, (b) a generic that carries the type without
  assertion, (c) a `satisfies` check, and only then (d) a commented boundary
  cast. New assertions require justification in review; the count is tracked and
  driven toward zero.

> This is the honest position: we make the _public surface_ assertion-free and
> hold framework internals to a documented, shrinking exception list — rather
> than claim an absolute we'd have to fake with hidden `any`.
>
> **Where that stands (2026-09-03):** 61 assertions across `packages/*/src`, all
> documented under 53 `// boundary:` comments; 0 `any`, 0 non-null `!`, 1 lint
> suppression, 1 `as unknown as`, 0 consumer-facing `as` in the docs.
>
> That is up from 28, and the increase came with the type-first work.
> `aot-validator` holds 28 of the 61, clustered where the type system stops being
> able to help: `utilities` (8 comments) certifies a value against a `TypeIR` it
> walked, `emit` (4) hands the compiler synthesised nodes, and `reflect` + `cli`
> (5) read the checker's own untyped edges. Every assertion carries a
> `// boundary:` comment stating the runtime guarantee that makes it sound —
> that is the part the gate below checks, and it is the part that matters more
> than the count.
>
> The number is now **ratcheted in CI** — `yarn verify:escape-hatches` fails both
> when a count exceeds its ceiling and when an assertion has no `// boundary:`
> comment, and it tells you to lower the ceiling when a row drops below it. The
> earlier version of this note recorded a silent drift from 23 to 28 that nobody
> caught; that is what the ratchet is for (PRD RISK-7).

---

## 3. Package architecture & separation of responsibility

### 3.1 The splitting doctrine — _when_ a concern earns its own package

We split aggressively along **responsibility seams**, not by file count. A new
package is justified **only** when it satisfies most of these tests:

1. **Distinct responsibility.** It owns one clearly-nameable concern that the
   others should not know about (e.g. "compile SQL" vs "derive types" vs
   "validate at the boundary").
2. **Independent consumability.** A real user would install it _alone_ — e.g.
   someone who wants only the query compiler, or only the AOT validator, with no
   interest in the rest.
3. **Independent versioning value.** Its API changes on a different cadence than
   its siblings, and forcing a lockstep bump would be user-hostile.
4. **A one-directional dependency edge.** It can sit at a clean layer in the DAG
   (below its consumers, above its providers) with **no cycles**. If two
   candidate packages would need to depend on each other, they are one package.
5. **Independent testability.** Its contract can be tested without standing up
   the others.

If a concern fails these tests it stays a **sub-module** (`src/<concern>/` with
its own `SPEC.md` and a subpath export) inside an existing package — cheaper to
maintain, still separable later. **Subpath exports are the default; a new package
is the exception.** We would rather ship `@zmdb/schema-core/dto` than a premature
`@zmdb/dto`.

Conversely, we **merge** packages that have grown a bidirectional dependency or
that no one installs independently — dissolving a package is a valid, encouraged
refactor.

### 3.2 The dependency DAG (must stay acyclic)

```
                         ┌───────────────────┐
                         │   @zmdb/schema-core│  (no deps — the SoT + type derivation)
                         └─────────┬─────────┘
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
      ┌────────────────┐  ┌────────────────┐  (schema-core has no
      │@zmdb/query-    │  │@zmdb/aot-       │   runtime deps; validator
      │  compiler      │  │  validator      │   is build-time + a tiny
      │ (no deps)      │  │ (ts as devDep)  │   runtime fallback)
      └───────┬────────┘  └───────┬────────┘
              └───────┬───────────┘
                      ▼
             ┌────────────────┐
             │ @zmdb/repository│  (deps: schema-core, query-compiler)
             │  + drivers/*    │   optional peer: pg; built-in: node:sqlite
             └───────┬─────────┘
                     ▼
             ┌────────────────┐
             │   @zmdb/web     │  (deps: schema-core, aot-validator, repository)
             │ (decorator HTTP)│   full NestJS-parity layer — shipped
             └───────┬─────────┘
                     ▼
             ┌────────────────┐
             │      zmdb       │  (umbrella — re-exports the whole ecosystem;
             │   (meta pkg)    │   depends on all of the above; ZERO logic)
             └────────────────┘
```

**Rules enforced by this DAG:**

- **schema-core is the root and depends on nothing.** It is the Single Source of
  Truth; everything derives downward. It must never import a sibling.
- **query-compiler and aot-validator are siblings that do not know about each
  other.** SQL compilation and boundary validation are orthogonal.
- **repository is the composition layer** — it wires schema + compiler + validator
  into CRUD, and owns the driver adapters (built-in `node:sqlite`, optional `pg`).
- **web sits above repository** — controllers inject repositories, routes
  validate via the AOT validator, responses serialize via the AOT serializer.
- **`zmdb` (umbrella) contains no logic** — only curated re-exports. It is the
  default install; the sub-packages remain the tree-shakeable/advanced path.

### 3.3 Current + planned package map

| Package                | Responsibility                                                                                                                                                                                                                                                          | Runtime deps                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@zmdb/schema-core`    | The tag vocabulary, the `TypeIR` spine, compile-time type derivation (Entity/Create/Update + read DTOs), relations, OpenAPI, seeding, custom types, LLM tool schemas                                                                                                    | none                                   |
| `@zmdb/query-compiler` | SQL-first compiler (select/insert/update/delete, joins, aggregations, FTS, set-ops, schema-object DDL, migration diff), dialects                                                                                                                                        | none                                   |
| `@zmdb/aot-validator`  | The reflection (a tagged interface -> `TypeIR`), the AOT transformer, `zmdb-codegen`, and `schemaOf`/`is`/`assert`/`validate`/`equals`/`random`, unions, transforms, JSON Ser/De                                                                                        | none (ts is a devDep)                  |
| `@zmdb/repository`     | Auto-validating typed CRUD, `defineRepository`, transactions, populate, read-replicas, lifecycle events, framework adapters, **drivers**                                                                                                                                | schema-core, query-compiler            |
| `@zmdb/web`            | Stage-3 decorator HTTP framework: controllers, routing, typed `Ctx`, compile-time DI, domain state machines, request pipeline + adapters, modules, guards/pipes/interceptors/filters, app bootstrap + lifecycle, DTO validation/serialization, OpenAPI, WS/SSE, testing | schema-core, aot-validator, repository |
| `zmdb`                 | Umbrella meta-package (curated root + subpath re-exports)                                                                                                                                                                                                               | all of the above                       |

**Watch-list for future splits** (kept as sub-modules until they earn §3.1):

- `@zmdb/aot-validator` may split its **transformer plugin** from its **runtime
  fallback** if the plugin grows a heavy `typescript` coupling that hurts the
  runtime package's install weight.
- `@zmdb/web` will likely spawn **sub-modules first** (routing, DI, pipeline,
  guards/interceptors) and only promote one to a package if it becomes
  independently useful (e.g. the DI container).
- Native/WASM hot-path kernels (§4) would ship as their own artifact packages
  (`@zmdb/<x>-native`) loaded optionally, never as a hard dependency.

---

## 4. Implementation-language policy

**We target the TypeScript ecosystem; we are not obligated to implement in
TypeScript.** The public surface (types, tags, decorators) is and will remain
TypeScript, because that is the _product_. But the _implementation_ of any hot
path is chosen purely by north star (1): whatever gives the consumer the fastest
runtime while remaining maintainable.

### 4.1 The decision rule

For each unit of work, pick the leftmost option that meets the perf bar:

1. **Type-level (0 runtime).** If it can be a compile-time type, it is not code.
   _(derivation, path-param typing, DI-graph checks, domain state machines)_
2. **AOT-generated JS (0 marginal runtime).** If it can be inlined at the
   consumer's build, emit straight-line JavaScript. _(validation, static SQL)_
3. **Hand-written modern JS/TS (fast enough, most maintainable).** The default
   for everything not on a measured hot path. Node 26's V8 is the target; write
   monomorphic, allocation-light code.
4. **Native (N-API) or WASM kernel (last resort, measured).** Only when (1)–(3)
   are proven insufficient by a benchmark, and only for a **small, stable,
   pure-function kernel** with a clean boundary (bytes in → bytes/values out).

### 4.2 Guardrails for reaching down to native/WASM

Because native code trades maintainability for speed, it is gated:

- **Must be justified by a committed benchmark** showing the JS path is the
  bottleneck in a _consumer_ hot path (not a micro-benchmark of our internals).
- **Must ship as an optional, separately-versioned artifact** with a **pure-JS
  fallback of identical behaviour** — installs must never _require_ a native
  build, and consumers on any platform must work (slower) without it.
- **WASM is preferred over N-API** for portability (no node-gyp, no per-platform
  binaries, works in edge runtimes), unless N-API is measurably faster for the
  specific kernel.
- **The boundary must be tiny and value-typed** (e.g. "compile this AST to a SQL
  string", "hash these bytes") — never a chatty API that crosses the JS↔native
  boundary per row.

### 4.3 Current reality (honest)

Today **everything is TypeScript**, compiled to ESM `.js` + `.d.ts` by `tsc`
(`scripts/build-package.mjs`), and it already meets our validation/ORM benchmark
targets on Node/Bun/Deno. The
AOT validator's inlined output _is_ our "generated JS" tier. **No native/WASM
kernel exists or is currently justified.** The policy above is the rule we'll
apply _if and when_ a measured bottleneck appears — we do not add native
complexity speculatively (north star 2). The realistic first candidates, should
they ever be needed, are the AOT validator's JS emitter and the query compiler's
string assembly — both pure, both boundary-clean.

---

## 5. What Node 26 / TS 7 lets us delete

Committing to a hard floor is itself an architecture decision — it removes code:

- **No CommonJS interop, no dual `exports`, no `__dirname` shims.** ESM-only.
- **No transpilation of modern syntax** — `using`/`await using` (explicit
  resource mgmt), top-level `await`, `Array.fromAsync`, `Object.groupBy`,
  `Promise.withResolvers`, `structuredClone`, and **`node:sqlite`** are assumed
  present. The built-in `node:sqlite` driver is why our quickstart is
  zero-dependency.
- **Stage 3 standard decorators** (`experimentalDecorators: false`) with
  `Symbol.metadata` — the foundation of `@zmdb/web`. No `reflect-metadata`.
- **No polyfills** in shipped code. If a runtime feature isn't in Node 26, we
  don't use it; we don't shim it.

---

## 6. Cross-cutting standards (every package)

- **`SPEC.md` per concern, frozen before code** (spec → failing tests → impl →
  docs). Type-level behaviour is tested in a `*.type-test.ts` file next to the
  module with `Expect<Equal<…>>` and `@ts-expect-error`, never with
  `expectTypeOf`: vitest only _runs_ specs, so `expectTypeOf(...)` there is a
  runtime no-op. Those files hold no runtime code — they are a **compilation**
  gate, run by `yarn typecheck` (which is what CI runs). See PRD §9.6.
- **The public surface is tested against what the incumbents test, not only
  against what they document.** `yarn verify:docs-coverage` maps 396 upstream
  documentation pages; `yarn verify:api-coverage` does the harder half — the 742
  public-API test suites (9,258 assertions) that Drizzle, Kysely, MikroORM,
  NestJS and Typia actually run. A documented feature with no test upstream is a
  promise; a tested one is behaviour someone already depends on, so it is the
  better inventory of what a data layer is expected to do. Every suite in
  `tests/api-coverage/inventory.mjs` either names a zmdb test or carries a
  written reason we do not want it, and the gate fails on a suite that has
  neither. The inventory is **pinned to an upstream commit** and re-harvested
  deliberately by `scripts/harvest-api-tests.mjs`, which clones the five
  repositories; CI never runs it, because a competitor landing a test at 3am
  should not turn our build red.
- **tsconfig:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `isolatedModules`; `@zmdb/web` additionally pins
  `noImplicitAny` and asserts `experimentalDecorators: false`.
- **Build:** `tsup` → ESM `.js` + `.d.ts`; `@zmdb/*` kept external so cross-package
  edges resolve to published packages, not bundled copies.
- **Publish:** Trusted Publishing (OIDC, no token) via CI; `latest` dist-tag
  tracks the highest-precedence release (stable > rc > beta > alpha); provenance
  attested. License **GPL-3.0-or-later**.
- **No hidden state.** No module-level mutable singletons on the hot path (the DI
  container in `@zmdb/web` is the one explicit, opt-in registry, and it is
  resolved at class-init, not per request).

---

## 7. Superseded

This document replaces the 2026-08-29 "Zero-Maintenance Data Layer — Architecture
Specification." Notably it **reverses** that document's §4 recommendation
("TypeScript for all packages") in favour of the north-star-driven language
policy in §4 here, and it records the five-package reality (+ `@zmdb/web`) rather
than the original four. Component-level details in the old doc that remain
accurate now live in each package's `SPEC.md` and the docs site.
