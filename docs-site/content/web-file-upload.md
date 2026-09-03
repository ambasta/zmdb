> **ToDo / feature gap.** There is no multipart (`multipart/form-data`) parser and
> no `FileInterceptor` analogue. Worse than missing: the bundled adapters cannot
> carry binary at all — both decode the request body as UTF-8 text, which destroys
> any byte sequence that is not valid UTF-8.
>
> The limits, the filename rule and the buffer-versus-stream decision are frozen in
> `packages/web/src/upload/SPEC.md`, and the adapter change they depend on is in
> `packages/web/src/pipeline/SPEC.md`.

So this is not "write a parser and plug it in". Uploads have to bypass the router
until the request body reaches a handler as bytes.

## What arrives today

`WebRequest.rawBody` is `unknown` and **optional**. `toNodeHandler` reads a body only
when the request has one — a `content-length` other than `0`, or any
`transfer-encoding` — and otherwise attaches no listeners at all and leaves `rawBody`
`undefined`. When there is a body it calls `req.setEncoding?.('utf8')` and accumulates
the decoded string. `toFetchHandler` calls `request.text()`, and skips the body
entirely for `GET` and `HEAD`. Either way it then tries `JSON.parse` and falls back to
the raw string.

The `setEncoding` is worth being precise about, because this page used to describe
the wrong mechanism. It installs a `StringDecoder`, which holds partial multi-byte
sequences across reads — so a character whose UTF-8 bytes straddle a chunk boundary
survives, and the naive `String(chunk)` per chunk this used to do would have
corrupted it. Note the `?.`: the adapter is structurally typed against a
`{ method?, url?, headers, on, setEncoding? }` shape, so a hand-rolled or wrapped
request object without `setEncoding` still works and still takes the per-chunk path —
where the boundary-split corruption is live rather than historical. Real
`node:http` requests have the method, so this is about proxies and test doubles.

What no version survives is a byte sequence that is not valid UTF-8 **at all**,
which is most of any image. A multipart body therefore reaches `ctx.body` as a
lossily decoded string with its boundary markers intact and its file content
replaced by U+FFFD. A JSON body with a base64 field works fine, which is the basis
of the small-file workaround below.

## Workaround 1: presigned uploads (recommended)

The client uploads to object storage directly; your API only signs and records.
This is the right architecture regardless of framework support — the bytes never
touch your process, so a 200 MB upload costs you no memory, no request duration
and no bandwidth.

```ts
@Controller('/uploads')
export class UploadsController {
  @Inject(STORAGE) private readonly storage!: Storage;
  @Inject(FILES) private readonly files!: FileRepository;

  @Post('/sign')
  async sign(ctx: Ctx<Record<never, string>, { filename: string; contentType: string; bytes: number }>) {
    const viewer = principalOf(ctx);
    assert<{ filename: string; contentType: string; bytes: number }>(ctx.body);

    if (!ALLOWED_TYPES.has(ctx.body.contentType)) throw new ValidationError('unsupported type', []);
    if (ctx.body.bytes > MAX_BYTES) throw new ValidationError('too large', []);

    const key = `${viewer.id}/${globalThis.crypto.randomUUID()}`; // never the client's filename
    return { key, url: await this.storage.presign(key, ctx.body.contentType, ctx.body.bytes) };
  }

  @Post('/confirm')
  async confirm(ctx: Ctx<Record<never, string>, { key: string }>) {
    const viewer = principalOf(ctx);
    assert<{ key: string }>(ctx.body);

    // ownership first: `head` on a key you do not own is an existence oracle over
    // the whole bucket, answerable one key at a time
    if (!ctx.body.key.startsWith(`${viewer.id}/`)) throw new Forbidden();
    const head = await this.storage.head(ctx.body.key); // verify it exists
    return this.files.create({ owner_id: viewer.id, key: ctx.body.key, bytes: head.size, mime: head.contentType });
  }
}
```

> [!WARNING]
> Sign for a **specific** key, content type and maximum size, with a short expiry.
> A presigned URL that accepts any key is a write handle to your bucket; one that
> accepts any content type lets a caller store `text/html` and serve it from your
> origin. And verify the object on `/confirm` rather than trusting the client's
> reported size — the signature constrains the upload, the confirmation records it.

## Workaround 2: handle uploads before the router

For self-hosted deployments, take the raw stream in your adapter and never involve
the router:

```ts
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/upload') {
    await handleUpload(req, res); // your streaming parser, writing to disk or S3
    return;
  }
  toNodeHandler(router)(req, res);
});
```

`handleUpload` sees the real `IncomingMessage`, so it can pipe, apply
backpressure, and abort past a byte limit. Then `POST /files` through the router
to record the metadata. Two requests, but each one is doing something the
transport is actually good at.

## Workaround 3: base64 in JSON, for small files

```ts
@Post('/avatar')
async avatar(ctx: Ctx<Record<never, string>, { data: string; mime: string }>) {
  assert<{ data: string; mime: string }>(ctx.body);
  const bytes = Buffer.from(ctx.body.data, 'base64');
  if (bytes.byteLength > 256 * 1024) throw new ValidationError('too large', []);
  return this.avatars.save(principalOf(ctx).id, bytes, ctx.body.mime);
}
```

Fine for an avatar or a small attachment. Base64 costs 33% in size and the whole
payload is buffered in memory, so put a hard cap on it — and remember the adapter
has **no body size limit of its own**, which makes an unbounded endpoint here a
trivial memory-exhaustion target. Cap at the proxy as well.

## Validating an upload, wherever you parse it

| Check                                           | Why                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Size, enforced while streaming                  | a limit checked after buffering has already cost you the memory     |
| Content type from the **bytes**, not the header | `content-type` is client-supplied; sniff the magic number           |
| A generated storage key                         | a client filename means `../../etc/passwd` and overwrites           |
| An explicit extension allow-list                | not a deny-list; `.php5`, `.phtml`, `.svg` are what deny-lists miss |
| Serve from a different origin                   | an `.svg` or `.html` on your API origin executes with your cookies  |
| Strip metadata from images                      | EXIF carries GPS coordinates                                        |

> [!WARNING]
> Never write an uploaded file to a path built from a client-controlled name, and
> never serve user uploads from your application's origin. Those two mistakes turn
> an upload endpoint into remote code execution and stored XSS respectively.

## Storing the record

```ts
import type { HasDefault, Length, PrimaryKey, References, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface FileRecord extends Table<'files'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  owner_id: number & Sql<'integer'> & References<'users.id'>;
  key: string & Sql<'text'> & Unique;
  mime: string & Sql<'varchar'> & Length<127>;
  bytes: bigint & Sql<'bigint'>;
  created_at: Date & Sql<'timestamp'> & HasDefault;
}
```

`bytes` is a `bigint`, so `Sql<'bigint'>` is redundant — TypeScript's `bigint` maps to it with
nothing else to disambiguate. It is written here anyway because the DDL type is worth reading
off the declaration. `number` is the one app type that _must_ carry a tag, because `integer`
and `numeric` are both spelled `number`.

Store the key, never the bytes. Filter by `owner_id` in the `where` on every read
— see [Authorization](./web-authorization.html).

## What it would take

Three things, in order, and the middle one is not what this page previously assumed:

1. **Bytes through the adapter.** `WebRequest.rawBody` is already `unknown`, so it
   can carry a `Uint8Array`; the adapters must stop decoding a non-JSON body as
   text. That is the blocking change and it is small. It comes with a
   `maxBodyBytes` default of 1 MiB, because there is no request body limit today at
   all — which makes every `POST` route in every deployment an unbounded allocation
   reachable by one request.
2. **A buffering multipart parser**, not a streaming one. The freeze picked
   buffering, and the reason is worth knowing before you plan around it: a streaming
   parser needs `WebRequest` to carry a `ReadableStream`, which means routing,
   validation and `Ctx` construction all have to cope with a body that does not exist
   yet at match time — a redesign of the request half of the pipeline. A bounded
   buffer's safety is one comparison; a streaming parser's is every consumer
   honouring backpressure. And the case buffering cannot serve is the 200 MB upload,
   which workaround 1 says should not be going through the application anyway.
3. **A `Pipe`** exposing it: `Pipe<unknown, Multipart>` fits the existing
   `transform(value, ctx)` signature exactly, so the type needs no change. It does
   need the chain wiring, which is a second dependency this page used to omit: pipes
   are folded inside `runChain`, and the pipeline never calls `runChain`, so no `Pipe`
   runs on any request today — there is no plug to plug into yet. No decorator —
   `@UploadedFile()` would be a second way to reach `ctx.body`, and this package's
   handlers take one `Ctx`, which is what keeps them ordinary functions.

The limits, with defaults: 16 parts, 1 MiB per part, 8 MiB total, 100-byte field
names, 255-byte filenames, 1 KiB of headers per part. Two of those are not obvious
and both are real — a part with a ten-megabyte `content-disposition` line is an
unbounded allocation containing no file content at all.

Every limit has a default and none can be removed: `0`, `Infinity`, `-1` and a
non-integer are all construction errors rather than clever ways to switch a check
off. Raising a limit is the supported operation.

**An over-limit body is destroyed, not drained.** Draining means reading a hostile
request to completion in order to answer it politely, which is the resource
consumption the limit just refused. The cost is real and stated rather than hidden:
a client still writing its body may see a connection reset instead of the `413`. The
mitigation belongs to the client — check the size before uploading, or send
`Expect: 100-continue`, which lets the server refuse on the headers alone.

**The client filename is a label and nothing else.** A filename containing a `\0` or
a path separator makes the part a `400` rather than being stripped, because the
sanitised version of `../../etc/passwd` is a filename somebody will concatenate. The
storage key is generated. The declared content type is recorded verbatim and nothing
in the parser branches on it — the framework does not sniff, because a magic-number
table goes stale, disagrees with whatever library will process the bytes, and has
nothing to say about `image/svg+xml`, which is the type that actually matters.

Even with all of it, presigned uploads remain the better production answer for
anything large.

---

See also: [Request Pipeline](./web-pipeline.html) · [Raw Body](./web-raw-body.html) · [Authorization](./web-authorization.html)
