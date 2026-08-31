zmdb is a TypeScript data layer that eliminates schema-drift maintenance. You **define your schema once** and every derived artifact — entity types, create/update DTOs, runtime validation, JSON serialization, OpenAPI, and repository CRUD — is produced from that single source of truth, at **compile time**.

## The core idea

Other tools make you write your types more than once: a TypeScript type, plus a schema, plus decorators, plus DTOs. Every one of those is a place for drift. zmdb reads the schema you already wrote and derives the rest.

```ts
import { defineSchema, serial, text, jsonEnum, timestamp } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$')),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});
```

## What makes it different

- **No proxies, no identity map, no change tracking.** Rows you read back are plain, inert objects. Writes are explicit (`create`/`update`/`delete`). This is where the zero-overhead guarantee comes from — see [Why fetched rows are inert](./inert-rows.html).
- **AOT validation & serialization.** `validate`, `assert`, `stringify` compile to straight-line JavaScript at build time, not a runtime parser. See [AOT setup](./aot-setup.html).
- **SQL-first query builder** with real JOINs, aggregations and full-text search — plus a typed repository on top.

## Where to go next

- [Installation](./installation.html) and [AOT setup](./aot-setup.html)
- [Schema declaration](./schema-declaration.html) → [Type derivation](./type-derivation.html)
- [CRUD](./crud.html) and the [Repository](./repository.html)
- [Benchmarks](../benchmarks/index.html)
