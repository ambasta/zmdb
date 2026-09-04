Small, bounded `multipart/form-data` uploads can use `parseMultipart()` or
`multipartPipe()`. The complete request is buffered before dispatch, every limit
is mandatory, and a client filename is only an opaque label: a null byte or path
separator is a `400`, while an overlong safe label is truncated. Generate the
storage key yourself and never concatenate the supplied filename into a path.

Large or streaming uploads should bypass the router or go directly to object
storage.

## Limits come first

| Boundary           | Default   | Behaviour when exceeded                        |
| ------------------ | --------- | ---------------------------------------------- |
| adapter body       | 1 MiB     | `413` before dispatch; Node destroys the input |
| parts              | 16        | `413`                                          |
| one part           | 1 MiB     | `413`                                          |
| complete multipart | 8 MiB     | `413`                                          |
| field name         | 100 bytes | `413`                                          |
| client filename    | 255 bytes | truncate the label                             |
| one part's headers | 1 KiB     | `413`                                          |

The adapter limit runs first, so the effective out-of-the-box request ceiling is
1 MiB even though `maxTotalBytes` defaults to 8 MiB. Raise `maxBodyBytes` to at
least the multipart ceiling when the route intentionally accepts more:

```ts
createServer(toNodeHandler(router, { maxBodyBytes: 8 * 1024 * 1024 }));
const fetch = toFetchHandler(router, { maxBodyBytes: 8 * 1024 * 1024 });
```

Every configured limit must remain a positive safe integer. `0`, `Infinity`,
negative values, and non-integers are configuration errors rather than ways to
disable a check.

## Parse a bounded upload

```ts
import { parseMultipart } from '@zmdb/web';

const form = parseMultipart(ctx.body, ctx.headers['content-type'] ?? '', {
  maxParts: 8,
  maxPartBytes: 512 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
});
```

`form.fields` is a string record; repeated names keep the last value.
`form.files` contains exact bytes plus the untrusted filename and declared content
type. For an explicit middleware chain, use `multipartPipe(limits)` before the
ordinary validation pipe.

## Request representation

`WebRequest.rawBody` is `unknown` and **optional**. `toNodeHandler` reads a body
only when `content-length` or `transfer-encoding` says one exists; `toFetchHandler`
skips bodies for `GET` and `HEAD`. Both reject more than 1 MiB by default.

Content type selects the representation. JSON and `text/*` use the decoded path;
another explicit content type, including `multipart/form-data`, reaches
`ctx.body` as an exact `Uint8Array<ArrayBuffer>`. The complete request is still
buffered before dispatch. An explicit chain can then apply `multipartPipe`, which
parses boundaries and headers under mandatory per-part limits.

## For large uploads: presigned object storage

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

## For streaming uploads: handle them before the router

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

## For tiny files: base64 in JSON

```ts
@Post('/avatar')
async avatar(ctx: Ctx<Record<never, string>, { data: string; mime: string }>) {
  assert<{ data: string; mime: string }>(ctx.body);
  const bytes = Uint8Array.fromBase64(ctx.body.data);
  if (bytes.byteLength > 256 * 1024) throw new ValidationError('too large', []);
  return this.avatars.save(principalOf(ctx).id, bytes, ctx.body.mime);
}
```

Fine for an avatar or a small attachment. Base64 costs 33% in size and the whole
payload is buffered in memory, so keep the adapter's mandatory size bound low and
enforce the smaller decoded-file limit shown above. Cap at the proxy as well.

## Validating an upload, wherever you parse it

| Check                                                         | Why                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Adapter size while reading; parser part limits while scanning | each layer stops at the first bound it can enforce                                                     |
| Type accepted by the library that processes the bytes         | `content-type` is client-supplied; the parser deliberately trusts neither it nor a generic sniff table |
| A generated storage key                                       | a client filename means `../../etc/passwd` and overwrites                                              |
| An explicit extension allow-list                              | not a deny-list; `.php5`, `.phtml`, `.svg` are what deny-lists miss                                    |
| Serve from a different origin                                 | an `.svg` or `.html` on your API origin executes with your cookies                                     |
| Strip metadata from images                                    | EXIF carries GPS coordinates                                                                           |

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

`bytes` is a `bigint`, so `Sql<'bigint'>` is redundant: TypeScript's `bigint`
already maps to that SQL type. It remains in the example to make the DDL type
visible in the declaration. A `number` column must carry a tag because both
`integer` and `numeric` use the same TypeScript type.

Store the key, never the bytes. Filter by `owner_id` in the `where` on every read
— see [Authorization](./web-authorization.html).

## Parser and pipe details

Three pieces, in order:

1. **Bytes through the adapter — shipped.** A non-JSON, non-text request reaches
   `WebRequest.rawBody` as a `Uint8Array`, and both adapters enforce
   `maxBodyBytes` with a 1 MiB default before dispatch.
2. **A buffering multipart parser — shipped.** A streaming parser would require
   `WebRequest` to carry a `ReadableStream`, which means routing,
   validation and `Ctx` construction all have to cope with a body that does not exist
   yet at match time — a redesign of the request half of the pipeline. A bounded
   buffer's safety is one comparison; a streaming parser's is every consumer
   honouring backpressure. And the case buffering cannot serve is the 200 MB upload,
   which the presigned-object-storage section says should not be going through the
   application anyway.
3. **`multipartPipe` — shipped.** `Pipe<unknown, Multipart>` fits the existing
   `transform(value, ctx)` signature. The router does not auto-run complete chains,
   so handlers invoke `runChain` explicitly and place their ordinary
   `validationPipe` after `multipartPipe`. No decorator: `@UploadedFile()` would be
   a second way to reach `ctx.body`, and this package's handlers take one `Ctx`,
   which is what keeps them ordinary functions.

The limits, with defaults: 16 parts, 1 MiB per part, 8 MiB total, 100-byte field
names, 255-byte filenames, 1 KiB of headers per part. Two of those are not obvious
and both are real — a part with a ten-megabyte `content-disposition` line is an
unbounded allocation containing no file content at all.

Every limit has a default and none can be removed: `0`, `Infinity`, `-1` and a
non-integer are all construction errors rather than clever ways to switch a check
off. Raising a limit is the supported operation.

**A body over the adapter's `maxBodyBytes` is destroyed, not drained.** Per-part
limits run after that bounded body is materialised; the parser stops scanning and
the handler never runs. A client still writing past the adapter limit may see a
connection reset instead of the `413`.

**The client filename is a label and nothing else.** A filename containing a `\0` or a path separator makes the part a `400` rather than being stripped, because the sanitised version of `../../etc/passwd` is a filename somebody will concatenate. The caller generates the storage key; the parser performs no I/O.

The declared content type is recorded verbatim and nothing in the parser branches on it — the framework does not sniff, because a magic-number table goes stale, disagrees with whatever library will process the bytes, and has nothing to say about `image/svg+xml`, which is the type that actually matters.

Even with all of it, presigned uploads remain the better production answer for
anything large.

---

See also: [Request Pipeline](./web-pipeline.html) · [Raw Body](./web-raw-body.html) · [Authorization](./web-authorization.html)
