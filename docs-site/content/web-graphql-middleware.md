> **ToDo / feature gap.** There is no GraphQL layer, so there is no GraphQL
> middleware — no `graphql-middleware`, no envelop `onExecute` hooks, no
> operation-level wrappers.

## The middleware that does exist

`@zmdb/web/middleware` defines four interfaces and a composer:

```ts
export interface Guard {
  canActivate(ctx: Ctx): boolean | Promise<boolean>;
}
export interface Pipe {
  transform(value: unknown, ctx: Ctx): unknown | Promise<unknown>;
}
export interface Interceptor {
  intercept(ctx: Ctx, next: ChainHandler): Promise<unknown>;
}
export interface ExceptionFilter {
  catch(error: unknown, ctx: Ctx): WebResponse | undefined;
}
```

`runChain(chain, ctx, handler)` runs them in order: guards, then pipes folding the body, then interceptors nested with the first outermost, then the handler, then filters on a throw.

```ts
const chain: Chain = { guards: [authGuard], pipes: [trimStrings], interceptors: [timing], filters: [dbErrors] };
const result = await runChain(chain, ctx, () => this.repo.list({ page: { limit: 20 } }));
```

> [!WARNING]
> **The router does not call `runChain`.** Registering a controller does not apply
> any chain — you must invoke it inside the handler. A `ChainError` that escapes to
> the router serialises as a 500, not as its own status. See
> [Request Lifecycle](./web-request-lifecycle.html).

That is the honest state of it: the composition primitives are built and tested; the wiring is not.

## Applying a chain in practice

Since it is a function call, factor it:

```ts
function guarded<T>(ctx: Ctx, handler: () => Promise<T>): Promise<T> {
  return runChain(STANDARD_CHAIN, ctx, handler) as Promise<T>;
}
```

```ts
@Get('/')
list(ctx: Ctx<Record<never, string>, unknown>) {
  return guarded(ctx, () => this.repo.list({ page: { limit: 20 } }));
}
```

One wrapper per handler, visible at the call site. Then a test that no handler forgot it:

```ts
it('every mutating route is guarded', async () => {
  for (const route of MUTATING) {
    const out = await app.request({ method: route.method, path: route.path, headers: {} });
    expect(out.status).toBe(400); // rejected without credentials
  }
});
```

A behavioural test rather than a convention. That is what makes hand-applied middleware trustworthy — a decorator would be forgotten just as easily, and the test catches both.

## Where an operation-level wrapper genuinely belongs

For concerns that must apply to _everything_, the adapter is the right place, and it is unaffected by the router's gaps:

```ts
createServer(async (req, res) => {
  const start = performance.now();
  const out = await app.handle(toWebRequest(req));
  metrics.observe('http_ms', performance.now() - start, { route: routeFor(req) ?? 'unmatched' });
  res.writeHead(out.status, { ...out.headers, 'x-content-type-options': 'nosniff' }).end(out.body);
});
```

Note the header: an adapter _can_ set response headers, where a handler cannot. Security headers, CORS and cookies all belong here for that reason. See [CORS](./web-cors.html).

## And for data access, the driver

Concerns that follow the data rather than the request compose as `Driver` wrappers — logging, tracing, retries, a query budget, replica routing:

```ts
const driver = instrumented(traced(withReplicas({ primary, replicas }), sink));
```

Each returns a `Driver`, so the composition is compiler-checked, and it covers every surface: REST handlers, a worker, a CLI backfill and a future GraphQL layer alike. This is where most middleware value lives in a data-heavy application.

## If you are running a GraphQL server

Use its middleware, and keep the layers separate: the GraphQL server's hooks for operations, zmdb's driver wrappers for queries. Sharing a container between them is one line:

```ts
const yoga = createYoga({ schema, context: () => ({ posts: app.container.resolve(POSTS) }) });
```

## What it will take

Two framework-internal changes, in order of value, and neither is blocked on GraphQL:

1. **Wire `runChain` into the router**, with a chain registrable per controller or per route. This is the single change that would make the existing middleware interfaces useful as designed.
2. **Let a filter's `WebResponse` reach the client**, so `ChainError(403, …)` produces a 403 rather than a 500. Today `ExceptionFilter.catch` returns a `WebResponse` that the router never sees.

Until they land, `runChain` called explicitly plus the adapter and driver layers is the supported arrangement.

The GraphQL side is frozen, in `packages/web/src/graphql/SPEC.md`, and it reuses these four interfaces rather than introducing a parallel set. There is **no `onExecute` hook and no plugin interface**, because `onExecute(ctx, next)` and `Interceptor.intercept(ctx, next)` are the same signature — see [Plugins](./web-graphql-plugins.html). Three things about the GraphQL wiring are worth knowing here, because each is visible from this page.

**A field's chain runs, without you calling it.** GraphQL is where `runChain` is wired first: the registry wraps each field's resolver, so unlike a route, a field with a chain declared on it actually gets one. The warning above is about the router, and it stays true.

**A chain is declared at one of three levels, and flattened once.** Global, per type, or on a single field; the three are concatenated at registration into exactly one `Chain` per field, so nothing walks a hierarchy per request. Guards, pipes and interceptors concatenate broadest-first; **filters concatenate narrowest-first**, because the first filter that returns a response wins and a global catch-all placed first would swallow every error before a field's own filter saw it — a failure that leaves every test green.

**A field with no chain in any layer is not wrapped at all.** The resolver map holds the bound method itself, so the cost of this feature to a schema that does not use it is zero rather than small.

The context change that makes all of this work is that a GraphQL context _is_ a `Ctx` — one guard, usable on a route and on a field, with a `kind` field to tell them apart when it matters. `runChain` becomes generic so the extra members (`parent`, `field`, `request`) survive the pipes in the type as well as at runtime.

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Guards](./web-middleware.html) · [Interceptors](./web-middleware.html)
