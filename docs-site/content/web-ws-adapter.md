`@zmdb/web/gateways` gives you the decorator and dispatch half of a WebSocket layer. The socket half is yours — there is no adapter, because binding a transport is the host's job here as it is for
[HTTP](./web-standalone.html).

## What exists

```ts
import { Gateway, Subscribe, createGatewayDispatcher } from '@zmdb/web/gateways';

@Gateway('/chat')
export class ChatGateway {
  @Inject(MESSAGES) private readonly repo!: MessageRepo;

  @Subscribe('message')
  async onMessage(payload: unknown) {
    const dto = assert<{ room: string; text: string }>(payload);
    return this.repo.create({ room: dto.room, text: dto.text, at: new Date() });
  }

  @Subscribe('join')
  onJoin(payload: unknown) {
    return { joined: assert<{ room: string }>(payload).room };
  }
}
```

`createGatewayDispatcher` reads the decorated methods and returns a dispatcher that routes an event name to its handler. No reflection per message — the metadata is read once, the same as for routes.

## Wiring it to `ws`

```ts
import { WebSocketServer } from 'ws';
import { createGatewayDispatcher } from '@zmdb/web/gateways';

const app = createApp(AppModule);
await app.init();

const gateway = new ChatGateway();
const dispatch = createGatewayDispatcher(gateway);

const wss = new WebSocketServer({ server, path: '/chat' });

wss.on('connection', socket => {
  socket.on('message', async raw => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      socket.close(1003, 'invalid json');
      return;
    }

    const { event, data } = assert<{ event: string; data: unknown }>(frame);
    try {
      const result = await dispatch(event, data);
      socket.send(JSON.stringify({ event, result }));
    } catch (error) {
      socket.send(JSON.stringify({ event, error: error instanceof Error ? error.message : 'error' }));
    }
  });
});
```

Three things this code gets right and that are easy to get wrong:

- **Validate the frame envelope before dispatching.** `event` comes from the client and selects a method; a non-string here is how you get a confusing crash.
- **Validate each payload inside the handler.** A WebSocket message is exactly as untrusted as an HTTP body, and there is no `validateBody` equivalent in the gateway path.
- **Catch per message.** An unhandled rejection in a message handler takes down the process, not the connection.

## Authenticate at the handshake

There is no guard mechanism on `@Subscribe`. Do it once, at connection:

```ts
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const user = verifyToken(req.headers['sec-websocket-protocol']);
  if (user === undefined) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, user));
});
```

Browsers cannot set headers on a WebSocket, so the token arrives in the subprotocol or a query parameter — and a query parameter ends up in access logs, so prefer the subprotocol or a short-lived
ticket fetched over HTTP first.

Keep the authenticated identity in a per-connection map, not on the gateway instance. The gateway is a singleton shared by every socket; a field assigned per connection is a cross-user data leak.

```ts
const users = new WeakMap<WebSocket, User>();
```

## Rooms and broadcast

Not provided. There is no socket registry, no rooms, no `server.to(room).emit(...)` — a dispatcher returns a value to _its_ caller and knows nothing about other connections. Keep your own map:

```ts
const rooms = new Map<string, Set<WebSocket>>();

function broadcast(room: string, message: unknown) {
  const payload = JSON.stringify(message);
  for (const socket of rooms.get(room) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
```

Remove sockets on `close` **and** on `error`, or the set grows forever and you broadcast to dead connections.

## Server-sent events

The response layer can now carry an SSE stream, but the existing `sseStream` helper has not earned direct `stream(sseStream(...))` wiring. Its public byte type is still `Uint8Array<ArrayBufferLike>`,
while `stream()` deliberately requires `Uint8Array<ArrayBuffer>`.

For a Fetch `Response`, `sseStream` now propagates cancellation: it calls and awaits the source iterator's optional `return(reason)`, so an async generator's `finally` completes before a disconnect
settles. A rejection from that cleanup is absorbed because disconnect is normal teardown; report it inside the source if needed. Use `stream()` with an application-owned SSE stream until the byte
types agree; that stream must provide its own cancellation and reporting policy.

Send a comment line (`: ping\n\n`) every 20–30 seconds or proxies will close an idle stream. See [Streaming](./streaming.html).

## No Socket.IO, no protocol negotiation

The dispatcher is transport-agnostic: it maps an event name and a payload to a method. Whether the frames arrive over `ws`, `uWebSockets.js`, Socket.IO or a Durable Object is your choice, and none of
it is in the package. That is the same trade as `App` having no `listen()` — less provided, nothing to fight.

## Cloudflare Durable Objects

The natural home for stateful sockets at the edge, and the dispatcher works there unchanged:

```ts
export class Room {
  #dispatch = createGatewayDispatcher(new ChatGateway());

  async fetch(request: Request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener('message', async e => {
      const { event, data } = assert<{ event: string; data: unknown }>(JSON.parse(String(e.data)));
      server.send(JSON.stringify(await this.#dispatch(event, data)));
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
```

See [Cloudflare Durable Objects](./connect-cloudflare-do.html).

---

See also: [Gateways](./web-gateways.html) · [Streaming](./streaming.html) · [Cloudflare Durable Objects](./connect-cloudflare-do.html)
