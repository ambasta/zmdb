> **ToDo / feature gap.** There is no GraphQL, and therefore no subscriptions — no
> `@Subscription`, no `PubSub`, no `graphql-ws` integration. Two independent
> blockers are in the way: there is no GraphQL layer at all, and
> [`WebResponse.body` is a `string`](./web-streaming-files.html), so the router
> cannot produce a stream.

## What exists for real-time

Two pieces, both usable today.

**`@Gateway` and `@Subscribe`** for WebSocket message dispatch, with the socket server supplied by you:

```ts
@Gateway('chat')
export class ChatGateway {
  @Inject(MESSAGES) private readonly messages!: MessageRepo;

  @Subscribe('message.send')
  async send(payload: unknown) {
    const input = assert<{ room: string; text: string }>(payload);
    return this.messages.create(input);
  }
}
```

See [WebSocket Adapter](./web-ws-adapter.html) for the `ws` wiring, handshake authentication and the per-connection identity `WeakMap`.

**`sseStream`** from `@zmdb/web/gateways` for server-sent events. SSE is a better fit than WebSockets for one-way updates: it is plain HTTP, it reconnects automatically, and it needs no separate protocol upgrade.

Both are driven from your adapter rather than from a handler, because a handler cannot return a stream.

## A subscription without GraphQL

The shape a GraphQL subscription gives you — "tell me when this changes" — with the pieces in the project:

```ts
createServer(async (req, res) => {
  if (req.url === '/events/posts') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const identity = authenticate(req.headers);
    if (identity === undefined) {
      res.writeHead(401).end();
      return;
    }

    const send = (event: { type: string; id: number }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const stop = subscribeToChanges(identity.tenant, send);
    const keepalive = setInterval(() => res.write(': ping\n\n'), 15_000);

    req.on('close', () => {
      clearInterval(keepalive);
      stop();
    });
    return;
  }

  const out = await app.handle(toWebRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

Four details that decide whether this survives production:

- **The keepalive comment.** Proxies and load balancers close idle connections, typically at 30–60 seconds. A periodic `: ping` keeps it open, and without it clients reconnect in a loop.
- **`req.on('close')` cleanup.** Without it, every disconnected client leaves a timer and a subscription — a leak that grows with churn, not with load.
- **Authenticate before streaming**, and scope the subscription to the authenticated tenant. A stream that emits every change is a data leak with a long tail: the client filters, which means the client receives.
- **Never stream a full row.** Emit an id and a type; let the client fetch through the authorised route. Otherwise your event channel bypasses the authorisation your handlers apply.

## Where the events come from

Postgres `LISTEN/NOTIFY` on a dedicated connection is the usual answer:

```ts
const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();
await client.query('LISTEN post_changed');
client.on('notification', n => broadcast(assert<{ id: number }>(JSON.parse(n.payload ?? '{}'))));
```

A dedicated connection, not one from the pool — a pooled connection that is `LISTEN`ing gets handed to a query and the listener silently stops.

`NOTIFY` is lossy: a listener that is disconnected misses the event. For anything that must not be missed, use the [transactional outbox](./transactional-outbox.html) and have the consumer both do the work and fan out the notification.

## Scaling past one process

An in-process broadcast reaches clients connected to **this** instance. With several replicas, a client connected to instance B never sees an event published on instance A — a bug that only appears once you scale, since development runs one process.

`LISTEN/NOTIFY` solves it (every instance listens), as does Redis pub/sub. Sticky sessions do not: they pin a client to an instance but do not get the event there.

## What it would take

In order: widen `WebResponse.body` so the router can stream, add the GraphQL layer, then a `PubSub` abstraction and `@Subscription`. The first is the shared blocker with [streaming](./web-streaming-files.html), [compression](./web-compression.html) and [templates](./web-templates.html), and the second is [a substantial piece of work](./web-graphql-resolvers.html) on its own.

The SSE pattern above will remain worth knowing regardless, because it needs no protocol beyond HTTP.

---

See also: [WebSocket Adapter](./web-ws-adapter.html) · [Streaming](./streaming.html) · [GraphQL Resolvers](./web-graphql-resolvers.html)
