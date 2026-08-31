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
import { defineSchema, serial, text, boolean } from '@zmdb/schema-core';

export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  active: boolean().notNull().defaultTo(true),
});
```

Differences that matter:

- No dialect-specific import. One `defineSchema` compiles for all three dialects; you pick the dialect when you build a compiler or repository.
- Column builders take no name argument. The object key _is_ the column name.
- `.defaultTo()` rather than `.default()`, and it comes after `.notNull()` because the flags accumulate in the type.

## Types

| Drizzle                     | zmdb                      |
| --------------------------- | ------------------------- |
| `typeof users.$inferSelect` | `Entity<typeof users>`    |
| `typeof users.$inferInsert` | `CreateDTO<typeof users>` |
| —                           | `UpdateDTO<typeof users>` |
| —                           | `WhereDTO<typeof users>`  |

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

## Validation

Drop `drizzle-zod`. `assert<CreateDTO<typeof users>>(body)` is generated from the same schema object by the transformer, so there is no second schema to keep in sync. See [assert()](./validators-assert.html).

## What you lose

- `ON CONFLICT` — see [Upsert](./upsert.html)
- expression updates (`sql\`views + 1\``) — see [Incrementing a value](./guide-increment-decrement.html)
- `drizzle-kit studio` / `pull` — see [CLI](./cli-overview.html)
- the `pg`/`mysql`/`sqlite` type zoo: zmdb has ten column types, not sixty. `json<T>()` and [custom types](./custom-types.html) cover most of the rest.

## What you gain

- one schema instead of schema + `drizzle-zod` + `@ApiProperty`
- an HTTP framework and a validator in the same type graph
- zero runtime dependencies

---

See also: [Why zmdb](./why-zmdb.html) · [Schema Declaration](./schema-declaration.html) · [Filters & Operators](./filters.html)
