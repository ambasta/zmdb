> **ToDo / feature gap.** There are no microservice transports yet — no
> `@MessagePattern`, no dispatcher, and no Redis, NATS or RabbitMQ strategies.
> `@zmdb/web` is an HTTP request handler.
>
> The shape they will ship as is frozen in
> `packages/web/src/microservices/SPEC.md`, and the interfaces on this page have
> been aligned to it. Kafka, MQTT and TCP are deferred, each with a reason — see
> [Microservices](./web-microservices.html).

## What to build with instead

**HTTP between services.** Unglamorous and usually correct. Every zmdb service is already an HTTP server, `toFetchHandler`/`toNodeHandler` are the transport, and [OpenAPI generation](./web-openapi-operations.html) gives you a contract other teams can consume. Call it with the [typed HTTP client](./web-http-client.html):

```ts
const user = await client.get(`/users/${id}`, raw => assert<User>(raw));
```

The `assert` at the boundary is the part a message-pattern framework tends to skip. A response from another service is untrusted input in the same way a request body is.

**The [transactional outbox](./transactional-outbox.html) for asynchronous work.** This is where a message broker is genuinely better than HTTP, and the outbox is the half that matters:

```ts
await db.transaction(async tx => {
  const order = await repo.withTransaction(tx).create(dto);
  await outbox.withTransaction(tx).create({
    id: globalThis.crypto.randomUUID(),
    topic: 'order.placed',
    payload: JSON.stringify({ id: order.id }),
    status: 'pending',
  });
});
```

Publishing to a broker inside a database transaction is the classic dual-write bug: the transaction rolls back and the message is already gone, or the process dies after commit and the message never exists. The outbox makes both impossible; a consumer then relays rows to your broker of choice. See [Queues](./web-queues.html).

**Postgres `LISTEN/NOTIFY`** when you already have the database and the message may be lost — cache invalidation, a nudge to re-poll:

```ts
await driver.execute({ text: 'SELECT pg_notify($1, $2)', parameters: ['order_placed', String(id)] });
```

Lossy by design: a listener that is disconnected misses it. Never use it for work that must happen.

## Request/response over a broker

The shape is a dispatcher over a name-to-handler map — which is what `@MessagePattern` compiles to anyway:

```ts
type Handler = (payload: unknown) => Promise<unknown>;

export function createDispatcher(handlers: Readonly<Record<string, Handler>>) {
  return async (pattern: string, raw: unknown): Promise<unknown> => {
    const handler = handlers[pattern];
    if (handler === undefined) throw new Error(`no handler for ${pattern}`);
    return handler(raw);
  };
}
```

```ts
const dispatch = createDispatcher({
  'order.get': async raw => orders.findById(assert<{ id: number }>(raw).id),
  'order.place': async raw => orders.create(assert<CreateDTO<Order>>(raw)),
});
```

Resolve the services from `app.container`, and validate every payload with `assert` — a message off a broker has been serialised, possibly by an older version of your code, and its shape is a runtime question.

Then bind it to whatever transport you have:

```ts
subscriber.on('message', async (channel, raw) => {
  const envelope = assert<{ pattern: string; payload: unknown; replyTo?: string }>(JSON.parse(raw));
  const result = await dispatch(envelope.pattern, envelope.payload);
  if (envelope.replyTo !== undefined) await publisher.publish(envelope.replyTo, JSON.stringify(result));
});
```

Two things the frozen dispatcher does that this hand-written one does not, and both are the reason to prefer it once it lands.

**A pattern with no handler is acknowledged, not thrown.** Throwing here is a rejection inside the subscriber callback, which on a broker with redelivery means the same unwanted message arrives forever. `createMessageDispatcher` reports it to a required `onUnhandled` sink and acks.

**The reply is validated too.** `assert` on the way in is only half the boundary; a reply arrived over the same network from the same code you do not control. The frozen typed client takes a total map of response validators, so a pattern added without one is a compile error:

```ts
type OrderCalls = {
  readonly 'order.get': { request: { id: number }; response: Order };
};

const client = createMessageClient<OrderCalls>(transport, {
  timeoutMs: 5_000,
  validate: { 'order.get': raw => assert<Order>(raw) },
});

const order = await client['order.get']({ id: 7 });
```

Declare that map as a `type`, not an `interface`. An `interface` has no implicit index signature, so it fails the constraint with an error naming a type you did not write — a real TypeScript wrinkle, documented in the spec rather than left to be discovered.

This is the same arrangement `@Gateway`/`@Subscribe` uses for WebSockets — see [Gateways](./web-gateways.html) — and `createGatewayDispatcher` is a working reference implementation to copy. Note it takes **one** gateway instance, not an array.

## The security details

- **Authenticate the transport.** A broker reachable without credentials is a remote code path into every service subscribed to it. TLS and credentials on Redis, NATS and RabbitMQ are not optional in any environment that is not your laptop.
- **Never trust a payload's identity claims.** `payload.userId` came from whoever published the message. Authorise from the transport's authenticated identity, not from the body.
- **Do not put secrets in messages.** Broker messages get retained, replayed and logged. Pass an id.
- **Assume at-least-once delivery.** Every broker replays. Make handlers idempotent — a unique key on the effect is more reliable than deduplicating in memory.

## Before you split

The strongest recommendation on this page: most applications that adopt microservice transports would be better as one deployable. A service boundary buys independent scaling and independent failure, and costs you transactions, joins, atomic reads and a debugging story. zmdb gives you `withTransaction` and typed joins across your whole schema in one process — that is worth more than a message bus for most teams.

If you split, split along a boundary where you genuinely never need a transaction across the seam.

## What it would take

Less than this page used to claim, because the interfaces are now settled: `TransportStrategy`, `createMessageDispatcher`, `@MessagePattern`/`@EventPattern`, `createMessageClient`, and one strategy per broker as an optional peer dependency — the same arrangement the database drivers use.

Two corrections to what was here before. The decorator writes to `Symbol.metadata` and a reader called `getMessagePatterns(cls)` reads it, but **nothing scans** to find the classes: they are passed to the dispatcher explicitly, exactly as controllers are passed to a router. And the return-value rule is a type-level distinction rather than a convention — `@EventPattern` on a method that returns a value does not compile, in both the `async` and the synchronous form, so "an event handler's return value is ignored" is a sentence nobody has to remember.

The framework-side piece worth building first is still the dispatcher, since it is transport-agnostic and is what makes the strategies thin.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Queues](./web-queues.html) · [HTTP Client](./web-http-client.html)
