Redis Pub/Sub, core NATS and RabbitMQ implement one public strategy contract, but they do not pretend to offer equivalent durability. Choose from the settlement matrix below before choosing from
familiarity.

## The strategy boundary

A strategy owns broker framing, subscriptions, replies and settlement. The application owns payload validation, handler invocation and retry policy:

```ts
import type { TraceCarrier } from '@zmdb/app/observability';
import type { DispatchOutcome, MessageReply, RawMessage, TransportCapabilities, TransportRequest } from '@zmdb/app/messaging';

export interface TransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<DispatchOutcome>): Promise<void>;
  send(request: TransportRequest): Promise<MessageReply>;
  emit(pattern: string, payload: unknown, carrier?: TraceCarrier): Promise<void>;
  close(graceMs: number): Promise<void>;
}
```

All three packaged strategies use a versioned JSON envelope and reject an `undefined` payload. Malformed JSON reaches the dispatcher as `RawMessage.parseError`, with the original input retained for
`onInvalidPayload`. `traceparent` / `tracestate` travel in the envelope; correlation and reply destinations use either envelope fields or native broker metadata.

## Settlement matrix

| Outcome                         | Redis Pub/Sub               | Core NATS                   | RabbitMQ                                                |
| ------------------------------- | --------------------------- | --------------------------- | ------------------------------------------------------- |
| handler returned                | no-op                       | no-op                       | confirm reply, then `basic.ack`                         |
| retry requested                 | dropped → `onUndeliverable` | dropped → `onUndeliverable` | confirm TTL retry copy, then `basic.ack`                |
| dead or invalid payload         | dropped → `onUndeliverable` | dropped → `onUndeliverable` | `basic.nack(requeue: false)` into the owned DLQ         |
| no handler                      | no-op                       | no-op                       | `basic.ack`                                             |
| consumer disappears mid-handler | lost                        | lost                        | unacked delivery is redelivered when the channel closes |
| `deliveryAttempt`               | always `1`                  | always `1`                  | `x-death` count, or `2` for a broker-marked redelivery  |
| capability flags                | `false / false / true`      | `false / false / true`      | `true / true / true`                                    |

Capability order is `redelivery / deadLetter / requestResponse`. Redis and core NATS therefore require `dispatcher.onUndeliverable`; RabbitMQ owns the retry and dead-letter topology described below.

## Install only the selected client

The neutral `@zmdb/app/messaging` entry imports no broker client. Install the optional peer alongside the adapter you use:

```bash
npm add @zmdb/web redis
npm add @zmdb/transport-nats @nats-io/transport-node
npm add @zmdb/web amqplib
```

```ts
import { createRedisStrategy } from '@zmdb/web/microservices/redis';
import { createNatsStrategy } from '@zmdb/transport-nats';
import { createRabbitMqStrategy } from '@zmdb/web/microservices/rabbitmq';
```

## Redis Pub/Sub

```ts
const redis = createRedisStrategy({
  connection: { url: process.env.REDIS_URL },
  channels: ['orders.get'],
  channelPatterns: ['orders.events.*'],
  onError: error => transportErrors.report(error),
});
```

This is Redis Pub/Sub, not Streams. A message published while no matching subscriber is connected is lost. There is no acknowledgement, redelivery or dead-letter destination, so `deliveryAttempt` is
always `1` and `transportExtension({ transports: [redis], dispatcher })` requires `dispatcher.onUndeliverable`.

Exact and glob subscriptions dispatch the concrete channel. Request/reply uses a process-owned reply-channel prefix and still requires the caller's explicit deadline.

## Core NATS

```ts
const nats = createNatsStrategy({
  connection: { servers: process.env.NATS_URL },
  subscriptions: [{ subject: 'orders.*', queue: 'orders-workers' }, { subject: 'audit.>' }],
  onError: error => transportErrors.report(error),
});
```

This is core NATS, not JetStream. Delivery is at-most-once: there is no acknowledgement, redelivery or dead-letter destination. Native `*` and final `>` subscriptions are compiled into a trie at
construction, and each delivery matches that trie rather than scanning the configured patterns. Queue groups are passed to NATS unchanged; the concrete delivered subject is the dispatcher pattern.

Core NATS also requires `dispatcher.onUndeliverable`. Request/reply uses an inbox subscription that is removed on reply, timeout, abort or publish failure.

## RabbitMQ

```ts
const rabbit = createRabbitMqStrategy({
  connection: env.RABBITMQ_URL,
  exchange: 'orders',
  queue: 'orders.worker',
  bindings: ['orders.*'],
  prefetch: 32,
  retry: {
    exchange: 'orders.retry',
    queue: 'orders.worker.retry',
  },
  deadLetter: {
    exchange: 'orders.dead',
    queue: 'orders.worker.dead',
  },
  onError: error => transportErrors.report(error),
});
```

`prefetch` is required and must be a positive integer; it is RabbitMQ's consumer backpressure control. The strategy declares topic exchanges, the main queue, a per-message-TTL retry queue and an owned
dead-letter queue.

On `retry`, it publisher-confirm-publishes a copy to the retry queue with `expiration: afterMs`, then acknowledges the original. The retry queue dead-letters the expired copy back to the main
exchange. On `dead`, it calls `basic.nack(requeue: false)` so the main queue routes the original to the configured DLQ. There is deliberately no `nack(requeue: true)`: immediate head-of-queue requeue
turns deterministic failures into a tight poison-message loop.

Broker delivery is never a substitute for an application transaction. Use the [transactional outbox](./transactional-outbox.html) when a database write and event publication must not become a dual
write.

## Lifecycle and security

Attach strategies through `transportExtension` in `createApp({ extensions })`. They open after application bootstrap, stop intake before dependencies are disposed, drain in-flight dispatch under
`graceMs` and close in reverse declaration order.

Connection authentication, TLS and credential rotation are broker-client configuration. Do not trust identity claims carried in the payload, and do not put secrets in retained or dead-lettered
messages. Handler effects must remain idempotent because RabbitMQ can redeliver an unacknowledged message.

## Deferred transports

Kafka is deferred because a consumer-group offset commits every earlier record in the partition; that cannot express independent settlement of concurrent messages through this interface. MQTT is
deferred because broker QoS controls redelivery on the broker's schedule and cannot honour `retry.afterMs`.

No bespoke TCP framing is shipped.

---

See also: [Microservices](./web-microservices.html) · [Custom Transports](./web-microservices-custom-transport.html) · [Hybrid Applications](./web-hybrid-application.html)
