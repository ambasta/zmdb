> **ToDo / feature gap.** There is no compression middleware, and there cannot be
> one at the handler level: `WebResponse.body` is a `string`, and a gzip payload is
> bytes. A handler also cannot set `content-encoding`, since the router controls
> the response headers.

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
import { createGzip, createBrotliCompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

createServer(async (req, res) => {
  const out = await app.handle(toWebRequest(req));

  const accept = String(req.headers['accept-encoding'] ?? '');
  const encoding = accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : undefined;

  if (encoding === undefined || out.body.length < 1024) {
    res.writeHead(out.status, { ...out.headers }).end(out.body);
    return;
  }

  res.writeHead(out.status, { ...out.headers, 'content-encoding': encoding, vary: 'accept-encoding' });
  const compressor = encoding === 'br' ? createBrotliCompress() : createGzip();
  await pipeline(Readable.from([out.body]), compressor, res);
});
```

Four details that are not optional:

- **`vary: accept-encoding`.** Without it a shared cache serves a gzip response to a client that did not ask for one, and that client sees binary garbage.
- **The 1024-byte threshold.** Compressing a 200-byte JSON response makes it larger and costs CPU.
- **Honour `accept-encoding`.** Sending brotli to a client that only advertised gzip breaks it.
- **Do not set `content-length`.** The compressed length differs; the framework's headers do not include it, but if you add one, remove it here.

## Do not compress everything

**Already-compressed content.** Images, video, PDFs, zip files — compressing them wastes CPU and can grow the payload. Filter by content type.

**Responses containing a secret alongside attacker-controlled input.** Compression ratio leaks information about the plaintext, which is the BREACH attack: an attacker who can inject text into a response that also contains a CSRF token can recover the token from response sizes. If you compress a response containing both, either do not compress it, or make the secret vary per response. Rare in a JSON API, real in server-rendered HTML.

## Compress the payload instead

Often the bigger win, and available today:

```ts
await repo.list({ select: ['id', 'title'], page: { limit: 20 } });
```

A response that does not include the fields the client ignores needs no compression. `select` narrows the SQL and the type together — see [Query Performance](./perf-queries.html). Cutting a 200KB response to 20KB beats compressing 200KB, and it saves the database work too.

## What it would take

The same change as [streaming files](./web-streaming-files.html): widen `WebResponse.body` beyond `string`, and let a handler or a filter set response headers. Then compression is a `Interceptor`-shaped wrapper — though even with that, the honest recommendation would remain "do it at the edge", because a CDN caches the compressed bytes and your process does not.

That makes this a low-priority gap despite being conspicuously absent: the workaround is one proxy directive, and the proxy does it better.

---

See also: [Streaming Files](./web-streaming-files.html) · [Query Performance](./perf-queries.html) · [Deployment](./deployment.html)
