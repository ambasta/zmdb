What happens between a request arriving and a response leaving, in order, with nothing hidden. The whole path is about forty lines of `createRouter`, and reading it is the fastest way to understand the framework's limits.

## The order

1. **Adapter** — `toNodeHandler` or `toFetchHandler` builds a `WebRequest`: method, path (query string stripped), flattened headers, and `rawBody` parsed as JSON when the text is non-empty.
2. **Route match** — the method (uppercased) and the path's segment count select a bucket of candidate routes; those are tried in registration order, matched against patterns that were compiled at registration, and the first to match yields `params`. An empty or exhausted bucket means no match.
3. **Body validation** — if the route was registered with `validateBody`, it runs. A throw becomes **400** with `{ error, issues? }`.
4. **Ctx construction** — `{ params, body, query, headers, method, path }`.
5. **Handler** — awaited.
6. **Serialization** — the return value becomes **`200`** with `JSON.stringify(result)` and `content-type: application/json`.
7. **Errors** — a `ValidationError` (or any object with an `issues` property) becomes **400**; anything else becomes **500** with `{ error: message }`.
8. **No match** — **404** with `{ error: 'no route for GET /x' }`.

## The consequence you need to know

**A handler cannot set the status code or headers.** Whatever it returns is serialised as a 200:

```ts
@Get('/:id')
async byId(ctx: Ctx<{ id: string }>) {
  const post = await this.repo.findById(Number(ctx.params.id));
  return { status: 404, body: { error: 'not found' } };   // this is a 200 whose body is that object
}
```

The only status codes a handler can produce are 200 (return), 400 (throw something with `issues`) and 500 (throw anything else).

Signal a client error by throwing a validation-shaped error:

```ts
import { ValidationError } from '@zmdb/schema-core';

@Get('/:id')
async byId(ctx: Ctx<{ id: string }>) {
  const post = await this.repo.findById(Number(ctx.params.id));
  if (post === undefined) throw new ValidationError('post not found', []);
  return post;
}
```

That yields a 400, not a 404 — which is honest but not correct REST. If you need real status codes, wrap `app.handle` and post-process, or map in the adapter:

```ts
const out = await app.handle(req);
const body: unknown = JSON.parse(out.body);
const status = out.status === 400 && isNotFound(body) ? 404 : out.status;
res.writeHead(status, { ...out.headers }).end(out.body);
```

Ugly, and the honest description of where the framework is today. Everything downstream of it — [status codes](./web-exception-filters.html), [cookies](./web-cookies-sessions.html), [CORS](./web-cors.html), [caching headers](./web-caching.html), [redirects](./web-request-lifecycle.html) — needs the same wrapper.

## Route matching is first-match, in registration order

```ts
@Controller('/posts')
class C {
  @Get('/:id') byId() {}
  @Get('/latest') latest() {} // unreachable — '/:id' matched first
}
```

Declare literal paths before parameterised ones. There is no specificity ranking; the scan returns the first route whose method and pattern match.

## Validation runs before the handler, if you register it

```ts
const router = createRouter();
router.register(new PostsController(), {
  create: { validateBody: raw => assert<CreateDTO<typeof posts>>(raw) },
});
```

`RouteOptions` is keyed by **handler name** and has exactly one field, `validateBody`. A throw is turned into a 400 with the `issues` array if the error carries one, which is what `ValidationError` from `@zmdb/schema-core` provides.

> [!NOTE]
> `createApp` calls `router.register(controller)` with **no options**, so a module
> graph gets no automatic body validation. Validate inside the handler with
> `assert<T>(ctx.body)` instead, or build the router yourself.

## Guards, pipes and interceptors are not in this path

`@zmdb/web/middleware` exports `Guard`, `Pipe`, `Interceptor`, `ExceptionFilter`, `Chain` and `runChain`, and `runChain` composes them in a defined order — guards, then pipes folding the body, then interceptors nested outermost-first, then the handler, then filters on a throw.

But the router does not call it. To use a chain, wrap the handler yourself:

```ts
import { runChain, type Chain } from '@zmdb/web/middleware';

const chain: Chain = { guards: [authGuard], pipes: [], interceptors: [timing], filters: [] };

@Get('/')
list(ctx: Ctx) {
  return runChain(chain, ctx, () => this.repo.findAll());
}
```

A guard returning `false` throws `ChainError(403)`, and a throwing pipe throws `ChainError(400)` — but `ChainError` reaches the router as an ordinary error, so it serialises as a **500** unless you also map it. See [Guards](./web-middleware.html) and [Interceptors](./web-middleware.html).

## The body is parsed JSON, or the raw string

`parseJson` returns the parsed value, and falls back to the original text if parsing fails. So `ctx.body` is `unknown` and may be a string on malformed input — which is why validating it is not optional:

```ts
const dto = assert<CreateDTO<typeof posts>>(ctx.body);
```

There is no content-type negotiation, no form parsing and no multipart. See [Raw Body](./web-raw-body.html).

## Query strings

`toNodeHandler` strips the query string and does **not** populate `query`, so `ctx.query` is `{}` under the Node adapter. `toFetchHandler` also leaves it unset. If you need query parameters, parse them and pass `query` yourself when calling `app.handle`:

```ts
const url = new URL(req.url ?? '/', 'http://x');
const query = Object.fromEntries(url.searchParams);
await app.handle({ method, path: url.pathname, headers, query, rawBody });
```

## What is not in the lifecycle at all

No middleware registration, no per-request DI scope, no ambient request context, no `AsyncLocalStorage`, no streaming (`WebResponse.body` is a `string`), no cancellation. Each has a page: [Request Context](./web-request-context.html), [Injection Scopes](./web-injection-scopes.html), [Streaming](./streaming.html), [Query Cancellation](./query-cancellation.html).

---

See also: [Standalone Applications](./web-standalone.html) · [Typed Request Context](./web-context.html) · [Guards](./web-middleware.html)
