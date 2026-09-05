`compress(response, ctx)` negotiates gzip or deflate and transforms text, bytes, or an existing stream incrementally. It is the application-layer fallback for a deployment with no reverse proxy or
CDN.

Prefer compression at the edge when one exists. A CDN compresses once and caches the encoded representation; an application repeats the CPU work for every request.

## Compress a response

```ts
import { compress, json } from '@zmdb/web';

@Get('/report')
report(ctx: Ctx) {
  return compress(json(buildReport()), ctx);
}
```

The function preserves handler-controlled responses, appends `vary: accept-encoding`, removes the old `content-length`, and returns a stream body whose length is unknown until it finishes.

`compressionInterceptor()` is the same operation as an `Interceptor` for code that already composes a middleware chain:

```ts
const compression = compressionInterceptor({
  minBytes: 2048,
  skip: (response, ctx) => ctx.path === '/secret-form',
});
```

There is no global registration or module-level state. Call `compress()` directly from a handler/custom adapter, or place the interceptor in an explicit chain.

## Negotiation

Supported content codings are exactly `gzip` and `deflate`.

- Missing `accept-encoding` means no compression.
- `q=0` forbids a coding, even if the same coding appears again.
- Client quality values win; equal values prefer gzip.
- `*` applies only to codings not explicitly named.
- If no supported coding remains and identity is also forbidden by `identity;q=0` or an applicable `*;q=0`, the result is an empty `406`.

Brotli, zstd, and `deflate-raw` are not part of the public union. The web platform's `CompressionStream` on the supported Node runtime accepts gzip and deflate but rejects `br`; using `node:zlib`
would make this otherwise Fetch-runtime middleware Node-only. Brotli for cached assets belongs at the edge.

## What is not compressed

Compression is skipped when:

- `content-encoding` is already present, including `identity`;
- the status is informational, `204`, or `304`;
- the request method is `HEAD`;
- `content-type` is absent or outside the allow-list;
- a text/byte body is below `minBytes` (default 1024 bytes);
- a stream declares a length below `minBytes`;
- `skip(response, ctx)` returns `true`.

An unknown-length stream is compressed without buffering to discover its size. The default media types are `text/*`, JSON, JavaScript, XML, XHTML, SVG, and `+json`/`+xml` subtypes. `types` replaces
that list with explicit media types or patterns such as `text/*` and `*+json`.

`vary: accept-encoding` is still appended when compression is skipped. The header records that the representation depended on request negotiation; omitting it lets a shared cache serve encoded bytes
to a client that cannot decode them.

## Incremental body transform

Text and bytes become a single source chunk, then pass through `CompressionStream`. Existing streams pipe through directly. The implementation does not materialize a stream or recompute compressed
length, and measured tests verify that compressed bytes arrive before the source produces its final chunk.

Source failures remain visible on the compressed stream. A stream created by `stream()` still reports through its original `onError` sink, and the adapter owns the post-headers connection-destroy
behavior.

## BREACH

Do not compress a response that contains both a long-lived secret and attacker-controlled text. Compression ratios can reveal whether injected text matches the secret; TLS does not hide response
length.

The framework cannot infer which fields are secret or attacker-controlled. `skip(response, ctx)` is the explicit escape hatch:

```ts
const safe = compress(response, ctx, {
  skip: (_response, request) => request.path === '/account/recovery',
});
```

This is guidance, not an automatic protection flag. The right answer is to avoid placing stable secrets beside reflected input, rotate/mask the secret, or skip compression for that response.

## Edge configuration

```nginx
gzip on;
gzip_types application/json text/plain text/css application/javascript;
gzip_min_length 1024;
```

```text
# Caddy
encode zstd gzip
```

Managed platforms commonly provide this layer already. Use the application middleware only when that layer is genuinely absent.

---

See also: [Streaming Files](./web-streaming-files.html) · [Static Files](./web-static-files.html) · [Deployment](./deployment.html)
