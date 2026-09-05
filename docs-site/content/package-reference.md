# Package reference

> [!NOTE] The section below is generated from the read-only product catalog and current package manifests. `build:docs` refreshes it, while `verify:docs-generated` and `verify:product-catalog` compare
> its bytes without changing this file.

zmdb is installed as one product; use the manifest-derived command in the generated table below.

The root and `zmdb/*` subpaths are the application-facing contract. Individual `@zmdb/*` packages are advanced dependency firebreaks for consumers that deliberately need one concern without the
complete product; they are not steps in the beginner setup.

The generated reference contains one row per official product-catalog entry. The catalog supplies product role, optionality, facade exposure, documentation ownership and external proof. Each package
manifest supplies:

- npm name, description and version;
- public exports and dependencies;
- peer ranges and optional metadata;
- runtime engines and license; and
- an installation command derived from package name and catalog optionality.

Optional drivers, frontend adapters, transports, brokers, telemetry providers, and similar technologies appear only when selected. Importing `zmdb` must not load them.

<!-- generated: product-catalog package-reference -->

| Package                  | Version       | Role            | Install mode                           | Installation                                     | Description                                                                                                                                                                                                             | Documentation                |
| ------------------------ | ------------- | --------------- | -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| @zmdb/ai                 | 1.0.0-alpha.4 | ai              | integration: provider-neutral AI tools | `npm add @zmdb/ai@1.0.0-alpha.4`                 | Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.                                                                                             | llm-function-calling         |
| @zmdb/ai-anthropic       | 1.0.0-alpha.4 | anthropic       | integration: Anthropic Messages API    | `npm add @zmdb/ai-anthropic@1.0.0-alpha.4`       | Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.                                                                                                                                           | llm-chat                     |
| @zmdb/ai-langchain       | 1.0.0-alpha.4 | langchain       | integration: LangChain                 | `npm add @zmdb/ai-langchain@1.0.0-alpha.4`       | Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.                                                                                                                                 | llm-langchain                |
| @zmdb/ai-vercel          | 1.0.0-alpha.4 | vercel-ai       | integration: Vercel AI SDK             | `npm add @zmdb/ai-vercel@1.0.0-alpha.4`          | Vercel AI SDK tool integration for provider-neutral zmdb AI contracts.                                                                                                                                                  | llm-vercel-ai-sdk            |
| @zmdb/aot-validator      | 1.0.0-alpha.4 | validator       | required                               | `npm add zmdb@1.0.0-alpha.4`                     | Ahead-of-time compiled validation and JSON Ser/De: is/assert/validate/equals/random, unions, transforms — inlined to straight-line JavaScript at build time, no runtime parser.                                         | aot-setup                    |
| @zmdb/app                | 1.0.0-alpha.4 | app             | required                               | `npm add zmdb@1.0.0-alpha.4`                     | Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, and observability.                                          | web-app                      |
| @zmdb/client             | 1.0.0-alpha.4 | client          | integration: generated HTTP clients    | `npm add @zmdb/client@1.0.0-alpha.4`             | Dependency-free HTTP client runtime for generated and manually declared zmdb operations.                                                                                                                                | web-http-client              |
| @zmdb/jobs               | 1.0.0-alpha.4 | jobs            | required                               | `npm add @zmdb/jobs@1.0.0-alpha.4`               | Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.                                                                                                    | web-queues                   |
| @zmdb/mcp                | 1.0.0-alpha.4 | mcp             | integration: Model Context Protocol    | `npm add @zmdb/mcp@1.0.0-alpha.4`                | Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.                                                                                           | llm-mcp                      |
| @zmdb/otel               | 1.0.0-alpha.4 | otel            | integration: OpenTelemetry             | `npm add @zmdb/otel@1.0.0-alpha.4`               | OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.                                                                                                                    | web-observability            |
| @zmdb/protobuf           | 1.0.0-alpha.4 | protobuf        | integration: Protocol Buffers          | `npm add @zmdb/protobuf@1.0.0-alpha.4`           | Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.                                                                                           | protobuf-message             |
| @zmdb/query-compiler     | 1.0.0-alpha.4 | sql             | required                               | `npm add zmdb@1.0.0-alpha.4`                     | SQL-first, dialect-aware query compiler with catalog introspection, declaration emission, schema-object DDL, and migration diffing.                                                                                     | raw-sql                      |
| @zmdb/react              | 1.0.0-alpha.4 | react           | integration: React                     | `npm add @zmdb/react@1.0.0-alpha.4`              | React context, query, and mutation lifecycle bindings for generated zmdb clients.                                                                                                                                       | framework-integrations       |
| @zmdb/repository         | 1.0.0-alpha.4 | orm             | required                               | `npm add zmdb@1.0.0-alpha.4`                     | Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.                                              | repository                   |
| @zmdb/schema-core        | 1.0.0-alpha.4 | schema          | required                               | `npm add zmdb@1.0.0-alpha.4`                     | Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.                                                    | schema-declaration           |
| @zmdb/sqlite             | 1.0.0-alpha.4 | sqlite          | integration: SQLite                    | `npm add @zmdb/sqlite@1.0.0-alpha.4`             | Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.                                                           | dialect-sqlite               |
| @zmdb/transport-grpc     | 1.0.0-alpha.4 | grpc            | integration: gRPC                      | `npm add @zmdb/transport-grpc@1.0.0-alpha.4`     | Typed gRPC server and client integration for generated @zmdb/protobuf service artifacts and the @zmdb/app lifecycle.                                                                                                    | web-microservices-grpc       |
| @zmdb/transport-nats     | 1.0.0-alpha.4 | transport-nats  | integration: core NATS messaging       | `npm add @zmdb/transport-nats@1.0.0-alpha.4`     | Core NATS transport strategy for the public messaging contract owned by the zmdb application kernel.                                                                                                                    | web-microservices-transports |
| @zmdb/transport-rabbitmq | 1.0.0-alpha.4 | rabbitmq        | integration: RabbitMQ                  | `npm add @zmdb/transport-rabbitmq@1.0.0-alpha.4` | RabbitMQ transport strategy for the zmdb application messaging contract, with confirmed retries and owned dead-letter topology.                                                                                         | web-microservices-transports |
| @zmdb/transport-redis    | 1.0.0-alpha.4 | transport-redis | integration: Redis Pub/Sub             | `npm add @zmdb/transport-redis@1.0.0-alpha.4`    | Redis Pub/Sub transport strategy for the protocol-neutral zmdb application messaging contract.                                                                                                                          | web-microservices-transports |
| @zmdb/web                | 1.0.0-alpha.4 | web             | required                               | `npm add zmdb@1.0.0-alpha.4`                     | HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.                                                               | web-overview                 |
| zmdb                     | 1.0.0-alpha.4 | product         | required                               | `npm add zmdb@1.0.0-alpha.4`                     | The zmdb umbrella package — one install that re-exports the whole ecosystem (schema-core, query-compiler, aot-validator, repository). Define your schema once; types, validation, CRUD and more derive at compile time. | package-reference            |

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

Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, and observability.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./commands` → `./src/commands/index.ts`
  - `./cqrs` → `./src/cqrs/index.ts`
  - `./data` → `./src/data/index.ts`
  - `./di` → `./src/di/index.ts`
  - `./events` → `./src/events/index.ts`
  - `./health` → `./src/health/index.ts`
  - `./lifecycle` → `./src/lifecycle.ts`
  - `./messaging` → `./src/messaging/index.ts`
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

### `@zmdb/jobs`

Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./memory` → `./src/queues/backends/memory.ts`
  - `./schedule` → `./src/schedule/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/sqlite` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-core

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
  - `./introspect/runtime` → `./src/introspect/common.ts`
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

### `@zmdb/react`

React context, query, and mutation lifecycle bindings for generated zmdb clients.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `react` → `>=19.2.0 <20.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/repository`

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./drivers/mssql` → `./src/drivers/mssql.ts`
  - `./drivers/pg` → `./src/drivers/pg.ts`
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
  - `Driver`
  - `IncompleteKeyError`
  - `NumericColumnOf`
  - `TransactionContext`
  - `TransactionState`
  - `TransactionalDb`
  - `TxConnection`
  - `UpdatePatch`
  - `UpsertOptions`
  - `ValidationError`
  - `batch`
  - `createTransactionalDb`
  - `defineRepository`
  - `markTransactionClosed`
  - `zmdb/drivers/mssql`
  - `zmdb/drivers/pg`
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
  - `CustomType`
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
  - `decodeValue`
  - `defineEntityStateMachine`
  - `defineStateTransitions`
  - `defineType`
  - `encodeValue`
  - `schemaOf`
  - `toJsonSchema`
  - `zmdb/derive`
  - `zmdb/dto`
  - `zmdb/ir`
  - `zmdb/relations`
  - `zmdb/tags`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/sqlite`

Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.

- **Exports:**
  - `.` → `./src/index.ts`
  - `./embedded` → `./src/embedded.ts`
  - `./node` → `./src/node.ts`
- **Dependencies:**
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/drivers/sqlite`
- **External proof:** fixtures/database-sqlite

### `@zmdb/transport-grpc`

Typed gRPC server and client integration for generated @zmdb/protobuf service artifacts and the @zmdb/app lifecycle.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/protobuf` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@grpc/grpc-js` → `^1.14.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-nats`

Core NATS transport strategy for the public messaging contract owned by the zmdb application kernel.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@nats-io/transport-node` → `^3.4.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-rabbitmq`

RabbitMQ transport strategy for the zmdb application messaging contract, with confirmed retries and owned dead-letter topology.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `amqplib` → `^2.0.1`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-redis`

Redis Pub/Sub transport strategy for the protocol-neutral zmdb application messaging contract.

- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `redis` → `^6.2.1`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

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
  - `./middleware` → `./src/middleware/index.ts`
  - `./openapi` → `./src/openapi/index.ts`
  - `./pipeline` → `./src/pipeline/index.ts`
  - `./routing` → `./src/routing/index.ts`
  - `./static` → `./src/static/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./upload` → `./src/upload/index.ts`
  - `./versioning` → `./src/versioning/index.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
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
  - `@zmdb/sqlite` → `workspace:^`
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
