# `@zmdb/web` — static files SPEC

> Serving a directory of files over HTTP, confined to that directory by
> construction (epic #564, sub-issue #565). Frozen before code. This is the one
> file in the epic where a mistake is a disclosed private key rather than a slow
> response, so the confinement rules below are enumerated technique by technique
> instead of summarised.

Depends on `../pipeline/SPEC.md`'s [streaming amendment](../pipeline/SPEC.md): a
static handler that materialises each file as a string is the memory bug the epic
exists to remove, so nothing here is implementable before `#567`.

## 1. The surface

```ts
export interface StaticOptions {
  readonly root: string;
  readonly index?: string;
  readonly cacheControl?: string;
  readonly contentTypes?: Readonly<Record<string, string>>;
  readonly onError: (error: unknown) => void;
}

export interface StaticHandler {
  serve(pathname: string, headers: Readonly<Record<string, string>>): Promise<WebResponse>;
}

export declare function createStaticHandler(options: StaticOptions): Promise<StaticHandler>;
```

`createStaticHandler` is async because it resolves `root` to its real path **once,
at construction**, and refuses a `root` that does not exist or is not a directory.
Resolving per request would mean re-reading the same symlinks on every request and,
worse, would let a `root` that becomes a symlink at runtime change what the handler
serves without the process noticing.

`serve` takes a `pathname` and the request headers and returns a `WebResponse`, so a
static handler is an ordinary controller method:

```ts
@Get('/assets/*')
async asset(ctx: Ctx<{ '*': string }>) {
  return this.assets.serve(ctx.params['*'], ctx.headers);
}
```

It returns a response rather than throwing, including for a rejection, because §3
requires every rejection to be indistinguishable and an exception's message is the
first thing that leaks.

## 2. Confinement, technique by technique

The check is a sequence of refusals over the _decoded_ path, then a containment test
over the _resolved real_ path. Each step below exists because it is the step some
production static handler was missing.

1. **Percent-decode exactly once, then refuse any remaining `%`.** One decode is
   what turns `%2e%2e%2f` into `../` so the later checks can see it; refusing a
   surviving `%` is what kills double encoding (`%252e%252e%252f`) without a decode
   loop whose termination is its own question. A legitimate asset filename does not
   contain a literal percent sign, and the cost of that restriction is a rename.
2. **Refuse a `\0` anywhere.** A null byte truncates the path in any layer below
   that is C-shaped, so `/assets/ok.css\0/../../etc/passwd` can pass a check
   performed on the full string and open a different file.
3. **Refuse a `\` anywhere.** It is a path separator on Windows and never
   meaningful in a URL path, so a backslash is either an attack or a mistake.
4. **Refuse a leading `/`, an absolute path, a drive letter (`C:`) and a UNC
   prefix (`//`).** The handler accepts a path relative to its configured root;
   anything absolute after decoding is an attempt to replace that root rather than
   index into it.
5. **Split on `/` and refuse any segment equal to `..`, and any segment beginning
   with `.`.** The `..` refusal is done on segments rather than by trusting
   `normalize`, because normalisation is a string transformation whose result still
   has to be checked and checking the input directly is one fewer step to get
   wrong. Refusing dot-segments removes `.git`, `.env`, `.htaccess` and
   `.DS_Store` as a class rather than as a list, and it is not configurable: a
   deployment that wants to serve a dotfile can copy it to a name without the dot.
6. **Refuse an empty segment (`//`) and a trailing `/`.** Both resolve to a
   directory, and §5 says a directory is never served.
7. **Join and resolve, then require containment:** `resolved === root ||
resolved.startsWith(root + sep)`. The separator in the prefix is load-bearing —
   without it `/var/www/assets-private` passes a `startsWith('/var/www/assets')`
   test. This is a belt over the braces of step 5, not a replacement for it.
8. **Re-apply containment to the real path.** After the descriptor is open (§4),
   resolve symlinks and require the result to be inside `root` by the same test.
   This is the case people forget: every string check above passes for
   `/var/www/assets/backup` when that name is a symlink to `/home/app/.ssh`. The
   policy is therefore **follow within root only** — a symlink whose target is
   inside the root is served, a symlink that escapes is refused — which supports
   the common deployment where a release directory is symlinked into place while
   refusing the one that leaks.
9. **Open once, and read from the descriptor.** Every response size, mtime and
   byte comes from the same open file handle, never from a second open by path.
   Platforms without a descriptor-to-realpath facility may stat the resolved
   target only to compare filesystem identity with the descriptor; that stat is
   not response metadata. A path checked and then re-opened is a
   time-of-check-to-time-of-use race: an attacker who can create files in the
   served directory replaces a regular file with a symlink between the two
   operations and the checks all passed on the file that no longer exists.
10. **Refuse anything that is not a regular file.** A directory, a FIFO, a device
    or a socket. Reading a FIFO blocks the handler forever, and `/dev/zero` is an
    infinite response body — both are denial of service through a path that
    contains no traversal at all.

On a case-insensitive filesystem — macOS and Windows — a request for `/SECRET.ENV`
finds `secret.env`. Steps 5 and §7's content-type allow-list cover the realistic
cases, and the general answer is the one in the docs: do not put anything in the
served directory that must not be served.

## 3. Every rejection is the same 404

A refused traversal, a file that does not exist, a directory, a symlink that
escapes, a FIFO and a file the process cannot read all answer **`404` with an empty
body and no detail**. Not `403`.

The reason is that any distinction is an oracle. A `403` for "outside the root" and
a `404` for "not found" tells an attacker exactly where the boundary is and lets
them map the filesystem one request at a time without ever reading a file. A
message naming the rejected technique tells them which encodings to stop trying.
Uniformity costs a developer one debugging session, which the `onError` sink covers,
and costs an attacker the entire reconnaissance phase.

`onError` is called for the cases that indicate a bug or an attack — a refused
path, an unreadable file, a symlink escape — and not for an ordinary miss, so a
deployment can alert on it without alerting on every favicon request.

## 4. Reading the file

```ts
const fh = await open(resolved); // once, by path, no second lookup
const stat = await fh.stat(); // from the descriptor
const body = descriptorStream(fh, start, end); // ReadableStream<Uint8Array<ArrayBuffer>>
```

The descriptor-backed stream is what makes the `stream` arm of `ResponseBody`
reachable from a file with no adapter-specific code, and its cancellation closes
the descriptor — which is why `../pipeline/SPEC.md` §A3's disconnect handling is a
prerequisite and not a refinement. `length` is derived from the descriptor's
`stat().size`, so a static response always carries a `content-length` and is never
chunked.

`file(path, options)` in the pipeline is this sequence without the confinement
checks, for a handler that already knows the path it wants. Everything in §2 is the
difference between `file()` and a static _handler_, and it is the whole reason the
handler exists as a separate thing.

## 5. Directory listing is off, permanently

There is no option to turn it on. A listing is the reconnaissance step that every
other rule in §2 is trying to deny, and a deployment that wants an index of files
can generate one as a file. A path that resolves to a directory is a `404` by §2.10.

`index` is a _separate_ opt-in and is not a listing: when set (conventionally
`'index.html'`), a request whose path is empty appends it. That covers the
single-page-application root and nothing else. It is off by default, because an
implicit index means the same URL serves different content depending on which files
exist.

A single-page-application fallback — serve `index.html` for any unmatched path so a
client-side router can take over — is deliberately **not** in the handler. It is a
routing decision (which paths are the API and which are the app), the handler cannot
know it, and a handler that guesses turns every mistyped API path into a `200` of
HTML, which breaks clients in the most confusing way available. It belongs in the
controller, in one visible line.

## 6. Caching, conditional requests and ranges

**The `ETag` is weak: `W/"<size>-<mtimeMs>"`.** Weak is the accurate label. Size and modification time cannot distinguish two different files of the same length written in the same millisecond, and a strong validator would have to hash the contents, which reads the whole file and defeats the streaming this handler exists for.

Labelling it strong would be worse than not sending one, because a strong validator licenses a client to assemble byte ranges from two different responses — so the label is what keeps the range behaviour below correct.

**`Last-Modified`** comes from the same `stat`, formatted as an HTTP-date, which has
one-second resolution. That truncation is why `If-None-Match` is evaluated first: a
file modified twice within a second is unchanged as far as `If-Modified-Since` can
tell, and the ETag's millisecond component notices.

**Conditional requests.** `If-None-Match` takes precedence over
`If-Modified-Since` when both are present, per RFC 9110. A match answers `304`
with `ETag`, `Last-Modified` and `Cache-Control`, **no body and no
`content-length`**, and the stream is never opened. Comparison is weak, which is
what a weak validator requires.

**`Cache-Control` defaults to `public, max-age=0, must-revalidate`.** Conservative
on purpose and in the same spirit as every other default here: a `max-age` that is
too long cannot be corrected for its duration, because the caches holding the stale
response never ask again. A deployment with content-hashed filenames sets
`public, max-age=31536000, immutable` explicitly, which is exactly the case where
the operator knows the name changes when the bytes do.

**`accept-ranges: bytes`** on every `200`. Range handling:

| request                           | answer                                                  |
| --------------------------------- | ------------------------------------------------------- |
| `bytes=0-499`, `bytes=500-`       | `206` with `content-range` and the exact byte window    |
| `bytes=-500` (suffix)             | `206` over the last 500 bytes, clamped to the file size |
| `end` past the end                | clamped to `size - 1`, still a `206`                    |
| `start >= size`                   | `416` with `content-range: bytes */<size>` and no body  |
| malformed (`bytes=abc`, `bytes=`) | ignored: `200` with the whole file, per RFC 9110 §14.2  |
| more than one range               | ignored: `200` with the whole file                      |
| `If-Range` present                | ignored: `200` with the whole file                      |

Two of those are decisions rather than transcriptions.

**Multiple ranges are refused by ignoring them**, because `multipart/byteranges` is a second body format with its own boundary generation and its only real-world consumer is a PDF viewer that works fine without it; serving the whole file is always a correct answer to a `Range` request and this one is clear about the trade-off.

**`If-Range` is ignored for the same reason the ETag is labelled weak** — `If-Range` requires a strong validator, and answering it with a weak one is how a client ends up splicing two versions of a file together.

`content-range` and the window are applied while reading the already-open
descriptor with explicit positions, so a range response streams the window and
never reads the rest.

## 7. Content types are an allow-list

A fixed extension-to-type map, defaulting to `application/octet-stream`, overridable
by `contentTypes` but never _derived_ — not from the request, not from the bytes, not
from a lookup library.

`application/octet-stream` as the fallback is deliberately boring: it downloads
rather than renders, so an unrecognised extension cannot become HTML in a browser
that was willing to guess. `x-content-type-options: nosniff` is sent on every
response, because the fallback only works if the browser honours it.

The map is an allow-list rather than a deny-list for the same reason
`../upload/SPEC.md` §4 uses one: a deny-list is a list of the attacks somebody
thought of, and `.php5`, `.phtml` and `.svg` are the ones they did not.

`Content-Disposition` is not set by this handler. A static asset is meant to render;
a download is `file()` with an explicit disposition header, where the caller owns
the filename and its escaping.

## 8. What #566 has to assert

1. Each of §2's ten refusals, one assertion each, and every one of them a `404`
   with the same empty body — including `%2e%2e%2f`, `%252e%252e%252f`, a null
   byte, a backslash, a `..` segment, a dotfile, a trailing slash and a `C:` prefix.
2. A symlink inside the root pointing outside it is a `404`; a symlink inside the
   root pointing to another file inside it is served. Both are needed: one asserts
   the check exists, the other asserts it is not a blanket refusal.
3. `/var/www/assets-private/x` is refused when the root is `/var/www/assets` — the
   trailing-separator case.
4. A FIFO and a directory are both `404`, not a hang and not a listing.
5. There is no option that enables directory listing — a compile-time assertion
   over `StaticOptions`, since a missing runtime option is not observable.
6. A `304` on a matching `If-None-Match` carries no body, no `content-length`,
   closes the descriptor before returning, and never constructs the body stream
   (asserted by a descriptor count or an `open` spy).
7. `If-None-Match` wins over a contradicting `If-Modified-Since`.
8. Every range row in §6's table, including that two ranges and an `If-Range` both
   answer `200` with the whole file, and that `start >= size` is a `416` carrying
   `content-range: bytes */<size>`.
9. A range response reads only the window (asserted by the stream's byte count, not
   by timing).
10. An unknown extension is `application/octet-stream`, and every response carries
    `x-content-type-options: nosniff`.
11. A client disconnect mid-file closes the descriptor.
12. `createStaticHandler` rejects a `root` that is missing, is a file, or is not a
    directory — at construction, not at the first request.

## Non-goals (rejected)

- **Directory listing, at any configuration** (§5).
- **A single-page-application catch-all inside the handler** (§5) — the handler
  cannot know which paths are the API, and guessing turns a typo into a `200`.
- **A `403` for a refused path, or any message naming the reason** (§3).
- **Deriving `content-type` from the bytes or from a media-type library** (§7). The
  first is a magic-number table that rots, the second is a runtime dependency.
- **`multipart/byteranges`** and **`If-Range`** (§6).
- **A strong `ETag`** (§6) — it requires hashing the file, which is what streaming
  was for.
- **In-memory file caching.** The operating system's page cache already holds the
  file, and a second cache inside the process adds an invalidation bug and an
  unbounded memory footprint to something that was already fast.
- **Compression inside the static handler.** `../compression/SPEC.md` is a
  middleware over `ResponseBody` and works for every response, not only files.
- **Pre-compressed sibling lookup (`x.css.br`).** It needs the encoding negotiation
  from the compression middleware plus its own `Vary` handling and its own
  `ETag` per variant; it belongs there if it ever ships.
- **Serving a directory the application also writes to.** Not something the
  framework can prevent, and documented as the mistake it is: an upload directory
  served statically is stored XSS on the origin.
- **`etag: false` or `lastModified: false`.** Options whose only effect is to make
  caching worse.
