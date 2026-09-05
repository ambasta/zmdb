# `@zmdb/web` — WebSocket & SSE gateways SPEC

> `@Gateway`/`@Subscribe` decorators + typed message ctx (epic #307). Frozen. Adapter-based; SSE works on the Fetch/stream primitives with no ws dependency.

## Contract

### Decorators

- **`@Gateway(namespace?)`** — Stage-3 **class** decorator recording a gateway namespace in `context.metadata`.
- **`@Subscribe(event)`** — Stage-3 **method** decorator recording an event handler `{ event, handlerName }` in `context.metadata`. The recorded type is **`EventBinding`**; see "Amendments" below for
  why it is no longer `Subscription`.

### Reader / dispatch

- **`getSubscriptions(GatewayClass)`** → `readonly { event; handlerName }[]` (the gateway namespace + its event handlers), read from metadata (no reflection).
- **`createGatewayDispatcher(gatewayInstance)`** → `{ dispatch(event, message): Promise<unknown> }` that routes a message to the matching `@Subscribe` handler, invoked with a typed **message context**
  `{ event; data }`. Unknown event → `undefined` (no handler).

### SSE adapter

- **`sseStream(source)`** → a helper turning an async iterable of `{ event?; data }` into a `ReadableStream<Uint8Array>` of SSE frames (`event: <e>\\ndata: <json>\\n\\n`), usable in a Fetch `Response`
  — no ws dependency, works on Node 26 stream/TextEncoder primitives.
- Cancelling the stream calls and awaits the source iterator's optional `return(reason)`. An async generator's `finally` therefore completes before cancellation resolves; an iterator with no `return`
  still cancels successfully. A rejecting `return` is awaited but does not reject cancellation: disconnect is normal teardown, and this helper has no error-reporting callback. Natural completion and
  cancellation share one terminal state, so cleanup is not requested twice.

## Invariants

- Stage 3 metadata only; **no reflection, no ws dependency** (transport is an adapter; SSE uses standard streams).
- **No `as`/`any`/`!` on the consumer surface.** Internal metadata reads are commented boundaries per ARCHITECTURE.md §2.1.

## Acceptance

- A `@Gateway`/`@Subscribe` class's subscriptions are recoverable; the dispatcher routes an event to its handler with a typed message ctx; unknown event → undefined.
- `sseStream` emits correctly-framed SSE bytes for an async iterable (in-process read).
- Cancelling `sseStream` awaits one source cleanup, including while a pull is in flight; a cleanup rejection does not surface as a stream error, and natural completion does not call `return`.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

A concrete WebSocket server binding (adapter left to the consumer); auth (guards, epic #287).

## Amendments recorded for GraphQL subscriptions (#551, wontfix)

`../graphql/subscriptions/SPEC.md` described a design that is no longer being implemented. The naming change below remains unshipped; the SSE cancellation defect was independent of GraphQL and was
fixed for the existing gateway API in #610.

- **`Subscription` would have been renamed `EventBinding`.** It is `{ event; handlerName }` — a handler bound to an event name, not a subscription to anything — and the proposed root barrel could not
  re-export two different `Subscription`s. That GraphQL-driven rename remains unshipped.
- **`sseStream` releases its source on cancellation.** Its `cancel(reason)` calls and awaits `iterator.return?.(reason)`, then resolves even if that cleanup rejects so a normal disconnect is not
  reported as a server failure. The #610 gateway tests cover this independently; no GraphQL surface was added.

The concrete WebSocket binding stays out of scope, and the subscriptions spec keeps it that way: it specifies the `graphql-transport-ws` protocol state machine and the socket remains the
application's.
