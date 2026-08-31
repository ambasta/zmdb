The request **middleware chain** — the NestJS analogue of guards, pipes,
interceptors and exception filters — composed **statically** per route and run in
a deterministic order with no reflection.

## The four roles

```ts
import type { Guard, Pipe, Interceptor, ExceptionFilter } from '@zmdb/web';

const AuthGuard: Guard = { canActivate: ctx => Boolean(ctx.headers.authorization) };

const TrimPipe: Pipe<{ name: string }, { name: string }> = {
  transform: v => ({ name: v.name.trim() }),
};

const Timing: Interceptor = {
  async intercept(ctx, next) {
    const start = Date.now();
    const result = await next(); // runs the rest of the chain (handler)
    console.log(ctx.path, Date.now() - start);
    return result;
  },
};

const NotFoundFilter: ExceptionFilter = {
  catch: err => (err instanceof RangeError ? { status: 404, body: '{}', headers: {} } : undefined), // undefined → let another filter/handler win
};
```

## Execution order

`runChain(chain, ctx, handler)` runs:

```
guards → pipes (fold the body) → interceptor(before) → handler → interceptor(after)
                                                                   ↘ on throw → exception filters
```

```ts
import { runChain, type Chain } from '@zmdb/web';

const chain: Chain = { guards: [AuthGuard], pipes: [TrimPipe], interceptors: [Timing], filters: [NotFoundFilter] };
const result = await runChain(chain, ctx, c => c.body);
```

- A **guard** returning `false` short-circuits with `ChainError(403)` — the
  handler never runs.
- A **pipe** that throws yields `ChainError(400)`; pipes **fold** the body
  left-to-right, and the handler sees the piped value.
- **Interceptors** nest (first listed = outermost), observing before **and** after.
- A thrown handler is offered to each **exception filter**; the first to return a
  response wins, otherwise the error rethrows for the [pipeline](./web-pipeline.html)
  to turn into a 500.

> [!WARNING]
> **The router does not call `runChain`.** `router.register(controller)` applies no
> chain, and `createApp` registers controllers with no options at all — so a chain
> runs only where you invoke it inside a handler. Two consequences follow: a
> `ChainError(403)` reaching the router serialises as a **500**, not a 403, and a
> filter's returned `WebResponse` is serialised as the **body of a 200**. See
> [Request Lifecycle](./web-request-lifecycle.html).

## Applying a chain in practice

Since it is a function call, factor the wrapper and use it at each handler:

```ts
const STANDARD: Chain = { guards: [AuthGuard], pipes: [TrimPipe], interceptors: [Timing], filters: [] };

@Get('/')
list(ctx: Ctx<Record<never, string>, unknown>) {
  return runChain(STANDARD, ctx, () => this.repo.list({ page: { limit: 20 } }));
}
```

Then a behavioural test that no handler forgot it — a convention nobody checks is
not a control:

```ts
it('every mutating route rejects an unauthenticated request', async () => {
  for (const route of MUTATING) {
    const out = await app.request({ method: route.method, path: route.path, headers: {} });
    expect(out.status).not.toBe(200);
  }
});
```

## Design notes

- **Static composition** — a chain is built once and executed per request; no
  reflection and no metadata reads on the request path.
- **Typed folding** — `Pipe<In, Out>` composes so the handler's body type follows
  from the pipes, with no `as` on the consumer surface.
- **Filters return `WebResponse`**, whose `body` is a **`string`** — stringify it
  yourself.
- Granular import: `import { runChain } from '@zmdb/web/middleware'`.

## Concerns that belong elsewhere

Anything that must apply to _every_ request, or that needs to set a status or a
response header, goes in your adapter rather than in a chain — see
[CORS](./web-cors.html) and [Exception Filters](./web-exception-filters.html).
Anything that follows the data rather than the request composes as a `Driver`
wrapper — logging, tracing, retries, a query budget, replica routing — which
covers handlers, workers and CLI scripts alike.

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Guards](./web-middleware.html) · [Interceptors](./web-middleware.html)
