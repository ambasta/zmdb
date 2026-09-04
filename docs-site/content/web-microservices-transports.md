> **ToDo / partial support.** The public transport strategy, dispatcher,
> decorators and typed clients ship. Packaged Redis, NATS and RabbitMQ
> strategies do not yet ship.

## The strategy boundary

A strategy handles broker framing, subscriptions, replies and settlement. It
does not discover controllers, validate handler payloads or invoke handlers
itself:

```ts
import type {
  DispatchOutcome,
  MessageReply,
  RawMessage,
  TransportCapabilities,
  TransportRequest,
} from '@zmdb/web/microservices';

export interface TransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<DispatchOutcome>): Promise<void>;
  send(request: TransportRequest): Promise<MessageReply>;
  emit(pattern: string, payload: unknown): Promise<void>;
  close(graceMs: number): Promise<void>;
}
```

`listen` supplies the application dispatcher with a parsed `RawMessage`. If
framing failed, it sets `parseError` and keeps inspectable raw input in
`payload`. After dispatch, the strategy applies `outcome.settlement` and, when
present, publishes `outcome.reply` to the delivery's reply destination.

`send` receives the framework-generated correlation id, required deadline and
an `AbortSignal`. It returns a `MessageReply` carrying that same correlation
id. `createMessageClient` performs the deadline race, correlation check, remote
error mapping and response validation.

## Binding a strategy

`createApp` owns inbound transport lifecycle:

```ts
await using app = createApp(AppModule, {
  transports: [ordersTransport],
  dispatcher: {
    onUnhandled,
    onInvalidPayload,
    onHandlerError,
    onUndeliverable,
  },
  graceMs: 5_000,
});

await app.init();
```

Strategies open after application bootstrap hooks. They close in reverse order
before shutdown hooks. A failed `listen` closes strategies opened earlier and
rejects initialization; the application does not silently serve HTTP while
dropping broker work.

The capability declaration is checked at this boundary. If redelivery or
dead-lettering is unavailable, `onUndeliverable` is required so a
`retry`/`dead` decision cannot disappear silently.

## Request/reply and events

Use `createMessageClient` for typed request/reply:

```ts
type Calls = {
  readonly 'order.get': {
    readonly request: { readonly id: number };
    readonly response: Order;
  };
};

const client = createMessageClient<Calls>(ordersTransport, {
  timeoutMs: 5_000,
  validate: { 'order.get': raw => assert<Order>(raw) },
});

const order = await client['order.get']({ id: 7 });
```

Use `createEventPublisher` for one-way publishing:

```ts
type Events = {
  readonly 'order.placed': { readonly id: number };
};

const events = createEventPublisher<Events>(ordersTransport);
await events['order.placed']({ id: 7 });
```

Declare maps as type aliases rather than interfaces: the public constraint is a
string-keyed map, and TypeScript does not give an interface an implicit index
signature.

## What to use before broker adapters land

**HTTP between services.** Every zmdb application already exposes Fetch and
framework-neutral handlers, and OpenAPI can describe the boundary. Validate
responses just as strictly as requests.

**The [transactional outbox](./transactional-outbox.html) for durable
publication.** Publishing inside a database transaction creates a dual-write
race. Write the event row in the transaction, then let a relay publish it:

```ts
await db.transaction(async tx => {
  const order = await repo.withTransaction(tx).create(dto);
  await outboxWriter(tx).write('order.placed', JSON.stringify({ id: order.id }));
});
```

**Postgres `LISTEN/NOTIFY` for deliberately lossy notifications.** A
disconnected listener misses messages, so it is suitable for cache
invalidation or a prompt to re-poll, not durable work.

## Adapter requirements

A broker adapter must:

- authenticate and encrypt its connection;
- validate its envelope before constructing `RawMessage`;
- preserve generated correlation ids on replies;
- honour cancellation and release pending waiters;
- translate all three settlements without inventing immediate requeue;
- stop intake, drain bounded in-flight work and close under `graceMs`;
- report its capabilities truthfully.

Assume at-least-once delivery and make effects idempotent. Do not trust identity
claims from the payload, and do not put secrets in retained messages.

Redis, NATS and RabbitMQ adapters remain pending. Kafka, MQTT and bespoke TCP
are deferred for the reasons on [Microservices](./web-microservices.html).

---

See also: [Custom Transports](./web-microservices-custom-transport.html) · [Hybrid Applications](./web-hybrid-application.html) · [Queues](./web-queues.html)
