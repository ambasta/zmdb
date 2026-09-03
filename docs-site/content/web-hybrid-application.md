> **ToDo / feature gap.** There is no hybrid application concept yet — no
> [microservice transports](./web-microservices-transports.html) to connect. There
> is also no `listen()`; see [Standalone Applications](./web-standalone.html).
>
> The shape it will ship as is frozen in
> `packages/web/src/microservices/SPEC.md` §10, and it is **not**
> `connectMicroservice`/`startAllMicroservices` — see the end of this page.

## What you can build instead

The pieces are all plain objects, so combining an HTTP surface with a non-HTTP one is composition in `main.ts` rather than a framework feature.

```ts
const app = createApp(AppModule);
await app.init();

// HTTP — toNodeHandler takes a Router, not an App
const router = createRouter();
for (const controller of controllers) router.register(controller);
const server = createServer(toNodeHandler(router));
server.listen(3000);

// a queue consumer over the same container
const driver = app.container.resolve(DRIVER);
const stop = startWorker(driver);

// graceful shutdown for both
process.once('SIGTERM', async () => {
  server.close();
  await stop();
  await app[Symbol.asyncDispose]();
});
```

One container, one set of providers, two entry points. `app.container` is public, so anything registered in your modules is available to the non-HTTP half — which is the substance of what a hybrid application gives you.

`toNodeHandler(router: Router)` needs `register`, and `App` has only `container`, `handle`, `fetch`, `init` and `[Symbol.asyncDispose]` — so `toNodeHandler(app)`, which an earlier version of this snippet used, does not typecheck. The adapter uses nothing but `handle`, so widening the parameter to `Pick<Router, 'handle'>` is the real fix; until that lands, build the router explicitly as above, which is what [Standalone Applications](./web-standalone.html) and [the pipeline page](./web-pipeline.html) already do.

## A WebSocket surface alongside HTTP

`@Gateway` and `@Subscribe` exist, and dispatch is yours to wire:

```ts
import { WebSocketServer } from 'ws';
import { createGatewayDispatcher } from '@zmdb/web/gateways';

const dispatch = createGatewayDispatcher(app.container.build(ChatGateway));
const wss = new WebSocketServer({ server }); // shares the HTTP server

wss.on('connection', (socket, request) => {
  const identity = authenticateHandshake(request); // before any message
  if (identity === undefined) {
    socket.close(4401, 'unauthorized');
    return;
  }
  identities.set(socket, identity);

  socket.on('message', async raw => {
    const envelope = assert<{ event: string; payload: unknown }>(JSON.parse(String(raw)));
    socket.send(JSON.stringify(await dispatch(envelope.event, envelope.payload)));
  });
});
```

Two things that are load-bearing:

- **Authenticate at the handshake**, not per message, and keep identity in a `WeakMap` keyed by socket — never on the gateway instance, which is a singleton shared by every connection.
- **Validate the envelope and the payload separately.** `JSON.parse` of a frame gives you `unknown`; the envelope shape and the per-event payload are two different checks.

Sharing the HTTP server (`{ server }`) means one port and one TLS configuration. See [WebSocket Adapter](./web-ws-adapter.html).

`createGatewayDispatcher` takes **one** gateway instance, not an array — an earlier version of this snippet wrapped it in brackets. For several gateways, build one dispatcher each.

## A worker and an API in one process

Common and reasonable at low volume:

```ts
function startWorker(driver: Driver): () => Promise<void> {
  let running = true;
  const loop = (async () => {
    while (running) {
      const count = await drainOutbox(driver, dispatch);
      if (count === 0) await new Promise(r => setTimeout(r, 1_000));
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}
```

The stop function awaits the loop, so shutdown finishes the current batch instead of abandoning a job mid-flight. See [Queues](./web-queues.html).

The trade-off is real: a slow job competes with requests for the event loop, and a crash in either half takes both down. Split the processes when either becomes a problem — the code does not change, only which entry point runs.

## A CLI and an API from one module

```ts
// cli.ts
await using app = createApp(AppModule);
await app.init();
const reports = app.container.resolve(REPORTS);
await reports.sendDigests();
```

`await using` disposes the app when the script ends, so the pool closes and the process exits. No `listen`, no server — the module graph works standalone. See [Standalone Applications](./web-standalone.html).

## Lifecycle hooks only fire for controllers

The constraint to plan around: `createApp` detects `onModuleInit`, `onApplicationBootstrap` and `onShutdown` on **controllers only**, never on providers. So a gateway or worker that needs startup work either lives on a controller class, or you call its setup explicitly in `main.ts` as above.

Explicit is arguably better here — the order in which the HTTP server, the worker and the WebSocket server start and stop is visible in one file rather than distributed across hook implementations.

## What it would take

Transports, which are now specified — see [Microservice Transports](./web-microservices-transports.html). The hybrid half is settled and is smaller than this page assumed.

**There is no `connectMicroservice` and no `startAllMicroservices`, and no `App.attach(startable)` either.** All three are a second entry point an application can forget to call, which is a process that serves HTTP and consumes nothing while every health check passes. Instead `createApp` takes the transports up front and `init()` is the one place startup happens:

```ts
await using app = createApp(AppModule, {
  transports: [redisStrategy(env.REDIS_URL)],
  dispatcher: { onUnhandled, onInvalidPayload, onHandlerError },
  graceMs: 5_000,
});
await app.init(); // hooks, then dispatcher, then listen
```

The ordering is fixed and each step's position is load-bearing: `onModuleInit` and `onApplicationBootstrap` run first, then the pattern map is built (a consumer's `onModuleInit` may be what prepares it), then `listen` — last, so a message can never arrive before bootstrap has finished. Shutdown is the mirror: transports close **before** the shutdown hooks, so no handler outlives the repository it uses.

**If a transport fails to connect, `init()` rejects and nothing serves.** The tempting alternative — serve HTTP, report the broker failure — produces a process that passes its health check and silently drops every message, which is worse than either extreme because nothing notices. A deployment that genuinely wants HTTP-only degradation gets it by not passing the transport to `createApp`, which is the `main.ts` composition at the top of this page: two statements, failing independently.

Putting transports in `AppOptions` rather than the container is also what sidesteps the constraint above — the app owns them, so a connection registered as a provider and never torn down is not a shape you can write.

Still open and still independently useful: extending hook detection to providers.

---

See also: [Standalone Applications](./web-standalone.html) · [WebSocket Adapter](./web-ws-adapter.html) · [Queues](./web-queues.html)
