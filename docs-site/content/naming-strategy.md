> **ToDo / feature gap.** There is no naming strategy hook. The table name is the
> first argument to `defineSchema` and the column name is the object key, both
> used verbatim by the DDL emitter and the query compiler. There is no
> pluralisation, no camelCase-to-snake_case conversion, and no
> `NamingStrategy` interface to implement.

## What that means in practice

```ts
export const blogPosts = defineSchema('blog_posts', {
  id: serial().primaryKey(),
  authorId: integer().notNull(),
});
```

```sql
SELECT * FROM "blog_posts" WHERE "authorId" = $1
```

The table is `blog_posts` because you typed `blog_posts`. The column is `authorId` because you typed `authorId`. If you want `author_id` in the database, that is the key:

```ts
export const blogPosts = defineSchema('blog_posts', {
  id: serial().primaryKey(),
  author_id: integer().notNull(),
});
```

...and then your TypeScript uses `author_id` too, because `Entity<S>` is derived from the keys.

## The trade-off this makes

You cannot have a `snake_case` database and a `camelCase` TypeScript API without something in between doing the mapping. zmdb currently has nothing in between, which means:

**Upside.** There is exactly one name for each column, and it appears in the schema, the SQL, the DTOs, the JSON Schema, the OpenAPI document and the HTTP payload. Nothing to trace through a strategy function, and a grep for `author_id` finds every use.

**Downside.** If your database convention is `snake_case` and your API convention is `camelCase`, one of them has to give — usually the API, which means your JSON has `author_id` in it.

## Working around it today

**Map at the HTTP boundary**, which is where the two conventions actually meet:

```ts
@Post('/')
async create(ctx: Ctx<Record<never, string>, { authorId: number; title: string }>) {
  const { authorId, title } = ctx.body;
  return this.repo.create({ author_id: authorId, title });
}
```

Explicit, typed, and testable. The cost is one adapter per endpoint that has a mismatched field.

**Or use a view** with the names you want, and a second schema object over it:

```ts
createViewDdl({ name: 'posts_api', select: 'SELECT id, author_id AS "authorId" FROM blog_posts' }, 'postgres');
```

See [Views](./views.html).

## What it would take

A `naming` option on `SchemaOptions` carrying `{ table?: (s: string) => string; column?: (s: string) => string }`, applied in exactly three places: the DDL emitter, `quoteColumn` at compile time, and the row-to-entity path in the repository. The hard part is not the transformation — it is that `Entity<S>`'s keys are the _TypeScript_ names and the compiled SQL needs the _database_ names, so the mapping has to exist at the type level too, or the two halves silently disagree. That is the design work, and it is why this is a ToDo rather than a config flag.

---

See also: [Schema Declaration](./schema-declaration.html) · [Views](./views.html) · [Type Derivation](./type-derivation.html)
