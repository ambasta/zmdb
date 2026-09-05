# Package reference

> [!NOTE] The table below is generated from the read-only product catalog and current package manifests. `verify:product-catalog` compares its bytes without changing this file; #716 owns the
> documentation generator that will refresh it explicitly.

zmdb is installed as one product:

```bash
npm add zmdb@alpha
```

The root and `zmdb/*` subpaths are the application-facing contract. Individual `@zmdb/*` packages are advanced dependency firebreaks for consumers that deliberately need one concern without the
complete product; they are not steps in the beginner setup.

The generated reference must contain one row per official product-catalog entry, with:

- the manifest-derived npm name and version;
- the package's product role;
- whether it is required, tooling-only, or a selected integration;
- root and subpath facade exposure;
- its documentation owner; and
- the packed external fixture that proves it, or the catalog's explicit reason for having no fixture.

Optional drivers, frontend adapters, transports, brokers, telemetry providers, and similar technologies appear only when selected. Importing `zmdb` must not load them.

<!-- generated: product-catalog package-reference -->

| Package              | Version       | Role      | Install mode                           | Installation                               | Description                                                                                                                                                                                                             | Documentation        |
| -------------------- | ------------- | --------- | -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| @zmdb/ai             | 1.0.0-alpha.4 | ai        | integration: provider-neutral AI tools | `npm add @zmdb/ai@1.0.0-alpha.4`           | Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.                                                                                             | llm-function-calling |
| @zmdb/ai-anthropic   | 1.0.0-alpha.4 | anthropic | integration: Anthropic Messages API    | `npm add @zmdb/ai-anthropic@1.0.0-alpha.4` | Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.                                                                                                                                           | llm-chat             |
| @zmdb/ai-langchain   | 1.0.0-alpha.4 | langchain | integration: LangChain                 | `npm add @zmdb/ai-langchain@1.0.0-alpha.4` | Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.                                                                                                                                 | llm-langchain        |
| @zmdb/ai-vercel      | 1.0.0-alpha.4 | vercel-ai | integration: Vercel AI SDK             | `npm add @zmdb/ai-vercel@1.0.0-alpha.4`    | Vercel AI SDK tool integration for provider-neutral zmdb AI contracts.                                                                                                                                                  | llm-vercel-ai-sdk    |
| @zmdb/aot-validator  | 1.0.0-alpha.4 | validator | required                               | `npm add zmdb@1.0.0-alpha.4`               | Ahead-of-time compiled validation and JSON Ser/De: is/assert/validate/equals/random, unions, transforms — inlined to straight-line JavaScript at build time, no runtime parser.                                         | aot-setup            |
| @zmdb/app            | 1.0.0-alpha.4 | app       | required                               | `npm add zmdb@1.0.0-alpha.4`               | Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health, and observability.                                                     | web-app              |
| @zmdb/client         | 1.0.0-alpha.4 | client    | integration: generated HTTP clients    | `npm add @zmdb/client@1.0.0-alpha.4`       | Dependency-free HTTP client runtime for generated and manually declared zmdb operations.                                                                                                                                | web-http-client      |
| @zmdb/mcp            | 1.0.0-alpha.4 | mcp       | integration: Model Context Protocol    | `npm add @zmdb/mcp@1.0.0-alpha.4`          | Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.                                                                                           | llm-mcp              |
| @zmdb/otel           | 1.0.0-alpha.4 | otel      | integration: OpenTelemetry             | `npm add @zmdb/otel@1.0.0-alpha.4`         | OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.                                                                                                                    | web-observability    |
| @zmdb/protobuf       | 1.0.0-alpha.4 | protobuf  | integration: Protocol Buffers          | `npm add @zmdb/protobuf@1.0.0-alpha.4`     | Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.                                                                                           | protobuf-message     |
| @zmdb/query-compiler | 1.0.0-alpha.4 | sql       | required                               | `npm add zmdb@1.0.0-alpha.4`               | SQL-first, dialect-aware query compiler with catalog introspection, declaration emission, schema-object DDL, and migration diffing.                                                                                     | raw-sql              |
| @zmdb/repository     | 1.0.0-alpha.4 | orm       | required                               | `npm add zmdb@1.0.0-alpha.4`               | Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.                                              | repository           |
| @zmdb/schema-core    | 1.0.0-alpha.4 | schema    | required                               | `npm add zmdb@1.0.0-alpha.4`               | Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.                                                    | schema-declaration   |
| @zmdb/web            | 1.0.0-alpha.4 | web       | required                               | `npm add zmdb@1.0.0-alpha.4`               | HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.                                                               | web-overview         |
| zmdb                 | 1.0.0-alpha.4 | product   | required                               | `npm add zmdb@1.0.0-alpha.4`               | The zmdb umbrella package — one install that re-exports the whole ecosystem (schema-core, query-compiler, aot-validator, repository). Define your schema once; types, validation, CRUD and more derive at compile time. | package-reference    |

### `@zmdb/ai`

Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./chat` → `./src/chat/index.ts`
  - `./compiler` → `./src/compiler.ts`
  - `./http` → `./src/http/index.ts`
  - `./tool-runtime` → `./src/tool-runtime.ts`
- **Dependencies:**
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/ai-anthropic`

Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@anthropic-ai/sdk` → `0.123.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/ai-langchain`

Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@langchain/core` → `^1.2.9`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/llm-adapters

### `@zmdb/ai-vercel`

Vercel AI SDK tool integration for provider-neutral zmdb AI contracts.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `ai` → `^7.0.83`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/llm-adapters

### `@zmdb/aot-validator`

Ahead-of-time compiled validation and JSON Ser/De: is/assert/validate/equals/random, unions, transforms — inlined to straight-line JavaScript at build time, no runtime parser.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./advanced` → `./src/advanced/index.ts`
  - `./codegen` → `./src/cli/index.ts`
  - `./emit` → `./src/emit/index.ts`
  - `./errors` → `./src/errors.ts`
  - `./lint` → `./src/lint/index.ts`
  - `./metro` → `./src/plugin/metro.ts`
  - `./plugin` → `./src/plugin/index.ts`
  - `./reflect` → `./src/reflect/index.ts`
  - `./serialization` → `./src/serialization/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./transformer` → `./src/transformer.ts`
  - `./unplugin` → `./src/unplugin.ts`
  - `./utilities` → `./src/utilities/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `metro` → `>=0.87.0 <0.88.0`
  - `metro-babel-transformer` → `>=0.87.0 <0.88.0`
  - `oxlint` → `>=1.81.0 <1.82.0`
  - `typescript` → `>=7.0.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `AssertError`
  - `ValidateResult`
  - `assert`
  - `assertEquals`
  - `assertShallow`
  - `equals`
  - `is`
  - `isShallow`
  - `random`
  - `tags`
  - `validate`
  - `validateShallow`
  - `zmdb/unplugin`
- **External proof:** fixtures/consumer-metro

### `@zmdb/app`

Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health, and observability.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./commands` → `./src/commands/index.ts`
  - `./cqrs` → `./src/cqrs/index.ts`
  - `./data` → `./src/data/index.ts`
  - `./di` → `./src/di/index.ts`
  - `./events` → `./src/events/index.ts`
  - `./health` → `./src/health/index.ts`
  - `./lifecycle` → `./src/lifecycle.ts`
  - `./modules` → `./src/modules/index.ts`
  - `./observability` → `./src/observability/index.ts`
  - `./state` → `./src/state/index.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/client`

Dependency-free HTTP client runtime for generated and manually declared zmdb operations.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./body` → `./src/body/index.ts`
  - `./errors` → `./src/errors/index.ts`
  - `./headers` → `./src/headers/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./transport` → `./src/transport/index.ts`
  - `./url` → `./src/url/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-http-client

### `@zmdb/mcp`

Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-mcp

### `@zmdb/otel`

OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@opentelemetry/api` → `^1.9.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/protobuf`

Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./wire` → `./src/wire.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/query-compiler`

SQL-first, dialect-aware query compiler with catalog introspection, declaration emission, schema-object DDL, and migration diffing.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./aggregations` → `./src/aggregations/index.ts`
  - `./comments` → `./src/comments/index.ts`
  - `./fts` → `./src/fts/index.ts`
  - `./introspect` → `./src/introspect/index.ts`
  - `./joins` → `./src/joins/index.ts`
  - `./migrations` → `./src/migrations/index.ts`
  - `./migrations/embedded` → `./src/migrations/embedded.ts`
  - `./migrations/runner` → `./src/migrations/runner.ts`
  - `./naming` → `./src/naming/index.ts`
  - `./outbox` → `./src/outbox/index.ts`
  - `./schema-objects` → `./src/schema-objects/index.ts`
  - `./set-ops` → `./src/set-ops/index.ts`
- **Dependencies:**
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `ColumnExpr`
  - `CommentKey`
  - `CommentKeys`
  - `CommentPairs`
  - `CompiledQuery`
  - `DIALECT_PARAM_LIMITS`
  - `Dialect`
  - `SetValue`
  - `UnsupportedFeatureError`
  - `appendComment`
  - `chunkArray`
  - `coalesce`
  - `concat`
  - `createQueryCompiler`
  - `dec`
  - `inc`
  - `migrations`
  - `mul`
  - `not`
  - `proposed`
  - `sanitizeKeys`
  - `serializeComment`
  - `withComments`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/repository`

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./drivers/mssql` → `./src/drivers/mssql.ts`
  - `./drivers/pg` → `./src/drivers/pg.ts`
  - `./drivers/sqlite` → `./src/drivers/sqlite.ts`
  - `./entity-modeling` → `./src/entity-modeling/index.ts`
  - `./integrations` → `./src/integrations/index.ts`
  - `./jobs` → `./src/jobs/index.ts`
  - `./outbox` → `./src/outbox/index.ts`
  - `./replicas` → `./src/replicas/index.ts`
  - `./seeding` → `./src/seeding/index.ts`
  - `./transactions` → `./src/transactions/index.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `ActiveTransactionContext`
  - `BaseRepository`
  - `ClosedTransactionContext`
  - `CreateGraphDTO`
  - `Driver`
  - `IncompleteKeyError`
  - `NumericColumnOf`
  - `TransactionContext`
  - `TransactionState`
  - `TransactionalDb`
  - `TxConnection`
  - `UpdateGraphDTO`
  - `UpdatePatch`
  - `UpsertOptions`
  - `ValidationError`
  - `batch`
  - `createTransactionalDb`
  - `defineRepository`
  - `markTransactionClosed`
  - `zmdb/drivers/mssql`
  - `zmdb/drivers/pg`
  - `zmdb/drivers/sqlite`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/schema-core`

Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./custom-types` → `./src/custom-types/index.ts`
  - `./derive` → `./src/derive/index.ts`
  - `./dto` → `./src/dto/index.ts`
  - `./ir` → `./src/ir/index.ts`
  - `./naming` → `./src/naming/index.ts`
  - `./openapi` → `./src/openapi/index.ts`
  - `./relations` → `./src/relations/index.ts`
  - `./tags` → `./src/tags/index.ts`
- **Dependencies:**
  - `@zmdb/query-compiler` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `AllowedTargetStates`
  - `ColumnMeta`
  - `CoreSchema`
  - `CreateDTO`
  - `Entity`
  - `EntityStateMachine`
  - `EntityStateMachineOptions`
  - `JsonSchemaObject`
  - `PrimaryKeyOf`
  - `StateTransitions`
  - `StateUpdateDTO`
  - `TaggedSchema`
  - `UpdateDTO`
  - `ValidationIssue`
  - `createStateUpdatePayload`
  - `defineEntityStateMachine`
  - `defineStateTransitions`
  - `schemaOf`
  - `toJsonSchema`
  - `zmdb/derive`
  - `zmdb/dto`
  - `zmdb/ir`
  - `zmdb/relations`
  - `zmdb/tags`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/web`

HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./app` → `./src/app/index.ts`
  - `./bench` → `./src/bench/index.ts`
  - `./compression` → `./src/compression/index.ts`
  - `./context` → `./src/context/index.ts`
  - `./contract` → `./src/contract/index.ts`
  - `./contract/compiler` → `./src/contract/compiler/index.ts`
  - `./csrf` → `./src/csrf/index.ts`
  - `./data` → `./src/data/index.ts`
  - `./devtools` → `./src/devtools/index.ts`
  - `./dto-pipes` → `./src/dto-pipes/index.ts`
  - `./gateways` → `./src/gateways/index.ts`
  - `./health` → `./src/health/index.ts`
  - `./microservices` → `./src/microservices/index.ts`
  - `./microservices/grpc` → `./src/microservices/grpc/index.ts`
  - `./microservices/nats` → `./src/microservices/nats/index.ts`
  - `./microservices/rabbitmq` → `./src/microservices/rabbitmq/index.ts`
  - `./microservices/redis` → `./src/microservices/redis/index.ts`
  - `./middleware` → `./src/middleware/index.ts`
  - `./openapi` → `./src/openapi/index.ts`
  - `./pipeline` → `./src/pipeline/index.ts`
  - `./queues` → `./src/queues/index.ts`
  - `./queues/backends/memory` → `./src/queues/backends/memory.ts`
  - `./queues/backends/pg` → `./src/queues/backends/pg.ts`
  - `./routing` → `./src/routing/index.ts`
  - `./schedule` → `./src/schedule/index.ts`
  - `./static` → `./src/static/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./upload` → `./src/upload/index.ts`
  - `./versioning` → `./src/versioning/index.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@grpc/grpc-js` → `^1.14.0`
  - `@nats-io/transport-node` → `^3.4.0`
  - `amqplib` → `^2.0.1`
  - `pg` → `^8.23.0`
  - `redis` → `^6.2.1`
  - `typescript` → `>=7.0.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/web`
  - `zmdb/web/contract`
  - `zmdb/web/contract/compiler`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `zmdb`

The zmdb umbrella package — one install that re-exports the whole ecosystem (schema-core, query-compiler, aot-validator, repository). Define your schema once; types, validation, CRUD and more derive
at compile time.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./cli` → `./src/cli/index.ts`
  - `./config` → `./src/config/index.ts`
  - `./derive` → `./src/derive.ts`
  - `./drivers/mssql` → `./src/drivers-mssql.ts`
  - `./drivers/pg` → `./src/drivers-pg.ts`
  - `./drivers/sqlite` → `./src/drivers-sqlite.ts`
  - `./dto` → `./src/dto.ts`
  - `./ir` → `./src/ir.ts`
  - `./relations` → `./src/relations.ts`
  - `./tags` → `./src/tags.ts`
  - `./unplugin` → `./src/unplugin.ts`
  - `./web` → `./src/web.ts`
  - `./web/contract` → `./src/web-contract.ts`
  - `./web/contract/compiler` → `./src/web-contract-compiler.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
  - `@zmdb/web` → `workspace:^`
  - `esbuild` → `^0.28.2`
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/cli`
  - `zmdb/config`
- **External proof:** fixtures/consumer-product

<!-- /generated: product-catalog package-reference -->

Release versions, changelog entries, npm tags, and publish order are not product catalog fields. See the architecture and publishing references; that policy is owned by architecture-governance EPIC
#721 and #728.
