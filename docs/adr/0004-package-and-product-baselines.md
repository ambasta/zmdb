# 0004 — Package extraction and product baselines

**Status:** superseded

**Decision date:** historical issue dates and source revisions are retained in the excerpts; archival separation recorded 2026-09-08.

**Owning issues:** #248, #618, #645, #649, #654, #703, #710, #753, #756; archival separation #737.

## Context

The AI, application, HTTP, PostgreSQL jobs and product specifications began with extraction measurements or earlier package plans. The catalog also repeated a measured membership table. Those
snapshots described their recorded revisions and do not define current dependencies, exports, or compatibility aliases.

## Decision

Lead the owning specifications with their current contracts and links to authoritative implementation definitions. Keep active ownership and refusal rules in those specifications; preserve the
superseded blocks here without changing their text.

## Evidence

The excerpts below are copied byte-for-byte from source commit `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. Original headings, names, measurements and issue references remain unchanged. A historical
statement inside an excerpt is not a current package claim.

## Consequences

Package manifests, public entries and policy/catalog sources remain authoritative. This move does not add an API, change dependency or release policy, or qualify any runtime integration. It separates
the identified historical blocks; it does not certify every historical sentence in every SPEC.

## Current contracts

- [AI](../../packages/ai/SPEC.md), [application kernel](../../packages/app/SPEC.md), [HTTP](../../packages/web/SPEC.md), and [PostgreSQL jobs](../../packages/jobs-postgres/SPEC.md).
- [Product facade](../../packages/zmdb/SPEC.md) and [product catalog](../../scripts/product/SPEC.md).
- [Architecture policy](../../scripts/architecture/policy.mjs), [runtime foundation](../../.github/scripts/verify-runtime-foundation.SPEC.md), and [release contract](../../scripts/release/SPEC.md).

**Superseded by:** the current contracts and implementation definitions linked above.

## Preserved source excerpts

### 1. packages/ai/SPEC.md — Extraction status and measured starting point

Original source: `packages/ai/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `7e1f75281b34239064ad6796727146b8e21f333ff3d3d3eac6cfdeab3401de1c`.

```text
> **Status:** target-state specification frozen by issue #703 and epic #702, with the extraction implemented by #705–#710. `@zmdb/ai` physically owns its root, chat, HTTP, compiler, and tool-runtime
> implementations; the Anthropic, LangChain, Vercel, and MCP packages physically own their integrations. No schema-core LLM compatibility source or export remains.

### Current state after #710

- `@zmdb/ai`, `/chat`, `/compiler`, `/http`, and `/tool-runtime` are explicit package exports.
- The package has one runtime dependency, `@zmdb/schema`, and no external dependency or peer.
- `@zmdb/ai-anthropic` owns the Anthropic driver, depends only on `@zmdb/ai`, and declares the SDK as its sole optional peer.
- Provider-neutral runtime and type tests execute from `packages/ai/src`.
- AOT `toolFor` imports and generated OpenAPI modules name the new package.
- `@zmdb/ai-vercel` physically owns the AI SDK adapter, tests and peer.
- `@zmdb/ai-langchain` physically owns its adapter, publishes one root, depends at runtime only on `@zmdb/ai`, owns the optional `@langchain/core@^1.2.9` peer, and is exercised by the real-package
  fixture.
- `@zmdb/mcp` owns its client, server, protocol specification, runtime tests, and type tests; its sole runtime dependency is `@zmdb/ai`.
- Schema-core has no `src/llm` files, `./llm*` exports, provider/framework peer, or dependency on AI.
- Measured after #710, `packages/ai/src` contains 21 files, `packages/mcp/src` contains six, `packages/ai-langchain/src` contains three, and `packages/schema/src/llm` contains zero.

## 1. Measured starting point

The inventory below was measured on 2026-09-05 at `94164c53`.

- `packages/schema/src/llm/` contains exactly **32 files**.
- `@zmdb/schema` publishes six LLM subpaths: `./llm`, `./llm/ai-sdk`, `./llm/chat`, `./llm/http`, `./llm/langchain` and `./llm/mcp`. Its package root does not export the LLM surface.
- `@zmdb/schema` declares `@anthropic-ai/sdk` `0.123.0`, `@langchain/core` `^1.2.9` and `ai` `^7.0.83` as optional peers.
- The installed Anthropic SDK is `0.123.0`. The LangChain consumer fixture declares and resolves `1.2.9`. The Vercel AI SDK fixture declares and resolves `7.0.92`, so the current lockfile does not
  prove the lower bound `7.0.83` even though the peer range starts there.
- Nine canonical LLM documentation pages exist: `llm-chat`, `llm-function-calling`, `llm-http`, `llm-json-schema`, `llm-langchain`, `llm-mcp`, `llm-strategy`, `llm-structured-output` and
  `llm-vercel-ai-sdk`.
- The AOT transformer, emitter, scanner, witness tests and callable-surface test still name `@zmdb/schema/llm`. Generated OpenAPI-tool modules also emit that old package header.

These are migration inputs, not final ownership claims.

```

### 2. packages/ai/SPEC.md — Extraction dependency diagram

Original source: `packages/ai/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `04e4ff0f39ea27e175d6085bcb5b348939a08774c4a949f9b69fa98cc9c5e796`.

````text
In this diagram `A --> B` means “A has a direct runtime dependency on B”:

```text
@zmdb/ai-anthropic ──┐
@zmdb/ai-langchain ──┼──> @zmdb/ai ──> @zmdb/schema ──> @zmdb/sql
@zmdb/ai-vercel ─────┤         ▲
@zmdb/mcp ───────────┘         │
                               │
@zmdb/compiler ────────────────┘
         ├────────────────────> @zmdb/validator ──> @zmdb/schema
         ├────────────────────> @zmdb/sql
         └────────────────────> @zmdb/schema
```

````

### 3. packages/app/SPEC.md — Pre-extraction application-kernel measurement

Original source: `packages/app/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `37fb285c9e6806a366b796a4f0aff063bc9e7565f5f8b28b1cf41071dad7f7a8`.

```text
> **Target contract — issue #645.** This specification freezes the package split before runtime files or manifests move. The measured baseline is commit `e66621a5`: the current `@zmdb/web` package
> exposes 318 distinct public symbols through 36 manifest entries, and 105 of those symbols belong to this application kernel.

```

### 4. packages/jobs-postgres/SPEC.md — Superseded SQL-shaped provider baseline

Original source: `packages/jobs-postgres/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `bca0403f7d4e65e12a0afea70cfd7822493dbaec848f89c170e6f6efc464ba62`.

```text
> Frozen by #654 for the first adapter, then superseded by issue #753's complete provider boundary. At the measured baseline the package adapts only the SQL-shaped `JobStore`; #756 moves all
> PostgreSQL jobs persistence into this package.

```

### 5. packages/web/SPEC.md — Historical HTTP package introduction

Original source: `packages/web/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `80597d637e1223b5d4da8f96a0b942006b0f6b684db7d5e490f3e12f6e3f3c70`.

```text
> Stage-3 HTTP framework over the protocol-neutral `@zmdb/app` kernel. The original issue #248 package baseline remains below as history; issue #649's HTTP-only boundary is the current contract.

```

### 6. packages/web/SPEC.md — Original and extracted HTTP dependency position

Original source: `packages/web/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `7ee50f113049f9ddc81320783ea34ae93829bac29fd739add9410c2ea60177cd`.

```text
At the original #248 baseline, `@zmdb/web` sat **above** `@zmdb/orm` in the dependency DAG (ARCHITECTURE.md §3) and depended on `@zmdb/schema`, `@zmdb/validator`, `@zmdb/sql` and `@zmdb/orm`. The
current package is the HTTP adapter over `@zmdb/app`; its direct runtime dependencies are exactly `@zmdb/app` and `@zmdb/schema`. It declares no third-party runtime dependency or runtime peer.
`@zmdb/compiler` and TypeScript are optional build-time peers reached only by `./contract/compiler`.

```

### 7. packages/web/SPEC.md — Original package baseline, acceptance and deferred scope

Original source: `packages/web/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `21bc91067c1042d3a6ec936c9f9ff42f617829920b9211093cbf2e01a21c56a2`.

```text
## Baseline contract (this issue)

### Package

- New workspace `packages/web`, name **`@zmdb/web`**, version tracks the other packages (`1.0.0-alpha.4`), license **GPL-3.0-or-later**.
- Original `dependencies`: `@zmdb/schema`, `@zmdb/validator`, `@zmdb/sql`, `@zmdb/orm` (all `workspace:^`). Integration peers belonged to the former server subpaths. The current HTTP-only manifest is
  defined in the issue #649 section below.
- `exports."."` → `./src/index.ts` (repointed to `./dist/index.js` at publish, exactly like the sibling packages).

### tsconfig

- Extends `../../tsconfig.json`.
- `rootDir`, `outDir` and the sibling `.d.ts` `paths` live in `tsconfig.build.json`, the emit project; `tsconfig.json` is `noEmit` and resolves siblings to their sources, so an edit in one package is
  a compile error here immediately.
- Explicitly asserts the decorator baseline: `experimentalDecorators: false`, `emitDecoratorMetadata: false`. (`strict` etc. come from base.)

### Build & publish wiring

- `tsconfig.build.json` mirrors `src` into `dist`; every public root and subpath is declared in the package `exports` map and repointed to emitted `.js` during publishing.
- Admitted once through `scripts/product/catalog.mjs`; release tooling maps that catalog row through architecture policy, so publish membership and dependency-first order are not repeated in package
  scripts.
- Re-exported from the `zmdb` product facade as **`zmdb/web`** (a subpath entry in `packages/zmdb`).

### Baseline symbol

- A zero-dependency **`Symbol.metadata` polyfill** (`src/polyfill.ts`), imported first by the entry, installing the well-known symbol when the runtime lacks it.
- `metadataOf(target)` — a tiny, typed accessor that reads the Stage-3 `Symbol.metadata` record off a decorated class/prototype and returns a `DecoratorMetadata` object (never `undefined`; returns an
  empty frozen record when absent). This is the one primitive every later decorator builds on, and it proves the baseline round-trips through the build.

## Acceptance (this issue)

- `@zmdb/web` resolves in dev (vitest/tsc) via `src` and builds to `dist/index.js` + `dist/index.d.ts`; every declared subpath imports and typechecks from an installed tarball (`yarn verify:publish`).
- A trivial Stage-3 class decorator that writes to `context.metadata` can be read back via `metadataOf(...)` at runtime — **without** `reflect-metadata` and **without** any `as` on the consumer
  surface.
- `zmdb/web` re-export path is present and re-exports the package root.
- Full monorepo suite + typecheck stay green.

## Out of scope (future issues/epics)

Routing (#252), typed `Ctx`/path-params (#257), DI (#262), domain state machines (#267), request pipeline/adapters (#272), data-layer integration (#277), and all NestJS-parity follow-ups (#282–#321).
Those freeze their own SPECs.

```

### 8. packages/zmdb/SPEC.md — Product extraction baseline and measured facade inventories

Original source: `packages/zmdb/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `4b62e1a4db8da71a70a513cd91896d9871d303384fbd6af89d68756c9a8d7c6e`.

```text
Issue #618 froze the public product boundary before #619–#624 changed exports, configuration consumers, generated product metadata, packed fixtures, or documentation. This document deliberately
separates the historical surface measured at `44d8fa4a` from the target and later implemented surfaces. Issue #618 itself changed no runtime source or package manifest.

## 1. Historical measured baseline

At `44d8fa4a`, `packages/zmdb/package.json` declared 13 export-map entries: the root plus 12 named subpaths. Importing that root in an isolated Node process exposed 42 runtime names. Static inspection
of that revision's `src/index.ts` added 32 type-only names, for 74 root symbols in total.

The combined #620/#651/#755 surface is measured from the manifest, isolated root import and explicit source exports: 51 export-map entries (the root plus 50 named subpaths), 33 runtime names and 38
type-only names, for 71 catalog-owned root names.

### 1.1 Every baseline root symbol

The classifications below describe product disposition, not whether the symbol is useful. A public symbol classified as `internal` is an implementation leak that must leave the facade; it is not
silently made private by this spec.

| Classification      | Count | Baseline root symbols                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application default |    18 | `schemaOf`, `Entity`, `CreateDTO`, `UpdateDTO`, `PrimaryKeyOf`, `ValidationIssue`, `is`, `assert`, `validate`, `AssertError`, `ValidateResult`, `BaseRepository`, `defineRepository`, `IncompleteKeyError`, `ValidationError`, `Driver`, `UpdatePatch`, `UpsertOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Advanced runtime    |    48 | `defineStateTransitions`, `defineEntityStateMachine`, `createStateUpdatePayload`, `CoreSchema`, `TaggedSchema`, `ColumnMeta`, `StateTransitions`, `AllowedTargetStates`, `StateUpdateDTO`, `EntityStateMachineOptions`, `EntityStateMachine`, `appendComment`, `coalesce`, `concat`, `serializeComment`, `withComments`, `createQueryCompiler`, `dec`, `inc`, `mul`, `not`, `proposed`, `UnsupportedFeatureError`, `ColumnExpr`, `CommentKey`, `CommentKeys`, `CommentPairs`, `CompiledQuery`, `Dialect`, `SetValue`, `equals`, `isShallow`, `assertShallow`, `assertEquals`, `random`, `validateShallow`, `tags`, `toJsonSchema`, `JsonSchemaObject`, `createTransactionalDb`, `batch`, `TransactionContext`, `TransactionState`, `ActiveTransactionContext`, `ClosedTransactionContext`, `TransactionalDb`, `TxConnection`, `NumericColumnOf` |
| Tooling             |     1 | `migrations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Integration         |     3 | `protoDecode`, `protoDescriptor`, `protoEncode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Internal            |     4 | `sanitizeKeys`, `chunkArray`, `DIALECT_PARAM_LIMITS`, `markTransactionClosed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The sum is the inventory assertion: `18 + 48 + 1 + 3 + 4 = 74`. #619 must turn that review-time measurement into an executable exact-export test.

### 1.1.1 Protobuf extraction amendment (#656)

The three integration names above are a historical baseline measurement. They are no longer root exports: `protoDecode`, `protoDescriptor`, and `protoEncode`, together with the gRPC artifact calls and
types, are owned only by `@zmdb/protobuf`. The product root does not forward optional protocol packages.

### 1.2 Every baseline named subpath

| Current subpath              | Classification      | Target concern / disposition                                                                 |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `zmdb/tags`                  | Application default | Root for the common declaration vocabulary; complete vocabulary under `zmdb/schema`          |
| `zmdb/derive`                | Application default | Root for common DTOs; complete derivation family under `zmdb/schema`                         |
| `zmdb/dto`                   | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/relations`             | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/ir`                    | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/migrations`            | Tooling             | Stable explicit migration-tooling boundary                                                   |
| `zmdb/sqlite`                | Integration         | Explicit facade for the optional `@zmdb/sqlite` vertical                                     |
| `zmdb/postgres`              | Integration         | Explicit facade for the optional `@zmdb/postgres` vertical                                   |
| `zmdb/mysql`                 | Integration         | Explicit facade for the optional `@zmdb/mysql` vertical                                      |
| `zmdb/mssql`                 | Integration         | Explicit facade for the optional `@zmdb/mssql` vertical                                      |
| `zmdb/cockroach`             | Integration         | Explicit facade for the optional `@zmdb/cockroach` vertical                                  |
| `zmdb/singlestore`           | Integration         | Explicit facade for the optional `@zmdb/singlestore` vertical                                |
| `zmdb/web`                   | Advanced runtime    | Stable complete web surface                                                                  |
| `zmdb/web/contract`          | Advanced runtime    | Stable HTTP contract boundary                                                                |
| `zmdb/web/contract/compiler` | Tooling             | Explicit HTTP contract compiler boundary                                                     |
| `zmdb/cli`                   | Tooling             | Stable programmatic CLI boundary; the executable remains `zmdb`                              |
| `zmdb/config`                | Tooling contract    | Stable canonical project-config boundary; its implementation package is intentionally hidden |

Compatibility aliases may remain until release governance chooses a breaking release, but they do not own new APIs and the beginner documentation does not teach them. Removing or deprecating an alias
is a versioning decision owned by #721/#728, not by the catalog.

```

### 9. scripts/product/SPEC.md — Catalog implementation starting point

Original source: `scripts/product/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `21dbbe82c941e43dff08d13d1049c920ae675ec6dc650790bd7d31ac0c1fde40`.

```text
Issue #618 froze the read-only metadata contract for the canonical module `scripts/product/catalog.mjs`. #622 implements that module and replaces handwritten product inventories with generated or
verified consumers.

```

### 10. scripts/product/SPEC.md — Measured package inventory and admission history

Original source: `scripts/product/SPEC.md` at `bfce8e3f4745bf10ddf06d2cfbe1abfce868415d`. SHA-256: `5cf4b4d8ff3924bea0db15873790ca8b12a4e40ad7971376b38e03eda1b3124b`.

```text
## 3. Measured package inventory

At the #618 baseline, six directories under `packages/` contained publishable manifests. Issues #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #670, #671, #672, #691, #692, #693,
#694, #657, #658, #659, #660, #661, #695, #696, #697, #698, #699, #628, and #629 add `@zmdb/protobuf`, `@zmdb/client`, `@zmdb/ai`, `@zmdb/app`, `@zmdb/jobs`, the independently selected
`@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, `@zmdb/ai-vercel`, `@zmdb/mcp`, `@zmdb/otel`, `@zmdb/sqlite`, `@zmdb/postgres`, `@zmdb/mssql`, `@zmdb/mysql`, `@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`,
`@zmdb/svelte`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, `@zmdb/jobs-postgres`, `@zmdb/solid`, `@zmdb/react-native`, `@zmdb/next`,
`@zmdb/nuxt`, `@zmdb/sveltekit`, `@zmdb/compiler`, and `@zmdb/migrations`; issue #673 adds `@zmdb/cockroach`, and issue #674 adds `@zmdb/singlestore`. The catalog now accounts for every
manifest-backed package exactly once. Publication derives its dependency-first sequence from architecture policy; the catalog still owns membership rather than release order:

| Directory                     | npm name                   | Frozen product role | Current facade ownership                                                   |
| ----------------------------- | -------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `packages/client`             | `@zmdb/client`             | `client`            | None; generated clients import it directly                                 |
| `packages/angular`            | `@zmdb/angular`            | `angular`           | None; selected Angular generated-client lifecycle integration              |
| `packages/schema`             | `@zmdb/schema`             | `schema`            | Root schema defaults; `schema`, `tags`, `derive`, `dto`, `relations`, `ir` |
| `packages/sql`                | `@zmdb/sql`                | `sql`               | Root SQL defaults and `zmdb/sql`                                           |
| `packages/migrations`         | `@zmdb/migrations`         | `migrations`        | `zmdb/migrations`                                                          |
| `packages/react`              | `@zmdb/react`              | `react`             | None; selected React generated-client lifecycle integration                |
| `packages/react-native`       | `@zmdb/react-native`       | `react-native`      | None; selected native generated-client lifecycle integration               |
| `packages/vue`                | `@zmdb/vue`                | `vue`               | None; selected Vue generated-client lifecycle integration                  |
| `packages/svelte`             | `@zmdb/svelte`             | `svelte`            | None; selected Svelte generated-client lifecycle integration               |
| `packages/next`               | `@zmdb/next`               | `next`              | None; selected Next.js generated-client integration                        |
| `packages/nuxt`               | `@zmdb/nuxt`               | `nuxt`              | None; selected Nuxt generated-client SSR/hydration integration             |
| `packages/sveltekit`          | `@zmdb/sveltekit`          | `sveltekit`         | None; selected SvelteKit generated-client load integration                 |
| `packages/solid`              | `@zmdb/solid`              | `solid`             | None; selected Solid generated-client lifecycle integration                |
| `packages/ai`                 | `@zmdb/ai`                 | `ai`                | None; installed and imported independently                                 |
| `packages/ai-anthropic`       | `@zmdb/ai-anthropic`       | `anthropic`         | None; selected integration with no facade export                           |
| `packages/ai-langchain`       | `@zmdb/ai-langchain`       | `langchain`         | None; selected integration with no facade export                           |
| `packages/ai-vercel`          | `@zmdb/ai-vercel`          | `vercel-ai`         | None; selected integration with no facade export                           |
| `packages/mcp`                | `@zmdb/mcp`                | `mcp`               | None; selected protocol integration with no facade export                  |
| `packages/protobuf`           | `@zmdb/protobuf`           | `protobuf`          | None; installed and imported independently                                 |
| `packages/validator`          | `@zmdb/validator`          | `validator`         | Root validator defaults and `zmdb/validator`                               |
| `packages/compiler`           | `@zmdb/compiler`           | `compiler`          | Root config authoring names; `compiler`, `config`, `testing`               |
| `packages/orm`                | `@zmdb/orm`                | `orm`               | Root repository defaults and `zmdb/orm`                                    |
| `packages/mssql`              | `@zmdb/mssql`              | `mssql`             | `zmdb/mssql`                                                               |
| `packages/postgres`           | `@zmdb/postgres`           | `postgres`          | `zmdb/postgres`                                                            |
| `packages/cockroach`          | `@zmdb/cockroach`          | `cockroach`         | `zmdb/cockroach`                                                           |
| `packages/sqlite`             | `@zmdb/sqlite`             | `sqlite`            | `zmdb/sqlite`                                                              |
| `packages/mysql`              | `@zmdb/mysql`              | `mysql`             | `zmdb/mysql`                                                               |
| `packages/singlestore`        | `@zmdb/singlestore`        | `singlestore`       | `zmdb/singlestore`                                                         |
| `packages/app`                | `@zmdb/app`                | `app`               | Root application names and `zmdb/app/*`                                    |
| `packages/jobs`               | `@zmdb/jobs`               | `jobs`              | None; selected first-party capability with no facade export                |
| `packages/jobs-postgres`      | `@zmdb/jobs-postgres`      | `jobs-postgres`     | None; selected PostgreSQL job adapter with no facade export                |
| `packages/jobs-sqlite`        | `@zmdb/jobs-sqlite`        | `jobs-sqlite`       | None; selected SQLite jobs provider with no facade export                  |
| `packages/otel`               | `@zmdb/otel`               | `otel`              | None; selected OpenTelemetry integration with no facade export             |
| `packages/transport-grpc`     | `@zmdb/transport-grpc`     | `grpc`              | None; selected gRPC integration with no facade export                      |
| `packages/transport-nats`     | `@zmdb/transport-nats`     | `transport-nats`    | None; selected core NATS integration with no facade export                 |
| `packages/transport-rabbitmq` | `@zmdb/transport-rabbitmq` | `rabbitmq`          | None; selected RabbitMQ integration with no facade export                  |
| `packages/transport-redis`    | `@zmdb/transport-redis`    | `transport-redis`   | None; selected Redis Pub/Sub transport with no facade export               |
| `packages/web`                | `@zmdb/web`                | `web`               | Root HTTP names and `zmdb/web/*`                                           |
| `packages/zmdb`               | `zmdb`                     | `product`           | Root composition, concern facades, `config`, `cli`, and executable         |

This table is review evidence, not the canonical machine source. The rows in `catalog.mjs` assign `docsOwner` and `consumer`, so later package additions or renames are one catalog edit plus the
consumers that verify it. A planned package is not catalogued until its package manifest exists; roadmap names are not published facts.

```
