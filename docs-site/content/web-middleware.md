The request **middleware chain** — the NestJS analogue of guards, pipes,
interceptors and exception filters — composed **statically** per route and run in
a deterministic order with no reflection.

## The four roles

```ts
import { json, type Guard, type Pipe, type Interceptor, type ExceptionFilter } from '@zmdb/web';

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
  catch: err => (err instanceof RangeError ? json({}, { status: 404 }) : undefined), // undefined → let another filter/handler win
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
- An ordinary **pipe** throw yields `ChainError(400)`; built-in boundary pipes
  can preserve a framework status (`multipartPipe` uses 400/413). Pipes
  **fold** the body left-to-right, and the handler sees the piped value.
- **Interceptors** nest (first listed = outermost), observing before **and** after.
- A thrown handler is offered to each **exception filter**; the first to return a
  response wins, otherwise the error rethrows for the [pipeline](./web-pipeline.html)
  to turn into a 500.

The router resolves an effective guard chain from `GuardRegistry.app`,
`GuardRegistry.controllers[controllerName]`, then `RouteOptions.guards`.
It returns 403 before validation or handler invocation when one returns false.
`@Public()` bypasses inherited app/controller guards. The router does not run the
rest of a `Chain`; pipes, interceptors and filters remain explicit `runChain`
calls. `createApp` constructs its router without a registry or per-route options.

> [!WARNING]
> A `ChainError(403)` thrown by an explicit `runChain` call still reaches the
> router as an ordinary error and serialises as **500**. A filter response built
> as an untagged `{ status, body, headers }` literal is serialised as the **body
> of a 200**; responses built with `json`, `text`, `bytes`, `stream` or `respond`
> keep their own status and headers. See
> [Request Lifecycle](./web-request-lifecycle.html).

The multipart boundary error is narrower than a user-created `ChainError`: the
router recognises that internal error so malformed framing remains 400 and a
limit remains 413.

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
- **Filters return `WebResponse`**. Build one with `json`, `text`, `bytes`,
  `stream` or `respond`; use `bodyText` only when middleware deliberately needs
  to consume a body.
- Granular import: `import { runChain } from '@zmdb/web/middleware'`.

## Concerns that belong elsewhere

Anything other than a guard that must apply to _every_ request, or anything that
needs to set a status or response header, goes in your adapter rather than in a
chain — see [CORS](./web-cors.html) and
[Exception Filters](./web-exception-filters.html).
Anything that follows the data rather than the request composes as a `Driver`
wrapper — logging, tracing, retries, a query budget, replica routing — which
covers handlers, workers and CLI scripts alike.

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Guards](./web-middleware.html) · [Interceptors](./web-middleware.html)
