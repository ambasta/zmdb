> **ToDo / feature gap.** `compileModule` walks the whole import graph eagerly and
> builds every controller before `createApp` returns. There is no
> `LazyModuleLoader`, no deferred registration, and no way to add a module after
> startup.

## What happens today

```ts
export function createApp(rootModule: ModuleClass): App {
  const { container, controllers } = compileModule(rootModule);
  const router = createRouter();
  for (const controller of controllers) router.register(controller);
  // …
}
```

Every imported module is visited, every provider registered, every controller constructed with `new Ctor()`. If a module imports a heavy dependency at module scope, you pay for it at startup whether or not any request touches it.

## Why it matters less than it looks

Eager construction is cheap here, for structural reasons:

- **Providers are lazy already.** `useFactory` does not run until the first `resolve`, and a singleton caches. So a provider wrapping an expensive client costs nothing until used.
- **Controllers are `new Ctor()`.** No metadata reflection, no proxies, no dependency graph traversal per instance — field injection resolves tokens, and unresolved factories stay unresolved.
- **Repositories are objects over a driver.** `defineRepository(schema, driver, opts)` allocates an object; there is no engine to spin up.

So the eager pass is a walk of your module graph and one allocation per controller. On a large application that is milliseconds, not hundreds of them.

## What does cost you

The `import` statements, not the framework. This is a module-loading problem:

```ts
import { HeavyReportModule } from './reports/module.js'; // pulls in a PDF library at startup
```

Fix it where the cost is — with a dynamic import inside the provider:

```ts
{
  token: PDF,
  useFactory: async () => (await import('pdf-lib')).PDFDocument,
}
```

That defers the heavy module until the first `resolve`, which is the actual win people want from lazy modules. Note the factory returns a promise, so the token's type is `Promise<T>` and consumers await it — the container has no async resolution.

## Workaround — a second app, built on demand

If a whole subsystem should not exist until needed, build a second application lazily:

```ts
let reports: App | undefined;

async function reportsApp(): Promise<App> {
  if (reports === undefined) {
    const { ReportsModule } = await import('./reports/module.js');
    reports = createApp(ReportsModule);
    await reports.init();
  }
  return reports;
}

// in the adapter
if (req.path.startsWith('/reports')) return (await reportsApp()).handle(req);
return app.handle(req);
```

Nothing is global, so two apps coexist happily — see [Multiple Servers](./web-multiple-servers.html). The costs are real: two containers means shared providers are constructed twice, so put anything genuinely shared (the pool, the driver) in a module-scope value both import rather than in a provider each registers.

Guard the initialisation against concurrency by caching the _promise_, not the app, if two requests can race:

```ts
let pending: Promise<App> | undefined;
const reportsApp = () => (pending ??= buildReports());
```

## Workaround — a feature flag on the controller

The lightest option when the point is "this endpoint should not be available", not "this code should not be loaded":

```ts
@Get('/reports/:id')
async report(ctx: Ctx<{ id: string }>) {
  if (!features.reports) throw new ValidationError('not available', []);
  return this.service.build(ctx.params.id);
}
```

## What it would take

Two independent pieces:

- **A lazy loader.** `loadModule(ModuleClass)` returning a container for a subgraph, registered into the parent. The design question is what happens to a token the lazy module needs from its parent — which needs the parent container passed in, and then a resolution order between them. Not hard; it is a real API decision.
- **Adding routes after startup.** `Router` builds its route list at `register` time and `createApp` registers once. Exposing `app.register(controller)` would cover it, at the cost of the route table no longer being fixed after `init()` — which is currently a property worth something (it is why there is no per-request reflection).

Neither is blocked on anything deep. The reason it is not built is that the eager pass is cheap enough that the dynamic-import-in-a-factory workaround above covers most of the motivation.

---

See also: [Modules](./web-modules.html) · [Multiple Servers](./web-multiple-servers.html) · [Serverless Performance](./perf-serverless.html)
