`@zmdb/web` ships a transport-neutral message layer, typed request and event clients, Redis Pub/Sub, core NATS, RabbitMQ and a separate typed gRPC surface. Applications own those transports through
the same module graph and bounded lifecycle as HTTP.

## The public seam

Import the broker-neutral API from `@zmdb/web/microservices`:

```ts
import { EventPattern, MessagePattern, createMessageClient, type MessageContext, type TransportStrategy } from '@zmdb/web/microservices';
```

A broker delivery is not an HTTP request. `MessageContext<T>` is therefore a sibling of `Ctx`, not a subtype: it has no invented method or path. The reusable part is structural:

```ts
type WithHeaders = {
  readonly headers: Readonly<Record<string, string>>;
};

function requiresApiKey(ctx: WithHeaders): boolean {
  return ctx.headers['x-api-key'] === env.API_KEY;
}
```

Both HTTP and message contexts satisfy `WithHeaders` without casts. An HTTP guard and a message handler can call the same function, while the HTTP middleware interface remains HTTP-only so a path
check cannot silently run against a broker delivery.

## Declaring consumers

Each declaration carries its consume-boundary validator:

```ts
type OrderId = { readonly id: number };

function orderId(raw: unknown): OrderId {
  if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
    throw new Error('id must be a number');
  }
  return { id: raw.id };
}

class OrdersConsumer {
  @MessagePattern('order.get', orderId)
  async get(ctx: MessageContext<OrderId>): Promise<Order> {
    return orders.findById(ctx.payload.id);
  }

  @EventPattern('order.refresh', orderId)
  async refresh(ctx: MessageContext<OrderId>): Promise<void> {
    await orders.refresh(ctx.payload.id);
  }
}
```

`@EventPattern` rejects a method that returns a value. Decorators write Stage-3 metadata; `createApp` resolves the exact-pattern map once at startup. There is no filesystem scan, runtime wildcard
language or metadata lookup per delivery.

## Failure and settlement

Handlers never call `ack()` or `nack()`. The dispatcher returns a `DispatchOutcome`: a broker `Settlement` plus an optional correlated reply. The strategy applies the settlement while it still owns
the broker delivery token.

The decorators are separate because success and failure mean different things:

| Declaration       | Success                                  | Handler failure                                     |
| ----------------- | ---------------------------------------- | --------------------------------------------------- |
| `@MessagePattern` | acknowledge and publish the typed result | acknowledge and publish a generic correlated error  |
| `@EventPattern`   | acknowledge                              | retry with delay, then dead-letter at `maxAttempts` |

A request is not redelivered after its caller has received an error: doing so could perform the same command twice. An event has no waiting caller, so a transient failure can be retried.

- Unknown patterns are acknowledged and reported to `onUnhandled`.
- Parse and validation failures settle `dead` and reach `onInvalidPayload`.
- Private handler error detail goes to `onHandlerError`; it never enters a correlated reply.
- `retry` always carries a positive delay. The default is exponential from one second, capped at 30 seconds.
- A strategy that cannot redeliver or dead-letter requires an `onUndeliverable` sink when it is attached to an application.

The three capability flags are facts, not hints: `redelivery`, `deadLetter` and `requestResponse`. A request through a strategy without request/reply support rejects immediately with
`TransportUnsupportedError`.

## Typed request clients

The strategy moves `unknown`; the client supplies the trusted result type by validating the reply:

```ts
type OrderCalls = {
  readonly 'order.get': {
    readonly request: OrderId;
    readonly response: Order;
  };
};

const client = createMessageClient<OrderCalls>(transport, {
  timeoutMs: 5_000,
  validate: {
    'order.get': raw => assert<Order>(raw),
  },
});

const order = await client['order.get']({ id: 7 });
```

The client generates the correlation id, passes it and an `AbortSignal` to the strategy, rejects mismatched replies, validates successful payloads and clears its deadline timer on every exit. Timeouts
have no framework default.

For one-way events, `createEventPublisher<EventMap>(transport)` exposes one typed method per event pattern and delegates to `transport.emit`.

## Application ownership

Pass strategies to `createApp` rather than starting them beside the app:

```ts
await using app = createApp(AppModule, {
  transports: [transport],
  dispatcher: {
    onUnhandled: message => audit.unhandled(message),
    onInvalidPayload: (message, error) => audit.invalid(message, error),
    onHandlerError: (message, error) => audit.failed(message, error),
    onUndeliverable: (message, settlement) => audit.dropped(message, settlement),
  },
  graceMs: 5_000,
});

await app.init();
```

Initialization runs module hooks, builds the dispatcher, then calls `transport.listen` in declaration order. A partial startup closes the strategies that already opened and rejects. Disposal closes
transports in reverse order before provider/controller shutdown hooks, so no message handler outlives its dependencies.

## Packaged broker strategies

Install only the client used by the selected strategy:

```bash
npm add @zmdb/web redis
npm add @zmdb/web @nats-io/transport-node
npm add @zmdb/web amqplib
```

Import the adapter through its own optional subpath:

```ts
import { createRedisStrategy } from '@zmdb/web/microservices/redis';
import { createNatsStrategy } from '@zmdb/web/microservices/nats';
import { createRabbitMqStrategy } from '@zmdb/web/microservices/rabbitmq';
```

| Strategy      | Redelivery | Dead letter | Request/reply | Delivery warning                                      |
| ------------- | ---------- | ----------- | ------------- | ----------------------------------------------------- |
| Redis Pub/Sub | no         | no          | yes           | messages are lost while no matching subscriber exists |
| Core NATS     | no         | no          | yes           | deliveries are at-most-once                           |
| RabbitMQ      | yes        | yes         | yes           | handlers must tolerate redelivery                     |

Redis and core NATS therefore require `dispatcher.onUndeliverable`. RabbitMQ requires an explicit positive `prefetch`, owns its dead-letter destination and uses publisher-confirmed, per-message-TTL
retry copies. It never immediately requeues a failed delivery.

See [Broker Transports](./web-microservices-transports.html) for concrete configuration and the complete settlement table.

## What remains deferred

Kafka is deferred because committing an ordered partition offset also commits every predecessor, which does not implement independent per-message settlement. MQTT is deferred because broker QoS cannot
honour `retry.afterMs`. There is no bespoke length-prefixed TCP protocol.

GraphQL remains out of scope; the message layer has no GraphQL dependency.

Before splitting a deployment, keep the trade-off explicit: an independent service buys independent scaling and failure, while giving up local transactions, joins and atomic reads across the seam.

## Cross-links

- [Broker Transports](./web-microservices-transports.html) · [gRPC](./web-microservices-grpc.html) · [Custom Transports](./web-microservices-custom-transport.html)
- [Hybrid Applications](./web-hybrid-application.html) · [Transactional Outbox](./transactional-outbox.html)
