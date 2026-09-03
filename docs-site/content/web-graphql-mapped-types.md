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

## Where the gap is not, after all

**Generating GraphQL SDL from a composed type** reads like the missing capability, and this page used to say so — a hypothetical `toGraphQLType(schema, variant)` working from a _schema object_, with `Omit<PostRow, 'authorEmail'>` having no runtime representation to hand it. That framing is wrong, and the frozen emitter (`packages/schema-core/src/sdl/SPEC.md` §10) does not have the problem:

```ts
sdlOf<Omit<Entity<Post>, 'authorEmail'>>('PublicPost');
```

`sdlOf` reads a **type argument**, not a schema object. The transform resolves the composition with the TypeScript checker before any of it exists at runtime, so what the emitter walks is the already-composed shape — the same reason `assert<Omit<NewPost, 'authorId'>>` works two sections up. The name is an argument because a composed type has no name of its own to borrow.

The same is true on the JSON Schema side, which is why the post-processing this page recommended is not needed either:

```ts
const publicPost = toJsonSchema<Omit<Entity<Post>, 'authorEmail'>>();
```

So `omitFromSchema(schema, keys)` is refused rather than unbuilt. A helper that deletes keys from an emitted document is unchecked — misspell `authorEmial` and it silently does nothing, and the column stays in your public schema. Composing the type instead makes the same mistake a compile error.

What genuinely does not exist, and will not, is `PartialType`/`PickType`/`OmitType`/`IntersectionType`. Those are functions that copy runtime metadata, and there is no metadata to copy.

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

## What it will take

Nothing at all, for this page's subject. The operators are already better than the helpers, and the emitter takes a type argument, so a composed shape produces SDL and JSON Schema with no composition helper in between. This page's remaining gap is only that [the GraphQL layer](./web-graphql-resolvers.html) has to exist for `sdlOf` to be worth calling.

One constraint worth carrying over from the freeze: a composed type needs the name you pass. `sdlOf` refuses an **anonymous** object type — a nested `{ street: string }` inside a payload, say — rather than inventing `PostShipTo`, because a name the emitter chose is a public identifier in your schema that nobody wrote down. Give the shape an interface, or a `sdlOf` call of its own.

---

See also: [Mapped Types](./web-mapped-types.html) · [DTO Derivation](./type-derivation.html) · [GraphQL Scalars](./web-graphql-scalars.html)
