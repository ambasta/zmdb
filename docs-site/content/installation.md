zmdb is an ESM-only TypeScript data layer framework targeting Node.js 26+ and TypeScript 7.0+. The easiest way to install is the single umbrella package; the four sub-packages are also published individually for advanced/tree-shaken use.

## Recommended: one install

```bash
npm add zmdb@alpha
```

```ts
// everything from one import
import { defineSchema, serial, text, defineRepository, is } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
```

The `zmdb` package re-exports the curated public API of all four sub-packages,
with deeper surfaces under subpaths (`zmdb/dto`, `zmdb/relations`,
`zmdb/drivers/sqlite`, `zmdb/drivers/pg`, …).

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
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository
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
```

> [!NOTE]
> `@zmdb/query-compiler` is a required peer dependency of `@zmdb/repository`.

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

## Verify Installation

```ts
import { defineSchema, serial, text } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

console.log(UserSchema.table); // 'users'
console.log(UserSchema.columns.email.type); // 'text'
```

## Package Overview

| Package                | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `@zmdb/schema-core`    | DSL builders, type derivation (Entity/CreateDTO/UpdateDTO), relations, OpenAPI |
| `@zmdb/query-compiler` | SELECT/INSERT/UPDATE/DELETE, dialects, JOINs, aggregations, FTS, migrations    |
| `@zmdb/aot-validator`  | AOT inlining + is/assert/validate/equals, unions, transforms, serialization    |
| `@zmdb/repository`     | Auto-validating CRUD, hooks, transactions, populate                            |

## Next Steps

- [Quick Start](./quick-start.html) — define your first schema
- [AOT Setup](./aot-setup.html) — configure build-time validation inlining
- [Pure TypeScript](./pure-typescript.html) — runtime-only validation without AOT
