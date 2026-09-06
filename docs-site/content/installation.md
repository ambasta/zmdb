zmdb is an ESM-only TypeScript backend framework targeting Node.js 26+ and TypeScript 7.0+. Thirty-six packages are published today: thirty-five focused packages plus the `zmdb` facade. The
recommended installation combines the cohesive data, application, and HTTP product with one explicit database vertical; `@zmdb/client`, `@zmdb/react`, `@zmdb/react-native`, `@zmdb/angular`,
`@zmdb/vue`, `@zmdb/svelte`, `@zmdb/sveltekit`, `@zmdb/solid`, `@zmdb/next`, `@zmdb/nuxt`, `@zmdb/migrations`, `@zmdb/protobuf`, provider-neutral `@zmdb/ai`, its opt-in provider integrations,
`@zmdb/mcp`, `@zmdb/otel`, `@zmdb/cockroach`, `@zmdb/mssql`, `@zmdb/mysql`, `@zmdb/postgres`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, and
`@zmdb/jobs-postgres` remain independently installable.

## Recommended: product plus SQLite

```bash
npm add zmdb@alpha @zmdb/sqlite@alpha
```

```ts
import { schemaOf, defineRepository, is } from 'zmdb';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';
import type { CreateDTO, Entity } from 'zmdb/derive';
```

The `zmdb` package re-exports the curated public API of its eight required workspace dependencies, with deeper surfaces under subpaths (`zmdb/tags`, `zmdb/derive`, `zmdb/ir`, `zmdb/dto`,
`zmdb/relations`, `zmdb/migrations`, `zmdb/web`, `zmdb/drivers/pg`, …). Database selection is explicit: `@zmdb/sqlite` owns SQLite compilation traits, migrations, introspection, and its driver;
`@zmdb/postgres` owns the complete PostgreSQL vertical and structural `pg` adapter; and `@zmdb/mssql` owns the complete SQL Server vertical and structural node-mssql adapter. The temporary
`zmdb/drivers/sqlite` path delegates to SQLite, while `zmdb/drivers/pg` and `zmdb/drivers/mssql` delegate through optional database-package peers. The `zmdb/web` facade combines the protocol-neutral
`@zmdb/app` kernel with the HTTP-specific `@zmdb/web` package.

`@zmdb/ai` and `@zmdb/mcp` are independently installable and are not re-exported by the umbrella root. Anthropic, LangChain, and Vercel AI SDK users add the matching opt-in integration package and its
SDK/framework peer.

`@zmdb/ai-anthropic` is an optional integration package. It depends on `@zmdb/ai` and accepts an injected Anthropic client; it is not re-exported by the umbrella.

`@zmdb/mysql` is independently installable and is not pulled in by the umbrella. Install it with `mysql2` when the application selects MySQL; importing the package does not load the client.

`zmdb/tags` and `zmdb/derive` are **types only** — nothing there has a runtime export, so those two imports vanish entirely from your build output.

Applications that publish an HTTP API add the independently installable `@zmdb/client` runtime beside their generated module. The [Generated HTTP Client](./generated-client.html) guide shows one
contract feeding runtime routing, OpenAPI, and browser/Node client output.

Applications then add only the framework adapter that owns their UI lifecycle or request boundary. The [Client Applications](./framework-integrations.html) guide starts from that one generated client,
compares all nine official packages, and links to their framework-native lifecycle, SSR, hydration, cancellation, and testing recipes.

## Optional server integrations

`npm add zmdb@alpha` installs none of the packages or peers below. Add only the integration selected by the application:

| Capability         | Install                                                                         | Lifecycle and ownership                                                                |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Protobuf artifacts | `npm add @zmdb/protobuf@alpha`                                                  | no peer or external resource; add `@zmdb/aot-validator@alpha` as a build-time dev tool |
| Typed gRPC         | `npm add @zmdb/protobuf@alpha @zmdb/transport-grpc@alpha @grpc/grpc-js@^1.14.0` | app owns server extension; caller closes clients                                       |
| Core NATS          | `npm add @zmdb/transport-nats@alpha @nats-io/transport-node@^3.4.0`             | app starts, drains, and closes the strategy connection                                 |
| RabbitMQ           | `npm add @zmdb/transport-rabbitmq@alpha amqplib@^2.0.1`                         | app owns connection, channels, retry, and dead-letter topology                         |
| Redis Pub/Sub      | `npm add @zmdb/transport-redis@alpha redis@^6.2.1`                              | app owns publisher/subscriber clients and bounded drain                                |
| PostgreSQL jobs    | `npm add @zmdb/jobs@alpha @zmdb/jobs-postgres@alpha pg@^8.23.0`                 | caller owns and closes/releases the pool or client                                     |
| OpenTelemetry      | `npm add @zmdb/otel@alpha @opentelemetry/api@^1.9.0`                            | caller owns providers, exporters, tracers, meters, and shutdown                        |

The package owns the adapter; the peer owns the external protocol client. `@zmdb/app` owns transport-neutral messaging and observability ports, while `@zmdb/jobs` owns queue and worker behavior.
`@zmdb/aot-validator` owns TypeScript reflection and emission; `@zmdb/protobuf` owns the calls, service-artifact types, and generated wire runtime that emitted code imports.

## Prerequisites

- **Node.js** 26.0.0 or later
- **TypeScript** 7.0.0 or later
- **ESM** — your `package.json` must have `"type": "module"`

```json
{
  "type": "module",
  "dependencies": {
    "zmdb": "^1.0.0-alpha.4"
  }
}
```

## Advanced: install sub-packages individually

Prefer to depend only on the pieces you use (better tree-shaking):

```bash
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/migrations @zmdb/aot-validator @zmdb/repository @zmdb/sqlite @zmdb/app @zmdb/web
```

## Install Individual Packages

Install only what you need:

```bash
# Schema definition + type derivation
npm install @zmdb/schema-core

# Query builder (SELECT/INSERT/UPDATE/DELETE)
npm install @zmdb/query-compiler

# Schema snapshots, migration plans, runners, introspection, and declaration emission
npm install @zmdb/migrations

# AOT validation + serialization
npm install @zmdb/aot-validator

# Repository with CRUD + transactions
npm install @zmdb/repository

# Complete SQLite dialect + migrations + introspection + node:sqlite driver
npm install @zmdb/sqlite

# Complete SQL Server vertical plus the application-selected client
npm install @zmdb/mssql mssql

# Complete PostgreSQL dialect + migrations + introspection + structural pg driver
npm install @zmdb/postgres pg

# Complete MySQL vertical + consumer-selected client
npm install @zmdb/mysql mysql2

# Protocol-neutral application kernel
npm install @zmdb/app

# HTTP framework over the application kernel
npm install @zmdb/web

# Queues, workers, scheduling, and the SQLite memory backend
npm install @zmdb/jobs

# Optional PostgreSQL jobs adapter
npm install @zmdb/jobs @zmdb/jobs-postgres pg@^8.23.0

# Dependency-free generated-client runtime
npm install @zmdb/client

# React generated-client lifecycle bindings
npm install @zmdb/react react@19

# React Native AppState, connectivity, and credential-store lifecycle
npm install @zmdb/react-native react@19 react-native@0.87

# Angular dependency injection, signals, and Observable cancellation
npm install @zmdb/angular @angular/core@22 rxjs@7

# Vue plugin and lifecycle composables
npm install @zmdb/vue vue@^3.5

# Svelte context and lifecycle-aware stores
npm install @zmdb/svelte svelte@^5.57

# SvelteKit request-local server/client loads and navigation cancellation
npm install @zmdb/sveltekit @sveltejs/kit@^2.70 svelte@^5.57

# Next App Router request scopes and browser bindings
npm install @zmdb/next next@16 react@19 react-dom@19

# Solid context, resources, and owner-lifetime cancellation
npm install @zmdb/solid solid-js@1

# Nuxt module, request-scoped Nitro transport, and Vue hydration
npm install @zmdb/nuxt nuxt@^4.5 vue@^3.5

# Dependency-free protobuf and typed gRPC artifacts
npm install @zmdb/protobuf

# Typed gRPC server and client adapter
npm install @zmdb/protobuf @zmdb/transport-grpc @grpc/grpc-js@^1.14.0

# Core NATS transport strategy
npm install @zmdb/transport-nats @nats-io/transport-node@^3.4.0

# RabbitMQ transport strategy
npm install @zmdb/transport-rabbitmq amqplib@^2.0.1

# Redis Pub/Sub transport strategy
npm install @zmdb/transport-redis redis@^6.2.1

# Provider-neutral AI tools + bounded chat
npm install @zmdb/ai

# Optional Anthropic chat driver
npm install @zmdb/ai-anthropic @anthropic-ai/sdk@0.124.0

# LangChain structured-tool integration
npm install @zmdb/ai @zmdb/ai-langchain @langchain/core@^1.2.9

# Vercel AI SDK tool adapter
npm install @zmdb/ai @zmdb/ai-vercel ai@^7.0.93

# Transport-neutral MCP client/server core
npm install @zmdb/ai @zmdb/mcp

# OpenTelemetry API adapter
npm install @zmdb/otel @opentelemetry/api@^1.9.0
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

```ts
// vite.config.ts / rollup / esbuild / webpack — unplugin, so one factory for all
import { zmdbAot } from '@zmdb/aot-validator/unplugin';

export default {
  plugins: [zmdbAot({ project: new URL('./tsconfig.json', import.meta.url).pathname })],
};
```

> [!IMPORTANT] Without `project` (or an already-open `session`) the plugin cannot ask the checker what a type is, so it leaves every `f<T>(…)` call alone — and an untransformed `schemaOf<T>()` throws
> when called. A refused call site is a build error by default, not a silent fallback. See [AOT Setup](./aot-setup.html).

For a project that only needs the query compiler, there is no build step at all — see [Pure TypeScript](./pure-typescript.html).

## Verify Installation

The query compiler is plain runtime code, so it verifies the install without the transformer in the way:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';
import { sqlite } from '@zmdb/sqlite';

const q = createQueryCompiler(sqlite).selectFrom('users').select(['id']).compile();
console.log(q.text); // SELECT "id" FROM "users"
```

Then verify the transformer is wired, which is the part that actually goes wrong:

```ts
import { schemaOf } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

const userSchema = schemaOf<User>();
console.log(userSchema.table); // 'users'
console.log(userSchema.columns.email.type); // 'text'
```

If that throws instead of printing, the plugin is not running over this file.

## Package Overview

| Package                    | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `@zmdb/schema-core`        | The tag vocabulary, the IR, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI   |
| `@zmdb/query-compiler`     | SELECT/INSERT/UPDATE/DELETE, dialect protocols, JOINs, aggregations, FTS, schema-object DDL    |
| `@zmdb/migrations`         | Snapshots, diffs, DDL plans, files, runners, introspection, and declaration emission           |
| `@zmdb/aot-validator`      | Type reflection, full/shallow is/assert/validate, equals/random, serialization                 |
| `@zmdb/repository`         | Auto-validating CRUD, hooks, transactions, populate                                            |
| `@zmdb/mssql`              | T-SQL compilation, migrations, structural driver, introspection, and capability refusals       |
| `@zmdb/postgres`           | PostgreSQL compiler traits, migrations, introspection, structural `pg` driver, and cursors     |
| `@zmdb/sqlite`             | SQLite compiler traits, migrations, introspection, embedded runner, and `node:sqlite` driver   |
| `@zmdb/mysql`              | MySQL compilation, migrations, introspection, and structural mysql2 driver                     |
| `@zmdb/app`                | Metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health      |
| `@zmdb/web`                | HTTP controllers, routing, middleware, OpenAPI, gateways, testing, and runtime adapters        |
| `@zmdb/jobs`               | Typed queues, workers, dead letters, scheduling, leases, and SQLite memory storage             |
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
