zmdb is an ESM-only TypeScript backend framework targeting Node.js 26+ and TypeScript 7.0+. Eleven packages are published today: ten focused packages plus the `zmdb` umbrella. The easiest way to
install the cohesive data, application, and HTTP stack is the umbrella; `@zmdb/client`, `@zmdb/protobuf`, provider-neutral `@zmdb/ai`, and opt-in provider integrations remain independently
installable.

## Recommended: one install

```bash
npm add zmdb@alpha
```

```ts
// everything from one import
import { schemaOf, defineRepository, is } from 'zmdb';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';
import type { CreateDTO, Entity } from 'zmdb/derive';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
```

The `zmdb` package re-exports the curated public API of its six runtime dependencies, with deeper surfaces under subpaths (`zmdb/tags`, `zmdb/derive`, `zmdb/ir`, `zmdb/dto`, `zmdb/relations`,
`zmdb/web`, `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, …). The `zmdb/web` facade combines the protocol-neutral `@zmdb/app` kernel with the HTTP-specific `@zmdb/web` package.

`@zmdb/ai` is independently installable and is not re-exported by the umbrella root.

`@zmdb/ai-anthropic` is an optional integration package. It depends on `@zmdb/ai` and accepts an injected Anthropic client; it is not re-exported by the umbrella.

`zmdb/tags` and `zmdb/derive` are **types only** — nothing there has a runtime export, so those two imports vanish entirely from your build output.

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
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository @zmdb/app @zmdb/web
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

# Protocol-neutral application kernel
npm install @zmdb/app

# HTTP framework over the application kernel
npm install @zmdb/web

# Dependency-free generated-client runtime
npm install @zmdb/client

# Dependency-free protobuf and typed gRPC artifacts
npm install @zmdb/protobuf

# Provider-neutral AI tools + bounded chat
npm install @zmdb/ai

# Optional Anthropic chat driver
npm install @zmdb/ai-anthropic @anthropic-ai/sdk@0.123.0
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

const q = createQueryCompiler('sqlite').selectFrom('users').select(['id']).compile();
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

| Package                | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `@zmdb/schema-core`    | The tag vocabulary, the IR, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI |
| `@zmdb/query-compiler` | SELECT/INSERT/UPDATE/DELETE, dialects, JOINs, aggregations, FTS, migrations                  |
| `@zmdb/aot-validator`  | Type reflection, full/shallow is/assert/validate, equals/random, serialization               |
| `@zmdb/repository`     | Auto-validating CRUD, hooks, transactions, populate                                          |
| `@zmdb/app`            | Metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, health    |
| `@zmdb/web`            | HTTP controllers, routing, middleware, OpenAPI, gateways, testing, and runtime adapters      |
| `@zmdb/client`         | Dependency-free HTTP transport, cancellation, authentication, and typed errors               |
| `@zmdb/protobuf`       | Dependency-free protobuf calls, generated-code wire ABI, and typed gRPC artifacts            |
| `@zmdb/ai`             | Provider-neutral tool documents, bounded chat, shared invocation, and OpenAPI-derived tools  |
| `@zmdb/ai-anthropic`   | Optional Anthropic Messages API driver over `@zmdb/ai/chat`                                  |

## Next Steps

- [Quick Start](./quick-start.html) — declare your first table
- [Schema Declaration](./schema-declaration.html) — how a type becomes a table
- [Tag Reference](./tags-reference.html) — the full tag vocabulary
- [AOT Setup](./aot-setup.html) — configure the transformer
- [Pure TypeScript](./pure-typescript.html) — what works with no build step
