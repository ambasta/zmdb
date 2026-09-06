One application can own HTTP routing, custom or packaged Redis, NATS and RabbitMQ strategies, and typed gRPC bindings. They share one container and one bounded lifecycle; the host still owns the HTTP
listening socket.

Install only the selected adapters and peers: grpc-js `^1.14.4`, the Node NATS transport `^3.4.0`, amqplib `^2.0.1`, or redis `^6.2.1`. None is part of the `zmdb` default install. HTTP socket shutdown
remains host-owned; broker strategies and the gRPC server are application extensions; gRPC clients remain caller-owned.

## One application, two transport surfaces

Attach message transports through the public app extension:

```ts
import { transportExtension } from '@zmdb/app/messaging';
import { grpcExtension } from '@zmdb/transport-grpc';

await using app = createApp(AppModule, {
  extensions: [
    transportExtension({
      transports: [ordersTransport],
      dispatcher: {
        onUnhandled: message => audit.unhandled(message),
        onInvalidPayload: (message, error) => audit.invalid(message, error),
        onHandlerError: (message, error) => audit.failed(message, error),
        onUndeliverable: (message, settlement) => audit.dropped(message, settlement),
      },
    }),
  ],
  graceMs: 5_000,
});

await app.init();
```

Add gRPC through its separate binding contract rather than the broker strategy array:

```ts
await using app = createApp(AppModule, {
  extensions: [
    transportExtension({ transports: [ordersTransport], dispatcher }),
    grpcExtension({
      address: '0.0.0.0:50051',
      bindings: [ordersGrpcBinding],
      credentials: 'insecure',
    }),
  ],
  graceMs: 5_000,
});
```

The same module graph and controller instances serve the HTTP and message surfaces. A controller can therefore inject one repository and expose both a route and a message handler without opening a
second pool or constructing a second singleton.

There is no `connectMicroservice` or `startAllMicroservices`. `init()` is the one startup boundary, so a process cannot accidentally serve HTTP while forgetting to start its configured consumers.

## Startup and shutdown order

Initialization is ordered:

1. run `onModuleInit` for constructed providers/controllers;
2. run `onApplicationBootstrap`;
3. build the exact message-pattern map once;
4. call `transport.listen` in declaration order;
5. start the following declared extension, including the gRPC server.

A rejecting `listen` or gRPC bind closes entered transports in reverse order and rejects `init()`. Start the external HTTP server only after `init()` resolves.

Disposal mirrors the dependency direction:

1. stop lazy module loading and await in-flight loads;
2. close extensions in reverse declaration order, so gRPC closes before the earlier message transport;
3. apply the one remaining `graceMs` budget across those closes;
4. run `onShutdown` in reverse construction order.

Intake stops before repositories and other handler dependencies are disposed. Every configured transport is asked to close even when an earlier close rejects.

## Serving HTTP

`createApp` exposes both framework-neutral and Fetch handlers:

```ts
const result = await app.handle({
  method: 'GET',
  path: '/health',
  headers: {},
});

const response = await app.fetch(new Request('https://service.example/health'));
```

The host still owns its listening socket and must close it as part of process shutdown. `toNodeHandler` currently accepts a `Router`, not a `WebApplication`, so do not pass `app` to it; use
`app.fetch`/`app.handle` in a compatible host or build the Node router explicitly as described by [Standalone Applications](./web-standalone.html).

## Several transports

Strategies are independent entries in one `transportExtension`:

```ts
const app = createApp(AppModule, {
  extensions: [transportExtension({ transports: [commands, notifications], dispatcher })],
  graceMs: 10_000,
});
```

Names must be non-empty and unique because `MessageContext.transport` records the strategy that delivered the message. All transports share the same startup-built handler map.

A strategy without redelivery or dead-letter support requires `dispatcher.onUndeliverable`; a strategy without request/reply support can still carry events, while typed client calls reject
immediately.

## Deliberate HTTP-only degradation

If HTTP should remain available when a broker is unavailable, do not attach that broker to the same application startup. Run the consumer as a separate process or compose it outside `createApp` with
an explicit health and shutdown contract.

That is a deployment decision, not an implicit fallback. Silently accepting HTTP traffic while every message consumer is disconnected makes ordinary health checks lie.

## Other sidecars

WebSocket servers, polling workers and CLI entry points remain ordinary composition around the same container:

```ts
const reports = app.container.resolve(REPORTS);
await reports.sendDigests();
```

External workers must still expose a stop function that awaits in-flight work. Only configured `ApplicationExtension` instances participate in the application's automatic bounded shutdown.

---

See also: [Microservices](./web-microservices.html) · [Custom Transports](./web-microservices-custom-transport.html) · [Standalone Applications](./web-standalone.html)
