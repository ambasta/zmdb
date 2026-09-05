`createApp` bootstraps an application from a root [module](./web-modules.html): it compiles the DI graph, builds the [router](./web-pipeline.html), and registers every controller's routes — **once**.
It exposes lifecycle hooks and `await using` graceful shutdown. Its optional second argument accepts protocol-neutral application extensions, including the
[`transportExtension`](./web-microservices.html) and the typed [`grpcExtension`](./web-microservices-grpc.html).

## Bootstrapping

```ts
import { createApp } from '@zmdb/web';
import { createServer } from 'node:http';
import { toNodeHandler } from '@zmdb/web';

const app = createApp(AppModule);
await app.init(); // run lifecycle init hooks

// serve over any runtime:
await app.handle({ method: 'GET', path: '/ping', headers: {} }); // framework-neutral
await app.fetch(new Request('http://x/ping')); // Fetch (Hono/edge)
```

`app.lazy` contains the per-app handles for [lazy module imports](./web-lazy-modules.html). It is empty for an all-eager graph.

## Lifecycle hooks

Implement any of these on a controller (or provider) and they run at the right time:

```ts
import type { OnModuleInit, OnApplicationBootstrap, OnShutdown } from '@zmdb/app/lifecycle';

class Db implements OnModuleInit, OnShutdown {
  onModuleInit() {
    /* connect */
  }
  onShutdown() {
    /* close pool */
  }
}
```

| phase     | order                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `init()`  | eager instances: `onModuleInit` → `onApplicationBootstrap` → configured extensions in order → gRPC bind   |
| lazy load | that subtree's constructed providers/controllers: init pass → bootstrap pass                              |
| shutdown  | gRPC closes → extensions stop in reverse order → instances `onShutdown` in **reverse construction order** |

“All” means every constructed object provider and controller. Value providers enter the ledger when registered; factory providers enter only when resolved. A factory first resolved after `init()` is
still shut down, without retroactive init hooks, and an unresolved factory is never constructed for lifecycle.

## Graceful shutdown with `await using`

`createApp` returns an `AsyncDisposable`, so Stage-3 explicit resource management cleans up automatically:

```ts
await using app = createApp(AppModule);
await app.init();
// ... serve ...
// at scope exit: transports close, then onShutdown hooks run via Symbol.asyncDispose
```

## Design notes

- **Bootstrap-time declarations** — the full graph is validated and every route is registered once. Lazy instances alone are deferred; the dispatcher reads no metadata per request.
- **Eager message consumers** — a lazy controller with message-pattern metadata is rejected because the closed dispatch map is built at startup.
- **No `as`** — hook detection uses structural `in`-narrowing, not casts.
- Granular import: `import { createApp } from '@zmdb/web/app'`.

## Cross-links

- [Modules & providers](./web-modules.html) · [Request pipeline](./web-pipeline.html)
