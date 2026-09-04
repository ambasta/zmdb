There is no `app.enableCors()`, and CORS cannot be implemented inside a handler: the router builds the response headers and a handler cannot add to them. CORS belongs in your adapter, or at the proxy in front of it.

## In the adapter

```ts
import { createServer } from 'node:http';

const ALLOWED = new Set(['https://app.example.com', 'https://staging.example.com']);

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined || !ALLOWED.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

createServer(async (req, res) => {
  const headers = corsHeaders(req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers).end();
    return;
  }

  const out = await app.handle(await webRequest(req));
  res.writeHead(out.status, { ...out.headers, ...headers }).end(out.body);
});
```

Six details there are load-bearing.

**`webRequest(req)`.** There is no `toWebRequest` to import; `app.handle` takes a `WebRequest` the adapter builds itself, and it is written out in [Request Lifecycle](./web-request-lifecycle.html).

**`vary: origin`.** Without it, a shared cache or CDN serves the `access-control-allow-origin` computed for one origin to a request from another — which either breaks legitimate clients or grants access you did not intend.

**An allow-list, echoed.** The header must name a single origin, so with several allowed origins you echo the request's `Origin` **after** checking it against the set. Never echo it unchecked.

> [!WARNING]
> `access-control-allow-origin: *` with `access-control-allow-credentials: true` is
> rejected by browsers, and echoing an arbitrary `Origin` alongside credentials is
> equivalent to allowing every site to make authenticated requests as your users.
> That is a full account-takeover primitive. Use a fixed allow-list.

**Preflight short-circuits.** An `OPTIONS` request must not reach the router — there are no `OPTIONS` routes, so it would 404 and the browser would block the real request with a confusing error.

**`access-control-max-age`.** Caches the preflight, removing a round trip per request. Ten minutes is a reasonable default.

**Only the headers you need in `allow-headers`.** A browser will not send a header the server did not permit, and a wildcard here is not honoured with credentials.

## For a fetch adapter

```ts
const handle = toFetchHandler(app);

export default {
  async fetch(request: Request) {
    const headers = corsHeaders(request.headers.get('origin') ?? undefined);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const response = await handle(request);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  },
};
```

## At the proxy instead

Usually the better place — it applies before your process is involved, survives a restart, and is configured next to the TLS and header policy:

```nginx
add_header access-control-allow-origin "https://app.example.com" always;
add_header vary origin always;

if ($request_method = OPTIONS) { return 204; }
```

Every managed platform has an equivalent. Configure it in one place: CORS headers set at both the proxy and the application produce duplicated headers, which browsers reject.

## What CORS is not

CORS is a **browser** policy. It does not stop `curl`, a server-side client, or an attacker — anyone can send any request with any origin and read the response outside a browser. It only stops page JavaScript on another site from reading your responses.

So CORS is not authorisation, and it is not [CSRF protection](./web-csrf.html): a cross-site form post needs no preflight and is unaffected by your CORS policy. Authorise every request on its own merits.

## Development

```ts
const ALLOWED = new Set(
  process.env.NODE_ENV === 'production'
    ? ['https://app.example.com']
    : ['http://localhost:5173', 'http://localhost:3000'],
);
```

Gate the permissive list on the environment explicitly, so a wildcard cannot reach production by being the default.

## What it would take

For CORS to be a framework feature, a handler or a filter would need to set response headers — the same [handler-cannot-set-headers](./web-request-lifecycle.html) blocker affecting [cookies](./web-cookies-sessions.html), [CSRF](./web-csrf.html) and [caching](./web-caching.html). With that, CORS is an `Interceptor` plus an `OPTIONS` route.

Even then, the proxy remains the better place for a production deployment.

---

See also: [Security Headers](./web-security-headers.html) · [CSRF](./web-csrf.html) · [Request Lifecycle](./web-request-lifecycle.html)
