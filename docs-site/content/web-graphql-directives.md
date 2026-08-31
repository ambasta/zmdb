> **ToDo / feature gap.** There is no GraphQL layer, so there are no schema
> directives — no `@Directive`, no `SchemaDirectiveVisitor`, no `@auth` or
> `@deprecated` handling.

## What directives are used for, and what to use instead

Directives are how a GraphQL schema attaches behaviour to a field declaratively. The four common uses map onto things zmdb does differently.

| Directive                | zmdb equivalent                                                               |
| ------------------------ | ----------------------------------------------------------------------------- |
| `@auth(requires: ADMIN)` | a [guard](./web-middleware.html), or a check in the resolver                  |
| `@deprecated(reason:)`   | a comment, plus removal — see below                                           |
| `@upper`, `@formatDate`  | a transform in the resolver, or a [`postSelect` hook](./lifecycle-hooks.html) |
| `@cost(complexity: 10)`  | see [Query Complexity](./web-graphql-complexity.html)                         |

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

For a REST surface, `toOpenApi` produces a document you can post-process to add `deprecated: true` on an operation — see [OpenAPI Operations](./web-openapi-operations.html). Field-level deprecation would need it in the schema output.

## Transforms

A directive that formats a value is doing presentation in the schema layer. Two better places:

**In the resolver**, where it is explicit:

```ts
Post: {
  titleUpper: post => post.title.toUpperCase();
}
```

**In a [`postSelect` hook](./lifecycle-hooks.html)**, when the transform should apply to every read of the column — decrypting an encrypted field, for instance. Note there is no matching pre-write transform, so the inbound direction is your service's job.

## What it would take

Directives presuppose a schema, so this is downstream of [the GraphQL layer](./web-graphql-resolvers.html). If it lands, the directive worth supporting is `@deprecated`; `@auth` would be a mistake to encourage over data-layer authorisation, for the reason above.

---

See also: [Guards](./web-middleware.html) · [Repository Hooks](./lifecycle-hooks.html) · [Request Context](./web-request-context.html)
