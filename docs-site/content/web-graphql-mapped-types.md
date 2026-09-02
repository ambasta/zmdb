> **ToDo / feature gap.** There is no GraphQL layer, so there is no
> `PartialType`/`PickType`/`OmitType`/`IntersectionType` for GraphQL types, and no
> `@ObjectType`/`@InputType` to derive from.

## Why these helpers exist elsewhere, and would not here

A decorator-based GraphQL library represents a type as a **class carrying runtime metadata**. `@Field()` on each property populates a registry that the schema builder reads. Deriving one type from another therefore needs a function that copies that metadata — hence `PartialType(CreatePostInput)`.

zmdb has no such registry. A DTO is a TypeScript type derived from a schema, and TypeScript already has the operators:

```ts
type PostRow = Entity<Post>;
type NewPost = CreateDTO<Post>;
type PostPatch = UpdateDTO<Post>;

type PublicPost = Omit<PostRow, 'authorEmail'>;
type PostSummary = Pick<PostRow, 'id' | 'title'>;
type Draft = Partial<NewPost>;
```

All zero-cost, all checked, and all directly validatable — which is the part a metadata-based system cannot do:

```ts
const input = assert<Omit<NewPost, 'authorId'>>(args.input);
```

`assert<Omit<A, 'b'>>` works because the AOT transformer compiles the _type_. That is why there is no `OmitType()` to miss. See [Mapped Types](./web-mapped-types.html) for the full treatment.

## Where the gap is real

**Generating GraphQL SDL from a composed type.** This is the actual missing capability, and it is the same shape as the `toJsonSchema` limitation: a hypothetical `toGraphQLType(schema, variant)` would work from a _schema object_, and `Omit<PostRow, 'authorEmail'>` is a TypeScript type with no runtime representation.

So a GraphQL type for a hand-composed DTO would have to be written out, or post-processed:

```ts
const full = toJsonSchema(posts, 'entity');
const { authorEmail, ...properties } = full.properties as Record<string, unknown>;
const publicPost = { ...full, properties };
```

Workable, and it is where a small helper would pay for itself — `omitFromSchema(schema, keys)` returning something both the JSON Schema and a future GraphQL emitter could consume. Not built.

## The pattern that avoids the problem

Declare the field list once as a tuple and derive both the type and the runtime list from it:

```ts
const PUBLIC_FIELDS = ['id', 'title', 'createdAt'] as const;

type PublicPost = Pick<Entity<Post>, (typeof PUBLIC_FIELDS)[number]>;
```

```ts
const { rows } = await repo.list({ select: PUBLIC_FIELDS, page: { limit: 20 } });
```

One declaration, three uses: the type, the SQL projection, and — when a GraphQL emitter exists — the field set. `select` narrows the row type as well as the query, so the projection and the type cannot disagree, and the omitted columns are never fetched.

The `as const` is required. Without it the array widens to `string[]` and you get the full row type back with no error.

## Input types versus object types

GraphQL requires them to be distinct — an input object cannot be used as an output type. The derivations already separate concerns the same way:

| GraphQL                        | zmdb                       |
| ------------------------------ | -------------------------- |
| `type Post` (output)           | `Entity<Post>`             |
| `input CreatePostInput`        | `CreateDTO<Post>`          |
| `input UpdatePostInput`        | `UpdateDTO<Post>`          |
| `PartialType(CreatePostInput)` | `Partial<CreateDTO<Post>>` |

`CreateDTO` already omits serial columns and makes defaulted columns optional, which is what an input type needs and what a hand-written `@InputType()` gets wrong first.

## Hiding fields on the way out

```ts
function toPublic(post: PostRow): PublicPost {
  const { authorEmail, internalNotes, ...rest } = post;
  return rest;
}
```

Explicit, and it fails to compile when someone adds a sensitive column — provided `PublicPost` is an `Omit` of the real entity rather than a hand-written interface. That is the discipline worth keeping: derive the narrow type from the wide one so the compiler notices new fields.

Better still, do not fetch them: `select` keeps the column out of the SQL entirely.

## What it would take

Nothing at the TypeScript level — the operators are already better than the helpers. What would help is the schema-level composition helper mentioned above, so that a derived shape can produce JSON Schema and GraphQL SDL as well as a type. That is a small, self-contained addition, and it is only useful once [the GraphQL layer exists](./web-graphql-resolvers.html).

---

See also: [Mapped Types](./web-mapped-types.html) · [DTO Derivation](./type-derivation.html) · [GraphQL Scalars](./web-graphql-scalars.html)
