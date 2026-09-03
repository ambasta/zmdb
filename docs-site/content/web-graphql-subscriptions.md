> **Not planned.** There is no GraphQL, and therefore no subscriptions — no
> `@Subscription`, no `PubSub`, no `graphql-ws` integration — and there will not be:
> [GraphQL is out of scope](./web-graphql.html). The design is frozen (see the last
> section) and stays in the tree as a record, because the four failure modes it
> settles — cancellation, an expiring guard's verdict, a slow subscriber and a
> filter mistaken for a permission check — are the same four in any long-lived
> stream, including the `@Gateway` and SSE ones below that do work today.

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

## What it would have taken

The design is frozen, in `packages/web/src/graphql/subscriptions/SPEC.md`, and it is not going to be implemented — it followed [the GraphQL layer](./web-graphql-resolvers.html) and nothing else, and that layer is out of scope. It is documented here because a hand-rolled subscription server over the `@Gateway` above faces every one of these decisions.

```ts
export interface PubSub {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, signal: AbortSignal): AsyncIterable<unknown>;
}
```

Two methods, an `AbortSignal`, and an in-process implementation. Five of the decisions around it are worth knowing now, because four of them are about what happens when things go wrong — which is what the four bullets in the section above are also about.

**Cancellation is a signal passed in, not a teardown function handed back.** The four ways a subscription ends — client disconnect, client `complete`, an error in the stream, and `app.dispose()` — all abort the same controller, so cleanup is one code path with four triggers rather than four call sites, one of which would eventually be missing. That is the `req.on('close')` bullet above, made structural. The registry implements the existing `OnShutdown` hook, so `app.dispose()` is the whole of the shutdown story.

**A guard's verdict expires.** A guard that runs at subscribe time and never again means a revoked token keeps receiving data indefinitely, and the alternative — re-running the guard per event — is a fan-out amplifier pointed at your own database: 1,000 subscribers on a topic publishing 100 events a second is 100,000 guard evaluations a second. So the guard runs before delivery and its verdict is memoised for `reauthMs`, default **5000**. Exposure after a revocation is at most five seconds, and the same knob spells the other two policies: `0` is per-event, `Infinity` is subscribe-time only and has to be written out. A guard that fails mid-stream **terminates that operation** with `FORBIDDEN` and leaves the socket open — skipping the event instead would leave a client that cannot distinguish "revoked" from "quiet topic".

**A slow subscriber is terminated, not trimmed, and never blocks the publisher.** The buffer is bounded per subscriber (default 64) with no option for an unbounded one, because a client that opens a subscription and stops reading would otherwise be a memory-exhaustion attack from one connection. On overflow the client gets `SUBSCRIPTION_OVERFLOW` and reconnects; dropping the oldest event is refused, because a subscription payload has no sequence number, so a silently incomplete stream is undetectable from the client side. And `publish` never waits for a subscriber: it is called from a transaction commit, and letting the slowest client set the rate there is head-of-line blocking across every tenant.

**A filter is not an authorisation check, and the signature is what says so.** `filter(payload, args)` is not given the context — it cannot see the headers, the viewer or the container, so it is structurally incapable of being a permission check. A filter is about relevance; a guard is about permission; conflating them leaks data to the wrong subscriber, quietly, because a filter with a bug delivers rather than throwing. Where a filter is tempting for authorisation, put the identity in the **topic name** at subscribe time — `post.created:tenant-7` — which is the same rule as the third bullet above and is the one control no new field can be added without.

**The socket is still yours.** The freeze had zmdb implement the `graphql-transport-ws` protocol state machine — `connection_init`, `subscribe`, `next`, `error`, `complete`, and the close codes — with the WebSocket server left where [the WebSocket adapter](./web-ws-adapter.html) already puts it, for the same reason nothing serves `POST /graphql`. Since none of that is being built, the state machine is yours too if you want that protocol; the handshake was to be one callback, with `connection_init`'s payload becoming the `RequestFacts` every guard reads.

The SSE pattern above is the one that matters now, because it needs no protocol beyond HTTP — and it carries a leak that was going to be fixed as part of this freeze and now needs its own fix: `sseStream`'s stream has no `cancel`, so a disconnecting client never closes the source iterable.

---

See also: [WebSocket Adapter](./web-ws-adapter.html) · [Streaming](./streaming.html) · [GraphQL Resolvers](./web-graphql-resolvers.html)
