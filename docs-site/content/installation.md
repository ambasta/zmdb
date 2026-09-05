zmdb is an ESM-only TypeScript backend framework targeting Node.js 26+ and TypeScript 7.0+. Twenty-three packages are published today: twenty-two focused packages plus the `zmdb` facade. The
recommended installation combines the cohesive data, application, and HTTP product with one explicit database vertical; `@zmdb/client`, `@zmdb/protobuf`, provider-neutral `@zmdb/ai`, its opt-in
provider integrations, `@zmdb/mcp`, `@zmdb/otel`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, and `@zmdb/jobs-postgres` remain independently
installable.

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

The `zmdb` package re-exports the curated public API of its six runtime dependencies, with deeper surfaces under subpaths (`zmdb/tags`, `zmdb/derive`, `zmdb/ir`, `zmdb/dto`, `zmdb/relations`,
`zmdb/web`, `zmdb/drivers/pg`, …). Database selection is explicit: `@zmdb/sqlite` owns SQLite compilation traits, migrations, introspection, and the driver. The temporary `zmdb/drivers/sqlite`
compatibility path delegates to that package during the database-package cutover. The `zmdb/web` facade combines the protocol-neutral `@zmdb/app` kernel with the HTTP-specific `@zmdb/web` package.

`@zmdb/ai` and `@zmdb/mcp` are independently installable and are not re-exported by the umbrella root. Anthropic, LangChain, and Vercel AI SDK users add the matching opt-in integration package and its
SDK/framework peer.

`@zmdb/ai-anthropic` is an optional integration package. It depends on `@zmdb/ai` and accepts an injected Anthropic client; it is not re-exported by the umbrella.

`zmdb/tags` and `zmdb/derive` are **types only** — nothing there has a runtime export, so those two imports vanish entirely from your build output.

Applications that publish an HTTP API add the independently installable `@zmdb/client` runtime beside their generated module. The [Generated HTTP Client](./generated-client.html) guide shows one
contract feeding runtime routing, OpenAPI, and browser/Node client output.

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
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository @zmdb/sqlite @zmdb/app @zmdb/web
```

## Install Individual Packages

Install only what you need:

```bash
# Schema definition + type derivation
npm install @zmdb/schema-core

# Query builder (SELECT/INSERT/UPDATE/DELETE)
npm install @zmdb/query-compiler

# AOT validation + serialization
npm install @zmdb/aot-validator

# Repository with CRUD + transactions
npm install @zmdb/repository

# Complete SQLite dialect + migrations + introspection + node:sqlite driver
npm install @zmdb/sqlite

# Protocol-neutral application kernel
npm install @zmdb/app

# HTTP framework over the application kernel
npm install @zmdb/web

# Queues, workers, scheduling, and the SQLite memory backend
npm install @zmdb/jobs

# Optional PostgreSQL jobs adapter
npm install @zmdb/jobs-postgres pg

# Dependency-free generated-client runtime
npm install @zmdb/client

# Dependency-free protobuf and typed gRPC artifacts
npm install @zmdb/protobuf

# Typed gRPC server and client adapter
npm install @zmdb/transport-grpc @grpc/grpc-js

# Core NATS transport strategy
npm install @zmdb/transport-nats @nats-io/transport-node

# RabbitMQ transport strategy
npm install @zmdb/transport-rabbitmq amqplib

# Redis Pub/Sub transport strategy
npm install @zmdb/transport-redis redis

# Provider-neutral AI tools + bounded chat
npm install @zmdb/ai

# Optional Anthropic chat driver
npm install @zmdb/ai-anthropic @anthropic-ai/sdk@0.123.0

# LangChain structured-tool integration
npm install @zmdb/ai @zmdb/ai-langchain @langchain/core@^1.2.9

# Vercel AI SDK tool adapter
npm install @zmdb/ai @zmdb/ai-vercel ai@^7.0.83

# Transport-neutral MCP client/server core
npm install @zmdb/ai @zmdb/mcp

# OpenTelemetry API adapter
npm install @zmdb/otel @opentelemetry/api
```

> [!NOTE] Workspace packages declare their direct `@zmdb/*` runtime dependencies. Provider and framework SDKs remain opt-in at their integration boundaries.

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

| Package                    | Purpose                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `@zmdb/schema-core`        | The tag vocabulary, the IR, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI |
| `@zmdb/query-compiler`     | SELECT/INSERT/UPDATE/DELETE, dialects, JOINs, aggregations, FTS, migrations                  |
| `@zmdb/aot-validator`      | Type reflection, full/shallow is/assert/validate, equals/random, serialization               |
| `@zmdb/repository`         | Auto-validating CRUD, hooks, transactions, populate                                          |
| `@zmdb/sqlite`             | SQLite compiler traits, migrations, introspection, embedded runner, and `node:sqlite` driver |
| `@zmdb/app`                | Metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health    |
| `@zmdb/web`                | HTTP controllers, routing, middleware, OpenAPI, gateways, testing, and runtime adapters      |
| `@zmdb/jobs`               | Typed queues, workers, dead letters, scheduling, leases, and SQLite memory storage           |
| `@zmdb/jobs-postgres`      | PostgreSQL `JobStore` adapter for caller-owned pools and clients                             |
| `@zmdb/client`             | Dependency-free HTTP transport, cancellation, authentication, and typed errors               |
| `@zmdb/protobuf`           | Dependency-free protobuf calls, generated-code wire ABI, and typed gRPC artifacts            |
| `@zmdb/transport-grpc`     | Typed gRPC servers, clients, streaming, deadlines, metadata, and bounded lifecycle           |
| `@zmdb/transport-nats`     | Core NATS wildcard, queue-group, event, and request/reply transport strategy                 |
| `@zmdb/transport-rabbitmq` | RabbitMQ prefetch, confirmed retries, request/reply, and owned dead-letter topology          |
| `@zmdb/transport-redis`    | Redis Pub/Sub event and request/reply transport strategy                                     |
| `@zmdb/ai`                 | Provider-neutral tool documents, bounded chat, shared invocation, and OpenAPI-derived tools  |
| `@zmdb/ai-anthropic`       | Optional Anthropic Messages API driver over `@zmdb/ai/chat`                                  |
| `@zmdb/ai-langchain`       | Optional LangChain structured-tool adapter with an `@langchain/core@^1.2.9` peer             |
| `@zmdb/ai-vercel`          | Optional Vercel AI SDK tool adapter with caller-owned schema branding                        |
| `@zmdb/mcp`                | Pure MCP client/server protocol core, authenticated identity, validation, and call budgets   |
| `@zmdb/otel`               | OpenTelemetry API adaptation for caller-owned tracers and meters                             |

## Next Steps

- [Quick Start](./quick-start.html) — declare your first table
- [Schema Declaration](./schema-declaration.html) — how a type becomes a table
- [Tag Reference](./tags-reference.html) — the full tag vocabulary
- [AOT Setup](./aot-setup.html) — configure the transformer
- [Pure TypeScript](./pure-typescript.html) — what works with no build step
- [Generated HTTP Client](./generated-client.html) — emit OpenAPI and a typed client from one HTTP contract
