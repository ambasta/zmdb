What happens between a request arriving and a response leaving, in order, with nothing hidden. The whole path is about forty lines of `createRouter`, and reading it is the fastest way to understand the framework's limits.

## The order

1. **Adapter** — `toNodeHandler` or `toFetchHandler` builds a `WebRequest`: method, path (query string stripped), flattened headers, and `rawBody` parsed as JSON when the text is non-empty.
2. **Route match** — the method (uppercased) and the path's segment count select a bucket of candidate routes; those are tried in registration order, matched against patterns that were compiled at registration, and the first to match yields `params`. An empty or exhausted bucket means no match.
3. **Body validation** — if the route was registered with `validateBody`, it runs. A throw becomes **400** with `{ error, issues? }`.
4. **Ctx construction** — `{ params, body, query, headers, method, path }`.
5. **Handler** — awaited.
6. **Serialization** — the return value becomes **`200`** with `JSON.stringify(result)` and `content-type: application/json`, unless the handler returned a response built by `json`, `text` or `respond`, which is sent as-is.
7. **Errors** — a `ValidationError` (or any object with an `issues` property) becomes **400**; anything else becomes **500** with `{ error: message }`.
8. **No match** — **404** with `{ error: 'no route for GET /x' }`.

## Returning something other than a 200 JSON body

Return a plain value and you get `200 application/json`. To choose anything else, return one of three factories:

```ts
import { json, text, respond } from '@zmdb/web';

return json(created, { status: 201, headers: { location: `/posts/${id}` } });
return text(ctx.params.id); // text/plain, body verbatim
return respond({ status: 302, headers: { location: '/login' } }); // no assumed content-type
return respond({ status: 204 }); // no body
```

**A plain object is still a body, even if it has a `status` field.** This is the trap the design avoids:

```ts
return { status: 'draft', title: 'x' }; // a 200 whose JSON body is that object
return respond({ status: 404, body: '{"error":"not found"}' }); // an actual 404
```

The framework recognises a real response by a marker symbol the factories attach, not by looking for a `status` property — so `{ status: 'draft' }` cannot accidentally become an HTTP status. A hand-built `{ status, body, headers }` object is therefore **not** a response; it is a body. Use the factories.

Without them, the status codes a handler can produce are 200 (return), 400 (throw something with `issues`) and 500 (throw anything else).

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
  create: { validateBody: raw => assert<CreateDTO<Post>>(raw) },
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
const dto = assert<CreateDTO<Post>>(ctx.body);
```

There is no content-type negotiation, no form parsing and no multipart. See [Raw Body](./web-raw-body.html).

## Building the `WebRequest` yourself

Every page that maps statuses, sets a cookie, adds CORS headers or logs a request does it in a hand-written adapter, because those are the things the router cannot do — and such an adapter calls `app.handle(request)` with a `WebRequest` it built. **There is no `toWebRequest` helper to import.** `toNodeHandler(router)` owns the whole `(req, res)` pair and writes the response itself, so it cannot be used by an adapter that needs to touch either one. The build is a dozen lines; every sample on those pages calls this function, so it is written out once here:

```ts
import type { IncomingMessage } from 'node:http';
import type { WebRequest } from '@zmdb/web';

async function webRequest(req: IncomingMessage): Promise<WebRequest> {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  req.setEncoding('utf8');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return {
    method: req.method ?? 'GET',
    path: q === -1 ? url : url.slice(0, q),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : (value ?? '')]),
    ),
    query: Object.fromEntries(new URLSearchParams(q === -1 ? '' : url.slice(q + 1))),
    ...(raw.length > 0 ? { rawBody: JSON.parse(raw) as unknown } : {}),
  };
}
```

Four things it has to get right:

- **Consume the body before dispatching.** `req` is a stream; reading it after `app.handle` returns gets you nothing. `setEncoding('utf8')` installs a `StringDecoder` that holds a partial multi-byte sequence across chunk boundaries — concatenating `String(chunk)` instead corrupts any character whose UTF-8 bytes straddle a read.
- **Omit `rawBody` rather than passing `undefined`.** The type is `rawBody?: unknown` under `exactOptionalPropertyTypes`, and `JSON.parse('')` throws.
- **Flatten the headers.** `req.headers` values are `string | string[] | undefined`; `WebRequest.headers` is `Record<string, string>`.
- **Pass `query`, because the framework does not.** See below.

## Query strings

`toNodeHandler` strips the query string and does **not** populate `query`, so `ctx.query` is `{}` under the Node adapter. `toFetchHandler` also leaves it unset. The `query` line in `webRequest` above is what fixes it, and it is the reason a hand-written adapter is worth having even when you want nothing else from one. Repeated keys collapse to the last value there; `QueryValues` is `Record<string, string | readonly string[]>`, so keep the array if you need `?tag=a&tag=b`:

```ts
const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
const query = Object.fromEntries([...params.keys()].map(key => [key, params.getAll(key)]));
```

## What is not in the lifecycle at all

No middleware registration, no per-request DI scope, no ambient request context, no `AsyncLocalStorage`, no streaming (`WebResponse.body` is a `string`), no cancellation. Each has a page: [Request Context](./web-request-context.html), [Injection Scopes](./web-injection-scopes.html), [Streaming](./streaming.html), [Query Cancellation](./query-cancellation.html).

---

See also: [Standalone Applications](./web-standalone.html) · [Typed Request Context](./web-context.html) · [Guards](./web-middleware.html)
