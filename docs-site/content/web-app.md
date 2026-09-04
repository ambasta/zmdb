`createApp` bootstraps an application from a root [module](./web-modules.html):
it compiles the DI graph, builds the [router](./web-pipeline.html), and registers
every controller's routes — **once**. It exposes lifecycle hooks and `await using`
graceful shutdown.

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

`app.lazy` contains the per-app handles for
[lazy module imports](./web-lazy-modules.html). It is empty for an all-eager
graph.

## Lifecycle hooks

Implement any of these on a controller (or provider) and they run at the right
time:

```ts
import type { OnModuleInit, OnApplicationBootstrap, OnShutdown } from '@zmdb/web';

class Db implements OnModuleInit, OnShutdown {
  onModuleInit() {
    /* connect */
  }
  onShutdown() {
    /* close pool */
  }
}
```

| phase     | order                                                       |
| --------- | ----------------------------------------------------------- |
| `init()`  | eager `onModuleInit` (all) → `onApplicationBootstrap` (all) |
| lazy load | that module's `onModuleInit` → `onApplicationBootstrap`     |
| shutdown  | `onShutdown` in **reverse** construction order              |

## Graceful shutdown with `await using`

`createApp` returns an `AsyncDisposable`, so Stage-3 explicit resource management
cleans up automatically:

```ts
await using app = createApp(AppModule);
await app.init();
// ... serve ...
// at scope exit: onShutdown hooks run (reverse order) via Symbol.asyncDispose
```

## Design notes

- **Bootstrap-time declarations** — the full graph is validated and every route
  is registered once. Lazy instances alone are deferred; the dispatcher reads
  no metadata per request.
- **No `as`** — hook detection uses structural `in`-narrowing, not casts.
- Granular import: `import { createApp } from '@zmdb/web/app'`.

## Cross-links

- [Modules & providers](./web-modules.html) · [Request pipeline](./web-pipeline.html)
