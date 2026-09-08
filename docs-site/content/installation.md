zmdb is an ESM-only TypeScript backend framework targeting Node.js 26+ and TypeScript 7+. Install `zmdb` for schema, validation, ORM, migrations, configuration, CLI, application lifecycle and HTTP,
with SQLite included. Add jobs, other database providers and protocol integrations only when the application selects them. The [server journey](./web-overview.html) demonstrates these choices in one
application; the [package reference](./package-reference.html) lists the independently usable owners.

## Recommended: one product install

```bash
yarn add zmdb@1.0.0-beta.1
```

```ts {"mode":"compile","id":"example-001"}
import { defineRepository, is, schemaOf, type CreateDTO, type Entity, type PrimaryKey, type Serial, type Sql, type Table } from 'zmdb';
import { sqliteDriver } from 'zmdb/sqlite';
```

The `zmdb` package re-exports the curated public API of its required workspace dependencies, with complete concerns under `zmdb/schema`, `zmdb/sql`, `zmdb/validator`, `zmdb/orm`, `zmdb/web`,
`zmdb/compiler`, `zmdb/migrations`, and `zmdb/testing`. SQLite is included by default and exposed through `zmdb/sqlite`. Each database package owns its compiler traits, migrations, introspection and
structural driver. The `zmdb/postgres`, `zmdb/mysql`, `zmdb/mssql`, `zmdb/cockroach` and `zmdb/singlestore` facades resolve when their optional database package is installed. The `zmdb/web` facade
combines the protocol-neutral `@zmdb/app` kernel with the HTTP-specific `@zmdb/web` package.

The focused `zmdb/tags`, `zmdb/derive`, `zmdb/ir`, `zmdb/dto`, and `zmdb/relations` entries expose their documented concerns. Type-only imports from either the root or those paths disappear from
emitted JavaScript.

`@zmdb/mysql` is independently installable and is not pulled in by the default product. Install it with `mysql2` when the application selects MySQL; importing the package does not load the client.

`zmdb/tags` and `zmdb/derive` are **types only** — nothing there has a runtime export, so those two imports vanish entirely from your build output.

Applications that publish an HTTP API add the independently installable `@zmdb/client` runtime beside their generated module. The [Generated HTTP Client](./generated-client.html) guide shows one
contract feeding runtime routing, OpenAPI, and browser/Node client output.

Applications then add only the framework adapter that owns their UI lifecycle or request boundary. The [Client Applications](./framework-integrations.html) guide starts from that one generated client,
compares all nine official packages, and links to their framework-native lifecycle, SSR, hydration, cancellation, and testing recipes.

## Optional server integrations

`yarn add zmdb@1.0.0-beta.1` installs none of the packages or peers below. Add only the integration selected by the application:

| Capability         | Install                                                                                        | Lifecycle and ownership                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Protobuf artifacts | `yarn add @zmdb/protobuf@1.0.0-beta.1 && yarn add --dev @zmdb/compiler@1.0.0-beta.1`           | no runtime peer or external resource; compiler emits the artifacts               |
| Typed gRPC         | `yarn add @zmdb/protobuf@1.0.0-beta.1 @zmdb/transport-grpc@1.0.0-beta.1 @grpc/grpc-js@^1.14.4` | app owns server extension; caller closes clients                                 |
| Core NATS          | `yarn add @zmdb/transport-nats@1.0.0-beta.1 @nats-io/transport-node@^3.4.0`                    | app starts, drains, and closes the strategy connection                           |
| RabbitMQ           | `yarn add @zmdb/transport-rabbitmq@1.0.0-beta.1 amqplib@^2.0.1`                                | app owns connection, channels, retry, and dead-letter topology                   |
| Redis Pub/Sub      | `yarn add @zmdb/transport-redis@1.0.0-beta.1 redis@^6.2.1`                                     | app owns publisher/subscriber clients and bounded drain                          |
| Background jobs    | `yarn add @zmdb/jobs@1.0.0-beta.1`                                                             | app starts and drains explicit workers/schedulers through `jobsExtension`        |
| SQLite jobs        | `yarn add @zmdb/jobs@1.0.0-beta.1 @zmdb/jobs-sqlite@1.0.0-beta.1`                              | explicit persistent stores borrow a database; memory stores own and close theirs |
| PostgreSQL jobs    | `yarn add @zmdb/jobs@1.0.0-beta.1 @zmdb/jobs-postgres@1.0.0-beta.1 pg@^8.23.0`                 | caller owns and closes/releases the pool or client                               |
| OpenTelemetry      | `yarn add @zmdb/otel@1.0.0-beta.1 @opentelemetry/api@^1.9.0`                                   | caller owns providers, exporters, tracers, meters, and shutdown                  |

The package owns the adapter; the peer owns the external protocol client. `@zmdb/app` owns transport-neutral messaging and observability ports, while `@zmdb/jobs` owns queue and worker behavior.
`@zmdb/compiler` owns TypeScript reflection and emission; `@zmdb/protobuf` owns the calls, service-artifact types, and generated wire runtime that emitted code imports.

Alpha migration: replace any branch-only or pre-release `zmdb/jobs` import with `@zmdb/jobs`, and replace `zmdb/jobs/schedule` with `@zmdb/jobs/schedule`. The default product does not ship a
compatibility facade or automatically install jobs.

## Prerequisites

- **Node.js** 26.0.0 or later
- **TypeScript** 7.0.2 or later
- **ESM** — your `package.json` must have `"type": "module"`

```json
{
  "type": "module",
  "dependencies": {
    "zmdb": "^1.0.0-beta.1"
  }
}
```

## Advanced: install sub-packages individually

Choose runtime dependencies separately from the build tools. For example, a standalone SQLite data layer can use:

```bash
yarn add @zmdb/schema@1.0.0-beta.1 @zmdb/sql@1.0.0-beta.1 @zmdb/validator@1.0.0-beta.1 @zmdb/orm@1.0.0-beta.1 @zmdb/sqlite@1.0.0-beta.1
yarn add --dev @zmdb/compiler@1.0.0-beta.1 typescript@^7.0.2
```

Install `@zmdb/cli@1.0.0-beta.1` with TypeScript instead when you want the single `zmdb` command; it includes the compiler and migrations engines. Install `@zmdb/migrations@1.0.0-beta.1` directly when
code owns the snapshot, plan or runner workflow. The [tooling guide](./tooling-boundaries.html) explains config ownership, optional adapter peers and which entries belong in generated runtime code.

## Install Individual Packages

Install only what you need:

```bash
# Schema definition + type derivation
yarn add @zmdb/schema

# Query builder (SELECT/INSERT/UPDATE/DELETE)
yarn add @zmdb/sql

# Schema snapshots, migration plans, runners, introspection, and declaration emission
yarn add @zmdb/migrations@1.0.0-beta.1

# Runtime validation + serialization
yarn add @zmdb/validator

# TypeScript reflection, AOT emission, build adapters, and lint rules
yarn add --dev @zmdb/compiler@1.0.0-beta.1 typescript@^7.0.2

# The single zmdb executable for codegen, migrations and application commands
yarn add --dev @zmdb/cli@1.0.0-beta.1 typescript@^7.0.2

# Repository with CRUD + transactions
yarn add @zmdb/orm

# Complete SQLite dialect + migrations + introspection + node:sqlite driver
yarn add @zmdb/sqlite

# Complete SQL Server vertical plus the application-selected client
yarn add @zmdb/mssql mssql

# Complete PostgreSQL dialect + migrations + introspection + structural pg driver
yarn add @zmdb/postgres pg

# Complete MySQL vertical + consumer-selected client
yarn add @zmdb/mysql mysql2

# Protocol-neutral application kernel
yarn add @zmdb/app

# HTTP framework over the application kernel
yarn add @zmdb/web

# Portable queues, workers, and scheduling with explicit storage providers
yarn add @zmdb/jobs

# SQLite persistence or an owned memory store
yarn add @zmdb/jobs @zmdb/jobs-sqlite

# Optional PostgreSQL jobs adapter
yarn add @zmdb/jobs @zmdb/jobs-postgres pg@^8.23.0

# Dependency-free generated-client runtime
yarn add @zmdb/client

# React generated-client lifecycle bindings
yarn add @zmdb/react react@19

# React Native AppState, connectivity, and credential-store lifecycle
yarn add @zmdb/react-native react@19 react-native@0.87

# Angular dependency injection, signals, and Observable cancellation
yarn add @zmdb/angular @angular/core@22 rxjs@7

# Vue plugin and lifecycle composables
yarn add @zmdb/vue vue@^3.5

# Svelte context and lifecycle-aware stores
yarn add @zmdb/svelte svelte@^5.57

# SvelteKit request-local server/client loads and navigation cancellation
yarn add @zmdb/sveltekit @sveltejs/kit@^2.70 svelte@^5.57

# Next App Router request scopes and browser bindings
yarn add @zmdb/next next@16 react@19 react-dom@19

# Solid context, resources, and owner-lifetime cancellation
yarn add @zmdb/solid solid-js@1

# Nuxt module, request-scoped Nitro transport, and Vue hydration
yarn add @zmdb/nuxt nuxt@^4.5 vue@^3.5

# Dependency-free protobuf and typed gRPC artifacts
yarn add @zmdb/protobuf

# Typed gRPC server and client adapter
yarn add @zmdb/protobuf @zmdb/transport-grpc @grpc/grpc-js@^1.14.0

# Core NATS transport strategy
yarn add @zmdb/transport-nats @nats-io/transport-node@^3.4.0

# RabbitMQ transport strategy
yarn add @zmdb/transport-rabbitmq amqplib@^2.0.1

# Redis Pub/Sub transport strategy
yarn add @zmdb/transport-redis redis@^6.2.1

# Provider-neutral AI tools + bounded chat
yarn add @zmdb/ai

# Optional Anthropic chat driver
yarn add @zmdb/ai-anthropic @anthropic-ai/sdk@0.124.0

# LangChain structured-tool integration
yarn add @zmdb/ai @zmdb/ai-langchain @langchain/core@^1.2.9

# Vercel AI SDK tool adapter
yarn add @zmdb/ai @zmdb/ai-vercel ai@^7.0.93

# Transport-neutral MCP client/server core
yarn add @zmdb/ai @zmdb/mcp

# OpenTelemetry API adapter
yarn add @zmdb/otel @opentelemetry/api@^1.9.0
```

> [!NOTE] Workspace packages declare their direct `@zmdb/*` runtime dependencies. Provider, framework, broker, database-client, and telemetry peers remain opt-in at their integration boundaries.

## TypeScript Configuration

Ensure your `tsconfig.json` targets modern features:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

## The build step

zmdb declares tables as **types**, and a type does not exist at runtime. The transformer is what closes that gap: it reads the declaration from the type checker and replaces each `schemaOf<T>()`,
`assert<T>()`, `is<T>()`, `validate<T>()`, `equals<T>()`, `assertEquals<T>()`, `random<T>()` and `toJsonSchema<T>()` call with the reflected result.

```ts {"mode":"compile","id":"example-002"}
// vite.config.ts / rollup / esbuild / webpack — one factory for all
import { zmdbAot } from 'zmdb/compiler';

const plugin = await zmdbAot({ project: new URL('./tsconfig.json', import.meta.url).pathname });
export default {
  plugins: [plugin],
};
```

`zmdb/compiler` discovers `zmdb.config.ts` when `project` is omitted. If neither config nor an explicit project or session is available, the plugin cannot ask the checker what a type is, so it leaves
every `f<T>(…)` call alone — and an untransformed `schemaOf<T>()` throws when called. A refused call site is a build error by default, not a silent fallback. See [AOT Setup](./aot-setup.html).

For a project that only needs the query compiler, there is no build step at all — see [Pure TypeScript](./pure-typescript.html).

## Verify Installation

The query compiler is plain runtime code, so it verifies the install without the transformer in the way:

```ts {"mode":"compile","id":"example-003"}
import { createQueryCompiler } from 'zmdb/sql';
import { sqlite } from 'zmdb/sqlite';

const q = createQueryCompiler(sqlite).selectFrom('users').select(['id']).compile();
console.log(q.text); // SELECT "id" FROM "users"
```

Then verify the transformer is wired, which is the part that actually goes wrong:

```ts {"mode":"compile","id":"example-004"}
import { schemaOf, type PrimaryKey, type Serial, type Sql, type Table } from 'zmdb';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

const userSchema = schemaOf<User>();
console.log(userSchema.table); // 'users'
const emailColumn = userSchema.columns.email;
if (emailColumn === undefined) throw new Error('The generated User schema must contain email');
console.log(emailColumn.type); // 'text'
```

If that throws instead of printing, the plugin is not running over this file.

## Package Overview

| Package                    | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `@zmdb/schema`             | The tag vocabulary, the IR, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI   |
| `@zmdb/sql`                | SELECT/INSERT/UPDATE/DELETE, dialect protocols, JOINs, aggregations, FTS, schema-object DDL    |
| `@zmdb/migrations`         | Snapshots, diffs, DDL plans, files, runners, introspection, and declaration emission           |
| `@zmdb/validator`          | Runtime full/shallow is/assert/validate, equals/random, errors, and serialization              |
| `@zmdb/compiler`           | TypeScript reflection, AOT emission, project compilation, build adapters, and lint rules       |
| `@zmdb/cli`                | The single zmdb executable, project commands, scaffolding, inspection and CLI library APIs     |
| `@zmdb/orm`                | Auto-validating CRUD, hooks, transactions, populate                                            |
| `@zmdb/mssql`              | T-SQL compilation, migrations, structural driver, introspection, and capability refusals       |
| `@zmdb/postgres`           | PostgreSQL compiler traits, migrations, introspection, structural `pg` driver, and cursors     |
| `@zmdb/sqlite`             | SQLite compiler traits, migrations, introspection, embedded runner, and `node:sqlite` driver   |
| `@zmdb/mysql`              | MySQL compilation, migrations, introspection, and structural mysql2 driver                     |
| `@zmdb/app`                | Metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health      |
| `@zmdb/web`                | HTTP controllers, routing, middleware, OpenAPI, gateways, testing, and runtime adapters        |
| `@zmdb/jobs`               | Typed queues, workers, dead letters, scheduling, leases, and explicit storage-provider ports   |
| `@zmdb/jobs-sqlite`        | SQLite persistence and owned memory stores for portable jobs                                   |
| `@zmdb/jobs-postgres`      | PostgreSQL `JobStore` adapter for caller-owned pools and clients                               |
| `@zmdb/client`             | Dependency-free HTTP transport, cancellation, authentication, and typed errors                 |
| `@zmdb/react`              | React context, query, mutation, and component-lifecycle cancellation                           |
| `@zmdb/angular`            | Angular DI, signals, `DestroyRef`, and Observable cancellation                                 |
| `@zmdb/vue`                | Vue plugin, reactive query/mutation state, and effect-scope cancellation                       |
| `@zmdb/svelte`             | Svelte context plus subscription-aware query and mutation stores                               |
| `@zmdb/sveltekit`          | Request-local server/client loads, explicit credential forwarding, and navigation cancellation |
| `@zmdb/next`               | Next.js App Router request clients and React browser bindings                                  |
| `@zmdb/solid`              | Solid context, native resources, owner cancellation, and Suspense/error propagation            |
| `@zmdb/protobuf`           | Dependency-free protobuf calls, generated-code wire ABI, and typed gRPC artifacts              |
| `@zmdb/transport-grpc`     | Typed gRPC servers, clients, streaming, deadlines, metadata, and bounded lifecycle             |
| `@zmdb/transport-nats`     | Core NATS wildcard, queue-group, event, and request/reply transport strategy                   |
| `@zmdb/transport-rabbitmq` | RabbitMQ prefetch, confirmed retries, request/reply, and owned dead-letter topology            |
| `@zmdb/transport-redis`    | Redis Pub/Sub subscriptions, correlated request/reply, cancellation, and bounded shutdown      |
| `@zmdb/ai`                 | Provider-neutral tool documents, bounded chat, shared invocation, and OpenAPI-derived tools    |
| `@zmdb/ai-anthropic`       | Optional Anthropic Messages API driver over `@zmdb/ai/chat`                                    |
| `@zmdb/ai-langchain`       | Optional LangChain structured-tool adapter with an `@langchain/core@^1.2.9` peer               |
| `@zmdb/ai-vercel`          | Optional Vercel AI SDK tool adapter with caller-owned schema branding                          |
| `@zmdb/mcp`                | Pure MCP client/server protocol core, authenticated identity, validation, and call budgets     |
| `@zmdb/otel`               | OpenTelemetry API adaptation for caller-owned tracers and meters                               |

## Next Steps

- [Quick Start](./quick-start.html) — declare your first table
- [Schema Declaration](./schema-declaration.html) — how a type becomes a table
- [Tag Reference](./tags-reference.html) — the full tag vocabulary
- [AOT Setup](./aot-setup.html) — configure the transformer
- [Pure TypeScript](./pure-typescript.html) — what works with no build step
- [Generated HTTP Client](./generated-client.html) — emit OpenAPI and a typed client from one HTTP contract
- [Client Applications](./framework-integrations.html) — use that one client through React, Angular, Vue, Svelte, Solid, React Native, Next.js, Nuxt, or SvelteKit
