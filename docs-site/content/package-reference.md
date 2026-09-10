# Package reference

> [!NOTE] The section below is generated from the read-only product catalog and current package manifests. `build:docs` refreshes it.

zmdb is installed as one product; use the manifest-derived command in the generated table below.

The root and `@zmdb/core/*` subpaths are the application-facing contract. Individual `@zmdb/*` packages are advanced dependency firebreaks for consumers that deliberately need one concern without the
complete product; they are not steps in the beginner setup.

The generated reference contains one row per official product-catalog entry. The catalog supplies product role, optionality, facade exposure, documentation ownership and external proof. Each package
manifest supplies:

- npm name, description and version;
- public exports and dependencies;
- peer ranges and optional metadata;
- runtime engines and license; and
- an installation command derived from package name and catalog optionality.

Optional drivers, frontend adapters, transports, brokers, telemetry providers, and similar technologies appear only when selected. Importing `@zmdb/core` must not load them.

<!-- generated: product-catalog package-reference -->

| Package             | Version      | Release unit | Support     | Role          | Install mode                                                 | Installation                                                                                                     | Description                                                                                                                                                                                                       | Documentation                |
| ------------------- | ------------ | ------------ | ----------- | ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| @zmdb/ai            | 1.0.0-beta.2 | integration  | supported   | ai            | integration: provider-neutral AI tools and provider adapters | `yarn add @zmdb/ai@1.0.0-beta.2 @zmdb/schema@1.0.0-beta.2 @zmdb/validator@1.0.0-beta.2`                          | Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, OpenAPI-derived tools, and optional Anthropic, LangChain, and Vercel AI SDK adapters for zmdb.                            | llm-function-calling         |
| @zmdb/app           | 1.0.0-beta.2 | core         | supported   | app           | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, observability, and an optional OpenTelemetry adapter. | web-app                      |
| @zmdb/cli           | 1.0.0-beta.2 | tooling      | supported   | cli           | tooling                                                      | `yarn add --dev @zmdb/cli@1.0.0-beta.2`                                                                          | The zmdb executable and developer command APIs for schema, application and HTTP workflows.                                                                                                                        | cli-overview                 |
| @zmdb/client        | 1.0.0-beta.2 | integration  | provisional | client        | integration: generated HTTP clients and framework bindings   | `yarn add @zmdb/client@1.0.0-beta.2`                                                                             | HTTP client runtime for generated and manually declared zmdb operations, with optional Angular, React, React Native, Solid, Svelte, and Vue bindings.                                                             | generated-client             |
| @zmdb/cockroach     | 1.0.0-beta.2 | integration  | supported   | cockroach     | integration: CockroachDB                                     | `yarn add @zmdb/cockroach@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                            | CockroachDB vertical for zmdb: PostgreSQL-family dialect overrides, migrations, catalog introspection, retries, and a pg-protocol driver.                                                                         | dialect-cockroach            |
| @zmdb/compiler      | 1.0.0-beta.2 | tooling      | supported   | compiler      | tooling                                                      | `yarn add --dev @zmdb/compiler@1.0.0-beta.2`                                                                     | The single TypeScript front end for zmdb reflection, AOT emission, code generation, build adapters, lint rules, and project configuration.                                                                        | aot-setup                    |
| @zmdb/core          | 1.0.0-beta.2 | core         | supported   | product       | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | The cohesive zmdb product: schema, SQL, validation, typed ORM, repositories, application kernel, HTTP, migrations, configuration, CLI, and tooling from one install.                                              | package-reference            |
| @zmdb/jobs          | 1.0.0-beta.2 | core         | supported   | jobs          | capability: jobs                                             | `yarn add @zmdb/jobs@1.0.0-beta.2`                                                                               | Portable typed queues, workers, scheduling, leases, and application lifecycle integration.                                                                                                                        | web-queues                   |
| @zmdb/jobs-postgres | 1.0.0-beta.2 | integration  | supported   | jobs-postgres | provider: jobs / PostgreSQL                                  | `yarn add @zmdb/jobs-postgres@1.0.0-beta.2 @zmdb/jobs@1.0.0-beta.2 pg@^8.23.0`                                   | node-postgres JobStore adapter for caller-owned PostgreSQL pools and clients.                                                                                                                                     | web-queues                   |
| @zmdb/jobs-sqlite   | 1.0.0-beta.2 | integration  | supported   | jobs-sqlite   | provider: jobs / SQLite                                      | `yarn add @zmdb/jobs-sqlite@1.0.0-beta.2 @zmdb/jobs@1.0.0-beta.2`                                                | Explicit SQLite persistence and owned memory storage for portable zmdb jobs.                                                                                                                                      | web-queues                   |
| @zmdb/mcp           | 1.0.0-beta.2 | integration  | provisional | mcp           | integration: Model Context Protocol                          | `yarn add @zmdb/mcp@1.0.0-beta.2`                                                                                | Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.                                                                                     | llm-mcp                      |
| @zmdb/migrations    | 1.0.0-beta.2 | tooling      | supported   | migrations    | tooling                                                      | `yarn add --dev @zmdb/migrations@1.0.0-beta.2`                                                                   | Schema snapshots, deterministic migration plans, ledger runners, embedded execution, catalog introspection, and declaration emission for zmdb.                                                                    | migrations                   |
| @zmdb/mssql         | 1.0.0-beta.2 | integration  | supported   | mssql         | integration: SQL Server                                      | `yarn add @zmdb/mssql@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                                | Complete SQL Server vertical for zmdb: T-SQL compilation, migrations, structural node-mssql execution, catalog introspection, and capability metadata.                                                            | dialect-mssql                |
| @zmdb/mysql         | 1.0.0-beta.2 | integration  | supported   | mysql         | integration: MySQL                                           | `yarn add @zmdb/mysql@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                                | Complete MySQL compiler, migrations, introspection, and structural mysql2 driver vertical for zmdb.                                                                                                               | dialect-mysql                |
| @zmdb/next          | 1.0.0-beta.2 | integration  | provisional | next          | integration: Next.js                                         | `yarn add @zmdb/next@1.0.0-beta.2 'next@>=16.3.4 <17.0.0' 'react@>=19.2.8 <20.0.0' 'react-dom@>=19.2.8 <20.0.0'` | Request-scoped Next.js server clients and React browser bindings for generated zmdb clients.                                                                                                                      | client-next                  |
| @zmdb/nuxt          | 1.0.0-beta.2 | integration  | provisional | nuxt          | integration: Nuxt 4                                          | `yarn add @zmdb/nuxt@1.0.0-beta.2 'nuxt@>=4.5.2 <5.0.0' 'vue@>=3.5.42 <4.0.0'`                                   | Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration for generated zmdb clients.                                                                                                       | client-nuxt                  |
| @zmdb/orm           | 1.0.0-beta.2 | core         | supported   | orm           | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and seeding. No proxies, no identity map.                                                            | repository                   |
| @zmdb/postgres      | 1.0.0-beta.2 | integration  | supported   | postgres      | integration: PostgreSQL                                      | `yarn add @zmdb/postgres@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                             | The complete PostgreSQL vertical for zmdb: dialect, migrations, catalog introspection, node-postgres driver, cursors, and cancellation.                                                                           | dialect-postgres             |
| @zmdb/protobuf      | 1.0.0-beta.2 | integration  | supported   | protobuf      | integration: Protocol Buffers                                | `yarn add @zmdb/protobuf@1.0.0-beta.2`                                                                           | Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.                                                                                     | protobuf-message             |
| @zmdb/schema        | 1.0.0-beta.2 | core         | supported   | schema        | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.                                              | schema-declaration           |
| @zmdb/singlestore   | 1.0.0-beta.2 | integration  | supported   | singlestore   | integration: SingleStore                                     | `yarn add @zmdb/singlestore@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                          | SingleStore vertical for zmdb: MySQL-family compilation, storage-aware migrations, catalog introspection, and mysql2 driver binding.                                                                              | dialect-singlestore          |
| @zmdb/sql           | 1.0.0-beta.2 | core         | supported   | sql           | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | SQL-first, dialect-aware query compiler with reads, writes, joins, aggregates, full-text search, set operations, and schema-object DDL.                                                                           | raw-sql                      |
| @zmdb/sqlite        | 1.0.0-beta.2 | integration  | supported   | sqlite        | integration: SQLite                                          | `yarn add @zmdb/sqlite@1.0.0-beta.2 @zmdb/orm@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2`                               | Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.                                                     | dialect-sqlite               |
| @zmdb/sveltekit     | 1.0.0-beta.2 | integration  | provisional | sveltekit     | integration: SvelteKit                                       | `yarn add @zmdb/sveltekit@1.0.0-beta.2 '@sveltejs/kit@>=2.70.3 <3.0.0' 'svelte@>=5.57.0 <6.0.0'`                 | Request-local SvelteKit clients, typed load helpers, explicit credential forwarding, and navigation cancellation for generated zmdb clients.                                                                      | client-sveltekit             |
| @zmdb/transport     | 1.0.0-beta.2 | integration  | provisional | transport     | integration: gRPC and broker transports                      | `yarn add @zmdb/transport@1.0.0-beta.2 @zmdb/app@1.0.0-beta.2`                                                   | gRPC, Kafka, NATS, RabbitMQ, Redis, and SQS transport adapters for the protocol-neutral zmdb application messaging contract.                                                                                      | web-microservices-transports |
| @zmdb/validator     | 1.0.0-beta.2 | core         | supported   | validator     | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | Runtime helpers for ahead-of-time validation and JSON serialization: is/assert/validate/equals/random, unions, transforms, and generated-code errors.                                                             | aot-setup                    |
| @zmdb/web           | 1.0.0-beta.2 | core         | supported   | web           | required                                                     | `yarn add @zmdb/core@1.0.0-beta.2`                                                                               | HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.                                                         | web-overview                 |

### `@zmdb/ai`

Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, OpenAPI-derived tools, and optional Anthropic, LangChain, and Vercel AI SDK adapters for zmdb.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `packages/ai/src/langchain/index.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./anthropic` → `./src/anthropic/index.ts`
  - `./chat` → `./src/chat/index.ts`
  - `./compiler` → `./src/compiler.ts`
  - `./http` → `./src/http/index.ts`
  - `./langchain` → `./src/langchain/index.ts`
  - `./tool-runtime` → `./src/tool-runtime.ts`
  - `./vercel` → `./src/vercel/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:**
  - `@anthropic-ai/sdk` → `0.124.0`
  - `@langchain/core` → `^1.2.9`
  - `ai` → `^7.0.93`
- **Required peers:**
  - `@zmdb/schema` → `1.0.0-beta.2`
  - `@zmdb/validator` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/app`

Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, observability, and an optional OpenTelemetry
adapter.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
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
  - `./otel` → `./src/otel/index.ts`
  - `./state` → `./src/state/index.ts`
- **Dependencies:**
  - `@zmdb/orm` → `workspace:^`
  - `@zmdb/schema` → `workspace:^`
  - `@zmdb/sql` → `workspace:^`
  - `@zmdb/validator` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@opentelemetry/api` → `^1.9.1`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
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
  - `@zmdb/core/app`
  - `@zmdb/core/app/commands`
  - `@zmdb/core/app/cqrs`
  - `@zmdb/core/app/data`
  - `@zmdb/core/app/di`
  - `@zmdb/core/app/events`
  - `@zmdb/core/app/health`
  - `@zmdb/core/app/lifecycle`
  - `@zmdb/core/app/messaging`
  - `@zmdb/core/app/modules`
  - `@zmdb/core/app/observability`
  - `@zmdb/core/app/state`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/cli`

The zmdb executable and developer command APIs for schema, application and HTTP workflows.

- **Release unit:** `tooling`
- **Support:** `supported` (evidence `packages/cli/src/packed-cli.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/compiler` → `workspace:1.0.0-beta.2`
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@zmdb/app` → `1.0.0-beta.2`
  - `@zmdb/web` → `1.0.0-beta.2`
  - `esbuild` → `>=0.28.2 <0.29.0`
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/schema` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
  - `typescript` → `>=7.0.2 <8.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/cli`
- **External proof:** fixtures/consumer-cli

### `@zmdb/client`

HTTP client runtime for generated and manually declared zmdb operations, with optional Angular, React, React Native, Solid, Svelte, and Vue bindings.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `packages/client/src/react/react.spec.ts`, unrun `fixtures/client-adapters`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./angular` → `./src/angular/index.ts`
  - `./body` → `./src/body/index.ts`
  - `./errors` → `./src/errors/index.ts`
  - `./headers` → `./src/headers/index.ts`
  - `./react` → `./src/react/index.ts`
  - `./react-native` → `./src/react-native/index.ts`
  - `./solid` → `./src/solid/index.ts`
  - `./svelte` → `./src/svelte/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./transport` → `./src/transport/index.ts`
  - `./url` → `./src/url/index.ts`
  - `./vue` → `./src/vue/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:**
  - `@angular/core` → `>=22.1.5 <23.0.0`
  - `react` → `>=19.2.8 <20.0.0`
  - `react-native` → `>=0.87.1 <0.88.0`
  - `rxjs` → `>=7.8.2 <8.0.0`
  - `solid-js` → `>=1.9.15 <2.0.0`
  - `svelte` → `>=5.57.0 <6.0.0`
  - `vue` → `>=3.5.42 <4.0.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** packages/client/src/runtime.spec.ts

### `@zmdb/cockroach`

CockroachDB vertical for zmdb: PostgreSQL-family dialect overrides, migrations, catalog introspection, retries, and a pg-protocol driver.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `fixtures/database-cockroach`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
  - `@zmdb/postgres` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/cockroach`
- **External proof:** fixtures/database-cockroach

### `@zmdb/compiler`

The single TypeScript front end for zmdb reflection, AOT emission, code generation, build adapters, lint rules, and project configuration.

- **Release unit:** `tooling`
- **Support:** `supported` (evidence `packages/compiler/src/metro/metro.integration.spec.ts`)
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
  - `@zmdb/ai` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `metro` → `>=0.87.0 <0.88.0`
  - `metro-babel-transformer` → `>=0.87.0 <0.88.0`
  - `oxlint` → `>=1.81.0 <1.82.0`
- **Required peers:**
  - `@zmdb/schema` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
  - `@zmdb/validator` → `1.0.0-beta.2`
  - `typescript` → `>=7.0.2 <8.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `ZmdbConfig`
  - `defineConfig`
  - `@zmdb/core/compiler`
  - `@zmdb/core/config`
  - `@zmdb/core/testing`
- **External proof:** fixtures/consumer-compiler

### `@zmdb/core`

The cohesive zmdb product: schema, SQL, validation, typed ORM, repositories, application kernel, HTTP, migrations, configuration, CLI, and tooling from one install.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
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
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/cli` → `workspace:1.0.0-beta.2`
  - `@zmdb/compiler` → `workspace:1.0.0-beta.2`
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
  - `@zmdb/orm` → `workspace:^`
  - `@zmdb/schema` → `workspace:^`
  - `@zmdb/sql` → `workspace:^`
  - `@zmdb/sqlite` → `workspace:1.0.0-beta.2`
  - `@zmdb/validator` → `workspace:^`
  - `@zmdb/web` → `workspace:^`
  - `esbuild` → `^0.28.2`
  - `oxfmt` → `0.66.0`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@zmdb/cockroach` → `1.0.0-beta.2`
  - `@zmdb/mssql` → `1.0.0-beta.2`
  - `@zmdb/mysql` → `1.0.0-beta.2`
  - `@zmdb/postgres` → `1.0.0-beta.2`
  - `@zmdb/singlestore` → `1.0.0-beta.2`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-product

### `@zmdb/jobs`

Portable typed queues, workers, scheduling, leases, and application lifecycle integration.

- **Release unit:** `core`
- **Support:** `supported` (evidence `packages/jobs/src/provider-lifecycle.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./schedule` → `./src/schedule/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-core

### `@zmdb/jobs-postgres`

node-postgres JobStore adapter for caller-owned PostgreSQL pools and clients.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `fixtures/consumer-server-integrations`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/postgres` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/jobs` → `1.0.0-beta.2`
  - `pg` → `^8.23.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/jobs-sqlite`

Explicit SQLite persistence and owned memory storage for portable zmdb jobs.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `fixtures/consumer-server-integrations`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/sqlite` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/jobs` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** packages/jobs-sqlite/src/index.spec.ts

### `@zmdb/mcp`

Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `packages/mcp/src/mcp.spec.ts`, unrun `fixtures/consumer-mcp`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/ai` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-mcp

### `@zmdb/migrations`

Schema snapshots, deterministic migration plans, ledger runners, embedded execution, catalog introspection, and declaration emission for zmdb.

- **Release unit:** `tooling`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
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
  - `@zmdb/schema` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/migrations`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/mssql`

Complete SQL Server vertical for zmdb: T-SQL compilation, migrations, structural node-mssql execution, catalog introspection, and capability metadata.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `fixtures/database-mssql`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mssql` → `^12.7.0`
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/mssql`
- **External proof:** fixtures/database-mssql

### `@zmdb/mysql`

Complete MySQL compiler, migrations, introspection, and structural mysql2 driver vertical for zmdb.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `packages/mysql/src/live.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mysql2` → `^3.24.3`
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/mysql`
- **External proof:** fixtures/database-mysql

### `@zmdb/next`

Request-scoped Next.js server clients and React browser bindings for generated zmdb clients.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `packages/next/src/server.spec.ts`, unrun `fixtures/next-app-router`)
- **Exports:**
  - `./client` → `./src/client.ts`
  - `./server` → `./src/server.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-beta.2`
  - `server-only` → `0.0.1`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `next` → `>=16.3.4 <17.0.0`
  - `react` → `>=19.2.8 <20.0.0`
  - `react-dom` → `>=19.2.8 <20.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/next-app-router

### `@zmdb/nuxt`

Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration for generated zmdb clients.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `packages/nuxt/src/server/server.spec.ts`, unrun `fixtures/client-adapters/nuxt`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./client` → `./src/client/index.ts`
  - `./server` → `./src/server/index.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `nuxt` → `>=4.5.2 <5.0.0`
  - `vue` → `>=3.5.42 <4.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters/nuxt

### `@zmdb/orm`

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and seeding. No proxies, no identity map.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./dto` → `./src/dto/index.ts`
  - `./entity-modeling` → `./src/entity-modeling/index.ts`
  - `./outbox` → `./src/outbox/index.ts`
  - `./relations` → `./src/relations/index.ts`
  - `./replicas` → `./src/replicas/index.ts`
  - `./seeding` → `./src/seeding/index.ts`
  - `./transactions` → `./src/transactions/index.ts`
- **Dependencies:**
  - `@zmdb/schema` → `workspace:^`
  - `@zmdb/sql` → `workspace:^`
  - `@zmdb/validator` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `Driver`
  - `IncompleteKeyError`
  - `UpdatePatch`
  - `ValidationError`
  - `defineRepository`
  - `@zmdb/core/orm`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/postgres`

The complete PostgreSQL vertical for zmdb: dialect, migrations, catalog introspection, node-postgres driver, cursors, and cancellation.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `fixtures/database-postgres`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `pg` → `^8.23.0`
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/postgres`
- **External proof:** fixtures/database-postgres

### `@zmdb/protobuf`

Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./wire` → `./src/wire.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/schema`

Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, and custom types — the single source of truth for a zmdb data layer.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./custom-types` → `./src/custom-types/index.ts`
  - `./derive` → `./src/derive/index.ts`
  - `./dto` → `./src/dto/index.ts`
  - `./entity-modeling` → `./src/entity-modeling/index.ts`
  - `./ir` → `./src/ir/index.ts`
  - `./naming` → `./src/naming/index.ts`
  - `./openapi` → `./src/openapi/index.ts`
  - `./relations` → `./src/relations/index.ts`
  - `./tags` → `./src/tags/index.ts`
- **Dependencies:** None.
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
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
  - `schemaOf`
  - `@zmdb/core/derive`
  - `@zmdb/core/dto`
  - `@zmdb/core/ir`
  - `@zmdb/core/relations`
  - `@zmdb/core/schema`
  - `@zmdb/core/tags`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/singlestore`

SingleStore vertical for zmdb: MySQL-family compilation, storage-aware migrations, catalog introspection, and mysql2 driver binding.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `packages/singlestore/src/singlestore.live.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
  - `@zmdb/mysql` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `mysql2` → `^3.24.3`
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/singlestore`
- **External proof:** fixtures/database-singlestore

### `@zmdb/sql`

SQL-first, dialect-aware query compiler with reads, writes, joins, aggregates, full-text search, set operations, and schema-object DDL.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./comments` → `./src/comments/index.ts`
  - `./schema-objects` → `./src/schema-objects/index.ts`
  - `./set-ops` → `./src/set-ops/index.ts`
- **Dependencies:**
  - `@zmdb/schema` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/sql`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/sqlite`

Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.

- **Release unit:** `integration`
- **Support:** `supported` (evidence `packages/sqlite/src/driver.spec.ts`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./embedded` → `./src/embedded.ts`
  - `./node` → `./src/node.ts`
- **Dependencies:**
  - `@zmdb/migrations` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@zmdb/orm` → `1.0.0-beta.2`
  - `@zmdb/sql` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `@zmdb/core/sqlite`
- **External proof:** fixtures/database-sqlite

### `@zmdb/sveltekit`

Request-local SvelteKit clients, typed load helpers, explicit credential forwarding, and navigation cancellation for generated zmdb clients.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `packages/sveltekit/src/server.spec.ts`, unrun `fixtures/client-adapters/sveltekit-packed`)
- **Exports:**
  - `./client` → `./src/client.ts`
  - `./server` → `./src/server.ts`
- **Dependencies:**
  - `@zmdb/client` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:**
  - `@sveltejs/kit` → `>=2.70.3 <3.0.0`
  - `svelte` → `>=5.57.0 <6.0.0`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/client-adapters/sveltekit-packed

### `@zmdb/transport`

gRPC, Kafka, NATS, RabbitMQ, Redis, and SQS transport adapters for the protocol-neutral zmdb application messaging contract.

- **Release unit:** `integration`
- **Support:** `provisional` (evidence `fixtures/consumer-server-integrations`, unrun `fixtures/consumer-transport-kafka`, `fixtures/consumer-transport-sqs`)
- **Exports:**
  - `./grpc` → `./src/grpc/index.ts`
  - `./kafka` → `./src/kafka/index.ts`
  - `./nats` → `./src/nats/index.ts`
  - `./rabbitmq` → `./src/rabbitmq/index.ts`
  - `./redis` → `./src/redis/index.ts`
  - `./sqs` → `./src/sqs/index.ts`
- **Dependencies:**
  - `@zmdb/protobuf` → `workspace:1.0.0-beta.2`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@aws-sdk/client-sqs` → `>=3.1127.0 <4.0.0`
  - `@grpc/grpc-js` → `^1.14.4`
  - `@nats-io/transport-node` → `^3.4.0`
  - `amqplib` → `^2.0.1`
  - `kafkajs` → `>=2.2.4 <3.0.0`
  - `redis` → `^6.2.1`
- **Required peers:**
  - `@zmdb/app` → `1.0.0-beta.2`
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:** None.
- **External proof:** fixtures/consumer-server-integrations

### `@zmdb/validator`

Runtime helpers for ahead-of-time validation and JSON serialization: is/assert/validate/equals/random, unions, transforms, and generated-code errors.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
- **Exports:**
  - `.` → `./src/index.ts`
  - `./advanced` → `./src/advanced/index.ts`
  - `./errors` → `./src/errors.ts`
  - `./serialization` → `./src/serialization/index.ts`
- **Dependencies:**
  - `@zmdb/schema` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:** None.
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
- **Facade exposure:**
  - `AssertError`
  - `ValidateResult`
  - `ValidationIssue`
  - `assert`
  - `is`
  - `validate`
  - `@zmdb/core/validator`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

### `@zmdb/web`

HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.

- **Release unit:** `core`
- **Support:** `supported` (evidence `.github/scripts/verify-publish.mjs`)
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
  - `./integrations` → `./src/integrations/index.ts`
  - `./middleware` → `./src/middleware/index.ts`
  - `./openapi` → `./src/openapi/index.ts`
  - `./pipeline` → `./src/pipeline/index.ts`
  - `./routing` → `./src/routing/index.ts`
  - `./static` → `./src/static/index.ts`
  - `./testing` → `./src/testing/index.ts`
  - `./upload` → `./src/upload/index.ts`
  - `./versioning` → `./src/versioning/index.ts`
- **Dependencies:**
  - `@zmdb/app` → `workspace:^`
  - `@zmdb/schema` → `workspace:^`
  - `@zmdb/validator` → `workspace:^`
- **Optional dependencies:** None.
- **Optional peers:**
  - `@zmdb/compiler` → `1.0.0-beta.2`
  - `typescript` → `>=7.0.2 <8.0.0`
- **Required peers:** None.
- **Engines:**
  - `node` → `>=26`
- **License:** `MPL-2.0`
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
  - `@zmdb/core/web`
  - `@zmdb/core/web/app`
  - `@zmdb/core/web/compression`
  - `@zmdb/core/web/context`
  - `@zmdb/core/web/contract`
  - `@zmdb/core/web/contract/compiler`
  - `@zmdb/core/web/csrf`
  - `@zmdb/core/web/data`
  - `@zmdb/core/web/devtools`
  - `@zmdb/core/web/dto-pipes`
  - `@zmdb/core/web/gateways`
  - `@zmdb/core/web/health`
  - `@zmdb/core/web/middleware`
  - `@zmdb/core/web/openapi`
  - `@zmdb/core/web/pipeline`
  - `@zmdb/core/web/routing`
  - `@zmdb/core/web/static`
  - `@zmdb/core/web/testing`
  - `@zmdb/core/web/upload`
  - `@zmdb/core/web/versioning`
- **External proof:** yarn verify:publish packs, installs, imports, and typechecks every public export from outside the repository.

<!-- /generated: product-catalog package-reference -->

Release versions, changelog entries, npm tags, and publish order are not product catalog fields. The release model combines this catalog membership with architecture-policy edges, package manifests
and the root changelog. See the [architecture guide](./architecture.html) for the generated graph and atomic package-admission workflow; the repository's `PUBLISHING.md` carries the complete
changelog, bump, dry-run, exact-tag, and retry procedure.
