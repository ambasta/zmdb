zmdb is a TypeScript data layer that eliminates schema-drift maintenance. You **declare your table as a type** and every derived artifact — entity types, create/update DTOs, runtime validation, JSON serialization, OpenAPI, DDL, and repository CRUD — is produced from that single source of truth, at **compile time**.

## The core idea

Other tools make you write your types more than once: a TypeScript type, plus a schema, plus decorators, plus DTOs. Every one of those is a place for drift. zmdb removes the schema object entirely — the interface **is** the schema, and the build step reads it.

```ts
import type { HasDefault, Pattern, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

That is the whole declaration. There is no runtime object, no import that survives to the
bundle, and nothing to construct — the tags are phantom symbol slots that erase, and `role`
is a plain union because TypeScript already has a way to say "one of these". Where the
database needs to know something TypeScript cannot say, like `integer` versus `numeric`, a
tag says it; everywhere else the type is the answer. See
[Schema Declaration](./schema-declaration.html) and the [Tag Reference](./tags-reference.html).

## What makes it different

- **No proxies, no identity map, no change tracking.** Rows you read back are plain, inert objects. Writes are explicit (`create`/`update`/`delete`). This is where the zero-overhead guarantee comes from — see [Why fetched rows are inert](./inert-rows.html).
- **AOT validation & serialization.** `validate`, `assert`, `stringify` compile to straight-line JavaScript at build time, not a runtime parser. See [AOT setup](./aot-setup.html).
- **SQL-first query builder** with real JOINs, aggregations and full-text search — plus a typed repository on top.

## Where to go next

- [Installation](./installation.html) and [AOT setup](./aot-setup.html)
- [Schema declaration](./schema-declaration.html) → [Tag reference](./tags-reference.html) → [Type derivation](./type-derivation.html)
- Coming from the builder DSL? [The codemod](./codemod.html) converts a `defineSchema` project.
- [CRUD](./crud.html) and the [Repository](./repository.html)
- [Benchmarks](../benchmarks/index.html)
