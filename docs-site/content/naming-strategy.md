> **ToDo / feature gap.** There is no naming strategy hook. The table name is the
> argument to `Table<'…'>` and the column name is the property name, both used
> verbatim by the DDL emitter and the query compiler. There is no pluralisation,
> no camelCase-to-snake_case conversion, and no `NamingStrategy` interface to
> implement.

## What that means in practice

```ts
export interface BlogPost extends Table<'blog_posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'>;
}
```

```sql
SELECT * FROM "blog_posts" WHERE "authorId" = $1
```

The table is `blog_posts` because you typed `blog_posts`. The column is `authorId` because you typed `authorId` — and note the interface name `BlogPost` has nothing to do with it, because a type name cannot be trusted to survive a rename and the reflector refuses a declaration with no `Table<'…'>` rather than guessing one from it. If you want `author_id` in the database, that is the property name:

```ts
export interface BlogPost extends Table<'blog_posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  author_id: number & Sql<'integer'>;
}
```

...and then your TypeScript uses `author_id` too, because `Entity<BlogPost>` is the same property names.

## The trade-off this makes

You cannot have a `snake_case` database and a `camelCase` TypeScript API without something in between doing the mapping. zmdb currently has nothing in between, which means:

**Upside.** There is exactly one name for each column, and it appears in the declaration, the SQL, the DTOs, the JSON Schema, the OpenAPI document and the HTTP payload. Nothing to trace through a strategy function, and a grep for `author_id` finds every use — including the interface it was declared in, which is now the same grep.

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

**Or use a view** with the names you want, and a second declaration over it:

```ts
createViewDdl({ name: 'posts_api', select: 'SELECT id, author_id AS "authorId" FROM blog_posts' }, 'postgres');
```

See [Views](./views.html).

## What it would take

A mapping applied in exactly three places: the DDL emitter, `quoteColumn` at compile time, and the row-to-entity path in the repository. The hard part is not the transformation — it is that `Entity<T>`'s keys are the _TypeScript_ names and the compiled SQL needs the _database_ names, so the mapping has to exist at the type level too, or the two halves silently disagree.

Type-first makes that both harder and more tractable. Harder, because there is no options object to hang a `naming` callback on any more — a declaration is a type, and a type cannot hold a function. More tractable, because the natural spelling is a tag: `authorId: number & Sql<'integer'> & Column<'author_id'>` would be read by the same reflector that reads every other tag, and a type-level rename is exactly the kind of thing a mapped type can do to `Entity<T>` without a second source of truth. That is the design work, and it is why this is a ToDo rather than a config flag.

---

See also: [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [Views](./views.html) · [Type Derivation](./type-derivation.html)
