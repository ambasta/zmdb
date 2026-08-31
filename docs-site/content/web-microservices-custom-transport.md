> **ToDo / feature gap.** There is no transport abstraction to implement — no
> `CustomTransportStrategy`, no `Server` base class, no `ClientProxy`. See
> [Microservice Transports](./web-microservices-transports.html) for the general
> position.

## The shape to build

Without a framework interface, a transport is two functions and a dispatcher. Define the interface yourself; it stays small because there is no framework contract to satisfy.

```ts
export interface Transport extends AsyncDisposable {
  subscribe(handler: (pattern: string, payload: unknown) => Promise<unknown>): Promise<void>;
  send(pattern: string, payload: unknown): Promise<unknown>;
}
```

`AsyncDisposable` so `await using` closes it, which matters more than it looks — a transport left open holds the process after your work finishes.

## A dispatcher over the container

```ts
type Handler = (payload: unknown) => Promise<unknown>;

export function dispatcherFor(container: Container): (pattern: string, payload: unknown) => Promise<unknown> {
  const orders = container.resolve(ORDERS);

  const handlers: Readonly<Record<string, Handler>> = {
    'order.get': async raw => orders.findById(assert<{ id: number }>(raw).id),
    'order.place': async raw => orders.create(assert<CreateDTO<typeof orders>>(raw)),
  };

  return async (pattern, payload) => {
    const handler = handlers[pattern];
    if (handler === undefined) throw new Error(`no handler for ${pattern}`);
    return handler(payload);
  };
}
```

An explicit map rather than decorator discovery, because [there is no discovery mechanism](./web-discovery.html). The upside is that the routing table is one readable object, and a test can assert every pattern your consumers use is present:

```ts
it('every published pattern has a handler', () => {
  for (const p of PUBLISHED_PATTERNS) expect(HANDLERS[p]).toBeDefined();
});
```

`createGatewayDispatcher` in `@zmdb/web/gateways` does exactly this for WebSocket events and is a working reference to copy.

## Wiring a transport to it

Redis pub/sub, as a concrete example:

```ts
export function redisTransport(url: string): Transport {
  const publisher = createClient({ url });
  const subscriber = publisher.duplicate();

  return {
    async subscribe(handler) {
      await subscriber.connect();
      await subscriber.subscribe('rpc', async raw => {
        const envelope = assert<{ id: string; pattern: string; payload: unknown; replyTo?: string }>(JSON.parse(raw));
        try {
          const result = await handler(envelope.pattern, envelope.payload);
          if (envelope.replyTo !== undefined) {
            await publisher.publish(envelope.replyTo, JSON.stringify({ id: envelope.id, result }));
          }
        } catch (error) {
          if (envelope.replyTo !== undefined) {
            await publisher.publish(envelope.replyTo, JSON.stringify({ id: envelope.id, error: 'handler failed' }));
          }
          console.error(JSON.stringify({ pattern: envelope.pattern, error: String(error) }));
        }
      });
    },
    async send(pattern, payload) {
      /* publish + await a reply on a per-caller channel */
    },
    async [Symbol.asyncDispose]() {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
```

Six things in that snippet are the actual work of writing a transport, and they are the parts a framework strategy would hide:

- **A separate subscriber connection.** A Redis connection in subscribe mode cannot publish; using one client deadlocks the reply.
- **A correlation id** on the envelope. Without it, concurrent calls on a shared reply channel resolve each other's promises.
- **Validate the envelope** with `assert` before touching any field. It arrived over a network from a publisher you do not control.
- **Return a generic error string.** `String(error)` in a reply leaks database errors, table names and sometimes values to the caller. Log the detail locally.
- **Catch per message.** A throw inside the subscriber callback becomes an unhandled rejection and can take the process down.
- **Dispose both clients**, or the process will not exit.

## Timeouts and correlation on the client side

```ts
async send(pattern, payload) {
  const id = randomUUID();
  const replyTo = `reply:${id}`;
  const pending = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${pattern}`)), 5_000);
    waiters.set(id, { resolve, reject, timer });
  });
  await publisher.publish('rpc', JSON.stringify({ id, pattern, payload, replyTo }));
  return pending;
}
```

Always a timeout. A request/response transport with no deadline turns one slow consumer into a pile of hanging callers, and the failure looks like your service being slow rather than theirs.

Clear the timer when the reply lands, and delete the waiter — a `Map` that only grows is a leak that takes a week to notice.

## Running it beside HTTP

```ts
await using app = createApp(AppModule);
await app.init();
await using transport = redisTransport(env.REDIS_URL);

await transport.subscribe(dispatcherFor(app.container));

const server = createServer(toNodeHandler(app));
server.listen(3000);
```

One container, one pool, two surfaces. Shutdown must close both; see [Hybrid Applications](./web-hybrid-application.html).

## Security

Authenticate the broker connection with TLS and credentials — a broker reachable anonymously is an unauthenticated path into every subscribed service. Never derive identity from the payload; the publisher wrote it. Never put a secret in a message, since broker messages are retained and replayed. Assume at-least-once delivery and make handlers idempotent.

## What it would take

A `Transport` interface in the framework, a `@MessagePattern` decorator writing to `Symbol.metadata`, and a dispatcher that reads it — with broker clients as optional peer dependencies under [Directive 7](./anti-patterns.html).

The interface above is deliberately close to what that would be. Building it in your own repository now means the eventual migration is renaming a type.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [Gateways](./web-gateways.html) · [Hybrid Applications](./web-hybrid-application.html)
