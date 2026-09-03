> **ToDo / feature gap.** `WebResponse.body` is a `string`. There is no
> `ReadableStream`, no `AsyncIterable` and no byte array in the response type, so a
> handler cannot stream — the whole body must be a string in memory before the
> response is returned.
>
> The shape it will ship as is frozen in
> `packages/web/src/pipeline/SPEC.md`, in the amendment section at the end. The
> workarounds below still apply until it lands.

```ts
export interface WebResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}
```

A handler **can** set the status, the headers and a non-JSON body — `json()`, `text()` and `respond()` do exactly that, and an earlier version of this page said otherwise. What it cannot do is return anything other than a string. See [Request Lifecycle](./web-request-lifecycle.html).

## Why this is the blocker it looks like

The same `string` body blocks [compression](./web-compression.html), [static files](./web-static-files.html), server-sent events from a handler, and [LLM token streaming](./llm-chat.html). One field, four features — [templates](./web-templates.html) are not one of them, for the reason at the bottom of this page.

SSE is the partial exception: `sseStream` is exported from `@zmdb/web` today, so a hand-written adapter can serve an event stream exactly like Workaround 2 below. What is blocked is returning one from a handler.

It also means a large file is fully buffered — a 200MB download is 200MB of process memory per concurrent request, which fails under load rather than at test time.

## Workaround 1 — a presigned URL

The best answer, and not a compromise. Redirect the client to object storage:

```ts
@Get('/files/:id')
async download(ctx: Ctx<{ id: string }>) {
  const file = await this.repo.findById(Number(ctx.params.id));
  if (file === undefined) throw new ValidationError('not found', []);
  return { url: await presignGet(file.key, 300) };
}
```

The client then fetches that URL directly. Your application never touches the bytes: no memory pressure, no timeout, no bandwidth cost, and the CDN serves it. Cap the expiry (300 seconds above) and make the key unguessable, since a presigned URL is a bearer credential — anyone holding it can read the object.

For uploads, presign a `PUT` the same way. See [Raw Body](./web-raw-body.html).

## Workaround 2 — stream from your own adapter

Bypass `app.handle` for the routes that stream. This is legitimate: the framework owns the JSON routes and your adapter owns the byte routes.

```ts
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const match = /^\/files\/(\d+)$/.exec(req.url ?? '');
  if (match !== null && req.method === 'GET') {
    const file = await lookup(Number(match[1]));
    if (file === undefined) {
      res.writeHead(404).end();
      return;
    }

    const stat = statSync(file.path);
    res.writeHead(200, {
      'content-type': file.contentType,
      'content-length': String(stat.size),
      'content-disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    });
    await pipeline(createReadStream(file.path), res);
    return;
  }

  // everything else goes to the app
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const out = await app.handle({
    method: req.method ?? 'GET',
    path: q === -1 ? url : url.slice(0, q),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
    ),
  });
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

Four things that matter in that code:

- **`app.handle` takes a `WebRequest`, and you have to build it.** There is no `toWebRequest` helper to import — `{ method, path, headers, rawBody?, query? }`, with the query string split off the `url` — because the framework's own adapter is `toNodeHandler(router)`, which owns the whole `(req, res)` pair and so cannot be used for a server that also serves byte routes. If none of your routes read a body, the four lines above are the whole adapter.

- **`pipeline`, not `.pipe()`.** `pipeline` propagates errors and destroys both streams on failure; a bare `pipe` leaks a file descriptor when the client disconnects mid-download.
- **Never build a path from user input.** `join(dir, ctx.params.name)` with `../../etc/passwd` reads whatever the process can read. Look the file up by id in the database and use the stored path, as above.
- **`encodeURIComponent` the filename.** A quote or newline in a `content-disposition` header is a header-injection vector.

## Workaround 3 — small files as a data URL or base64

Only for genuinely small payloads — an avatar, a QR code, a generated PDF of a page or two:

```ts
@Get('/qr/:id')
async qr(ctx: Ctx<{ id: string }>) {
  const png = await renderQr(ctx.params.id);
  return { contentType: 'image/png', base64: png.toString('base64') };
}
```

The client decodes it. Base64 adds 33%, and it is in memory twice — so this is a convenience, not a file-serving strategy. Anything above a few hundred kilobytes belongs in workaround 1 or 2.

## Range requests

Not possible through the framework, and required for video seeking and resumable downloads. Workaround 2 handles it:

```ts
const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
if (range !== null) {
  const start = Number(range[1] || 0);
  const end = range[2] ? Number(range[2]) : stat.size - 1;
  res.writeHead(206, {
    'content-range': `bytes ${start}-${end}/${stat.size}`,
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
  });
  await pipeline(createReadStream(file.path, { start, end }), res);
}
```

Validate the numbers. A `start` beyond the file size or a reversed range should be a 416, not a stream that reads nothing.

The frozen behaviour puts ranges in the [static file handler](./web-static-files.html) rather than in `file()`: a single range is a `206`, a start past the end is a `416` carrying `content-range: bytes */<size>`, and a malformed range, more than one range, or an `If-Range` all answer `200` with the whole file. Serving the whole file is always a correct answer to a `Range` request, and it is honest about the fact that `multipart/byteranges` is a second body format whose only real consumer is a PDF viewer.

## What it would take

Settled, and narrower than "widen the body". `body` becomes a **tagged** union, not `string | Uint8Array | ReadableStream`:

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

The tag is there because of `content-length`. `body.length` on the untagged union means UTF-16 code units for a string and bytes for a `Uint8Array`, so the one question every adapter has to answer is the question the untagged version answers ambiguously and silently. The tag also makes a fourth arm a compile error at every consumer instead of a missed case.

Two parameters that look like fussiness and are not. `Uint8Array<ArrayBuffer>` rather than `Uint8Array`, because a bare `Uint8Array` includes a `SharedArrayBuffer`-backed view, `BodyInit` excludes those, and `new Response(bytes)` therefore does not compile — the only alternative being a cast at the adapter. And `length: number | undefined` rather than `length?: number`, because under `exactOptionalPropertyTypes` a caller computing the length from a `stat` cannot write the optional form.

Then three new factories — `bytes`, `stream` and `file`. `file` is the one worth showing, because it is the one that composes a `stat` with a read stream:

```ts
@Get('/files/:id')
async download(ctx: Ctx<{ id: string }>) {
  const record = await this.repo.findById(Number(ctx.params.id));
  return file(record.path, {
    headers: { 'content-disposition': `attachment; filename="${encodeURIComponent(record.name)}"` },
    onError: error => this.log.error({ id: record.id, error }),
  });
}
```

`onError` is **required**, and that is the part of the freeze worth knowing before you plan around it. Once the first byte is on the wire there is no status left to send and no exception filter left to run, so a failing stream is the one error in the framework that cannot be reported through a return value. The connection is destroyed rather than ended — under chunked transfer, omitting the terminating chunk is the only in-protocol way to say "this response is incomplete", and appending an error object to a JSON stream would hand the consumer a value it will parse as data.

Client disconnect cancels the reader, which is what closes the file descriptor; backpressure is `res.write` returning `false`, because ignoring it turns a 2 GB download to one slow client into 2 GB of process memory — the same bug streaming was added to remove, reintroduced one layer down.

One thing this page overstated: it is not five features behind one field. [Compression](./web-compression.html) and [static files](./web-static-files.html) do need it, and so does `graphql-sse`; [templates](./web-templates.html) never did — `respond()` has been enough for a rendered string for some time, and the freeze declines a view engine on its own merits rather than for want of a stream.

---

See also: [Streaming](./streaming.html) · [Static Files](./web-static-files.html) · [Compression](./web-compression.html)
