> **ToDo / feature gap.** `@zmdb/web` ships **HTTP + WebSocket/SSE**, not a
> GraphQL layer (no `@nestjs/graphql` analogue, no schema-first/code-first
> resolver decorators).

## How it sits on the existing seams

The design is frozen — `packages/schema-core/src/sdl/SPEC.md` for the type half,
`packages/web/src/graphql/SPEC.md` for the resolver half — and it is an **emitter +
a resolver registry over DI**:

- SDL emitted from the declared TypeScript type by `sdlOf<T>(name)`, walking the
  same IR the [JSON Schema/OpenAPI](./web-openapi.html) derivation walks, so the
  schema can't drift from the data model. Code-first only; an SDL _consumer_ is
  [refused](./web-graphql-schema-first.html).
- Resolvers as classes with `@Resolver`/`@Query`/`@Mutation`/`@ResolveField`,
  resolved from the [DI container](./web-di.html) at boot like any controller, and
  type-checked against the emitted schema by `implements ResolversOf<F>`.
- Middleware chains bound per **field**, not per traversal — the
  [authorisation trap](./web-graphql-resolvers.html) GraphQL is known for.
- `graphql` is not a dependency, not a peer, and not an optional peer: the registry
  hands back a `typeDefs` string and a plain map of resolver functions.
- Runtime controls reuse what exists rather than adding a parallel set: there is no
  plugin lifecycle ([every hook it would carry already has a home](./web-graphql-plugins.html)),
  a directive with behaviour is an `Interceptor`
  ([`@deprecated` is the only one emitted](./web-graphql-directives.html)), and
  [query cost](./web-graphql-complexity.html) is a function your transport calls
  between `parse` and `execute`.

## Why it's still a ToDo

The spec is frozen; the code is not written. GraphQL is a large surface (SDL,
resolver binding, dataloader batching, subscriptions), and the pieces land
epic by epic — deferred rather than excluded.

One thing to know before adopting it: nothing serves `POST /graphql`. The transport
is your own [controller route](./web-controllers.html), because a route zmdb owned
would have to decide your authentication model.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Type derivation](./type-derivation.html) · [WebSockets & SSE](./web-gateways.html)
