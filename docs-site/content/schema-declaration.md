A table is a TypeScript type. You declare it once, as an interface, and everything else — the row type, the create and update DTOs, the DDL, the validator, the JSON Schema document — is derived from
that one declaration.

<!-- snippet: schema-declaration.ts#snippet-1 -->

That is the whole column declaration. There is no second property map to keep in sync with it. `Unique` is carried into the IR, but the root dialects still need an explicit standalone unique index in
a schema-object migration; see [Indexes & Constraints](./indexes-constraints.html).

> [!IMPORTANT] This replaced a builder DSL — `defineSchema('users', { id: serial().primaryKey() })` — which no longer exists. If you have a codebase full of those calls, the [codemod](./codemod.html)
> converts them, and it tells you about anything it could not read rather than guessing.

## How to read a column

Each property is its **app type** intersected with **tags**. The app type is what your handler code sees; the tags say the things TypeScript has no syntax for.

<!-- snippet: schema-declaration.ts#snippet-2 -->

A tag is a phantom `unique symbol` property. It exists only in the type system: it erases completely, so a tagged type is the same value at runtime as the untagged one, and `number & Sql<'integer'>`
is assignable to `number` in both directions. You can pass a row's `id` to anything that wants a `number`.

Two facts have no tag, on purpose:

| Fact           | How you say it  | Why not a tag                                                       |
| -------------- | --------------- | ------------------------------------------------------------------- |
| Nullability    | `\| null`       | TypeScript already has a way to say this, and it models it better   |
| An enum column | a literal union | `'admin' \| 'user'` is checked everywhere; a `string[]` flag is not |

> [!WARNING] Write nullability as `(T & Tags) | null` — tags inside, `| null` outside. The other order is a trap with a mechanism behind it: TypeScript normalises `(T | null) & Unique` into
> `(T & Unique) | (null & Unique)`, and `null & Unique` reduces to `never`. Your column silently stops being nullable.

## The tags you will use most

The full list is the [tag reference](./tags-reference.html). These five cover most tables:

| Tag             | Means                                                              |
| --------------- | ------------------------------------------------------------------ |
| `Table<'name'>` | the interface is a table, and this is its name                     |
| `Sql<'type'>`   | the SQL column type — `integer`, `text`, `varchar`, `timestamp`, … |
| `PrimaryKey`    | the key `findById`, `update` and `delete` use                      |
| `Serial`        | the database generates the value; omit it on insert                |
| `HasDefault`    | the column has a default, so it is optional on insert              |

`Sql<…>` is optional when the app type only maps one way — `Date` is a `timestamp`, `boolean` is a `boolean`. Write it when you mean something specific: `string` could be `text` or `varchar`, and
`number` could be `integer` or `numeric`.

## What you get from it

<!-- snippet: schema-declaration.ts#snippet-3 -->

`CreateDTO` drops `Serial` columns entirely rather than making them optional, because there is no value you could usefully pass. Columns with `HasDefault` and nullable columns become optional —
omitting a nullable column inserts `NULL`, which is what passing `null` does.

See [Type Derivation](./type-derivation.html) for the full family, including the read and query DTOs.

## Managed soft-delete timestamp

Soft delete is an entity-level declaration because it changes repository behavior for the whole table:

```ts
import type { PrimaryKey, Serial, SoftDelete, Sql, Table } from 'zmdb/schema';

export interface User extends Table<'users'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}
```

The named column must exist, be nullable, and use `Sql<'timestamp'>`. It remains part of the entity returned from reads, with an ISO `date-time` wire form, but is absent from `CreateDTO<User>` and
`UpdateDTO<User>` because `delete`, `restore`, and `hardDelete` own the state transition. See [Entity Filters](./entity-filters.html) for read/write filtering, hooks, and unique/upsert behavior.

## `schemaOf<T>()` needs a build step

`schemaOf<User>()` is a **compile-time** call. It has no runtime implementation and cannot have one: the answer is a function of a type argument, and type arguments do not exist at runtime. The zmdb
transform replaces the call with a frozen object literal.

<!-- snippet: schema-declaration.ts#snippet-4 -->

If the transform did not run, the call throws a message saying exactly that. It does not return an empty schema and let you find out in production. Set it up with the [build plugin](./aot-setup.html)
or the [codegen CLI](./cli-codegen.html), which commits the generated files so a fresh clone needs no tool at all.

## Foreign keys

<!-- snippet: schema-declaration.ts#snippet-5 -->

`References<'users.id'>` is `table.column`, checked as a string literal. It reaches the DDL as a real `FOREIGN KEY` constraint, and [Relations](./relations.html) is how you traverse it in queries.

## JSON columns keep their shape

<!-- snippet: schema-declaration.ts#snippet-6 -->

The payload's shape survives every derivation, and the emitted validator checks it on the way in. This is the clearest thing the old builder DSL could not do: `json<Preferences>()` erased its type
parameter at runtime, so the shape reached nothing downstream.

## Using the schema value directly

`schemaOf<T>()` returns a plain frozen object when you need one:

<!-- snippet: schema-declaration.ts#snippet-7 -->

```sql
SELECT "id", "email" FROM "users" WHERE "role" = $1
-- parameters: ['admin']
```

The value carries the full IR on `schema.ir`, which is what every back-end reads — the DDL emitter, the validator, the JSON Schema generator and the seeder all work from the same bytes, so they cannot
disagree about a column.

`schema.table`, `schema.columns` and `schema.primaryKey` are SQL-facing physical identifiers. The direct compiler is also a SQL-level API, so with non-identity naming pass physical column keys (for
example from `schema.columns`). Repository DTOs continue to use declared property names and perform that translation for you.

## Related

- [Tag reference](./tags-reference.html) — every tag, what it means, what it emits
- [Column Types](./column-types.html) — the SQL type set and why it is small
- [Type Derivation](./type-derivation.html) — `Entity`, the DTOs, and the read models
- [Relations](./relations.html) — declaring and traversing relationships
- [Codemod](./codemod.html) — converting a `defineSchema` project
- [Repository](./repository.html) — using a schema for CRUD
