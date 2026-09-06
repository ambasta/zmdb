Applications start eagerly by default. Eager construction keeps initialization failures at startup and avoids charging the first matching request for setup. Reach for a lazy module when startup cost
matters and the subtree is genuinely optional: a cold-started process, a short-lived CLI, or a rarely used administrative surface.

Lazy modules defer construction without deferring validation. The complete module graph is checked when `createApp` runs; a lazy subtree's providers, controllers and lifecycle hooks are instantiated
only when one of its routes or its handle first loads it.

## Declare a lazy import

```ts
import { lazy, Module } from '@zmdb/app/modules';

@Module({
  imports: [CoreModule, lazy(AdminModule)],
})
class AppModule {}
```

`lazy()` takes the module class itself. It is an inert declaration: load state belongs to the compiled application, so two apps created from `AppModule` do not share a promise, instances or status.

Eager imports remain the default:

```ts
@Module({ imports: [CoreModule, AdminModule] })
class AppModule {}
```

Use the eager form when the module is required on most requests or when its factories and lifecycle hooks must be proven during startup.

## What is still eager

The module's JavaScript file has already been imported, so `lazy(AdminModule)` does not defer bundle bytes or module-scope work. It defers:

- provider registration and factory execution;
- controller construction and `@Inject` field resolution;
- `onModuleInit` and `onApplicationBootstrap`.

For a large optional library, put a dynamic `import()` inside a provider factory. The DI container remains synchronous, so such a token is a `Promise<T>` that its consumer explicitly awaits.

## Graph validation still happens at startup

`compileModule` validates both eager and lazy declarations before constructing any controller. Startup refuses:

- an injected token no module provides;
- an import cycle, including lazy edges, with the cycle path in the message;
- the same token registered by two modules;
- an eager controller that injects a token available only from a lazy subtree.

A factory, constructor, dynamic import or lifecycle hook can still throw only when the lazy module runs. Validation proves the declared wiring, not arbitrary application code. That first-load residue
is the reason eager remains the safer default when deferral has no measured benefit.

If a module is reachable through any eager import, it is eager everywhere. Its behavior does not depend on which `imports` entry happened to be visited first.

## Routes are fixed at startup

Routes belonging to lazy controllers are read from their classes and registered when the app is created. The first matching request waits while the controller subtree is constructed and initialized,
then invokes the handler normally.

No route is added after startup, and no decorator metadata is read per request. Route ordering and shadowing therefore remain the same before and after a load.

## Observe or trigger a load

```ts
const app = createApp(AppModule);
await app.init();

const admin = app.lazy.find(handle => handle.name === 'AdminModule');
console.log(admin?.status); // "unloaded"

await admin?.load();
console.log(admin?.status); // "loaded"
```

A handle's status is `'unloaded'`, `'loading'`, `'loaded'` or `'failed'`. Concurrent callers share one in-flight load, so ten requests construct the module once.

## Lifecycle and failure

A successful load runs `onModuleInit` for the new instances, then `onApplicationBootstrap`, before the triggering request reaches its handler. A module that never loads has no instances and receives
no `onShutdown`. Loaded lazy instances shut down before the eager instances they were created after.

A construction or hook failure is terminal for that module in the app. The handle stores the error value, reports `'failed'`, and every later caller receives the same error without rerunning
factories. Retrying over a shared container could duplicate a pool or retain half-built objects because container registration is not transactional.

Disposal waits for an in-flight load before shutdown and refuses a new lazy load with `@zmdb/app: application is shutting down`.

## Cost model

An app with no lazy imports uses the eager fast path. The repository-private startup helper reports `{ iters, totalMs, opsPerSec }` and remains available to controlled qualification runs without
becoming an application API. Timing depends on the graph and machine, so the helper imposes no universal threshold.

---

See also: [Modules](./web-modules.html) · [Application Lifecycle](./web-app.html) · [Serverless](./web-serverless.html) · [Benchmarks](./web-benchmarks.html)
