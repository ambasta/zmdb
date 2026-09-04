> **Not planned.** `@zmdb/web` supports HTTP, WebSockets, and SSE, but it does not
> include a GraphQL layer. The related epics are closed as wontfix. These pages
> preserve the design notes and show how to compose an external GraphQL server
> with zmdb when needed.

## How it would have sat on the existing seams

The design was frozen before the capability was dropped —
`packages/schema-core/src/sdl/SPEC.md` for the type half,
`packages/web/src/graphql/SPEC.md` for the resolver half — and it was an **emitter +
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

## Why it is not being built

The spec is frozen; the code will not be written. GraphQL is a large surface — SDL
emission, resolver binding, dataloader batching, subscriptions, federation — and
each of those is a maintenance surface that has to keep answering identically to the
REST derivation beside it. The project would rather derive one API well than two,
so the surface is excluded rather than deferred.

If you want GraphQL over a zmdb application, run a GraphQL server next to it: your
services are plain objects and a schema library can call them directly, which is
what [Resolvers & Mutations](./web-graphql-resolvers.html) shows end to end. Nothing
zmdb ships serves `POST /graphql`, and nothing will — the transport, and with it
your authentication model, stays yours.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Type derivation](./type-derivation.html) · [WebSockets & SSE](./web-gateways.html)
