> **ToDo / feature gap.** There is no hybrid application concept — no
> `connectMicroservice`, no `app.startAllMicroservices`, and no
> [microservice transports](./web-microservices-transports.html) to connect. There
> is also no `listen()`; see [Standalone Applications](./web-standalone.html).

## What you can build instead

The pieces are all plain objects, so combining an HTTP surface with a non-HTTP one is composition in `main.ts` rather than a framework feature.

```ts
const app = createApp(AppModule);
await app.init();

// HTTP
const server = createServer(toNodeHandler(app));
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

## A WebSocket surface alongside HTTP

`@Gateway` and `@Subscribe` exist, and dispatch is yours to wire:

```ts
import { WebSocketServer } from 'ws';
import { createGatewayDispatcher } from '@zmdb/web/gateways';

const dispatch = createGatewayDispatcher([app.container.build(ChatGateway)]);
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

`connectMicroservice` presupposes transports, which is a much larger piece of work — see [Microservice Transports](./web-microservices-transports.html). Independently useful and much smaller: extending hook detection to providers, and a documented `App.attach(startable)` contract so shutdown covers non-HTTP surfaces without hand-written signal handling.

Until then, `main.ts` composition above is the supported approach, and it is explicit rather than magical.

---

See also: [Standalone Applications](./web-standalone.html) · [WebSocket Adapter](./web-ws-adapter.html) · [Queues](./web-queues.html)
