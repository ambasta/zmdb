> **Not planned.** `@zmdb/web` has no GraphQL schema directives because
> [GraphQL is out of scope](./web-graphql.html). The table below maps common
> directive use cases to features that are available today.

## What directives are used for, and what to use instead

Directives are how a GraphQL schema attaches behaviour to a field declaratively. The four common uses map onto things zmdb does differently.

| Directive                | zmdb equivalent                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `@auth(requires: ADMIN)` | a [guard](./web-middleware.html) bound to the field, or a check in the resolver                      |
| `@deprecated(reason:)`   | a `Deprecated<'why'>` tag on the column (frozen, below)                                              |
| `@upper`, `@formatDate`  | an `Interceptor` in the field's chain, or a [`postSelect` hook](./lifecycle-hooks.html)              |
| `@cost(complexity: 10)`  | `@Complexity(10)` — and it emits no directive; see [Query Complexity](./web-graphql-complexity.html) |

The one that matters is the first, and it is worth being blunt about why declarative authorisation is attractive and where it fails.

## Authorisation

An `@auth` directive is appealing because it puts the rule next to the field. Its weakness is that it can only express what the directive's arguments allow — usually a role. Anything relational ("the author of this post, or an admin, unless the post is archived") does not fit, so applications end up with directives _and_ resolver checks, and the split is where mistakes live.

The available approach:

```ts
Post: {
  authorEmail: (post, _, ctx) => {
    if (ctx.viewer === undefined) return null;
    if (ctx.viewer.id !== post.authorId && ctx.viewer.role !== 'admin') return null;
    return post.authorEmail;
  },
}
```

Verbose, and every rule is visible and testable. The important discipline is where the check goes:

> [!WARNING]
> Authorise on the **field that exposes the data**, not on the query that reached
> it. GraphQL lets a client traverse to any type from any entry point, so a check on
> `Query.user` does nothing for `Post.author` returning the same `User`. This is the
> most common GraphQL authorisation bug, and a directive on the type does not fix
> it either — it fixes it only if applied to every field that returns it.

The stronger version, and the one that composes with zmdb, is to authorise in the **data layer** so no resolver can bypass it:

```ts
const repo = defineRepository(posts, driverFor(viewer.tenant), { dialect: 'postgres' });
```

A [per-request driver](./web-request-context.html) that sets a tenant, or Postgres row-level security, makes the unauthorised row unreachable regardless of which resolver asks. That is a control you cannot forget to apply to a new field — which no directive can claim.

## Deprecation

`@deprecated` is genuinely useful: it keeps a field in the schema, marked, so clients see it in tooling. There is no equivalent for a REST field.

What you can do is make removal observable before you remove anything:

```ts
if ('legacyTitle' in requestedFields) {
  console.warn(JSON.stringify({ event: 'deprecated_field_read', field: 'legacyTitle' }));
}
```

Then remove it when the count reaches zero. That is more reliable than a deprecation notice, because it measures rather than announces.

For a REST surface, `toOpenApi` produces a document you can post-process to add `deprecated: true` on an operation — see [OpenAPI Operations](./web-openapi-operations.html). Field-level deprecation in the emitted GraphQL schema is frozen, and it is the next section.

## Transforms

A directive that formats a value is doing presentation in the schema layer. Two better places:

**In the resolver**, where it is explicit:

```ts
Post: {
  titleUpper: post => post.title.toUpperCase();
}
```

**In a [`postSelect` hook](./lifecycle-hooks.html)**, when the transform should apply to every read of the column — decrypting an encrypted field, for instance. Note there is no matching pre-write transform, so the inbound direction is your service's job.

## What it would have taken

The design is frozen, in `packages/web/src/graphql/SPEC.md` and `packages/schema-core/src/sdl/SPEC.md`, and will not be built. It is on record because of how it splits directives — three ways, rather than adding one mechanism for all of them.

**`@deprecated` is emitted, from a tag.** It is the only directive the emitter writes, because it is pure schema — it changes what the document says and needs nothing at runtime:

```ts
export interface Post extends Table<'posts'> {
  legacySlug: string & Sql<'text'> & Deprecated<'use `slug`'>;
}
```

→ `legacySlug: String! @deprecated(reason: "use \`slug\`")`. The reason is a type parameter rather than a runtime value, for the same reason `HasDefault` says only that a default exists: the emitter has no runtime and can read only what the type carries. Deprecated _arguments_ and deprecated _enum values_ are refused — neither position can hold a tag, and half of the feature is worse than a refusal that says where it stops.

**A directive with behaviour is an interceptor.** `@upper`, `@auth`, `@rateLimit` — each is a function wrapping one field's resolution, which is exactly `Interceptor`, bound to that field's chain. There is no `SchemaDirectiveVisitor` and no `@Directive`: transforming a built schema means `mapSchema` from `@graphql-tools`, a dependency the design gives up, and re-implementing schema transformation to get a second spelling of the interceptor that already exists is work with a negative payoff. See [Field Middleware](./web-graphql-field-middleware.html).

**A directive _definition_ your schema needs travels as text.** The registry takes SDL strings and concatenates them, so `directive @auth(role: String!) on FIELD_DEFINITION` is one more string in that array, visible to the engine you constructed — which is the thing that would enforce it anyway.

`@Complexity(10)` is the case that shows where the line is: it populates the cost table and emits **nothing** into the SDL. A `@cost` directive in a schema that no zmdb code reads is a schema that lies, and worse than a missing one, because a reader takes it for a limit.

The warning above survives all of this unchanged. A chain bound to a field does not inherit down a traversal — a guard on `Query.post` still says nothing about `Post.authorEmail` — and data-layer authorisation is still the control you cannot forget to apply to a new field.

---

See also: [Guards](./web-middleware.html) · [Repository Hooks](./lifecycle-hooks.html) · [Request Context](./web-request-context.html)
