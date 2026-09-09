CORS is a router feature. Configure `policy.cors` on the application or the router; the policy answers preflights before routing and decorates every response, including error responses.

## Configure it on the application

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies AppModule; this excerpt does not repeat that declaration."}
import { createApp } from '@zmdb/web';

const app = createApp(AppModule, {
  policy: {
    cors: {
      origins: ['https://app.example.com', 'https://staging.example.com'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      headers: ['content-type', 'authorization'],
      exposeHeaders: ['x-request-id'],
      maxAgeSeconds: 600,
    },
  },
});
```

`createRouter` takes the same option, so a router assembled without the application kernel is configured identically:

```ts {"mode":"compile","id":"example-002"}
import { createRouter, type HttpPolicy } from '@zmdb/web';

const policy: HttpPolicy = { cors: { origins: ['https://app.example.com'] } };
const router = createRouter({ policy });
```

That is the whole feature. It works through `router.handle`, the Node adapter and the fetch adapter alike, because the policy is applied inside the router rather than by the transport.

## What the policy does

**Answers preflights before routing.** An `OPTIONS` request carrying `Origin` and `Access-Control-Request-Method` never reaches a route — it is answered with `204` when the origin, method and
requested headers are all allowed, and `403` when any of them is not. This matters because there are no `OPTIONS` routes to match: without the policy such a request 404s and the browser blocks the
real request with a confusing error. A preflight for a path you never registered is still answered.

An `OPTIONS` request _without_ those two headers is not a preflight and is routed normally, which means it 404s. That is deliberate: the policy intercepts genuine preflights only.

**Echoes a checked origin.** `access-control-allow-origin` must name a single origin, so with an allow-list the policy echoes the request's `Origin` after checking it against the list, and omits the
header entirely when the origin is not allowed. `origins: '*'` sends the literal wildcard instead.

**Merges `Vary` rather than replacing it.** `Origin` is appended to whatever `Vary` your handler already set — plus `Access-Control-Request-Method` and `Access-Control-Request-Headers` on a preflight.
Without that, a shared cache or CDN serves the `access-control-allow-origin` computed for one origin to a request from another, which either breaks legitimate clients or grants access you did not
intend.

**Decorates failures too.** A handler that throws still gets the CORS headers, so the browser can read the error your application produced instead of a cross-origin failure that hides it. The same
applies to the `413` a request over `maxBodyBytes` receives.

**Rejects unsafe combinations at startup.** `origins: '*'` together with `credentials: true` throws a `TypeError` from `createRouter`, and a `maxAgeSeconds` that is not a non-negative safe integer
throws a `RangeError`. These are configuration mistakes, so they fail when the router is built rather than on the request that would have been mishandled.

> [!WARNING] `access-control-allow-origin: *` with `access-control-allow-credentials: true` is rejected by browsers, and echoing an arbitrary `Origin` alongside credentials is equivalent to allowing
> every site to make authenticated requests as your users. That is a full account-takeover primitive, which is why the combination is refused rather than merely discouraged. Use a fixed allow-list or
> a predicate.

## The three defaults worth knowing

**`methods` defaults to `GET`, `HEAD`, `POST`.** Anything else — `PUT`, `PATCH`, `DELETE` — must be listed, or its preflight is refused with a `403`. Values are matched case-insensitively and sent
uppercased, so `methods: ['post']` is fine.

**`headers` defaults to empty**, and a preflight requesting a header that is not listed is refused. A cross-origin JSON `POST` triggers a preflight asking for `content-type`, so a policy that omits it
denies every JSON write:

```ts {"mode":"compile","id":"example-003"}
import type { HttpPolicy } from '@zmdb/web';

// Refuses cross-origin JSON writes: the browser asks for `content-type` and the list is empty.
const wrong: HttpPolicy = { cors: { origins: ['https://app.example.com'], methods: ['POST'] } };

const right: HttpPolicy = {
  cors: { origins: ['https://app.example.com'], methods: ['POST'], headers: ['content-type', 'authorization'] },
};
```

There is no wildcard for this list, and a wildcard would not be honoured alongside credentials anyway. List the headers your client actually sends.

**`maxAgeSeconds` is unset**, so browsers apply their own short default and preflight more often than they need to. Ten minutes is a reasonable value; it removes a round trip per request.

## A predicate instead of a list

Give `origins` a function when the set is computed — a per-tenant subdomain, or a list loaded at boot. It is called once per request, and only for requests that carry an `Origin`:

```ts {"mode":"compile","id":"example-004"}
import type { HttpPolicy } from '@zmdb/web';

const policy: HttpPolicy = {
  cors: {
    origins: origin => {
      const url = URL.parse(origin);
      return url?.protocol === 'https:' && url.hostname.endsWith('.example.com');
    },
    credentials: true,
  },
};
```

Match on a parsed URL rather than with `endsWith` on the raw string: `https://evil-example.com` ends with `example.com`, and `https://example.com.attacker.test` contains it.

## Development

```ts {"mode":"compile","id":"example-005"}
import type { HttpPolicy } from '@zmdb/web';

const origins = process.env.NODE_ENV === 'production' ? ['https://app.example.com'] : ['http://localhost:5173', 'http://localhost:3000'];

const policy: HttpPolicy = { cors: { origins, credentials: true, headers: ['content-type', 'authorization'] } };
```

Gate the permissive list on the environment explicitly, so a wildcard cannot reach production by being the default.

## At the proxy instead

Still a legitimate choice, and for a fixed single-origin deployment often the simpler one — it applies before your process is involved, survives a restart, and sits next to the TLS and header policy:

```nginx
add_header access-control-allow-origin "https://app.example.com" always;
add_header vary origin always;

if ($request_method = OPTIONS) { return 204; }
```

Configure it in one place. CORS headers set at both the proxy and the application produce duplicated headers, which browsers reject — so if you do this, set `cors: false` and leave the rest of the
policy in place:

```ts {"mode":"compile","id":"example-006"}
import type { HttpPolicy } from '@zmdb/web';

// The proxy owns CORS; the application still owns its security headers.
const policy: HttpPolicy = { cors: false, securityHeaders: { 'x-content-type-options': 'nosniff' } };
```

## What CORS is not

CORS is a **browser** policy. It does not stop `curl`, a server-side client, or an attacker — anyone can send any request with any origin and read the response outside a browser. It only stops page
JavaScript on another site from reading your responses.

So CORS is not authorisation, and it is not [CSRF protection](./web-csrf.html): a cross-site form post needs no preflight and is unaffected by your CORS policy. Authorise every request on its own
merits.

---

See also: [Security Headers](./web-security-headers.html) · [CSRF](./web-csrf.html) · [Request Lifecycle](./web-request-lifecycle.html)
