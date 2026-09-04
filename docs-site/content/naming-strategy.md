> **ToDo / feature gap.** The build-time reflector now accepts an already
> resolved `NamingStrategy` and records both declared and physical names in its
> IR. That plumbing is not yet a project feature: `zmdb.config.ts` does not load
> a strategy, and the schema value, DDL emitter and query compiler still use the
> declared names. There is no built-in pluralisation or
> camelCase-to-snake_case conversion yet.

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

## What remains

The IR now carries `name` beside `physicalName`, and `table` beside
`physicalTable`, with identity values when no strategy is supplied. The
remaining work is to make every SQL-producing path read the physical fields,
load the strategy from project configuration, and ship the built-in strategies
and explicit-name tag. Derived types continue to read the declared property
names; the strategy must never become a per-query or per-row runtime
transformation.

Until those remaining slices land together, the examples above remain the
observable behavior and this page remains a ToDo rather than configuration
guidance.

---

See also: [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [Views](./views.html) · [Type Derivation](./type-derivation.html)
