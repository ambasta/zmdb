# `@zmdb/web/microservices` — transport strategy and message dispatch SPEC

This is the transport-neutral broker layer of epic #556, implemented by #559. Redis, core NATS and RabbitMQ adapters are implemented by #560. The shipped gRPC surface remains a separate typed contract
under `./grpc/SPEC.md`; it is not a `TransportStrategy`. The layer here owns validation, exact-pattern dispatch, typed request clients, correlation, deadlines and application lifecycle. A strategy
owns broker framing, subscriptions, replies and applying settlements.

## 1. A message is not an HTTP request

`MessageContext<T>` is a sibling of `Ctx`, not a subtype. A broker delivery has no HTTP method or path, and inventing those values would make HTTP-only guards compile against messages and silently
make the wrong decision.

The reusable portion is structural:

```ts
export type WithHeaders = {
  readonly headers: Readonly<Record<string, string>>;
};
```

Both contexts satisfy it without `extends` or a cast. One authorisation function can therefore serve an HTTP `Guard` and be called by a message handler. This slice does not invent a message-middleware
attachment API.

```ts
export interface MessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
}
```

GraphQL is out of scope and this contract does not depend on it. A union of `Ctx | MessageContext<unknown>` narrows through `'kind' in ctx`; no fabricated HTTP discriminant is added merely to make the
spelling shorter.

## 2. Strategy contract: settlement and reply are different facts

The pre-implementation freeze made `listen` return only a `Settlement`. That could acknowledge a delivery but gave a request handler's result no route to `replyTo`. It also made client-generated
correlation impossible because `send(pattern, payload, timeoutMs)` had nowhere to receive the id. The shipped surface separates those facts explicitly:

```ts
export interface RawMessage {
  readonly pattern: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
  readonly parseError?: unknown;
}

export type Settlement = { readonly kind: 'ack' } | { readonly kind: 'retry'; readonly afterMs: number } | { readonly kind: 'dead'; readonly reason: string };

export type MessageReply =
  | {
      readonly kind: 'result';
      readonly correlationId: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: 'error';
      readonly correlationId: string;
      readonly message: string;
    };

export interface DispatchOutcome {
  readonly settlement: Settlement;
  readonly reply?: MessageReply;
}

export interface TransportRequest {
  readonly pattern: string;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface TransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

export interface TransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<DispatchOutcome>): Promise<void>;
  send(request: TransportRequest): Promise<MessageReply>;
  emit(pattern: string, payload: unknown, carrier?: TraceCarrier): Promise<void>;
  close(graceMs: number): Promise<void>;
}
```

`parseError` distinguishes failed transport framing from a legitimate string payload. The raw text remains in `payload` for the invalid-payload sink.

There is no `ack()` or `nack()` on `MessageContext`. A handler cannot forget to settle: the dispatcher derives the settlement and the strategy applies it while it still owns the broker delivery token.

`retry` always carries a delay. Immediate head-of-queue requeue is absent because a deterministic failure would then be delivered in a tight loop.

`close(graceMs)` has a required bound. `AsyncDisposable` cannot carry that number and is not the application shutdown contract.

Calling `close` first stops new deliveries, then waits for dispatches already accepted, and only then closes the underlying connection. If the grace bound expires, the connection still closes and
`close` rejects so shutdown cannot silently report a clean drain.

## 3. Handler declarations and startup resolution

```ts
export function MessagePattern<T, R>(pattern: string, validate: (raw: unknown) => T): (target: (ctx: MessageContext<T>) => R | Promise<R>, context: ClassMethodDecoratorContext) => void;

export function EventPattern<T>(pattern: string, validate: (raw: unknown) => T): (target: (ctx: MessageContext<T>) => void | Promise<void>, context: ClassMethodDecoratorContext) => void;
```

The validator is explicit because AOT validation is emitted at its call site; a decorator cannot recover a method parameter's erased TypeScript type. Its output fixes the handler payload type.

`EventPattern` rejects both synchronous and asynchronous value returns at compile time. Request handlers may return a value, which becomes a correlated `result` reply.

The decorators write one private `Symbol.metadata` slot. Inheritance composes base-first; a subclass declaration for the same method replaces its inherited declaration. `getMessagePatterns(cls)` reads
declarations without constructing or discovering the class.

`createMessageDispatcher` receives application-owned instances and builds one exact-string `Map`:

```ts
export interface MessageDispatcher {
  dispatch(message: RawMessage, transport: string): Promise<DispatchOutcome>;
  readonly patterns: readonly string[];
}
```

No wildcard matcher exists. NATS and RabbitMQ assign different meanings to wildcards, and an exact framework contract cannot pretend they are portable. A strategy may subscribe using a broker-native
wildcard, but it dispatches the concrete subject.

Lazy-module message consumers are refused at application startup. A closed startup map and first-request construction cannot both be true; HTTP routes may remain lazy, but message consumers must be
eager.

## 4. Validation and settlement

`DispatcherOptions` makes every terminal observation explicit:

```ts
export interface DispatcherOptions {
  readonly onUnhandled: (message: RawMessage) => void;
  readonly onInvalidPayload: (message: RawMessage, error: unknown) => void;
  readonly onHandlerError: (message: RawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: RawMessage, settlement: Settlement) => void;
  readonly maxAttempts?: number; // 5
  readonly retryAfterMs?: (attempt: number) => number;
}
```

All sinks are observational. A sink that throws or returns a rejected promise cannot replace the settlement or the original handler result.

| Condition                                                     | Settlement                        | Reply                        |
| ------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| unknown event pattern                                         | `ack`                             | none                         |
| unknown request pattern                                       | `ack`                             | generic correlated error     |
| parse or validator failure                                    | `dead: invalid-payload`           | generic error when replyable |
| event handler returned                                        | `ack`                             | none                         |
| event handler threw, attempts remain                          | `retry` with bounded policy delay | none                         |
| event handler threw at `maxAttempts`                          | `dead: attempts-exhausted`        | none                         |
| request handler returned                                      | `ack`                             | correlated result            |
| request handler threw                                         | `ack`                             | generic correlated error     |
| request declaration without correlation and reply destination | `dead: invalid-request-envelope`  | none                         |

Request exceptions are acknowledged after returning an error reply. Retrying a request delivery after its caller already received an error can perform the same command twice and has no useful
recipient.

Invalid input is never retried. A deterministic validator or parse failure cannot succeed on redelivery.

An unknown pattern is acknowledged so a message nobody handles does not loop. When it carries a complete request envelope it also receives a generic error so the caller does not wait for its deadline.

The default event retry curve is one second doubling to a 30-second ceiling. `maxAttempts` and every produced delay must be positive integers. An invalid custom delay is reported and settles dead
rather than leaving a delivery unsettled.

## 5. Capability enforcement belongs at the app binding

`createMessageDispatcher(consumers, options)` is transport-neutral, so it cannot inspect a strategy's capabilities. `createApp` owns both objects and binds them.

Before opening a transport, the app requires `onUndeliverable` whenever either `redelivery` or `deadLetter` is false. After dispatch:

- `retry` on a strategy without redelivery reaches the sink;
- `dead` on a strategy without a dead-letter destination reaches the sink.

The outcome is still returned to the strategy. A sink is evidence of the drop, not an alternative settlement mechanism.

## 6. Typed clients, correlation and deadlines

A concrete pattern map is a type alias:

```ts
type OrderCalls = {
  readonly 'orders.get': {
    readonly request: { readonly id: number };
    readonly response: Order;
  };
};
```

The client is one method per pattern, and the response validator map is total:

```ts
const client = createMessageClient<OrderCalls>(transport, {
  timeoutMs: 5_000,
  validate: {
    'orders.get': raw => assert<Order>(raw),
  },
});
```

Each call:

1. refuses a strategy whose `requestResponse` capability is false;
2. generates a fresh `globalThis.crypto.randomUUID()` correlation id;
3. passes that id, the required timeout and an abort signal to `send`;
4. races the strategy against the deadline and aborts on expiry;
5. rejects a reply whose correlation id differs;
6. turns a remote error envelope into `MessageRemoteError`;
7. validates a result before returning it.

The distinct failures are `TransportUnsupportedError`, `MessageTimeoutError`, `MessageCorrelationError` and `MessageRemoteError`. A raw transport error, including disconnect, propagates unchanged.

The caller cannot supply a correlation id. A payload property with that name is ordinary payload data and never participates in reply matching.

`createEventPublisher<E>(transport)` exposes one typed property per event pattern and delegates to `emit`. Methods are cached per publisher; the publisher and its cache are application-owned, not
global. The proxy never synthesizes `then`, so ordinary promise resolution cannot assimilate it as a thenable.

## 7. Hybrid lifecycle

```ts
export interface AppOptions {
  readonly transports?: readonly TransportStrategy[];
  readonly dispatcher?: DispatcherOptions;
  readonly graceMs?: number; // 5_000
}

createApp(rootModule, options?)
```

With transports configured, `init()` is idempotent and runs:

1. all `onModuleInit` hooks;
2. all `onApplicationBootstrap` hooks;
3. dispatcher construction and configuration validation;
4. each `listen` in declaration order.

If a `listen` rejects, `init()` rejects and transports that previously opened are closed in reverse order. The refusing transport is not assumed to have opened successfully.

Disposal first prevents new lazy loads and waits for in-flight loads, then closes opened transports in reverse declaration order, then runs ordinary shutdown hooks in reverse construction order. A
close failure does not skip later closes or lifecycle hooks; the first close error is reported afterwards. Once disposal begins, a later `init()` rejects rather than opening a transport that the
memoized disposal can no longer close.

Transport names must be non-empty and unique because the name is copied into every `MessageContext`.

`App` gains no `connectMicroservice` or `startAllMicroservices`. `init()` is the single startup boundary, so an application cannot serve HTTP while silently forgetting to start its consumers.

## 8. Custom transport stability

A third-party strategy may depend on:

- `TransportStrategy`, `TransportCapabilities` and `TransportRequest`;
- `RawMessage`, `Settlement`, `MessageReply` and `DispatchOutcome`;
- the four public client error classes.

The app supplies the dispatch callback; a strategy does not construct `MessageContext` or invoke handlers itself.

Within a major release, new required members are not added to `TransportStrategy`, and new settlement arms are not added. Optional diagnostic members may be added to `RawMessage` because existing
strategies can omit them.

## 9. Broker strategies

The three clients are optional peers and live behind separate subpaths:

- `@zmdb/web/microservices/redis` uses Redis Pub/Sub;
- `@zmdb/web/microservices/nats` uses core NATS;
- `@zmdb/web/microservices/rabbitmq` uses a RabbitMQ topic exchange.

Importing `@zmdb/web` or `@zmdb/web/microservices` reaches none of those clients. A plain production install therefore contains no broker client.

All three adapters use the same versioned JSON envelope. Payloads must be JSON-serializable and cannot be `undefined`. The envelope carries W3C trace propagation; correlation and reply destinations
use either envelope fields or the broker's native metadata. Parsing remains the strategy's responsibility: malformed JSON becomes `RawMessage.parseError` with the original text retained in `payload`.

### 9.1 Delivery semantics

| Outcome                           | Redis Pub/Sub                 | Core NATS                     | RabbitMQ                                                   |
| --------------------------------- | ----------------------------- | ----------------------------- | ---------------------------------------------------------- |
| handler returned                  | no-op; nothing to acknowledge | no-op; nothing to acknowledge | `basic.ack` after any reply publish is confirmed           |
| handler threw, attempts left      | dropped → `onUndeliverable`   | dropped → `onUndeliverable`   | confirm-publish to a per-message-TTL retry queue, then ack |
| handler threw, attempts exhausted | dropped → `onUndeliverable`   | dropped → `onUndeliverable`   | `basic.nack(requeue: false)` into the owned DLQ            |
| payload or envelope invalid       | dropped → `onUndeliverable`   | dropped → `onUndeliverable`   | `basic.nack(requeue: false)` into the owned DLQ            |
| no handler                        | no-op                         | no-op                         | `basic.ack`                                                |
| consumer disappears mid-handler   | message lost                  | message lost                  | unacked delivery is redelivered on channel close           |
| `deliveryAttempt`                 | always `1`                    | always `1`                    | `x-death` count, with broker redelivery as attempt `2`     |
| capabilities                      | `false / false / true`        | `false / false / true`        | `true / true / true`                                       |

The capability order in the last row is `redelivery / deadLetter / requestResponse`. Redis and core NATS are lossy transports: publishing while no matching consumer is connected loses the message.
Attaching either one to `createApp` therefore requires `dispatcher.onUndeliverable`.

Redis accepts exact channels and Redis glob subscriptions, always dispatching the concrete channel. Core NATS accepts native `*` and final-`>` subjects plus queue groups. Its subject membership is
compiled to a trie at construction; delivery never scans the configured pattern array.

RabbitMQ requires a positive `prefetch`, which is its backpressure control. It owns the main queue, a TTL retry queue and a dead-letter queue. A retry is publisher-confirmed before the original
delivery is acknowledged. Immediate `nack(requeue: true)` remains deliberately absent: it would return a deterministic failure to the queue head in a tight loop.

### 9.2 Deferred transports

Kafka and MQTT remain deferred:

- Kafka commits ordered offsets rather than settling independent messages.
- MQTT retry timing belongs to broker QoS and cannot honour `retry.afterMs`.

There is no bespoke TCP JSON protocol. HTTP or a broker provides a maintained framing, TLS and reconnection story without creating another transport product inside the framework.

## 10. Acceptance evidence

The implementation tests prove:

- every known payload is validated before invocation;
- parse failures and invalid payloads settle dead;
- event failures retry then dead, while request failures reply and ack;
- correlation is generated, mismatches are rejected and concurrent replies may arrive out of order;
- required deadlines abort transport work and leave no timer behind;
- metadata is read at construction and never during dispatch;
- HTTP and message handlers share one controller instance;
- startup failure rejects observably and closes transports already opened;
- bounded reverse shutdown stops intake, drains accepted work and closes connections before application hooks;
- a strategy outside the package, written only against published subpaths, can participate.

## Non-goals

- no HTTP `Guard`, `Pipe`, `Interceptor` or `ExceptionFilter` is silently applied to a broker delivery;
- no wildcard pattern language;
- no caller-supplied correlation id;
- no default request timeout;
- no module-scope connection or registry;
- no GraphQL integration;
- no broker client reachable from the package root or transport-neutral microservices entry point;
- no grpc-js import from the package root or transport-neutral microservices entry point; the optional peer is reached only through `./microservices/grpc` or an application configured with gRPC.
