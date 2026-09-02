> **ToDo / feature gap.** There are no microservice transports — no
> `@MessagePattern`, no `ClientProxy`, no TCP, Redis, NATS, Kafka, RabbitMQ or
> MQTT adapters, and no `createMicroservice`. `@zmdb/web` is an HTTP request
> handler.

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
  await outbox.withTransaction(tx).create({ type: 'order.placed', payload: { id: order.id }, at: new Date() });
});
```

Publishing to a broker inside a database transaction is the classic dual-write bug: the transaction rolls back and the message is already gone, or the process dies after commit and the message never exists. The outbox makes both impossible; a consumer then relays rows to your broker of choice. See [Queues](./web-queues.html).

**Postgres `LISTEN/NOTIFY`** when you already have the database and the message may be lost — cache invalidation, a nudge to re-poll:

```ts
await driver.execute({ text: 'SELECT pg_notify($1, $2)', parameters: ['order_placed', String(id)] });
```

Lossy by design: a listener that is disconnected misses it. Never use it for work that must happen.

## Request/response over a broker

If you need it, the shape is a dispatcher over a name-to-handler map — which is what `@MessagePattern` compiles to anyway:

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

This is the same pattern `@Gateway`/`@Subscribe` uses for WebSockets — see [Gateways](./web-gateways.html) — and `createGatewayDispatcher` is a working reference implementation to copy.

## The security details

- **Authenticate the transport.** A broker reachable without credentials is a remote code path into every service subscribed to it. TLS and credentials on Redis, NATS and Kafka are not optional in any environment that is not your laptop.
- **Never trust a payload's identity claims.** `payload.userId` came from whoever published the message. Authorise from the transport's authenticated identity, not from the body.
- **Do not put secrets in messages.** Broker messages get retained, replayed and logged. Pass an id.
- **Assume at-least-once delivery.** Every broker replays. Make handlers idempotent — a unique key on the effect is more reliable than deduplicating in memory.

## Before you split

The strongest recommendation on this page: most applications that adopt microservice transports would be better as one deployable. A service boundary buys independent scaling and independent failure, and costs you transactions, joins, atomic reads and a debugging story. zmdb gives you `withTransaction` and typed joins across your whole schema in one process — that is worth more than a message bus for most teams.

If you split, split along a boundary where you genuinely never need a transaction across the seam.

## What it would take

A transport interface (`send`, `subscribe`, `close`), a `@MessagePattern` decorator writing to `Symbol.metadata`, a dispatcher reading it, and one adapter per broker. Every broker client is a dependency, so under [Directive 7](./anti-patterns.html) they would be optional entry points with peer dependencies — the same arrangement the database drivers use.

The framework-side piece worth building first is the pattern dispatcher and its metadata, since that is transport-agnostic and is what makes the adapters thin.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Queues](./web-queues.html) · [HTTP Client](./web-http-client.html)
