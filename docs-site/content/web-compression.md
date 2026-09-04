> **ToDo / feature gap.** There is no compression middleware. The response union
> prerequisite has shipped, so the remaining work is negotiation and an
> incremental transform over text, bytes and streams.
>
> The policy it will ship with is frozen in
> `packages/web/src/compression/SPEC.md`, including which encodings and why brotli
> is not one of them. A handler **can** set `content-encoding` — `respond()` takes
> arbitrary headers, and an earlier version of this page said it could not.

## Where to compress instead

For almost every deployment, not in the application. This is a case where the missing feature is genuinely something else's job.

**A reverse proxy or CDN.** Nginx, Caddy, Cloudflare, Fastly and every managed platform compress responses, and they do it in C against a tuned buffer rather than in your event loop.

```nginx
gzip on;
gzip_types application/json text/plain;
gzip_min_length 1024;
```

```
# Caddy — brotli and gzip, negotiated
encode zstd gzip
```

Vercel, Netlify, Cloudflare Pages and Fly all compress by default with no configuration. If you deploy to any of them, this gap has no effect on you at all.

**A load balancer.** ALB and Cloud Load Balancing both do it.

Compressing at the edge is also strictly better than compressing in the application: the CDN caches the compressed representation once and serves it to everyone, where an application compresses the same bytes per request.

## Workaround — compress in your adapter

When you genuinely have no proxy — a bare `node:http` server on a VM:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createGzip, createBrotliCompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { bodyText } from '@zmdb/web';

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const out = await app.handle({
    method: req.method ?? 'GET',
    path: q === -1 ? url : url.slice(0, q),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
    ),
  });

  const accept = String(req.headers['accept-encoding'] ?? '');
  const encoding = accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : undefined;

  const body = await bodyText(out);
  const size = new TextEncoder().encode(body).byteLength;

  if (encoding === undefined || size < 1024) {
    res.writeHead(out.status, { ...out.headers }).end(body);
    return;
  }

  res.writeHead(out.status, { ...out.headers, 'content-encoding': encoding, vary: 'accept-encoding' });
  const compressor = encoding === 'br' ? createBrotliCompress() : createGzip();
  await pipeline(Readable.from([body]), compressor, res);
});
```

Five details that are not optional:

- **`WebRequest` has `path`, not `url`.** The query string is a separate optional `query` field, so the adapter has to split it off — handing the whole `req.url` to `handle` matches no route the moment a request carries `?`, and `{ url }` does not even compile against `WebRequest`. `toNodeHandler` does this same `indexOf('?')`/`slice` internally — and does not fill `query` in either, so `ctx.query` is `{}` under the node adapter unless your own adapter parses it.
- **`vary: accept-encoding`.** Without it a shared cache serves a gzip response to a client that did not ask for one, and that client sees binary garbage.
- **The 1024-byte threshold, measured in bytes.** JavaScript string length is
  UTF-16 code units, so a 1,024-character CJK document is about 3 KiB — hence
  the `TextEncoder` above. Compressing a 200-byte JSON response makes it larger
  and costs CPU.
- **Honour `accept-encoding`.** Sending brotli to a client that only advertised gzip breaks it.
- **Do not set `content-length`.** The compressed length differs; the framework's headers do not include it, but if you add one, remove it here.

## Do not compress everything

**Already-compressed content.** Images, video, PDFs, zip files — compressing them wastes CPU and can grow the payload. Filter by content type.

**Responses containing a secret alongside attacker-controlled input.** Compression ratio leaks information about the plaintext, which is the BREACH attack: an attacker who can inject text into a response that also contains a CSRF token can recover the token from response sizes. If you compress a response containing both, either do not compress it, or make the secret vary per response. Rare in a JSON API, real in server-rendered HTML.

The framework cannot decide this for you and the freeze says so rather than shipping an "automatic BREACH protection" flag: deciding it requires knowing that one field is a secret and another is attacker-controlled, and neither is visible in a `WebResponse`. What it does instead is take the three honest positions — the guidance above, a named `skip(response, ctx)` escape hatch, and one structural fix for the canonical case. [CSRF tokens](./web-csrf.html) will be masked with a fresh random value per response (frozen, not built), so the secret is different bytes every time and has no stable ratio to leak. That keeps working when somebody forgets the guidance, which an exclusion rule does not.

## Compress the payload instead

Often the bigger win, and available today:

```ts
await repo.list({ select: ['id', 'title'], page: { limit: 20 } });
```

A response that does not include the fields the client ignores needs no compression. `select` narrows the SQL and the type together — see [Query Performance](./perf-queries.html). Cutting a 200KB response to 20KB beats compressing 200KB, and it saves the database work too.

## What it would take

The chain wiring that gives an `Interceptor` somewhere to run — `runChain` folds
interceptors today and the pipeline has never called it — and then an
`Interceptor` over the shipped union: `compress(response, ctx, options)` as a
pure function with the interceptor as a thin wrapper.

Three decisions in the freeze are worth knowing now, because they contradict what you might expect.

**Brotli is declined.** `CompressionStream` supports `gzip`, `deflate` and `deflate-raw` and not `br` — `new CompressionStream('br')` throws on the Node this project targets, and there is no `zstd` either. Supporting brotli means `node:zlib`, which makes the middleware Node-only in a package whose response model was designed so `toFetchHandler` works on any Fetch runtime, and adds a Node-stream-to-web-stream conversion to the one path that is supposed to be a straight pipe. The case brotli wins — an asset compressed once at high quality and cached — is exactly the case this page says belongs at the edge, where brotli already exists.

**The content-type list is an allow-list, not a deny-list of already-compressed formats.** The failure modes are asymmetric: a missing deny-list entry spends CPU inflating a JPEG on every request, a missing allow-list entry costs bandwidth and nothing else.

**`vary: accept-encoding` is added even when the middleware decides _not_ to compress.** The header describes what the response depended on, not what happened. This is the detail most implementations get wrong, and getting it wrong means a shared cache stores whichever representation it saw first and serves gzip bytes to a client that cannot decode them.

Even with all of it, the recommendation stays "do it at the edge": a CDN caches the compressed representation once and your process compresses per request. The workaround is one proxy directive and the proxy does it better.

---

See also: [Streaming Files](./web-streaming-files.html) · [Query Performance](./perf-queries.html) · [Deployment](./deployment.html)
