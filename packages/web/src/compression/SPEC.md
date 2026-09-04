# `@zmdb/web` — response compression SPEC

> Negotiating a content coding and compressing a `ResponseBody` incrementally
> (epic #564, sub-issue #565). Frozen before code.

#565's file list does not name this spec, but #566 names a `compression.spec.ts`
and epic #564's item 3 is a compression requirement, so the policy has to be frozen
somewhere. It is here rather than in `../pipeline/SPEC.md` because compression is a
middleware over the response union and not part of the pipeline's contract, and
rather than in `../static/SPEC.md` because it applies to every response and not only
to files.

The `../pipeline/SPEC.md` streaming amendment shipped in #567. Compression remains
a separate middleware over that union; this spec owns negotiation and the
incremental transform, not the response model.

## 1. The honest recommendation comes first

Compressing at the edge is better than compressing in the application, and the spec
saying so is not a hedge. A CDN compresses once and serves the result to everybody;
an application compresses the same bytes for every request, on the event loop, in a
process that is also serving other requests. Every managed platform does it by
default and every reverse proxy does it in two lines of configuration.

This middleware exists for the deployment that genuinely has no proxy — a
`node:http` server on a VM, or a fetch-runtime worker with no CDN in front. It is
built to be correct, not to be the recommendation.

## 2. The surface

```ts
export type ContentCoding = 'gzip' | 'deflate';

export interface CompressionOptions {
  readonly minBytes?: number; // default 1024
  readonly types?: readonly string[]; // default TEXTUAL_TYPES
  readonly skip?: (response: WebResponse, ctx: AnyCtx) => boolean;
}

export declare function compress(response: WebResponse, ctx: AnyCtx, options?: CompressionOptions): WebResponse;
export declare function compressionInterceptor(options?: CompressionOptions): Interceptor;
```

`compress` is a pure function of a response and a request context, and the
`Interceptor` is a thin wrapper over it. That split is deliberate: everything worth
testing about negotiation and exclusion is testable without a pipeline, and a
deployment that drives the router itself can call `compress` from its own adapter,
which is what the docs page already tells people to do by hand.

Nothing is registered globally and no state is held between requests, per §2.7.

## 3. Brotli and zstd are declined, with a measured reason

The web platform's `CompressionStream` supports `gzip`, `deflate` and
`deflate-raw`. It does **not** support `br` — `new CompressionStream('br')` throws
`Failed to construct 'CompressionStream': 1st argument 'br' is not a valid enum
value of type CompressionFormat`, verified on the Node this repo runs (v26.8.1) —
and it does not support `zstd`.

So supporting brotli means `import { createBrotliCompress } from 'node:zlib'`, and
that has two costs that are not worth paying here:

1. It makes this middleware **Node-only**, in a package whose response model was
   just designed so that `toFetchHandler` works on any Fetch runtime. A feature that
   silently does nothing on half the supported runtimes is worse than a feature that
   is documented as absent.
2. It adds a Node stream-to-web-stream conversion to the one path in the package
   that is supposed to be a straight pipe.

And the case brotli wins — a static asset compressed once at a high quality level
and cached — is precisely the case §1 says belongs at the edge, where brotli is
already available. A client that advertises `br` and gets `gzip` is not broken; it
is slightly less compressed.

`deflate` is supported because it is one enum value away and some old clients only
offer it. `deflate-raw` is not, because no client asks for it.

## 4. Negotiating `Accept-Encoding`

Parse the header into `(coding, q)` pairs, defaulting `q` to `1`:

1. A coding with `q=0` is **forbidden**, not merely unpreferred, and is removed
   from consideration even if it appears again.
2. Order the codings we can actually produce (`gzip`, `deflate`) by the client's
   `q`, breaking ties in our own preference order — `gzip` first, because it is
   universally supported and slightly cheaper than `deflate` for the same output.
3. `*` matches any coding not otherwise named, with its own `q`.
4. If nothing acceptable remains, do not compress. If in addition
   `identity;q=0` (or `*;q=0` with no explicit `identity`) was sent — the client
   said uncompressed is unacceptable and we cannot satisfy anything it will
   accept — answer **`406`** with an empty body, per RFC 9110 §12.5.3. This is the
   one path where the middleware changes the status, and it is a real client
   configuration rather than a hypothetical.
5. A missing `Accept-Encoding` means no compression. It does not mean `identity;q=0`
   and it does not mean gzip is safe to assume.

## 5. When compression is skipped

In order, and every one of them a refusal rather than a preference:

- `response.headers['content-encoding']` is already set. Something upstream encoded
  this body and re-encoding it is a bug, not double the compression.
- The response status is `204`, `304`, or any `1xx`. There is no body to compress.
- The request method is `HEAD`. The body will not be sent, so compressing it wastes
  the work and — worse — produces a `content-length` for a representation that never
  ships.
- The `content-type` is not in the allow-list (§6).
- The body is `text` or `bytes` and shorter than `minBytes` (default 1024). Below
  that the gzip header and dictionary make the output larger, and the CPU is spent
  for a negative result.
- The body is a `stream` with a known `length` below `minBytes`, by the same rule.
  A `stream` with **no** known length is compressed regardless of size, because
  there is no way to learn the size without buffering the thing streaming exists to
  avoid. That asymmetry is stated here so nobody later "fixes" it by buffering.
- `skip(response, ctx)` returned `true` (§8).

## 6. The content-type allow-list

Compression applies only to a `content-type` whose media type is in the list:
`text/*`, `application/json`, `application/javascript`, `application/xml`,
`application/xhtml+xml`, `image/svg+xml`, and any subtype ending `+json` or `+xml`.

An allow-list rather than a deny-list of already-compressed formats, and the
asymmetry of the failure modes is the argument. A deny-list that is missing an entry
spends CPU inflating a JPEG that is already compressed — a real cost, on every
request, for a payload that got bigger. An allow-list that is missing an entry
leaves a compressible response uncompressed, which costs bandwidth and nothing else.
The same reasoning picks an allow-list in `../static/SPEC.md` §7 and
`../upload/SPEC.md` §4; unfamiliar input is refused rather than accommodated.

A response with no `content-type` at all — which `respond()` produces on purpose —
is not compressed. Guessing the type of a body whose author declined to declare one
is exactly the sniffing this package refuses to do elsewhere.

## 7. Headers after compressing

- `content-encoding: <coding>`.
- **`vary: accept-encoding`, appended whenever this middleware examined the
  header** — including when it decided _not_ to compress. This is the detail that
  matters most and the one most often got wrong: without `Vary`, a shared cache
  stores whichever representation it saw first and serves gzip bytes to a client
  that cannot decode them. The header describes what the response _depended on_, not
  what happened, so a skipped compression still varies.
- **`content-length` is removed and not recomputed.** The compressed length is not
  known until the stream ends, and the framing rules in `../pipeline/SPEC.md` §A5
  already produce a chunked response when no length is present. Keeping the original
  length is a truncated response; buffering to compute the new one defeats the
  point.
- `etag`, if present, is left as-is. It is a weak validator (`../static/SPEC.md`
  §6) and a weak validator is allowed to identify several representations of the
  same resource, which is exactly the relationship between the coded and uncoded
  forms. A strong `ETag` would have to be varied per coding, which is one more
  reason §6 there does not claim one.

## 8. BREACH, and what the framework can honestly do about it

Compression leaks the _ratio_ of a response, and the ratio depends on whether
attacker-supplied text matches a secret already in the body. That is BREACH: an
attacker who can get their own string reflected into a page that also contains a
token recovers the token a character at a time by watching response sizes. It needs
no cryptographic weakness and TLS does not help.

The framework cannot detect this. Deciding it requires knowing that a particular
field is a secret and that a particular other field is attacker-controlled, and
neither is visible in a `WebResponse`. Pretending otherwise — an
"automatic BREACH protection" flag — would be the protection theatre this epic
rejects elsewhere.

So there are three honest positions, and all three are taken:

1. **The guidance, stated plainly.** Do not compress a response that contains both a
   long-lived secret and attacker-controlled input in the same body. In a JSON API
   this is rare; in server-rendered HTML with a token in a form it is the default
   arrangement.
2. **The escape hatch, named.** `skip(response, ctx)` is the supported way to say
   "not this one", and it takes the response so a handler can mark its own output
   however it likes.
3. **The one case the framework fixes structurally.** The canonical BREACH target is
   a CSRF token, and `../csrf/SPEC.md` §5 masks its token with a fresh random value
   per response. A secret that is different bytes every time has no ratio to leak,
   so the interaction is removed rather than mitigated — which is better than an
   exclusion rule, because it keeps working when somebody forgets the rule.

## 9. How the body is compressed

```ts
const encoded = body.kind === 'text' ? new TextEncoder().encode(body.value) : body.value;
```

- `text` and `bytes` become a single-chunk `ReadableStream` piped through
  `new CompressionStream(coding)`, and the result is a `stream` body with
  `length: undefined`. The response therefore stops carrying a `content-length`,
  which §7 already requires.
- `stream` is piped through directly, which is the whole point: nothing is
  materialised and the first compressed bytes ship before the last source bytes
  exist.
- A failure inside the compressor is a failure after the first byte, so it is
  `../pipeline/SPEC.md` §A3's destroy path with the original response's `onError`.
  The middleware does not introduce a second sink; a compression failure and a
  source failure are the same event to the client.

`TextEncoder` rather than a `Buffer` anywhere in this file: `.oxlintrc.json` bans
`Buffer` globally with "Use Uint8Array and ArrayBuffer for binary data", and the
ban is right — `Buffer` is Node-only and this middleware is not.

## 10. What #566 has to assert

1. `new CompressionStream('br')` throws on the supported runtime, and no `br`
   appears in `ContentCoding` — a compile-time assertion, so the decision in §3
   cannot be quietly reversed without editing this spec.
2. Every row of §4: `q` ordering, `gzip;q=0` excluding gzip even when it is the only
   coding offered, `*` matching, a missing header meaning no compression, and
   `identity;q=0` with nothing satisfiable answering `406`.
3. Every skip in §5, each as its own assertion — and specifically that a
   `stream` with no `length` **is** compressed while one with a `length` under
   `minBytes` is not.
4. An already-set `content-encoding` is never touched, including `identity`.
5. `vary: accept-encoding` is present on a response the middleware chose **not** to
   compress. This is the assertion that catches the cache-poisoning bug.
6. `content-length` is absent after compressing, and the compressed body round-trips
   through a `DecompressionStream` back to the original bytes — including for a
   multi-chunk source and for a body containing a multi-byte character.
7. An `image/png` and a response with no `content-type` are both left alone.
8. A `HEAD` request is not compressed.
9. `skip` returning `true` wins over every other condition.
10. A source that throws mid-stream calls the response's `onError` once and destroys
    the connection; the compressor does not swallow it.

## Non-goals (rejected)

- **Brotli and zstd** (§3), and `deflate-raw` because no client requests it.
- **A compression level or quality option.** `CompressionStream` does not expose
  one, so the option would be either a lie or a `node:zlib` dependency (§3).
- **Automatic BREACH protection** (§8). It cannot be decided from a `WebResponse`.
- **Recomputing `content-length` by buffering the compressed output** (§7).
- **Compressing a response with no `content-type`** by sniffing it (§6).
- **A deny-list of already-compressed media types** (§6).
- **Caching compressed representations in the process.** A second cache keyed by
  coding and validator, with its own invalidation and its own memory bound, to
  reproduce something the CDN in §1 does for free.
- **Pre-compressed file variants (`x.css.gz`).** It needs this negotiation plus
  per-variant validators inside the static handler; noted in `../static/SPEC.md`'s
  non-goals as the same rejection seen from the other side.
- **Request-body decompression (`Content-Encoding` on the way in).** A compressed
  request body is an amplification vector — a few kilobytes inflating to gigabytes —
  and accepting one requires a decompressed-size limit that is a separate design.
  Not in this epic.
