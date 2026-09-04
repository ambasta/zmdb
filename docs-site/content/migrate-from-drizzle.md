Drizzle is the closest neighbour: both compile to SQL, both derive types from a schema object, neither tracks entities. The move is mostly mechanical.

## Schema

```ts
// Drizzle
import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  active: boolean('active').default(true).notNull(),
});
```

```ts
// zmdb
import type { HasDefault, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  active: boolean & HasDefault;
}
```

Differences that matter:

- **It is a type, not a value.** There is no `pgTable` call and nothing to construct — `schemaOf<User>()` produces the value the query compiler reads, at build time.
- No dialect-specific import. One declaration compiles for all three dialects; you pick the dialect when you build a compiler or repository.
- Columns take no name argument. The property key _is_ the column name.
- Nullability is `| null`, not `.notNull()` — the default is non-null, and TypeScript already has a way to say the other thing. Write `(T & Tags) | null`, tags inside.
- `HasDefault` rather than `.default(true)`: it says the column _has_ a default, not which one. The value goes in the migration, because a type cannot hold a runtime value. This is the one thing Drizzle expresses that a declaration cannot.

## Types

| Drizzle                     | zmdb              |
| --------------------------- | ----------------- |
| `typeof users.$inferSelect` | `Entity<User>`    |
| `typeof users.$inferInsert` | `CreateDTO<User>` |
| —                           | `UpdateDTO<User>` |
| —                           | `WhereDTO<User>`  |

The zmdb column takes the declared interface, not `typeof` a value — the declaration is
already the type, so there is nothing to read it back out of.

## Queries

Drizzle's `db.select().from(users).where(eq(users.email, x))` becomes either a repository call or a compiler call:

```ts
// repository — typed against the schema
await repo.findOne({ email: { eq: 'a@b.c' } });

// compiler — SQL text, no connection
createQueryCompiler('postgres').selectFrom('users').where('email', '=', 'a@b.c').compile();
```

Note the two operator vocabularies: the [DTO](./filters.html) uses `eq` / `gte` / `in`, the [builder](./select.html) uses `'='` / `'>='` / `'in'`. The DTO one is typed per column; the builder one is closer to the SQL.

## Relational queries

`db.query.users.findMany({ with: { posts: true } })` becomes:

```ts
await repo.findAll({ populate: ['posts'] });
```

Same shape of result, same one-query-per-relation strategy. See [Loading Strategies](./loading-strategies.html).

## Migrations

`drizzle-kit generate` becomes a script calling `snapshot()` + `diff()` + `emitUp()`. The snapshot file plays the same role as Drizzle's `meta/_journal.json` + snapshot pair. See [generate](./cli-generate.html) for the script and [CLI Overview](./cli-overview.html) for what is missing.

For an existing Drizzle-managed database, start with
[schema-first adoption](./schema-first.html) instead of translating the schema
object blind: introspect into a staging directory, review the generated tags and
warnings, commit a baseline snapshot, and run `detectDrift()` against a restored
database in CI. The future [pull command](./cli-pull.html) will package that
library workflow rather than define a second one.

## Validation

Drop `drizzle-zod`. `assert<CreateDTO<User>>(body)` is generated from the same declaration by the transformer, so there is no second schema to keep in sync. See [assert()](./validators-assert.html).

## What you lose

- arbitrary `ON CONFLICT` predicates — the typed common forms are covered by [Upsert](./upsert.html)
- arbitrary SQL update expressions — the closed atomic forms (`inc`, `dec`,
  `mul`, `not`, `concat`, `coalesce`, `proposed`) are covered by
  [Incrementing a value](./guide-increment-decrement.html)
- `drizzle-kit studio` / `pull` — see [CLI](./cli-overview.html)
- the `pg`/`mysql`/`sqlite` type zoo: zmdb has ten column types, not sixty. `Sql<'json'>` and [custom types](./custom-types.html) cover most of the rest.

## What you gain

- one declaration instead of schema + `drizzle-zod` + `@ApiProperty`
- the shape of a JSON column reaching the validator, the DTOs and the OpenAPI document — Drizzle's `$type<T>()` is a cast that stops at the type layer
- an HTTP framework and a validator in the same type graph
- zero runtime dependencies

---

See also: [Why zmdb](./why-zmdb.html) · [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [Filters & Operators](./filters.html)
