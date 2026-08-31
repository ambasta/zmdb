> **ToDo / feature gap.** `WebResponse.body` is a `string`. There is no
> `ReadableStream`, no `AsyncIterable` and no `Buffer` in the response type, so a
> handler cannot stream — the whole body must be a string in memory before the
> response is returned.

```ts
export interface WebResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}
```

And a handler cannot even set that: the router serialises a handler's return value as a 200 JSON body. See [Request Lifecycle](./web-request-lifecycle.html).

## Why this is the blocker it looks like

The same `string` body blocks [compression](./web-compression.html), [static files](./web-static-files.html), [templates](./web-templates.html), server-sent events from a handler, and [LLM token streaming](./llm-chat.html). One field, five features.

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
import { pipeline } from 'node:stream/promises';

createServer(async (req, res) => {
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
  const out = await app.handle(toWebRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

Three things that matter in that code:

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

## What it would take

Widen `WebResponse.body` to `string | Uint8Array | ReadableStream`, and give a handler a way to return a full response rather than a value the router wraps. Both are breaking changes to core public types, which is why they have not been made incrementally — and both adapters need to handle each case (`toNodeHandler` piping a stream, `toFetchHandler` passing it to `Response`).

That one change unblocks compression, static files, templates, SSE and LLM streaming together, so it is the highest-leverage item on the framework's list.

---

See also: [Streaming](./streaming.html) · [Static Files](./web-static-files.html) · [Compression](./web-compression.html)
