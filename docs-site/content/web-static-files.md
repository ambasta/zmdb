> **ToDo / feature gap.** There is no static file serving — no `ServeStaticModule`,
> no `useStaticAssets`. A handler can now set the status, headers and body via
> `respond()`, `bytes()` or `file()`. What remains is the security-sensitive
> handler that confines paths to a root and implements caching and ranges.
>
> The confinement, caching and range rules it will ship with are frozen in
> `packages/web/src/static/SPEC.md`, enumerated technique by technique. Two things
> below are corrected against it: the rejection status and the encoding check.

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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { bodyText } from '@zmdb/web';

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

async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> {
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
createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path.startsWith('/assets/') && (await serveStatic(req, res, path.slice('/assets'.length)))) return;

  const out = await app.handle({
    method: req.method ?? 'GET',
    path,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
    ),
  });
  res.writeHead(out.status, { ...out.headers }).end(await bodyText(out));
});
```

`app.handle` takes a `WebRequest`, which is `{ method, path, headers, rawBody?, query? }` — a
`path` with the query string already removed, not a `url`. This branch has one, so it reuses it;
[compression](./web-compression.html) shows the same construction with the body-reading half.
The custom fallback buffers an application stream; `toNodeHandler` is the
backpressure-aware adapter when no static-file branch is needed.

## The security details, which are the whole point

**Path traversal is the vulnerability here**, and it is not hypothetical — it is the most common way a static file handler leaks `/etc/passwd`, an `.env` file or a private key.

- `normalize` **then** check `startsWith(ROOT + '/')`. Checking before normalising is useless: `/assets/../../etc/passwd` normalises to something outside the root, and a naive check on the raw input passes it.
- The trailing slash in `ROOT + '/'` matters. Without it, `/var/www/assets-secret` passes a `startsWith('/var/www/assets')` check.
- **Do not serve a directory you also write to.** An upload directory served statically means an attacker who uploads an `.html` file gets stored XSS on your origin, and one who uploads a `.js` file gets script execution.
- **Never serve the project root.** `.git`, `.env`, `node_modules` and your source maps are all in there.
- Decode the URL before normalising, or `%2e%2e%2f` bypasses the check entirely. `req.url` from `node:http` is not decoded. **Decode exactly once, then refuse any surviving `%`** — a single decode leaves `%252e%252e%252f` intact, and a decode loop replaces one bypass with a question about when the loop terminates. A legitimate asset filename does not contain a percent sign.
- **Refuse a `\0`, a `\` and a leading `/` or `C:` outright**, and refuse any segment that is `..` or starts with `.`. The null byte truncates the path in any layer below that is C-shaped; the backslash is a separator on Windows; refusing dot-segments removes `.git`, `.env` and `.htaccess` as a class rather than as a list.
- **Re-check containment against the _real_ path**, after resolving symlinks. Every string check above passes for `/var/www/assets/backup` when that name is a symlink to `/home/app/.ssh`. The frozen policy is follow-within-root-only: a symlink whose target is inside the root is served, one that escapes is refused.
- **Open the file once and read everything from the descriptor** — size, mtime and bytes. A path checked and then re-opened by name is a time-of-check-to-time-of-use race: anyone who can create a file in the served directory replaces it with a symlink between the two operations, and all your checks passed on a file that no longer exists.
- **Refuse anything that is not a regular file.** Reading a FIFO blocks the handler forever and `/dev/zero` is an infinite response body — denial of service through a path containing no traversal at all.

**Every rejection should be the same `404`, not the `403` in the snippet above.** That is the one correction the freeze makes to this page's advice. Any distinction is an oracle: a `403` for "outside the root" and a `404` for "not found" tells an attacker exactly where the boundary is, so they can map the filesystem one request at a time without ever reading a file. Uniformity costs you one debugging session, which a required `onError` sink covers, and costs an attacker the whole reconnaissance phase.

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

Three things, not two. The response body change in [streaming files](./web-streaming-files.html); a handler that returns a `WebResponse` — so `serveStatic` is a controller method and not an adapter branch; and **wildcard route patterns**, which do not exist. `compilePattern` special-cases `:param` only, so `*` is a literal segment: `@Get('/assets/*')` matches the path `/assets/*` and nothing else, and `ctx.params['*']` is never populated. `Ctx<{ '*': string }>` typechecks structurally, so the sample below compiles today and cannot work.

```ts
// top-level await, so the root is resolved once before any request arrives
const assets = await createStaticHandler({ root: '/var/www/assets', onError: log });

@Controller('/assets')
class AssetController {
  @Get('/*')
  async asset(ctx: Ctx<{ '*': string }>) {
    return assets.serve(ctx.params['*'], ctx.headers);
  }
}
```

`createStaticHandler` is async because it resolves the root to its real path **once, at construction**, and refuses a root that is missing or is not a directory. Resolving per request would re-read the same symlinks on every request and, worse, would let a root that becomes a symlink at runtime change what the handler serves without the process noticing.

Four decisions in the freeze that differ from what a static handler usually does:

- **The `ETag` is labelled weak** — `W/"<size>-<mtimeMs>"`. Size and mtime cannot distinguish two files of the same length written in the same millisecond, and a strong validator would have to hash the file, which reads all of it and defeats the streaming this exists for. The label is load-bearing: a strong validator licenses a client to assemble byte ranges from two different responses, so `If-Range` is ignored for the same reason.
- **`cache-control` defaults to `public, max-age=0, must-revalidate`.** A `max-age` that is too long cannot be corrected for its duration, because the caches holding the stale copy never ask again. `immutable` is opt-in, for the content-hashed case where the operator knows the name changes when the bytes do.
- **Directory listing has no option that enables it**, and a path resolving to a directory is a `404`. An `index` filename is a separate opt-in and is off by default.
- **There is no single-page-application fallback inside the handler.** Which paths are the API and which are the app is a routing decision the handler cannot know, and a handler that guesses turns every mistyped API path into a `200` of HTML — which breaks clients in the most confusing way available. It stays in the controller, in one visible line.

Even with all of it, this is not the recommendation. A framework serving static files is convenient in development and the wrong layer in production, so the destination is a correct handler plus the proxy configuration above.

---

See also: [Streaming Files](./web-streaming-files.html) · [Compression](./web-compression.html) · [Deployment](./deployment.html)
