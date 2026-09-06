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

| Package                  | Version       | Release unit | Role            | Install mode                                   | Installation                                                                                                     | Description                                                                                                                                                                    | Documentation                |
| ------------------------ | ------------- | ------------ | --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| @zmdb/ai                 | 1.0.0-alpha.4 | integration  | ai              | integration: provider-neutral AI tools         | `npm add @zmdb/ai@1.0.0-alpha.4 @zmdb/schema-core@1.0.0-alpha.4`                                                 | Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.                                                    | llm-function-calling         |
| @zmdb/ai-anthropic       | 1.0.0-alpha.4 | integration  | anthropic       | integration: Anthropic Messages API            | `npm add @zmdb/ai-anthropic@1.0.0-alpha.4`                                                                       | Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.                                                                                                  | llm-chat                     |
| @zmdb/ai-langchain       | 1.0.0-alpha.4 | integration  | langchain       | integration: LangChain                         | `npm add @zmdb/ai-langchain@1.0.0-alpha.4`                                                                       | Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.                                                                                        | llm-langchain                |
| @zmdb/ai-vercel          | 1.0.0-alpha.4 | integration  | vercel-ai       | integration: Vercel AI SDK                     | `npm add @zmdb/ai-vercel@1.0.0-alpha.4`                                                                          | Vercel AI SDK tool integration for provider-neutral zmdb AI contracts.                                                                                                         | llm-vercel-ai-sdk            |
| @zmdb/angular            | 1.0.0-alpha.4 | integration  | angular         | integration: Angular generated-client bindings | `npm add @zmdb/angular@1.0.0-alpha.4 '@angular/core@>=22.1.5 <23.0.0' 'rxjs@>=7.8.2 <8.0.0'`                     | Angular dependency-injection, signal, lifecycle, and Observable bindings for generated zmdb clients.                                                                           | client-angular               |
| @zmdb/aot-validator      | 1.0.0-alpha.4 | core         | validator       | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | Runtime helpers for ahead-of-time validation and JSON serialization: is/assert/validate/equals/random, unions, transforms, and generated-code errors.                          | aot-setup                    |
| @zmdb/app                | 1.0.0-alpha.4 | core         | app             | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, and observability. | web-app                      |
| @zmdb/client             | 1.0.0-alpha.4 | integration  | client          | integration: generated HTTP clients            | `npm add @zmdb/client@1.0.0-alpha.4`                                                                             | Dependency-free HTTP client runtime for generated and manually declared zmdb operations.                                                                                       | generated-client             |
| @zmdb/cockroach          | 1.0.0-alpha.4 | integration  | cockroach       | integration: CockroachDB                       | `npm add @zmdb/cockroach@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`        | CockroachDB vertical for zmdb: PostgreSQL-family dialect overrides, migrations, catalog introspection, retries, and a pg-protocol driver.                                      | dialect-cockroach            |
| @zmdb/compiler           | 1.0.0-alpha.4 | tooling      | compiler        | tooling                                        | `npm add --save-dev @zmdb/compiler@1.0.0-alpha.4`                                                                | The single TypeScript front end for zmdb reflection, AOT emission, code generation, build adapters, lint rules, and project configuration.                                     | aot-setup                    |
| @zmdb/jobs               | 1.0.0-alpha.4 | core         | jobs            | capability: jobs                               | `npm add @zmdb/jobs@1.0.0-alpha.4`                                                                               | Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.                                                           | web-queues                   |
| @zmdb/jobs-postgres      | 1.0.0-alpha.4 | integration  | jobs-postgres   | provider: jobs / PostgreSQL                    | `npm add @zmdb/jobs-postgres@1.0.0-alpha.4 @zmdb/jobs@1.0.0-alpha.4 pg@^8.23.0`                                  | node-postgres JobStore adapter for caller-owned PostgreSQL pools and clients.                                                                                                  | web-queues                   |
| @zmdb/mcp                | 1.0.0-alpha.4 | integration  | mcp             | integration: Model Context Protocol            | `npm add @zmdb/mcp@1.0.0-alpha.4`                                                                                | Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.                                                  | llm-mcp                      |
| @zmdb/migrations         | 1.0.0-alpha.4 | tooling      | migrations      | tooling                                        | `npm add --save-dev @zmdb/migrations@1.0.0-alpha.4`                                                              | Schema snapshots, deterministic migration plans, ledger runners, embedded execution, catalog introspection, and declaration emission for zmdb.                                 | migrations                   |
| @zmdb/mssql              | 1.0.0-alpha.4 | integration  | mssql           | integration: SQL Server                        | `npm add @zmdb/mssql@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`            | Complete SQL Server vertical for zmdb: T-SQL compilation, migrations, structural node-mssql execution, catalog introspection, and capability metadata.                         | dialect-mssql                |
| @zmdb/mysql              | 1.0.0-alpha.4 | integration  | mysql           | integration: MySQL                             | `npm add @zmdb/mysql@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`            | Complete MySQL compiler, migrations, introspection, and structural mysql2 driver vertical for zmdb.                                                                            | dialect-mysql                |
| @zmdb/next               | 1.0.0-alpha.4 | integration  | next            | integration: Next.js                           | `npm add @zmdb/next@1.0.0-alpha.4 'next@>=16.3.4 <17.0.0' 'react@>=19.2.8 <20.0.0' 'react-dom@>=19.2.8 <20.0.0'` | Request-scoped Next.js server clients and React browser bindings for generated zmdb clients.                                                                                   | client-next                  |
| @zmdb/nuxt               | 1.0.0-alpha.4 | integration  | nuxt            | integration: Nuxt 4                            | `npm add @zmdb/nuxt@1.0.0-alpha.4 'nuxt@>=4.5.2 <5.0.0' 'vue@>=3.5.42 <4.0.0'`                                   | Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration for generated zmdb clients.                                                                    | client-nuxt                  |
| @zmdb/otel               | 1.0.0-alpha.4 | integration  | otel            | integration: OpenTelemetry                     | `npm add @zmdb/otel@1.0.0-alpha.4 @opentelemetry/api@^1.9.1 @zmdb/app@1.0.0-alpha.4`                             | OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.                                                                           | web-observability            |
| @zmdb/postgres           | 1.0.0-alpha.4 | integration  | postgres        | integration: PostgreSQL                        | `npm add @zmdb/postgres@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`         | The complete PostgreSQL vertical for zmdb: dialect, migrations, catalog introspection, node-postgres driver, cursors, and cancellation.                                        | dialect-postgres             |
| @zmdb/protobuf           | 1.0.0-alpha.4 | integration  | protobuf        | integration: Protocol Buffers                  | `npm add @zmdb/protobuf@1.0.0-alpha.4`                                                                           | Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.                                                  | protobuf-message             |
| @zmdb/query-compiler     | 1.0.0-alpha.4 | core         | sql             | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | SQL-first, dialect-aware query compiler with reads, writes, joins, aggregates, full-text search, set operations, and schema-object DDL.                                        | raw-sql                      |
| @zmdb/react              | 1.0.0-alpha.4 | integration  | react           | integration: React                             | `npm add @zmdb/react@1.0.0-alpha.4 'react@>=19.2.8 <20.0.0'`                                                     | React context, query, and mutation lifecycle bindings for generated zmdb clients.                                                                                              | client-react                 |
| @zmdb/react-native       | 1.0.0-alpha.4 | integration  | react-native    | integration: React Native                      | `npm add @zmdb/react-native@1.0.0-alpha.4 'react@>=19.2.8 <20.0.0' 'react-native@>=0.87.1 <0.88.0'`              | React Native AppState, connectivity, and credential-store lifecycle bindings over @zmdb/react.                                                                                 | client-react-native          |
| @zmdb/repository         | 1.0.0-alpha.4 | core         | orm             | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.     | repository                   |
| @zmdb/schema-core        | 1.0.0-alpha.4 | core         | schema          | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.           | schema-declaration           |
| @zmdb/singlestore        | 1.0.0-alpha.4 | integration  | singlestore     | integration: SingleStore                       | `npm add @zmdb/singlestore@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`      | SingleStore vertical for zmdb: MySQL-family compilation, storage-aware migrations, catalog introspection, and mysql2 driver binding.                                           | dialect-singlestore          |
| @zmdb/solid              | 1.0.0-alpha.4 | integration  | solid           | integration: Solid client resources            | `npm add @zmdb/solid@1.0.0-alpha.4 'solid-js@>=1.9.15 <2.0.0'`                                                   | Solid context, resource and owner-lifetime bindings for generated zmdb clients.                                                                                                | client-solid                 |
| @zmdb/sqlite             | 1.0.0-alpha.4 | integration  | sqlite          | integration: SQLite                            | `npm add @zmdb/sqlite@1.0.0-alpha.4 @zmdb/query-compiler@1.0.0-alpha.4 @zmdb/repository@1.0.0-alpha.4`           | Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.                  | dialect-sqlite               |
| @zmdb/svelte             | 1.0.0-alpha.4 | integration  | svelte          | integration: Svelte 5                          | `npm add @zmdb/svelte@1.0.0-alpha.4 'svelte@>=5.57.0 <6.0.0'`                                                    | Typed Svelte context, lazy query stores, mutation stores, and lifecycle cancellation for generated zmdb clients.                                                               | client-svelte                |
| @zmdb/sveltekit          | 1.0.0-alpha.4 | integration  | sveltekit       | integration: SvelteKit                         | `npm add @zmdb/sveltekit@1.0.0-alpha.4 '@sveltejs/kit@>=2.70.3 <3.0.0' 'svelte@>=5.57.0 <6.0.0'`                 | Request-local SvelteKit clients, typed load helpers, explicit credential forwarding, and navigation cancellation for generated zmdb clients.                                   | client-sveltekit             |
| @zmdb/transport-grpc     | 1.0.0-alpha.4 | integration  | grpc            | integration: gRPC                              | `npm add @zmdb/transport-grpc@1.0.0-alpha.4 @grpc/grpc-js@^1.14.4 @zmdb/app@1.0.0-alpha.4`                       | Typed gRPC server and client integration for generated @zmdb/protobuf service artifacts and the @zmdb/app lifecycle.                                                           | web-microservices-grpc       |
| @zmdb/transport-nats     | 1.0.0-alpha.4 | integration  | transport-nats  | integration: core NATS messaging               | `npm add @zmdb/transport-nats@1.0.0-alpha.4 @nats-io/transport-node@^3.4.0 @zmdb/app@1.0.0-alpha.4`              | Core NATS transport strategy for the public messaging contract owned by the zmdb application kernel.                                                                           | web-microservices-transports |
| @zmdb/transport-rabbitmq | 1.0.0-alpha.4 | integration  | rabbitmq        | integration: RabbitMQ                          | `npm add @zmdb/transport-rabbitmq@1.0.0-alpha.4 @zmdb/app@1.0.0-alpha.4 amqplib@^2.0.1`                          | RabbitMQ transport strategy for the zmdb application messaging contract, with confirmed retries and owned dead-letter topology.                                                | web-microservices-transports |
| @zmdb/transport-redis    | 1.0.0-alpha.4 | integration  | transport-redis | integration: Redis Pub/Sub                     | `npm add @zmdb/transport-redis@1.0.0-alpha.4 @zmdb/app@1.0.0-alpha.4 redis@^6.2.1`                               | Redis Pub/Sub transport strategy for the protocol-neutral zmdb application messaging contract.                                                                                 | web-microservices-transports |
| @zmdb/vue                | 1.0.0-alpha.4 | integration  | vue             | integration: Vue 3                             | `npm add @zmdb/vue@1.0.0-alpha.4 'vue@>=3.5.42 <4.0.0'`                                                          | Vue plugin, reactive query, and mutation lifecycle bindings for generated zmdb clients.                                                                                        | client-vue                   |
| @zmdb/web                | 1.0.0-alpha.4 | core         | web             | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.                      | web-overview                 |
| zmdb                     | 1.0.0-alpha.4 | core         | product         | required                                       | `npm add zmdb@1.0.0-alpha.4`                                                                                     | The cohesive zmdb product: schema, SQL, validation, typed ORM, repositories, application kernel, HTTP, migrations, configuration, CLI, and tooling from one install.           | package-reference            |

### `@zmdb/ai`

Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./chat` → `./src/chat/index.ts`
  - `./compiler` → `./src/compiler.ts`
  - `./http` → `./src/http/index.ts`
  - `./tool-runtime` → `./src/tool-runtime.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/schema-core` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/ai-anthropic`

Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@anthropic-ai/sdk` → `0.124.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/ai-langchain`

Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-alpha.4`
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

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `ai` → `^7.0.93`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/llm-adapters

### `@zmdb/angular`

Angular dependency-injection, signal, lifecycle, and Observable bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@angular/core` → `>=22.1.5 <23.0.0`
  - `rxjs` → `>=7.8.2 <8.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/aot-validator`

Runtime helpers for ahead-of-time validation and JSON serialization: is/assert/validate/equals/random, unions, transforms, and generated-code errors.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./advanced` → `./src/advanced/index.ts`
  - `./errors` → `./src/errors.ts`
  - `./serialization` → `./src/serialization/index.ts`
  - `./utilities` → `./src/utilities/index.ts`
- **Dependencies:**
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `AssertError`
  - `ValidateResult`
  - `assert`
  - `is`
  - `validate`
  - `zmdb/validator`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/app`

Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, and observability.

- **Release unit:** `core`
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
- **Facade exposure:**
  - `Application`
  - `ApplicationExtension`
  - `ApplicationExtensionContext`
  - `ApplicationOptions`
  - `Command`
  - `CommandApp`
  - `Container`
  - `EventPattern`
  - `Inject`
  - `MessagePattern`
  - `Module`
  - `ModuleClass`
  - `Observability`
  - `OnEvent`
  - `Token`
  - `TransportStrategy`
  - `createApplication`
  - `createCommandApp`
  - `createEvents`
  - `createToken`
  - `repositoryToken`
  - `zmdb/app`
  - `zmdb/app/commands`
  - `zmdb/app/cqrs`
  - `zmdb/app/data`
  - `zmdb/app/di`
  - `zmdb/app/events`
  - `zmdb/app/health`
  - `zmdb/app/lifecycle`
  - `zmdb/app/messaging`
  - `zmdb/app/modules`
  - `zmdb/app/observability`
  - `zmdb/app/state`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/client`

Dependency-free HTTP client runtime for generated and manually declared zmdb operations.

- **Release unit:** `integration`
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

### `@zmdb/cockroach`

CockroachDB vertical for zmdb: PostgreSQL-family dialect overrides, migrations, catalog introspection, retries, and a pg-protocol driver.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
  - `@zmdb/postgres` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/cockroach`
- **External proof:** fixtures/database-cockroach

### `@zmdb/compiler`

The single TypeScript front end for zmdb reflection, AOT emission, code generation, build adapters, lint rules, and project configuration.

- **Release unit:** `tooling`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./config` → `./src/config/index.ts`
  - `./config/contract` → `./src/config/contract.ts`
  - `./emit` → `./src/emit/index.ts`
  - `./errors` → `./src/errors.ts`
  - `./lint` → `./src/lint/index.ts`
  - `./metro` → `./src/metro/metro.ts`
  - `./reflect` → `./src/reflect/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./transform` → `./src/transform/index.ts`
  - `./unplugin` → `./src/unplugin/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `metro` → `>=0.87.0 <0.88.0`
  - `metro-babel-transformer` → `>=0.87.0 <0.88.0`
  - `oxlint` → `>=1.81.0 <1.82.0`
- **Required peers:**
  - `@zmdb/aot-validator` → `1.0.0-alpha.4`
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/schema-core` → `1.0.0-alpha.4`
  - `typescript` → `>=7.0.2 <8.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `ZmdbConfig`
  - `defineConfig`
  - `zmdb/compiler`
  - `zmdb/config`
  - `zmdb/testing`
  - `zmdb/unplugin`
- **External proof:** fixtures/consumer-compiler

### `@zmdb/jobs`

Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./memory` → `./src/queues/backends/memory.ts`
  - `./schedule` → `./src/schedule/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/sqlite` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-core

### `@zmdb/jobs-postgres`

node-postgres JobStore adapter for caller-owned PostgreSQL pools and clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/postgres` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/jobs` → `1.0.0-alpha.4`
  - `pg` → `^8.23.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/mcp`

Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-mcp

### `@zmdb/migrations`

Schema snapshots, deterministic migration plans, ledger runners, embedded execution, catalog introspection, and declaration emission for zmdb.

- **Release unit:** `tooling`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./declarations` → `./src/declarations/index.ts`
  - `./embedded` → `./src/embedded.ts`
  - `./files` → `./src/files.ts`
  - `./introspect` → `./src/introspect/index.ts`
  - `./introspect/runtime` → `./src/introspect/common.ts`
  - `./runner` → `./src/runner.ts`
  - `./testing` → `./src/testing.ts`
- **Dependencies:**
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/migrations`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/mssql`

Complete SQL Server vertical for zmdb: T-SQL compilation, migrations, structural node-mssql execution, catalog introspection, and capability metadata.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mssql` → `^12.7.0`
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/mssql`
- **External proof:** fixtures/database-mssql

### `@zmdb/mysql`

Complete MySQL compiler, migrations, introspection, and structural mysql2 driver vertical for zmdb.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mysql2` → `^3.24.3`
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/mysql`
- **External proof:** fixtures/database-mysql

### `@zmdb/next`

Request-scoped Next.js server clients and React browser bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `./client` → `./src/client.ts`
  - `./server` → `./src/server.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
  - `@zmdb/react` → `workspace:1.0.0-alpha.4`
  - `server-only` → `0.0.1`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `next` → `>=16.3.4 <17.0.0`
  - `react` → `>=19.2.8 <20.0.0`
  - `react-dom` → `>=19.2.8 <20.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/next-app-router

### `@zmdb/nuxt`

Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./client` → `./src/client/index.ts`
  - `./server` → `./src/server/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
  - `@zmdb/vue` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `nuxt` → `>=4.5.2 <5.0.0`
  - `vue` → `>=3.5.42 <4.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters/nuxt

### `@zmdb/otel`

OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@opentelemetry/api` → `^1.9.1`
  - `@zmdb/app` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/postgres`

The complete PostgreSQL vertical for zmdb: dialect, migrations, catalog introspection, node-postgres driver, cursors, and cancellation.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `pg` → `^8.23.0`
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/postgres`
- **External proof:** fixtures/database-postgres

### `@zmdb/protobuf`

Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.

- **Release unit:** `integration`
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

SQL-first, dialect-aware query compiler with reads, writes, joins, aggregates, full-text search, set operations, and schema-object DDL.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./aggregations` → `./src/aggregations/index.ts`
  - `./comments` → `./src/comments/index.ts`
  - `./fts` → `./src/fts/index.ts`
  - `./joins` → `./src/joins/index.ts`
  - `./naming` → `./src/naming/index.ts`
  - `./outbox` → `./src/outbox/index.ts`
  - `./schema-objects` → `./src/schema-objects/index.ts`
  - `./set-ops` → `./src/set-ops/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/sql`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/react`

React context, query, and mutation lifecycle bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `react` → `>=19.2.8 <20.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/react-native`

React Native AppState, connectivity, and credential-store lifecycle bindings over @zmdb/react.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
  - `@zmdb/react` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `react` → `>=19.2.8 <20.0.0`
  - `react-native` → `>=0.87.1 <0.88.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/repository`

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, seeding, and framework adapters. No proxies, no identity map.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
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
  - `Driver`
  - `IncompleteKeyError`
  - `UpdatePatch`
  - `ValidationError`
  - `defineRepository`
  - `zmdb/orm`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/schema-core`

Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.

- **Release unit:** `core`
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
  - `CreateDTO`
  - `Entity`
  - `HasDefault`
  - `Max`
  - `MaxLength`
  - `Min`
  - `MinLength`
  - `Pattern`
  - `Physical`
  - `PrimaryKey`
  - `PrimaryKeyOf`
  - `ReadDTO`
  - `References`
  - `Sensitive`
  - `Serial`
  - `Sql`
  - `Table`
  - `Unique`
  - `UpdateDTO`
  - `ValidationIssue`
  - `schemaOf`
  - `zmdb/derive`
  - `zmdb/dto`
  - `zmdb/ir`
  - `zmdb/relations`
  - `zmdb/schema`
  - `zmdb/tags`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/singlestore`

SingleStore vertical for zmdb: MySQL-family compilation, storage-aware migrations, catalog introspection, and mysql2 driver binding.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
  - `@zmdb/mysql` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mysql2` → `^3.24.3`
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/singlestore`
- **External proof:** fixtures/database-singlestore

### `@zmdb/solid`

Solid context, resource and owner-lifetime bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `solid-js` → `>=1.9.15 <2.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/sqlite`

Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./embedded` → `./src/embedded.ts`
  - `./node` → `./src/node.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/query-compiler` → `1.0.0-alpha.4`
  - `@zmdb/repository` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/sqlite`
- **External proof:** fixtures/database-sqlite

### `@zmdb/svelte`

Typed Svelte context, lazy query stores, mutation stores, and lifecycle cancellation for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `svelte` → `>=5.57.0 <6.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters

### `@zmdb/sveltekit`

Request-local SvelteKit clients, typed load helpers, explicit credential forwarding, and navigation cancellation for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `./client` → `./src/client.ts`
  - `./server` → `./src/server.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
  - `@zmdb/svelte` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@sveltejs/kit` → `>=2.70.3 <3.0.0`
  - `svelte` → `>=5.57.0 <6.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters/sveltekit-packed

### `@zmdb/transport-grpc`

Typed gRPC server and client integration for generated @zmdb/protobuf service artifacts and the @zmdb/app lifecycle.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/protobuf` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@grpc/grpc-js` → `^1.14.4`
  - `@zmdb/app` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-nats`

Core NATS transport strategy for the public messaging contract owned by the zmdb application kernel.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@nats-io/transport-node` → `^3.4.0`
  - `@zmdb/app` → `1.0.0-alpha.4`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-rabbitmq`

RabbitMQ transport strategy for the zmdb application messaging contract, with confirmed retries and owned dead-letter topology.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/app` → `1.0.0-alpha.4`
  - `amqplib` → `^2.0.1`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/transport-redis`

Redis Pub/Sub transport strategy for the protocol-neutral zmdb application messaging contract.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/app` → `1.0.0-alpha.4`
  - `redis` → `^6.2.1`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/vue`

Vue plugin, reactive query, and mutation lifecycle bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-alpha.4`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `vue` → `>=3.5.42 <4.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters/vue

### `@zmdb/web`

HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./app` → `./src/app/index.ts`
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
  - `@zmdb/schema-core` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@zmdb/compiler` → `1.0.0-alpha.4`
  - `typescript` → `>=7.0.2 <8.0.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `Controller`
  - `Ctx`
  - `Delete`
  - `Gateway`
  - `Get`
  - `Patch`
  - `Post`
  - `Public`
  - `Put`
  - `Subscribe`
  - `Version`
  - `VersionNeutral`
  - `WebApplication`
  - `WebApplicationOptions`
  - `WebRequest`
  - `WebResponse`
  - `createApp`
  - `zmdb/web`
  - `zmdb/web/app`
  - `zmdb/web/compression`
  - `zmdb/web/context`
  - `zmdb/web/contract`
  - `zmdb/web/contract/compiler`
  - `zmdb/web/csrf`
  - `zmdb/web/data`
  - `zmdb/web/devtools`
  - `zmdb/web/dto-pipes`
  - `zmdb/web/gateways`
  - `zmdb/web/health`
  - `zmdb/web/middleware`
  - `zmdb/web/openapi`
  - `zmdb/web/pipeline`
  - `zmdb/web/routing`
  - `zmdb/web/static`
  - `zmdb/web/testing`
  - `zmdb/web/upload`
  - `zmdb/web/versioning`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `zmdb`

The cohesive zmdb product: schema, SQL, validation, typed ORM, repositories, application kernel, HTTP, migrations, configuration, CLI, and tooling from one install.

- **Release unit:** `core`
- **Exports:**
  - `.` → `./src/index.ts`
  - `./app` → `./src/app.ts`
  - `./app/commands` → `./src/app-commands.ts`
  - `./app/cqrs` → `./src/app-cqrs.ts`
  - `./app/data` → `./src/app-data.ts`
  - `./app/di` → `./src/app-di.ts`
  - `./app/events` → `./src/app-events.ts`
  - `./app/health` → `./src/app-health.ts`
  - `./app/lifecycle` → `./src/app-lifecycle.ts`
  - `./app/messaging` → `./src/app-messaging.ts`
  - `./app/modules` → `./src/app-modules.ts`
  - `./app/observability` → `./src/app-observability.ts`
  - `./app/state` → `./src/app-state.ts`
  - `./cli` → `./src/cli/index.ts`
  - `./cockroach` → `./src/database-cockroach.ts`
  - `./compiler` → `./src/compiler.ts`
  - `./config` → `./src/config/index.ts`
  - `./derive` → `./src/derive.ts`
  - `./dto` → `./src/dto.ts`
  - `./ir` → `./src/ir.ts`
  - `./migrations` → `./src/migrations.ts`
  - `./mssql` → `./src/database-mssql.ts`
  - `./mysql` → `./src/database-mysql.ts`
  - `./orm` → `./src/orm.ts`
  - `./postgres` → `./src/database-postgres.ts`
  - `./relations` → `./src/relations.ts`
  - `./schema` → `./src/schema.ts`
  - `./singlestore` → `./src/database-singlestore.ts`
  - `./sql` → `./src/sql.ts`
  - `./sqlite` → `./src/database-sqlite.ts`
  - `./tags` → `./src/tags.ts`
  - `./testing` → `./src/testing.ts`
  - `./unplugin` → `./src/unplugin.ts`
  - `./validator` → `./src/validator.ts`
  - `./web` → `./src/web.ts`
  - `./web/app` → `./src/web-app.ts`
  - `./web/compression` → `./src/web-compression.ts`
  - `./web/context` → `./src/web-context.ts`
  - `./web/contract` → `./src/web-contract.ts`
  - `./web/contract/compiler` → `./src/web-contract-compiler.ts`
  - `./web/csrf` → `./src/web-csrf.ts`
  - `./web/data` → `./src/web-data.ts`
  - `./web/devtools` → `./src/web-devtools.ts`
  - `./web/dto-pipes` → `./src/web-dto-pipes.ts`
  - `./web/gateways` → `./src/web-gateways.ts`
  - `./web/health` → `./src/web-health.ts`
  - `./web/middleware` → `./src/web-middleware.ts`
  - `./web/openapi` → `./src/web-openapi.ts`
  - `./web/pipeline` → `./src/web-pipeline.ts`
  - `./web/routing` → `./src/web-routing.ts`
  - `./web/static` → `./src/web-static.ts`
  - `./web/testing` → `./src/web-testing.ts`
  - `./web/upload` → `./src/web-upload.ts`
  - `./web/versioning` → `./src/web-versioning.ts`
- **Dependencies:**
  - `@zmdb/aot-validator` → `workspace:^`
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/compiler` → `workspace:1.0.0-alpha.4`
  - `@zmdb/migrations` → `workspace:1.0.0-alpha.4`
  - `@zmdb/query-compiler` → `workspace:^`
  - `@zmdb/repository` → `workspace:^`
  - `@zmdb/schema-core` → `workspace:^`
  - `@zmdb/web` → `workspace:^`
  - `esbuild` → `^0.28.2`
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@zmdb/cockroach` → `1.0.0-alpha.4`
  - `@zmdb/mssql` → `1.0.0-alpha.4`
  - `@zmdb/mysql` → `1.0.0-alpha.4`
  - `@zmdb/postgres` → `1.0.0-alpha.4`
  - `@zmdb/singlestore` → `1.0.0-alpha.4`
  - `@zmdb/sqlite` → `1.0.0-alpha.4`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `GPL-3.0-or-later`
- **Facade exposure:**
  - `zmdb/cli`
- **External proof:** fixtures/consumer-product

<!-- /generated: product-catalog package-reference -->

Release versions, changelog entries, npm tags, and publish order are not product catalog fields. The release model combines this catalog membership with architecture-policy edges, package manifests
and the root changelog. See the [architecture guide](./architecture.html) for the generated graph and atomic package-admission workflow; the repository's `PUBLISHING.md` carries the complete
changelog, bump, dry-run, exact-tag, and retry procedure.
