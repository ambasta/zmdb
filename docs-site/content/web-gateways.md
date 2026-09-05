Real-time handlers use the same Stage-3 metadata + DI machinery as HTTP controllers. `@Gateway`/`@Subscribe` mark event handlers; a dispatcher routes messages with a typed context; `sseStream` frames
an async iterable as Server-Sent Events — **no `ws` dependency** (transport is an adapter; SSE uses standard streams).

## Declaring a gateway

```ts
import { Gateway, Subscribe } from '@zmdb/web';
import type { MessageCtx } from '@zmdb/web';

@Gateway('chat')
class ChatGateway {
  @Subscribe('message')
  onMessage(ctx: MessageCtx<{ text: string }>) {
    return { echo: ctx.data.text };
  }

  @Subscribe('join')
  onJoin(ctx: MessageCtx<{ room: string }>) {
    return { joined: ctx.data.room };
  }
}
```

## Dispatching messages

```ts
import { createGatewayDispatcher } from '@zmdb/web';

const dispatcher = createGatewayDispatcher(new ChatGateway());
await dispatcher.dispatch('message', { text: 'hi' }); // → { echo: 'hi' }
await dispatcher.dispatch('nope', {}); // → undefined (no handler)
```

Wire `dispatch` to your transport of choice (a `ws` server, a Bun/Deno socket) — the gateway itself has no transport dependency.

## Server-Sent Events

`sseStream` turns an async iterable into a properly-framed SSE byte stream you can return from a Fetch `Response` — SSE needs **no** extra dependency:

```ts
import { sseStream } from '@zmdb/web';

async function* ticks() {
  yield { event: 'tick', data: { n: 1 } };
  yield { data: { n: 2 } }; // no event name → just data
}

return new Response(sseStream(ticks()), {
  headers: { 'content-type': 'text/event-stream' },
});
// event: tick\ndata: {"n":1}\n\n
// data: {"n":2}\n\n
```

## Design notes

- **Stage-3 metadata**, no `reflect-metadata`, no runtime reflection.
- **No hard transport dependency** — WS is adapter-based; SSE uses standard streams + `TextEncoder`.
- **No `as`** on the consumer surface.
- Granular import: `import { Gateway } from '@zmdb/web/gateways'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Dependency injection](./web-di.html)
