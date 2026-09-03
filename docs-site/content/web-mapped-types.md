There is no `PartialType`, `PickType`, `OmitType` or `IntersectionType`, and there is nothing for them to do: they exist in decorator frameworks because a DTO is a _class_ whose fields carry runtime metadata, so deriving one DTO from another needs a function that copies that metadata. Here a DTO is a type, and TypeScript already has the operators.

## The built-in derivations

```ts
import type { Entity, CreateDTO, UpdateDTO, ListDTO, GetOptions } from '@zmdb/repository';

type PostRow = Entity<Post>; // every column, as stored
type NewPost = CreateDTO<Post>; // no serial columns; defaults optional
type PostPatch = UpdateDTO<Post>; // every column optional
type PostQuery = ListDTO<Post>; // { where?, orderBy?, page?, select? }
```

`Post` is the interface you declared; the four names above are what derives from it, so
they track the declaration. `UpdateDTO` is already the `PartialType` case, and it is generated rather than declared.

## Composing with TypeScript

```ts
type PublicPost = Omit<PostRow, 'authorEmail' | 'internalNotes'>;
type PostSummary = Pick<PostRow, 'id' | 'title' | 'createdAt'>;
type PostForm = Partial<NewPost>;
type WithAuthor = PostRow & { author: Entity<User> };
type Sortable = Pick<PostRow, 'title' | 'createdAt'>;
```

All zero-cost, all checked, none needing an import from zmdb. And because the AOT validator takes a type parameter, every one of them is directly validatable:

```ts
const dto = assert<Omit<NewPost, 'authorId'>>(ctx.body);
```

That last line is the point of the whole design. A decorator framework cannot validate `Omit<A, 'b'>` — it needs a class with metadata, which is why `OmitType()` exists. Here the type _is_ the schema.

## Narrowing a response

```ts
const SUMMARY = ['id', 'title', 'createdAt'] as const;

@Get('/')
async list() {
  const { items } = await this.repo.list({ select: SUMMARY, page: { limit: 20 } });
  return items;   // typed as Pick<Post, 'id' | 'title' | 'createdAt'>[]
}
```

`select` narrows the row type as well as the SQL, so the projection and the type cannot disagree. The `as const` is required — without it the array widens to `string[]` and you get the full row type back.

This is better than mapping a full row to a DTO, because the columns are never fetched. See [Query Performance](./perf-queries.html).

## Hiding a field on the way out

```ts
function toPublic(post: Post): PublicPost {
  const { internalNotes, authorEmail, ...rest } = post;
  return rest;
}
```

Explicit, checked, and it fails to compile if someone adds a sensitive column and forgets — as long as `PublicPost` is an `Omit` of the real entity rather than a hand-written interface.

`Sensitive` on a column marks it, and it is worth knowing exactly what that does:

> [!WARNING]
> `Sensitive` affects the derived types and documents, **not** queries. The column is still
> selected, still travels from the database into your process, and still appears in
> anything that stringifies the raw row. Use `select` to avoid fetching it.

## Input types for a form

```ts
type Draft = Partial<Pick<NewPost, 'title' | 'body'>> & { authorId: number };

const draft = assert<Draft>(ctx.body);
```

Compose exactly the shape the endpoint accepts, validate it in one call, and let the compiler check the handler body against it. There is no DTO class to maintain alongside it.

## Where the equivalent is genuinely missing

**JSON Schema for a composed type.** `toJsonSchema(schema, variant)` works from a table and its six variants. It cannot emit a schema for `Omit<Post, 'x'>`, because that is a TypeScript type and the function reads a schema object. So an [OpenAPI](./web-openapi-operations.html) body schema for a hand-composed DTO must be written or post-processed:

```ts
const full = toJsonSchema(posts, 'create');
const { authorId, ...properties } = full.properties as Record<string, unknown>;
const body = { ...full, properties, required: (full.required as string[]).filter(r => r !== 'authorId') };
```

Workable, and the one place where a mapped-type helper would pay for itself — a `omitFromJsonSchema(schema, keys)` utility. Small, and not built.

**Runtime field lists.** A type has no runtime representation, so `Pick<Post, 'id'>` gives you nothing to iterate. Where you need both, declare the tuple and derive the type from it:

```ts
const FIELDS = ['id', 'title'] as const;
type Summary = Pick<Post, (typeof FIELDS)[number]>;
```

One declaration, both uses — the same trick `select` relies on.

---

See also: [DTO Derivation](./type-derivation.html) · [OpenAPI Schemas](./openapi.html) · [Query Performance](./perf-queries.html)
