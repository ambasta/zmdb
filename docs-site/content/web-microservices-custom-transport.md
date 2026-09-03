> **ToDo / feature gap.** There is no transport abstraction to implement yet — no
> `TransportStrategy`, no dispatcher, no typed client.
>
> The contract it will ship as is frozen in
> `packages/web/src/microservices/SPEC.md`, including which types are public and
> what a third-party strategy may rely on. The interface below is the
> hand-written version, annotated with where it differs.

## The shape to build

Without a framework interface, a transport is two functions and a dispatcher. Define the interface yourself; it stays small because there is no framework contract to satisfy.

```ts
export interface Transport extends AsyncDisposable {
  subscribe(handler: (pattern: string, payload: unknown) => Promise<unknown>): Promise<void>;
  send(pattern: string, payload: unknown): Promise<unknown>;
}
```

`AsyncDisposable` so `await using` closes it, which matters more than it looks — a transport left open holds the process after your work finishes.

Three differences from the frozen `TransportStrategy`, and each one is a bug this hand-written version has:

- **The handler returns a settlement, not a result.** `Settlement` is `ack`, `retry` with a required delay, or `dead` with a reason, and the strategy applies it while it still holds the broker's delivery tag. A handler that returns a value and no settlement leaves acknowledgement to a convention, and a forgotten ack is a message that succeeds and is redelivered anyway.
- **`close(graceMs)` instead of `Symbol.asyncDispose`.** Closing has to mean stop accepting deliveries, then wait for in-flight handlers, and the wait needs a bound — an unbounded one is a pod that hangs until `SIGKILL`, which abandons the very message the wait existed to protect. `[Symbol.asyncDispose]()` takes no argument, so it cannot carry the bound.
- **A `capabilities` triple that tells the truth.** Redis pub/sub has no acknowledgement, no redelivery and no dead-letter destination, so `retry` on it is a drop. Declaring `redelivery: false` is what makes the dispatcher demand an `onUndeliverable` sink at construction instead of losing the first failed message quietly.

## A dispatcher over the container

```ts
type Handler = (payload: unknown) => Promise<unknown>;

export function dispatcherFor(container: Container): (pattern: string, payload: unknown) => Promise<unknown> {
  const orders = container.resolve(ORDERS);

  const handlers: Readonly<Record<string, Handler>> = {
    'order.get': async raw => orders.findById(assert<{ id: number }>(raw).id),
    'order.place': async raw => orders.create(assert<CreateDTO<Order>>(raw)),
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

Two of those the framework takes over. Catching per message becomes the dispatcher's job, and the generic error string becomes its default — anything a handler throws that is not a deliberate, disclosable error is reported to a required sink rather than sent. `console.error` in the snippet above is what the frozen version replaces with `onHandlerError`, because a package that has deliberately never had a logger should not acquire one at its least testable point.

## Timeouts and correlation on the client side

```ts
async send(pattern, payload) {
  const id = globalThis.crypto.randomUUID();
  const replyTo = `reply:${id}`;
  const pending = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${pattern}`)), 5_000);
    waiters.set(id, { resolve, reject, timer });
  });
  await publisher.publish('rpc', JSON.stringify({ id, pattern, payload, replyTo }));
  return pending;
}
```

Always a timeout, and in the frozen version it is a **required** option with no default — a number the framework guessed for a broker it has never seen would be worse than making you state one. On expiry the caller gets a distinct `MessageTimeoutError`, because "the consumer never answered" is retryable and "the consumer threw" usually is not, and one indistinguishable error makes that a guess.

Generate the correlation id; never accept one from the caller. Two callers picking the same id resolve each other's promises, and a publisher who can choose an id can publish a reply for somebody else's outstanding request. Match on a per-caller reply destination **and** the id inside it — the channel alone is not enough once a caller has two calls in flight.

Clear the timer when the reply lands, and delete the waiter — a `Map` that only grows is a leak that takes a week to notice. Test the timeout path specifically: that is the exit where the deletion is usually missing.

## Running it beside HTTP

```ts
const router = createRouter();
for (const controller of controllers) router.register(controller);

await using app = createApp(AppModule);
await app.init();
await using transport = redisTransport(env.REDIS_URL);

await transport.subscribe(dispatcherFor(app.container));

const server = createServer(toNodeHandler(router));
server.listen(3000);
```

`toNodeHandler` takes a `Router`, not an `App` — an earlier version of this snippet passed `app`, which does not typecheck because `App` has no `register`. See [Hybrid Applications](./web-hybrid-application.html).

One container, one pool, two surfaces. Shutdown must close both — and in the frozen version `createApp` owns that: transports go in `AppOptions`, `init()` starts them after the bootstrap hooks, and disposal closes them before the shutdown hooks run so no handler outlives the repository it uses.

## Security

Authenticate the broker connection with TLS and credentials — a broker reachable anonymously is an unauthenticated path into every subscribed service. Never derive identity from the payload; the publisher wrote it. Never put a secret in a message, since broker messages are retained and replayed. Assume at-least-once delivery and make handlers idempotent.

## What it would take

The interfaces are settled: `TransportStrategy`, `RawMessage`, `Settlement`, `TransportCapabilities` and `createMessageDispatcher`, with broker clients as optional peer dependencies under [Directive 7](./anti-patterns.html).

The stability promise is the part worth knowing if you write a strategy. A member may be added to `RawMessage`, because you construct one and a new member with a defined default does not break your constructor call. A member may **not** be added to `TransportStrategy`, because you implement it and every addition breaks every implementation — which is why `pause()`, `resume()`, `connect()` and `unsubscribe()` were each argued out now rather than left for later. A `Settlement` arm may not be added either, for the same reason your `switch` would silently fall through it.

The interface above is deliberately close to the frozen one. Building it in your own repository now means the migration is renaming a type and adding the three differences named at the top of this page.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [Gateways](./web-gateways.html) · [Hybrid Applications](./web-hybrid-application.html)
