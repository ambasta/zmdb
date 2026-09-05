# `@zmdb/transport-rabbitmq` — RabbitMQ transport strategy

> Frozen by #654 for epic #653 and implemented by #659. RabbitMQ protocol ownership, executable evidence and the sole public root entry live in this package.

## 1. Boundary and exports

```ts
export interface RabbitMqDeadLetterOptions {
  readonly exchange: string;
  readonly queue: string;
  readonly binding?: string;
}

export interface RabbitMqRetryOptions {
  readonly exchange?: string;
  readonly queue?: string;
}

export interface RabbitMqStrategyOptions {
  readonly bindings: readonly string[];
  readonly connection: string;
  readonly deadLetter: RabbitMqDeadLetterOptions;
  readonly durable?: boolean;
  readonly exchange: string;
  readonly name?: string;
  readonly onError: (error: unknown) => void;
  readonly prefetch: number;
  readonly queue: string;
  readonly retry?: RabbitMqRetryOptions;
  readonly socketOptions?: SocketOptions;
}

export function createRabbitMqStrategy(options: RabbitMqStrategyOptions): TransportStrategy;
```

The root is the only export. It depends on `@zmdb/app` at `workspace:^` and declares one required external peer, `amqplib@^2.0.1`; release tests use `2.0.1`.

## 2. Semantics and lifecycle

The capability tuple is `{ redelivery: true, deadLetter: true, requestResponse: true }`. The strategy owns its topic exchange, queue bindings, positive prefetch, publisher-confirmed retry exchange/TTL
queue and dead-letter exchange/queue. A retry is confirmed before the original delivery is acknowledged; `nack(requeue: true)` remains absent.

The caller/application owns the strategy. `listen` opens one amqplib connection plus consumer and confirm channels; duplicate starts fail. Startup failure closes every resource already opened.
`close(graceMs)` cancels consumers, rejects pending replies, drains accepted dispatches, closes channels and the connection, and force-closes on timeout. No connection or topology registry is global.

Only the private amqplib boundary uses `Buffer`; the app transport surface remains string/`Uint8Array` based.

## 3. Migration and installation

`@zmdb/web/microservices/rabbitmq` is removed with no forwarding subpath. The package imports only public app messaging/transport-kit contracts.

```sh
yarn add @zmdb/transport-rabbitmq amqplib
```

## 4. Required evidence

1. Unit tests retain topology validation, publisher confirms, request/reply correlation, settlement mapping, pending-reply rejection and bounded drain.
2. A required release lane supplies `ZMDB_RABBITMQ_URL` and proves TTL retry/redelivery plus invalid-JSON dead lettering against a real RabbitMQ server. Missing service access fails qualification.
3. A packed external app installs the peer, imports only public package exports, dispatches through `transportExtension` and shuts down without leaked channels.
4. Manifest and graph checks prove that this package alone declares `amqplib` and no core package reaches it.
