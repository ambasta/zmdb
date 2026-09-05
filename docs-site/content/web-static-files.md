`createStaticHandler()` serves a directory through ordinary `WebResponse` values without letting a request escape that directory. It streams from one open file descriptor, generates validators,
handles one byte range, and makes every refused path indistinguishable from a missing file.

For production assets, a CDN, object store, or reverse proxy is still the better layer. The application handler is for development and deployments that genuinely have no static edge.

## Security boundary

Before any convenience option, the handler fixes these rules:

- request paths are decoded once and must remain relative to the configured root;
- null bytes, backslashes, absolute paths, drive letters, empty segments, dot-prefixed segments, and any surviving percent escape are refused;
- an opened symlink is followed only when its real target remains inside the root;
- directories, FIFOs, devices, sockets, unreadable files, and escaping paths all receive the same empty `404`;
- directory listing cannot be enabled. `index` is only an opt-in file for the empty path, not a listing or a single-page-application fallback.

The uniform `404` avoids turning the handler into a filesystem oracle. Refusal details go only to the required `onError` callback. Do not serve a directory the application also writes to: confinement
does not make attacker-supplied HTML safe to host on the application's origin.

## Create the handler once

```ts
import { createStaticHandler } from '@zmdb/web';

const assets = await createStaticHandler({
  root: '/var/www/assets',
  index: 'index.html',
  cacheControl: 'public, max-age=31536000, immutable',
  onError: error => log.error({ error }),
});
```

Construction is asynchronous because `root` is resolved to its real path once. A missing root, a regular file, a FIFO, or anything else that is not a directory rejects immediately rather than failing
on the first request.

`serve(pathname, headers)` expects a path relative to that root, with no leading slash:

```ts
@Controller('/assets')
class AssetController {
  @Get('/:file')
  asset(ctx: Ctx<{ file: string }>) {
    return assets.serve(ctx.params.file, ctx.headers);
  }
}
```

The current router has no wildcard route parameter. The example therefore serves one path segment; nested asset paths need explicit routes or a prefix branch in a custom adapter until wildcard routing
ships. The static handler itself accepts safe nested paths such as `css/app.css`.

## How confinement is enforced

The handler applies all of these checks before returning bytes:

- Percent-decode exactly once, then refuse any surviving `%`.
- Refuse malformed escapes, null bytes, backslashes, absolute paths, drive letters, UNC prefixes, empty segments, `..`, and every dot-prefixed segment.
- Resolve the candidate under the construction-time real root and require a separator-bounded containment match.
- Open once with non-blocking filesystem flags, refuse non-regular files, resolve the symlink target, and bind that target back to the opened descriptor.
- Follow a symlink only when its target stays inside the root.
- Read response metadata and bytes from the opened descriptor; cancellation closes it.

A traversal attempt, dotfile, directory, FIFO, escaping symlink, unreadable file, and ordinary miss all return the same empty `404` with `x-content-type-options: nosniff`. There is no `403` and no
client-visible reason: different answers would form a filesystem oracle.

`onError` receives refused paths, unreadable files, and symlink escapes. An ordinary missing asset does not call it, so a favicon miss does not become an alert.

Do not point the handler at the project root, and do not serve a directory the application also writes to. Serving uploaded HTML or JavaScript from the same origin is stored XSS even when path
confinement is perfect.

## Directory and index behavior

Directory listing cannot be enabled. A directory is always a `404`.

`index` is a separate opt-in used only when `serve()` receives the empty path. It does not add a single-page-application fallback, and it does not make unmatched paths return HTML. Keep SPA fallback
policy in the controller or adapter where the API/app boundary is visible.

## Validators and conditional requests

Every successful response carries:

- `etag: W/"<size>-<mtimeMs>"`;
- `last-modified` from the same opened file;
- `cache-control: public, max-age=0, must-revalidate` unless overridden;
- `accept-ranges: bytes`;
- `x-content-type-options: nosniff`.

The ETag is deliberately weak. Size plus modification time does not prove byte-for-byte identity, while a strong validator would require hashing the whole file and defeat streaming.

`If-None-Match` is evaluated before `If-Modified-Since`. A match returns `304` with validators and no body or `content-length`.

## Byte ranges

One byte range is supported without buffering:

| Request                       | Result                                                |
| ----------------------------- | ----------------------------------------------------- |
| `bytes=0-499` or `bytes=500-` | `206` with the exact streamed window                  |
| `bytes=-500`                  | last 500 bytes, clamped to the file size              |
| end past EOF                  | clamped to the last byte                              |
| start at or past EOF          | `416` with `content-range: bytes */<size>`            |
| malformed range               | ignored; the whole file is returned as `200`          |
| multiple ranges               | ignored; no `multipart/byteranges` implementation     |
| any `If-Range`                | ignored; the whole file is returned because ETag weak |

Ignoring a malformed or multi-range request is a valid HTTP response and avoids a partial multipart implementation. A range response reads only its requested window from the descriptor.

## Content types

Types come from a fixed extension allow-list. Unknown extensions use `application/octet-stream`; the handler never sniffs bytes or trusts a request header. Extend or override the map explicitly:

```ts
const assets = await createStaticHandler({
  root: '/var/www/assets',
  contentTypes: { '.wasm': 'application/wasm' },
  onError: error => log.error({ error }),
});
```

The handler does not set `content-disposition`. Use `file()` with an explicit, properly escaped filename for downloads.

## Prefer the edge for production assets

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

A long immutable lifetime is safe only for content-hashed filenames. Without hashed names, use revalidation or a short lifetime.

---

See also: [Streaming Files](./web-streaming-files.html) · [Compression](./web-compression.html) · [Deployment](./deployment.html)
