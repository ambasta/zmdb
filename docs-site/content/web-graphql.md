> **ToDo / feature gap.** `@zmdb/web` ships **HTTP + WebSocket/SSE**, not a
> GraphQL layer (no `@nestjs/graphql` analogue, no schema-first/code-first
> resolver decorators).

## How it could sit on the existing seams

A GraphQL integration would be an **adapter + a resolver registry over DI**:

- One [controller route](./web-controllers.html) (`POST /graphql`) as the transport.
- Resolvers resolved from the [DI container](./web-di.html) (same boot-time graph).
- Types generated from your [`@zmdb/schema-core`](./type-derivation.html) schemas,
  reusing the [JSON Schema/OpenAPI](./web-openapi.html) derivation so the GraphQL
  SDL can't drift from the data model.

## Why it's a ToDo

GraphQL is a large surface (SDL, resolver binding, dataloader batching,
subscriptions). It's deferred rather than excluded — the DI + schema-derivation
foundations it would build on already exist.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Type derivation](./type-derivation.html) · [WebSockets & SSE](./web-gateways.html)
