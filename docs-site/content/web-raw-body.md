`ctx.body` is JSON, parsed by the adapter. There is no body parser to configure, no `rawBody` option and no multipart handling — but the parse is deliberately forgiving in a way you need to know about.

## What the adapters do

`toNodeHandler` first decides whether there is a body to read at all. Per RFC
9112 a request with neither `content-length` nor `transfer-encoding` has none, so
those requests — most `GET`s, `HEAD`s and `DELETE`s — are dispatched immediately
without attaching stream listeners. `content-length: 0` counts as no body too.

When there is one, the adapter calls `req.setEncoding('utf8')` and accumulates
the decoded string:

```ts
rawBody: raw.length > 0 ? parseJson(raw) : undefined;
```

`setEncoding` matters for correctness, not just speed: it installs a
`StringDecoder`, which holds a partial multi-byte character across reads. Decoding
each chunk on its own — which this adapter used to do — corrupts any character
whose UTF-8 bytes straddle a chunk boundary, so a large body containing non-ASCII
text would silently arrive with `�` in it.

`parseJson` returns the parsed value — or, on a parse failure, **the original string**:

```ts
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

So `ctx.body` is:

| Request      | `ctx.body`                                |
| ------------ | ----------------------------------------- |
| Empty body   | `undefined`                               |
| Valid JSON   | the parsed value                          |
| Invalid JSON | the raw **string**                        |
| `text/plain` | the raw string (unless it parses as JSON) |
| Form-encoded | the raw string                            |

Content-type is never consulted. A `GET` with no body gives `undefined`; `toFetchHandler` skips reading the body entirely for `GET` and `HEAD`.

This is why validating is not optional:

```ts
const dto = assert<CreateDTO<typeof posts>>(ctx.body);
```

Without it, a malformed request hands your handler a string where it expects an object, and the failure surfaces somewhere less useful. With it, you get a 400.

## Getting the genuine raw bytes

You cannot, from a handler — the adapter has already consumed the stream and thrown the text away. Read it in your own adapter instead:

```ts
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);

  const out = await app.handle({
    method: req.method ?? 'GET',
    path: (req.url ?? '/').split('?')[0] ?? '/',
    headers: req.headers as Record<string, string>,
    rawBody: raw, // pass the Buffer through untouched
  });
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

`WebRequest.rawBody` is `unknown`, so a `Buffer` passes through unchanged and `ctx.body` is that `Buffer`. Parse it in the handler:

```ts
@Post('/hook')
async hook(ctx: Ctx<Record<never, string>, unknown>) {
  const buffer = ctx.body;
  if (!(buffer instanceof Buffer)) throw new ValidationError('expected a raw body', []);
  const payload = assert<StripeEvent>(JSON.parse(buffer.toString('utf8')));
  // …
}
```

## Webhook signature verification

The reason raw bytes matter. A signature covers the exact bytes sent, and `JSON.parse` then `JSON.stringify` does not round-trip — key order, number formatting and unicode escapes all change, so re-serialising invalidates every signature.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(raw: Buffer, header: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(header, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

Three things this gets right:

- **HMAC over the raw buffer**, not a re-serialised object.
- **`timingSafeEqual`**, not `===`. String comparison short-circuits on the first differing byte, which leaks the signature a byte at a time to a patient attacker.
- **A length check first**, because `timingSafeEqual` throws on mismatched lengths.

Also check the timestamp the provider sends and reject anything older than a few minutes, or a captured request can be replayed forever.

Verify **before** parsing and before any database work. A webhook endpoint is unauthenticated by definition; the signature is the only thing standing between it and an attacker.

## Size limits

There are none. `toNodeHandler` accumulates the whole body in memory with no cap, so a large upload is a memory-exhaustion vector. Cap it in your adapter:

```ts
const MAX = 1_000_000;
let size = 0;
const chunks: Buffer[] = [];
for await (const c of req) {
  size += c.length;
  if (size > MAX) {
    res.writeHead(413).end('{"error":"payload too large"}');
    return;
  }
  chunks.push(c);
}
```

Do this. Behind a reverse proxy you may already have a limit, but relying on a proxy config for a memory-safety property is not a control you can see in the code.

## Multipart and file uploads

Not supported, and awkward to add: the adapter reads the whole body into memory and `WebResponse.body` is a `string`, so there is no streaming in either direction. For uploads, the arrangement that avoids the problem entirely is a presigned URL — the client uploads directly to object storage and posts you the resulting key:

```ts
@Post('/uploads')
async presign(ctx: Ctx<Record<never, string>, unknown>) {
  const { filename, contentType } = assert<{ filename: string; contentType: string }>(ctx.body);
  return { url: await presignPut(key(filename), contentType), key: key(filename) };
}
```

Better than proxying bytes through your application regardless of framework: no memory pressure, no timeout, no bandwidth cost. Validate the content type and cap the size in the presign policy, not after the fact.

If you must accept multipart, handle it in the adapter with `busboy` before calling `app.handle`, and pass the parsed fields as `rawBody`.

## Form-encoded bodies

Parse them in the adapter:

```ts
const parsed = req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
  ? Object.fromEntries(new URLSearchParams(raw))
  : raw.length > 0
    ? JSON.parse(raw)
    : undefined;
```

Every value is a string, so coerce and validate — and remember `Number('abc')` is `NaN`, which passes a `number` check.

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Streaming](./streaming.html) · [Authentication](./web-authentication.html)
