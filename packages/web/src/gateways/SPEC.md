# `@zmdb/web` — WebSocket & SSE gateways SPEC

> `@Gateway`/`@Subscribe` decorators + typed message ctx (epic #307). Frozen.
> Adapter-based; SSE works on the Fetch/stream primitives with no ws dependency.

## Contract

### Decorators

- **`@Gateway(namespace?)`** — Stage-3 **class** decorator recording a gateway
  namespace in `context.metadata`.
- **`@Subscribe(event)`** — Stage-3 **method** decorator recording an event
  handler `{ event, handlerName }` in `context.metadata`.

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
