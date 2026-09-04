`@zmdb/web` responses can carry text, bytes or a `ReadableStream`. Both adapters
honour the body kind; the Node adapter respects `write()` backpressure and
cancels the source when the client disconnects.

```ts
export type ResponseBody =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: 'stream';
      readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
      readonly length: number | undefined;
    };
```

## Stream from a handler

Use `stream()` for an application-owned web stream:

```ts
import { stream } from '@zmdb/web';

@Get('/events')
events() {
  return stream(eventSource(), {
    headers: { 'content-type': 'text/event-stream' },
    onError: error => this.log.error({ error }),
  });
}
```

`onError` is required. Once headers and the first chunk have been sent, an HTTP
status can no longer report a failure. The Node adapter destroys the connection
instead of ending a truncated body cleanly; the callback is the server-side
record of what happened.

Pass `length` only when it is known. The adapters set `content-length` from that
value, and body consumption fails if the stream produces a different byte count.
Without it, the runtime chooses streaming framing.

## Send bytes

```ts
import { bytes } from '@zmdb/web';

return bytes(png, {
  headers: { 'content-type': 'image/png' },
});
```

The byte length overrides a caller-supplied `content-length`. Framing belongs to
the adapter, so a handler-supplied `transfer-encoding` is removed.

## Send a known file

```ts
import { file } from '@zmdb/web';

@Get('/files/:id')
async download(ctx: Ctx<{ id: string }>) {
  const record = await this.repo.findById(Number(ctx.params.id));
  return file(record.path, {
    contentType: record.contentType,
    headers: {
      'content-disposition': `attachment; filename="${encodeURIComponent(record.name)}"`,
    },
    onError: error => this.log.error({ id: record.id, error }),
  });
}
```

`file()` opens a path the application already trusts, measures it, and streams it
without materialising the whole file. It does not confine user input to a root,
decode URL paths, implement ranges or generate cache validators. Those security
and HTTP policies belong to the shipped
[static-file handler](./web-static-files.html).

For large public downloads, a presigned object-storage URL is still usually the
better architecture: the application signs and records the request while the CDN
serves the bytes.

## Cancellation and bodyless responses

- A Node client disconnect cancels the stream reader.
- Cancelling a Fetch response body propagates to the source stream.
- `HEAD`, `204` and `304` send no body and cancel a stream that was created for
  the response.
- `bodyText(response)` drains any body arm for tests and in-process consumers.
  A drained stream cannot then be sent again.

## Request-body limits

Both adapters default `maxBodyBytes` to 1 MiB:

```ts
createServer(toNodeHandler(router, { maxBodyBytes: 8 * 1024 * 1024 }));
const fetch = toFetchHandler(router, { maxBodyBytes: 8 * 1024 * 1024 });
```

The value must be a positive safe integer. An oversized body receives `413` and
is not dispatched. JSON and text remain decoded values; another content type
reaches `WebRequest.rawBody` as exact bytes.

---

See also: [Static Files](./web-static-files.html) · [Compression](./web-compression.html) · [Raw Body](./web-raw-body.html)
