The adapters preserve binary request bodies as bytes and keep JSON/text on the decoded path. A bounded multipart parser is available as an explicit Pipe; there is still no configurable body-parser
stack or inbound request stream exposed to handlers.

## What the adapters do

`toNodeHandler` first decides whether there is a body to read. Per RFC 9112, a request with neither `content-length` nor `transfer-encoding` has none, so most `GET`, `HEAD` and `DELETE` requests
dispatch without attaching body listeners. `content-length: 0` counts as no body too.

Both adapters enforce `maxBodyBytes`, defaulting to 1 MiB:

```ts
const nodeHandler = toNodeHandler(router, { maxBodyBytes: 8 * 1024 * 1024 });
const fetchHandler = toFetchHandler(router, { maxBodyBytes: 8 * 1024 * 1024 });
```

The value must be a positive safe integer. A body over the limit receives `413` and is not dispatched.

Content type selects the representation delivered as `ctx.body`:

| Request content type                          | `ctx.body`                                    |
| --------------------------------------------- | --------------------------------------------- |
| Empty body                                    | `undefined`                                   |
| `application/json` or an `application/*+json` | parsed JSON, or the decoded string if invalid |
| `text/*`                                      | decoded string, unless it parses as JSON      |
| another explicit content type                 | `Uint8Array<ArrayBuffer>` with exact bytes    |
| no content type                               | decoded/JSON path for compatibility           |

The Node adapter uses `setEncoding('utf8')` only on the decoded path, preserving partial multi-byte characters across chunks. The Fetch adapter reads bytes first and decodes only after applying the
same content-type rule.

Validation remains essential:

```ts
const dto = assert<CreateDTO<Post>>(ctx.body);
```

Without it, malformed JSON reaches a handler as a string instead of the object the handler expects.

## Exact bytes and webhook signatures

For a non-JSON content type, the handler receives exact bytes:

```ts
@Post('/hook')
hook(ctx: Ctx<Record<never, string>, unknown>) {
  if (!(ctx.body instanceof Uint8Array)) {
    throw new ValidationError('expected a binary body', []);
  }
  verifySignature(ctx.body);
}
```

A provider that sends `application/json` still takes the JSON path, so its pre-parse bytes are not available to the handler. If that provider signs the exact JSON bytes, use a route-specific adapter
that verifies before parsing. Re-serializing parsed JSON is not equivalent: key order, number formatting and Unicode escapes can all change.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(raw: Uint8Array, header: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Uint8Array.fromHex(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

Three details matter:

- HMAC the exact bytes, not a re-serialized object.
- Use `timingSafeEqual`, not `===`.
- Check lengths first because `timingSafeEqual` throws when they differ.

Also verify the provider timestamp and reject stale requests, or a captured request can be replayed indefinitely.

## Multipart and file uploads

`multipart/form-data` now arrives as bounded bytes instead of lossy UTF-8 text, and `multipartPipe` parses it under mandatory part/header/field limits. The complete body is still buffered before
dispatch, so this is suitable only within the configured `maxBodyBytes`.

Use it in an explicit middleware chain, followed by the same validation pipe used for any other body:

```ts
const upload = {
  guards: [],
  pipes: [multipartPipe(), validationPipe(validateUpload)],
  interceptors: [],
  filters: [],
} satisfies Chain;
```

For large uploads, a presigned object-storage URL remains the better design: the client uploads directly and posts the resulting key. For a larger bounded form, raise both the adapter and parser
limits deliberately.

## Form-encoded bodies

`application/x-www-form-urlencoded` arrives as bytes. Decode and parse it explicitly:

```ts
if (!(ctx.body instanceof Uint8Array)) {
  throw new ValidationError('expected form bytes', []);
}
const form = Object.fromEntries(new URLSearchParams(new TextDecoder().decode(ctx.body)));
```

Every value is a string, so coerce and validate it.

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Streaming Files](./web-streaming-files.html) · [File Upload](./web-file-upload.html)
