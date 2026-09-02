> **ToDo / feature gap.** There is no multipart (`multipart/form-data`) parser and
> no `FileInterceptor` analogue. Worse than missing: the bundled adapters cannot
> carry binary at all — `toNodeHandler` accumulates the request body as
> `String(chunk)`, which UTF-8-decodes each buffer and destroys any byte that is
> not valid UTF-8.

So this is not "write a parser and plug it in". Uploads have to bypass the router
until the request body reaches a handler as bytes.

## What arrives today

`WebRequest.rawBody` is `unknown`. The adapter joins the body into a string, tries
`JSON.parse`, and falls back to the raw string. A multipart body therefore reaches
`ctx.body` as a **lossily decoded string** with its boundary markers intact and its
binary content corrupted. A JSON body with a base64 field works fine, which is the
basis of the small-file workaround below.

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

    const key = `${viewer.id}/${randomUUID()}`; // never the client's filename
    return { key, url: await this.storage.presign(key, ctx.body.contentType, ctx.body.bytes) };
  }

  @Post('/confirm')
  async confirm(ctx: Ctx<Record<never, string>, { key: string }>) {
    const viewer = principalOf(ctx);
    const head = await this.storage.head(ctx.body.key); // verify it exists
    if (!ctx.body.key.startsWith(`${viewer.id}/`)) throw new Forbidden();
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

Three things, in order:

1. **Bytes through the adapter.** `WebRequest.rawBody` is already `unknown`, so it
   can carry a `Buffer` or a stream; `toNodeHandler` must stop stringifying chunks.
   That is the blocking change and it is small.
2. **A streaming multipart parser** behind a size limit and a part-count limit,
   producing `{ fields, files }` with each file as a stream rather than a buffer.
3. **A `Pipe`** exposing it: `Pipe<Buffer, Multipart>` fits the existing
   `transform(value, ctx)` signature with no design change.

Even then, presigned uploads remain the better production answer for anything
large.

---

See also: [Request Pipeline](./web-pipeline.html) · [Raw Body](./web-raw-body.html) · [Authorization](./web-authorization.html)
