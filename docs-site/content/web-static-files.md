> **ToDo / feature gap.** There is no static file serving — no `ServeStaticModule`,
> no `useStaticAssets`. A handler can now set the status, headers and body via
> `respond()`, so returning a small text asset is possible in userland; what is
> still missing is a module that maps a directory to routes, and streaming —
> `WebResponse.body` is a `string`, so the whole file is read into memory and
> binary content has to be handled outside the framework.

## Serve them somewhere else

For a production deployment this is the right answer regardless of framework. A CDN or object storage serves static assets with caching, range requests, compression and byte-range resumption that no application layer will match — and it does not consume your process's concurrency.

| Setup                               | How                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Vercel / Netlify / Cloudflare Pages | `public/` directory, served automatically                                      |
| S3 / R2 / GCS + CDN                 | upload at build time, point DNS at the CDN                                     |
| Nginx / Caddy in front              | `root` / `file_server` for `/assets`, proxy the rest                           |
| Container                           | a second container serving `/assets`, or an init container copying to a volume |

```nginx
location /assets/ {
  root /var/www;
  expires 1y;
  add_header cache-control "public, immutable";
}
location / {
  proxy_pass http://127.0.0.1:3000;
}
```

`immutable` with a one-year expiry is safe if your filenames are content-hashed (`app.a3f9c1.js`), which every bundler does by default. Without hashed names, do not do this — you will serve a stale bundle for a year.

## Workaround — serve from your adapter

When there is genuinely no proxy:

```ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = '/var/www/assets';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveStatic(req: NodeReq, res: NodeRes, urlPath: string): Promise<boolean> {
  const resolved = normalize(join(ROOT, urlPath));
  if (!resolved.startsWith(ROOT + '/')) {
    res.writeHead(403).end();
    return true;
  }

  const info = await stat(resolved).catch(() => undefined);
  if (info === undefined || !info.isFile()) return false;

  res.writeHead(200, {
    'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'public, max-age=31536000, immutable',
    etag: `"${info.size}-${info.mtimeMs}"`,
  });
  await pipeline(createReadStream(resolved), res);
  return true;
}
```

```ts
createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path.startsWith('/assets/') && (await serveStatic(req, res, path.slice('/assets'.length)))) return;

  const out = await app.handle(toWebRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

## The security details, which are the whole point

**Path traversal is the vulnerability here**, and it is not hypothetical — it is the most common way a static file handler leaks `/etc/passwd`, an `.env` file or a private key.

- `normalize` **then** check `startsWith(ROOT + '/')`. Checking before normalising is useless: `/assets/../../etc/passwd` normalises to something outside the root, and a naive check on the raw input passes it.
- The trailing slash in `ROOT + '/'` matters. Without it, `/var/www/assets-secret` passes a `startsWith('/var/www/assets')` check.
- **Do not serve a directory you also write to.** An upload directory served statically means an attacker who uploads an `.html` file gets stored XSS on your origin, and one who uploads a `.js` file gets script execution.
- **Never serve the project root.** `.git`, `.env`, `node_modules` and your source maps are all in there.
- Decode the URL before normalising, or `%2e%2e%2f` bypasses the check entirely. `req.url` from `node:http` is not decoded.

**`content-type` must be a fixed allow-list**, as above. Deriving it from the request, or falling back to something permissive, is how a `.txt` file gets interpreted as HTML. `application/octet-stream` as the default is deliberately boring — it downloads rather than renders.

Add `x-content-type-options: nosniff` so a browser does not second-guess you.

## A single-page application fallback

```ts
if (!path.startsWith('/api/') && !(await serveStatic(req, res, path))) {
  await serveStatic(req, res, '/index.html'); // client-side router takes over
  return;
}
```

Send `index.html` with `cache-control: no-cache` while the hashed assets get the long expiry — otherwise a deploy leaves clients holding an `index.html` that references bundles you deleted.

## What it would take

The same core change as [streaming files](./web-streaming-files.html): a response body that can be bytes or a stream, and a way for a handler to set status and headers. Then `serveStatic` is a controller.

Even then it would not be the recommendation. A framework serving static files is convenient in development and the wrong layer in production, so the realistic destination is a small dev-only helper plus the proxy configuration above.

---

See also: [Streaming Files](./web-streaming-files.html) · [Compression](./web-compression.html) · [Deployment](./deployment.html)
