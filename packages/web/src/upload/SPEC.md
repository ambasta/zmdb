# `@zmdb/web` — multipart uploads SPEC

> Parsing `multipart/form-data` under limits that cannot be removed (epic #564,
> sub-issue #565). Frozen before code.

Blocked in fact on `../pipeline/SPEC.md` §A7 and not on the response union: today
`toNodeHandler` calls `req.setEncoding('utf8')` and accumulates `String(chunk)`, and
`readFetchBody` calls `request.text()`. Both are correct for JSON and both destroy
every byte sequence that is not valid UTF-8, so a multipart body currently reaches a
handler as a lossily-decoded string with its boundaries intact and its file content
corrupted. Nothing here is implementable until `rawBody` can carry bytes.

## 1. The recommendation this feature does not replace

For anything large, a presigned upload directly to object storage is better than
every design below: the bytes never enter the process, so a 200 MB upload costs no
memory, no request duration and no bandwidth, and the application only signs and
records. That remains the documented advice.

This parser exists for the self-hosted deployment with a form and a few small
files — an avatar, a CSV, an attachment. Its design follows from that scope rather
than from an ambition to be a general file-transfer path.

## 2. Buffered, not streamed — and why

Both are defensible and the choice is buffering, with a hard total limit.

1. **The request side is not streaming and making it so is a second core-type
   change.** `WebRequest.rawBody` is a fully materialised `unknown`, and both
   adapters read the whole body before `router.handle` is called. A streaming parser
   needs `WebRequest` to carry a `ReadableStream<Uint8Array<ArrayBuffer>>`, which
   means the routing, validation and `Ctx` construction steps all have to cope with
   a body that does not exist yet at match time — a redesign of the request half of
   the pipeline, in an epic whose stated subject is the response half.
2. **A bounded buffer is provably bounded.** A streaming parser's memory safety is a
   property of every consumer honouring backpressure and aborting on the limit; a
   buffer's is a property of one comparison. For the security-critical half of a
   security-critical feature, the version whose safety is one comparison wins.
3. **The case buffering cannot serve is the case §1 says to presign.** Streaming
   exists for the 200 MB upload, and the 200 MB upload should not be going through
   the application at all.

So: the adapter's `maxBodyBytes` (`../pipeline/SPEC.md` §A7) bounds the transfer,
the parser reads from the resulting `Uint8Array`, and each part is a
`Uint8Array<ArrayBuffer>` view. The ceiling is stated plainly rather than hidden:
`maxTotalBytes` defaults to 8 MiB and is raisable, and above roughly 64 MiB the
honest answer is a presigned upload, not a larger number.

If streaming uploads are ever wanted, the prerequisite is named here so it is not
rediscovered: `WebRequest` gains a body stream, both adapters stop materialising,
and this parser gains an incremental boundary scanner. None of that is in this epic.

## 3. The limits

```ts
export interface UploadLimits {
  readonly maxParts: number;
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFieldNameBytes: number;
  readonly maxFilenameBytes: number;
  readonly maxPartHeaderBytes: number;
}

export const UPLOAD_DEFAULTS: UploadLimits = {
  maxParts: 16,
  maxPartBytes: 1_048_576, // 1 MiB
  maxTotalBytes: 8_388_608, // 8 MiB
  maxFieldNameBytes: 100,
  maxFilenameBytes: 255,
  maxPartHeaderBytes: 1024,
};

export declare function parseMultipart(
  rawBody: unknown,
  contentType: string,
  limits?: Partial<UploadLimits>,
): Multipart;
```

`UploadLimits` is **total** and the argument is `Partial<UploadLimits>`. That is how
"defaulted, not optional in effect" is spelled without fighting
`exactOptionalPropertyTypes`: `{ ...UPLOAD_DEFAULTS, ...limits }` yields a total
`UploadLimits` with no cast — verified — whereas a single interface with optional
members would make every internal read of a limit a `?? default` that can be
forgotten in one place.

Two limits are not in #565's sketch and are needed. **`maxPartHeaderBytes`** bounds
each part's header block, because a part with a ten-megabyte `content-disposition`
line is an unbounded allocation that never contains a single byte of file content.
**`maxFilenameBytes`** bounds the one client-supplied string this feature stores.

**Every limit has a default and none can be removed.** `parseMultipart` rejects a
limit that is not a positive, finite, safe integer — so `0`, `Infinity`, `-1`, `NaN`
and `2 ** 60` are all construction errors rather than clever ways to disable a
check. Raising a limit is the supported operation; removing one is not an operation.

### On exceeding one

| limit                                                                       | answer                                       |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| `maxTotalBytes`                                                             | `413`, then the connection is destroyed      |
| `maxBodyBytes`                                                              | `413` at the adapter, before the parser runs |
| `maxPartBytes`                                                              | `413`                                        |
| `maxParts`                                                                  | `413`                                        |
| `maxFieldNameBytes`                                                         | `413`                                        |
| `maxFilenameBytes`                                                          | `413`                                        |
| `maxPartHeaderBytes`                                                        | `413`                                        |
| missing/invalid boundary, no terminator, part with no `content-disposition` | `400`                                        |

Size limits are `413` and malformed input is `400`, uniformly, because the two mean
different things to a client: one says "send less", the other says "send it
correctly", and collapsing them makes both unactionable.

**An over-limit body is destroyed, not drained.** Draining means reading a hostile
request to completion in order to answer it politely, which is the resource
consumption the limit just refused — an attacker who wants to occupy the process
would ask for exactly that. The cost is real and is stated rather than hidden: an
HTTP/1.1 client still writing its body may see a connection reset instead of the
`413`, because the response races the remaining upload. That is the correct trade.
The mitigation belongs to the client and is worth documenting: check the size before
uploading, or send `Expect: 100-continue`, which lets the server refuse on the
headers alone.

## 4. Filenames and content types are untrusted

```ts
export interface UploadPart {
  readonly name: string; // the form field name
  readonly filename: string | undefined; // client-supplied, a label only
  readonly declaredType: string | undefined; // client-supplied, a hint only
  readonly bytes: Uint8Array<ArrayBuffer>;
}
export interface Multipart {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly UploadPart[];
}
```

**`filename` is never used for I/O, and the type cannot express that, so the rule is
the contract.** The parser stores it as an opaque label, truncated to
`maxFilenameBytes`, with a `\0` or a path separator making the part a `400` rather
than being stripped — stripping produces a _different_ name that looks sanitised,
and the sanitised version of `../../etc/passwd` is a filename somebody will
concatenate. A storage key is generated (`globalThis.crypto.randomUUID()`), which
also removes the collision and the overwrite.

The parser does not derive an extension from the filename either. An extension
allow-list is the application's, applied to the _declared_ extension it chose to
accept, and it is an allow-list for `../compression/SPEC.md` §6's reason: a
deny-list is a list of what somebody thought of, and `.php5`, `.phtml` and `.svg`
are what they missed.

**`declaredType` is recorded, never trusted, and never used to decide anything.**
The framework does not sniff either: a magic-number table is a data file that goes
stale, it disagrees with whatever the application's own image library thinks, and
`image/svg+xml` — the type that actually matters, because an SVG served from your
origin executes script — has no magic number at all. So the framework records what
the client said, and the docs say what to do: derive the type from the library that
will process the bytes, and serve user content from a different origin.

`fields` is `Record<string, string>` and a non-file part over `maxPartBytes` is a
`413` like any other. A repeated field name keeps the **last** value and does not
build an array, because a `string | string[]` field is the shape that produces
type-confusion bugs in validators — the same reason `flattenHeaders` collapses
repeated headers today.

## 5. Wiring it in

A `Pipe`, which needs no new pipeline concept:

```ts
const multipart: Pipe<unknown, Multipart> = {
  transform: (value, ctx) => parseMultipart(value, ctx.headers['content-type'] ?? '', { maxTotalBytes: 4 << 20 }),
};
```

`Pipe<unknown, Multipart>` fits the existing `transform(value, ctx)` signature
exactly, so uploads add a function and no framework surface. A handler then
validates the fields with `assert` as it would any other body — the parse produces
`unknown`-shaped data, and `../../../../ARCHITECTURE.md` §2.3 puts the validation at
the boundary, not in the parser.

No decorator. `@UploadedFile()` and a `FileInterceptor` analogue would each be a
second way to reach `ctx.body`, and the parameter-decorator form is unavailable
anyway — this package's handlers take one `Ctx`, which is what makes them ordinary
functions.

## 6. What #566 has to assert

1. A multipart body with a file part whose bytes are **not valid UTF-8** round-trips
   byte for byte, including a `0xFF 0xFE` sequence and a byte pattern that straddles
   two chunks of the incoming request. This is the assertion that would have caught
   the `String(chunk)` defect, and it fails before `../pipeline/SPEC.md` §A7 lands.
2. Each limit in §3's table, one assertion each, with the documented status.
3. A limit set to `0`, `Infinity`, `-1` and a non-integer is a construction error —
   the "cannot be removed, only raised" property, asserted rather than asserted-in-prose.
4. `maxTotalBytes` is enforced against the transfer, so a body of many small parts
   whose contents sum to less than the limit but whose boundaries push the total over
   it is still refused.
5. A filename of `../../etc/passwd`, one containing a `\0`, and one containing a
   backslash are each a `400`, and none of them appears anywhere in a sanitised form.
6. A filename over `maxFilenameBytes` is truncated on the label and the part is still
   accepted.
7. `declaredType` is preserved verbatim, including a bogus one, and nothing in the
   parser branches on it.
8. A repeated field name yields a `string`, not an array.
9. A missing boundary, a truncated final boundary, and a part with no
   `content-disposition` are each `400`.
10. The parser never touches the filesystem — asserted by there being no `node:fs`
    import in the module, which is a lint-visible property rather than a runtime one.

## Non-goals (rejected)

- **A streaming parser** (§2), and the `WebRequest` body stream it would need.
- **Writing parts to disk.** A framework that chooses a temporary directory chooses a
  cleanup story, a permissions story and a disk-exhaustion story on the
  application's behalf. The bytes are handed over; where they go is the
  application's decision.
- **Content-type sniffing** (§4).
- **An extension allow-list inside the framework** (§4) — the list is
  application-specific and a wrong one is worse than none.
- **Sanitising a hostile filename instead of refusing the part** (§4).
- **`string | string[]` fields** (§4).
- **`@UploadedFile()` / `FileInterceptor`** (§5).
- **Draining an over-limit body** (§3).
- **Image processing, EXIF stripping, virus scanning, thumbnailing.** Each is a
  runtime dependency under Directive 7 and each is a separate service in any
  deployment that needs it.
- **`multipart/mixed` or any multipart type other than `form-data`.** No browser
  sends one.
- **Request-body decompression before parsing.** `../compression/SPEC.md`'s
  non-goals: a compressed request body is an amplification vector needing its own
  decompressed-size limit.
