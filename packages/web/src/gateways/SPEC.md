# `@zmdb/web` — WebSocket & SSE gateways SPEC

> `@Gateway`/`@Subscribe` decorators + typed message ctx (epic #307). Frozen.
> Adapter-based; SSE works on the Fetch/stream primitives with no ws dependency.

## Contract

### Decorators

- **`@Gateway(namespace?)`** — Stage-3 **class** decorator recording a gateway
  namespace in `context.metadata`.
- **`@Subscribe(event)`** — Stage-3 **method** decorator recording an event
  handler `{ event, handlerName }` in `context.metadata`. The recorded type is
  **`EventBinding`**; see "Amendments" below for why it is no longer
  `Subscription`.

### Reader / dispatch

- **`getSubscriptions(GatewayClass)`** → `readonly { event; handlerName }[]` (the
  gateway namespace + its event handlers), read from metadata (no reflection).
- **`createGatewayDispatcher(gatewayInstance)`** → `{ dispatch(event, message):
Promise<unknown> }` that routes a message to the matching `@Subscribe` handler,
  invoked with a typed **message context** `{ event; data }`. Unknown event →
  `undefined` (no handler).

### SSE adapter

- **`sseStream(source)`** → a helper turning an async iterable of `{ event?;
data }` into a `ReadableStream<Uint8Array>` of SSE frames
  (`event: <e>\\ndata: <json>\\n\\n`), usable in a Fetch `Response` — no ws
  dependency, works on Node 26 stream/TextEncoder primitives.

## Invariants

- Stage 3 metadata only; **no reflection, no ws dependency** (transport is an
  adapter; SSE uses standard streams).
- **No `as`/`any`/`!` on the consumer surface.** Internal metadata reads are
  commented boundaries per ARCHITECTURE.md §2.1.

## Acceptance

- A `@Gateway`/`@Subscribe` class's subscriptions are recoverable; the dispatcher
  routes an event to its handler with a typed message ctx; unknown event →
  undefined.
- `sseStream` emits correctly-framed SSE bytes for an async iterable (in-process
  read).
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

A concrete WebSocket server binding (adapter left to the consumer); auth
(guards, epic #287).

## Amendments (GraphQL subscriptions, #551)

`../graphql/subscriptions/SPEC.md` builds on this seam, and two things here have to
change for it.

- **`Subscription` is renamed `EventBinding`.** It is `{ event; handlerName }` — a
  handler bound to an event name, not a subscription to anything — and the root
  barrel cannot re-export two different `Subscription`s. `@Subscribe` and
  `getSubscriptions` keep their names: they are about events, and "subscribe to an
  event" reads correctly. `#552` asserts the old name is gone rather than
  deprecated.
- **`sseStream` must release its source on cancellation.** The underlying source has
  a `pull` and no `cancel`, so when a client disconnects the stream is cancelled and
  `iterator.return()` is never called — the source async iterable is never told, and
  keeps running. That is a leak on the exact path a subscription uses, and no
  cleanup guarantee in the subscriptions spec is true while it is there. `cancel`
  calls `iterator.return?.()`; `#552` asserts it with a source that records whether
  it was closed.

The concrete WebSocket binding stays out of scope, and the subscriptions spec keeps
it that way: it specifies the `graphql-transport-ws` protocol state machine and the
socket remains the application's.
