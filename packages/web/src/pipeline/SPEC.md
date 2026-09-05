# `@zmdb/web` — request pipeline & adapters SPEC

> The dispatcher that ties routing + Ctx + DI together, plus thin adapters (epic #272). Frozen before code. Supersedes/absorbs the old `makeEndpoint`.

## Contract

### Route registration

- **`createRouter(options?)`** → a `Router`, where `options.guardRegistry` may declare app guards and controller guards keyed by controller class name.
- **`router.register(controllerInstance)`** — read the controller's routes via `getRoutes(controllerInstance.constructor)` (built once at register time) and bind each to the instance's handler method.
  The resolved table is cached.
- **`router.registerDeferred(controllerClass, instance)`** — read routes from the class at registration time, then await `instance()` only after one of those routes matches. No route is added or
  removed during the load.
- Each route may carry optional **`guards`** and a **`validateBody`** hook. The effective guard chain is resolved once at registration in app → controller → route order. `@Public()` bypasses inherited
  app/controller guards and cannot declare route guards or a non-empty explicit security requirement.
- Guards run first; the first `false` yields 403 and the handler never runs. The validator (`(raw: unknown) => Body`) then runs before the handler; if it throws, the handler is **not** called and the
  pipeline yields a 400.

```ts
export interface GuardRegistry {
  readonly app?: readonly Guard[];
  readonly controllers?: Readonly<Record<string, readonly Guard[]>>;
}

export interface RouterOptions {
  readonly guardRegistry?: GuardRegistry;
}
```

### Incoming request → response

- **`router.handle(req: WebRequest): Promise<WebResponse>`** where:
  - `WebRequest = { method: string; path: string; headers; rawBody?: unknown; query? }`
  - `WebResponse = { status: number; body: ResponseBody; headers }`, where `ResponseBody` is the three-arm tagged union in [A1](#a1-webresponsebody-is-a-three-arm-tagged-union), and `rawBody` carries
    bytes for a non-JSON request.
- Pipeline steps, in order:
  1. **Match** — the method and the path's segment count (`countSegments`) select a bucket of the cached table; candidates are tried in registration order against patterns compiled once by
     `compilePattern` at register time, using `matchCompiled`. No match → `404`. Routes that disagree on method or segment count are never examined, so this is not a scan of the whole table.
  2. **Build `Ctx`** — params from the match, `body`/`query`/`headers`/`method`/ `path` from the request.
  3. **Guard** — run every effective app, controller and route guard in that order; first `false` → 403. A route marked `@Public()` runs none.
  4. **Validate** — if the route has `validateBody`, run it on `rawBody`; on throw → `400` with the error message (handler never runs).
  5. **Invoke** the handler with the ctx.
  6. **Serialize** the result to JSON (`200`); a thrown handler → `500`, except a framework boundary error whose status is already decided (the multipart pipe's `400`/`413`). A handler that returns a
     response built by one of the factories below is returned verbatim instead, status and headers included.
- No per-request reflection; one `Ctx` + one result object allocated per request.

### Handler-controlled responses

A handler that returns a plain value gets `200 application/json`, unchanged. To choose a status, add headers, or send a body that is not JSON, it returns one of:

- **`json(value, { status?, headers? })`** — JSON body; supplied headers merge over `content-type: application/json`.
- **`text(body, { status?, headers? })`** — the body verbatim, with `content-type: text/plain; charset=utf-8`.
- **`respond({ status?, body?, headers? })`** — full control, **no** assumed content type; for HTML, CSV, a redirect, or a `204`.
- **`bytes(value, options?)`** — an exact byte body.
- **`stream(value, { length?, onError, ... })`** — a web stream with required post-headers error reporting.
- **`file(path, { contentType?, onError, ... })`** — a known file path as a bounded stream; path confinement belongs to the static-file handler.

These are recognised by a marker symbol (`Symbol.for('zmdb.web.response')`), not by inspecting the result's shape. This is load-bearing: `{ status: 'draft' }` is an ordinary body, and a structural
check would silently promote its `status` to an HTTP status. The marker is non-enumerable, so a `WebResponse` remains the plain `{ status, body, headers }` record every existing consumer reads.

### Adapters (thin, optional, structurally typed — no hard deps)

- **`toNodeHandler(router, options?: { maxBodyBytes: number })`** → an \`(req, res) => void\` compatible with \`node:http\` (reads method/url/headers, buffers the bounded request body, and streams the
  response with backpressure). Typed structurally so \`node:http\` is not a dependency.
- **`toFetchHandler(router, options?: { maxBodyBytes: number })`** → a \`(request: Request) => Promise<Response>\` usable by Hono / any Fetch-based runtime. Typed against the global \`Request\`/
  \`Response\` (Node 26 has them) — no Hono dependency.

## Invariants

- **No `as`/`any`/`!` on the consumer surface.** Internal boundary reads (matched route handler, JSON parse) are commented boundaries per ARCHITECTURE.md §2.1.
- No reflection; validation via an injected hook (AOT `assert` fits) — no runtime parser baked in.

## Acceptance

- A registered controller's route dispatches: correct handler, params extracted, app/controller/route guards run in order before body validation (first false → 403), body validated before the handler
  (invalid → 400, handler not called), serialized 200 result; unknown path → 404; throwing handler → 500, except the multipart boundary status propagated by an explicit chain.
- The node + fetch adapters round-trip a request to a response (in-process test).
- `text('0')` answers with the single byte `0` and no quotes; `respond({status:302, headers:{location}})` sends neither a body nor a `content-type`; a returned object carrying its own `status` field
  is still a `200` JSON body.
- One response's headers cannot leak into the next (the JSON default is a shared constant and must never be merged into).
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

Pipes/interceptors/filters (epic #287), modules (#282), OpenAPI generation (#302).

## Amendments (streaming responses, #565; implemented by #567)

Epic #564 needed a response that is not a fully materialised string, and everything else in that epic — compression, static files, uploads, templates, CSRF — is downstream of this one type. Five
things in the contract above change, one thing that looks like it should change does not, and one thing outside the response model turns out to be a prerequisite.

The promise this implementation keeps, which is narrower than "nothing changes": every response the three pre-existing factories produce sends **the same bytes, with the same headers, in the same
number of writes**. What changes is what a handler is _able_ to return. The one deliberate exception is §A7's request body limit, and it is called out as an exception rather than folded in.

### A1. `WebResponse.body` is a three-arm tagged union

```ts
export type ResponseBody =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: 'stream';
      readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
      readonly length: number | undefined;
    };

export interface WebResponse {
  readonly status: number;
  readonly body: ResponseBody;
  readonly headers: Readonly<Record<string, string>>;
}
```

**A tag rather than `string | Uint8Array | ReadableStream`.** The bare union looks smaller and is worse in three specific ways. `body.length` is defined on two of the three arms and means something
different on each — UTF-16 code units on a string, bytes on a `Uint8Array` — so the one question every adapter has to answer (`content-length`) is the question the untagged union answers ambiguously
and silently. `typeof body === 'object'` does not separate a `Uint8Array` from a `ReadableStream` without an `instanceof` chain, and `instanceof ReadableStream` against a cross-realm stream is false.

And a tag makes a fourth arm a compile error at every consumer:

```ts
switch (body.kind) {
  case 'text': …
  case 'bytes': …
  case 'stream': …
  default: return never(body); // TS2345 the day a fourth arm is added
}
```

That last property is what the adapters, the filters, the compression middleware and the testing readers all rely on, and it is why the tag is worth its cost.

**`Uint8Array<ArrayBuffer>`, not `Uint8Array`.** This is not pedantry, it is the difference between compiling and not. Under TypeScript 7 a bare `Uint8Array` means `Uint8Array<ArrayBufferLike>`, which
includes a `SharedArrayBuffer`-backed view, and `BodyInit` excludes those — so `new Response(body.value)` in `toFetchHandler` is
`TS2345: Argument of type 'Uint8Array<ArrayBufferLike>' is not assignable to parameter of type 'BodyInit'`.

Verified against the compiler with this package's own `lib` and `types`. The only ways out are the parameter above or an `as` at the adapter, and §2.5 forbids the second. The same applies inside the
stream arm.

**`length: number | undefined`, not `length?: number`.** Also verified: under `exactOptionalPropertyTypes` a caller that computes the length from a `stat` cannot write the optional form —

```ts
const stat = await fh.stat();
return { kind: 'stream', value, length: stat.isFile() ? stat.size : undefined };
// TS2322 with length?: number — "Consider adding 'undefined' to the target"
```

— and the workaround is a conditional spread at every construction site. Required and explicitly nullable is the same choice `RawMessage.correlationId` made in `../microservices/SPEC.md` §2 for the
same reason.

**The allocation, stated rather than waved at.** Epic #564's cost constraint says streaming must not add per-response allocation to the small-JSON path, and a wrapper object is exactly that: one extra
two-field object per response. It is kept anyway, and the accounting is the argument. `json(value)` already allocates the response record, the `JSON.stringify` result, and — whenever headers are
supplied — a merged header object.

The wrapper is a monomorphic two-slot literal next to a `JSON.stringify` that costs orders of magnitude more, so the constraint is met in substance and violated in letter. Two mitigations make it
exactly zero where it is cheapest to be zero: `text('')`, `respond({ status: 204 })` and every no-body path share one frozen `EMPTY_TEXT` constant, the same trick `JSON_HEADERS`/`NO_HEADERS` already
use; and the wrapper is constructed inside the factories, so no call site anywhere changes.

### A2. Two new factories, and one that deliberately does not grow

`json`, `text` and `respond` keep their exact signatures and construct the `text` arm internally. `respond`'s `body?: string` **stays a string**: a byte or stream response goes through the new
factories, because `respond` assumes no content type and a byte body with no `content-type` is a browser-sniffing hazard rather than a convenience.

```ts
export interface StreamOptions extends ResponseOptions {
  readonly length?: number;
  readonly onError: (error: unknown) => void;
}
export interface FileResponseOptions extends ResponseOptions {
  readonly contentType?: string;
  readonly onError: (error: unknown) => void;
}

export declare function bytes(value: Uint8Array<ArrayBuffer>, options?: ResponseOptions): WebResponse;
export declare function stream(value: ReadableStream<Uint8Array<ArrayBuffer>>, options: StreamOptions): WebResponse;
export declare function file(path: string, options: FileResponseOptions): Promise<WebResponse>;
```

**`onError` is required, so the second argument of `stream` and `file` is required too** — a correction to the `options?` in #565's own surface sketch.

Once the first byte is on the wire there is no status code left to send and no filter left to run, so a failing stream is the one error in this package that cannot be reported through its return
value.

Defaulting the sink would mean defaulting it to silence, and a truncated download that nothing records is the failure this section exists to prevent. Both factories are new, so requiring the argument
breaks nothing.

**The sink is on the response, not on the adapter.** `toNodeHandler(router, { onStreamError })` was the alternative and is worse twice over: it is per-server where the failure is per-stream, so the
report cannot name what was being sent; and it leaves the fetch adapter with nothing, because a runtime that owns the response never hands the error back.

Putting it on the response also keeps the promise in §A1 — streaming does not add an adapter-level error callback; the adapter's only optional configuration is the request-body limit.

`stream()` therefore returns a response whose `value` is the caller's stream **wrapped** in a pass-through that reports to `onError` and re-raises. That is what makes the sink uniform: whichever side
observes the failure, the report happens once, in the same place, on both adapters. `file()` is `stream()` over a file descriptor (see `../static/SPEC.md` §4) and is async because it stats and opens
before it can answer.

No logger is acquired anywhere in this package to serve this, for the reason `../microservices/SPEC.md` §5 gives: a required sink is testable and a logger at the least testable point in the process is
not.

### A3. The Node adapter contract

`NodeResLike` contains exactly the members below, and no more, because every member is a claim about what a non-`node:http` response object must provide:

```ts
interface NodeResLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  writeHead?(status: number, headers: Readonly<Record<string, string>>): unknown;
  write(chunk: Uint8Array<ArrayBuffer>): boolean;
  once(event: string, listener: () => void): void;
  destroy(error?: Error): void;
  end(body?: string | Uint8Array<ArrayBuffer>): void;
}
```

Per kind, after the single `writeHead` the current adapter already does:

| kind     | how                                                                              |
| -------- | -------------------------------------------------------------------------------- |
| `text`   | `res.end(value)` — byte-identical to today, one write, no encode step in-process |
| `bytes`  | `res.end(value)`                                                                 |
| `stream` | the loop below                                                                   |

```ts
const reader = body.value.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!res.write(value)) await new Promise<void>(r => res.once('drain', r));
}
res.end();
```

**Backpressure is the `write` return value, not a hope.** Ignoring it buffers the entire stream in the socket's outgoing queue, which turns a 2 GB file served to one slow client into 2 GB of process
memory — the exact bug streaming was added to fix, reintroduced in the adapter.

The platform stream queues remain bounded: measured on Node 26, a source piped through one default `TransformStream` can have two chunks pulled before the first write (one per queue), and the count
does not grow while `write()` is waiting for `drain`.

**Client disconnect cancels the reader.** The adapter registers `res.once('close', …)`; if the loop has not finished, it calls `reader.cancel()`. Cancelling the _reader_ rather than the stream is what
propagates to the source's `cancel()`, which is where a file descriptor gets closed or a database cursor released. Without it the handler keeps producing into a socket nobody is reading and the loop
only ends when the source does.

**`HEAD`, `204` and `304` send headers and no body, and cancel the stream.** A handler cannot know it was reached by a `HEAD`, so the adapter is the only place this can be decided; and a stream that
is created and then never read is a leaked descriptor, so cancelling is not optional politeness.

**An error mid-stream destroys the connection. It never calls `end()`.** This is the genuinely hard case and it has exactly one correct answer per framing. Under chunked transfer the only in-protocol
way to say "this response is incomplete" is to omit the terminating zero-length chunk, i.e. `res.destroy()`; a client then sees an aborted transfer rather than a short body it believes is complete.

Under `content-length` a short write is detected by the client for the same reason, and destroying makes it immediate. What must **not** happen: appending an error object to the body — for a JSON
stream that is a value the consumer will parse as data — or attempting a status, which was sent thousands of bytes ago. The error goes to `onError` and the connection dies.

The trade-off, stated so nobody is surprised by it: a client cannot distinguish this from a network failure, which is why the report to `onError` is server-side and required.

An error thrown _before_ the first byte is unchanged from today: a normal `500` through the existing path. The discriminator is whether headers have been written, and the adapter tracks it with a
local flag rather than by asking the response object, because `writableEnded` is a `node:http` member and this interface is structural on purpose.

### A4. The fetch adapter contract

```ts
if (request.method === 'HEAD' || response.status === 204 || response.status === 304) {
  await cancelStreamBody(response);
  return new Response(null, { status: response.status, headers });
}

switch (response.body.kind) {
  case 'text':
    return new Response(textBodyWithoutImplicitContentType(response, headers), {
      status: response.status,
      headers,
    });
  case 'bytes':
  case 'stream':
    return new Response(response.body.value, { status: response.status, headers });
}
```

Verified to compile for all three arms with the `Uint8Array<ArrayBuffer>` of §A1 and with no cast. The runtime owns backpressure and cancellation, so this adapter has no loop and no disconnect
handling of its own — which is a reason to prefer it, not a gap.

A no-body status cancels a stream and passes `null` to `Response`, because the platform rejects even an empty-string body for `204` and `304`. A text arm with no declared `content-type` is passed as
encoded bytes so the platform does not invent `text/plain`; `respond()` therefore keeps its no-assumed-content-type contract.

Two consequences worth being explicit about. Cancellation reaches the application only if the stream's underlying source implements `cancel`, so a source that only has `pull` leaks on every
disconnect; `../gateways/SPEC.md`'s amendment already records that `sseStream` is such a source and assigns the fix to #552, which makes #552 a prerequisite in fact for anything that streams SSE
through this adapter.

And the runtime does not hand a mid-stream error back, which is precisely why §A2 puts the reporting wrapper inside `stream()` instead of in either adapter.

### A5. `content-length`, chunked framing, and who wins

- **`text`** — the adapter sets nothing. Node computes the byte length from the string, correctly for multi-byte characters; `Response` does the same. Deriving it from `value.length` would be wrong
  for every non-ASCII body.
- **`bytes`** — the adapter sets `content-length: String(value.byteLength)` **after** merging the handler's headers, so a handler-supplied value cannot survive. A `content-length` that disagrees with
  the payload is not a cosmetic bug: behind a proxy that trusts it, it is a request-smuggling primitive.
- **`stream` with a `length`** — set it, and then enforce it. If the stream ends having produced a different number of bytes, that is §A3's destroy path with a distinct `onError` report, because a
  response that under-delivers a declared length is indistinguishable to a cache from a truncated one it may store.
- **`stream` with no `length`** — send no `content-length` and let the runtime frame it chunked. Do not guess.
- A handler-supplied `transfer-encoding` is dropped. Framing belongs to the adapter, and a handler that sets it is describing a body it did not encode.

### A6. Reading a body back

```ts
export declare function bodyText(response: WebResponse): Promise<string>;
```

Every consumer that treats the body as a string — the test suite's twenty `JSON.parse(res.body)` assertions, `createTestApp`, a filter that inspects a response — needs one place to do it. `bodyText`
decodes `text` verbatim, UTF-8 decodes `bytes`, and drains `stream`. It is async because one arm is, and it **consumes** a stream body: the response is not sendable afterwards, which is fine for the
assertion and the test harness and is why nothing in the adapters uses it. `../testing/SPEC.md` carries the matching amendment.

### A7. The request side, which is a prerequisite and a behaviour change

Before #567, uploads could not work on top of the response model alone because both adapters decoded every request as text and destroyed byte sequences that were not valid UTF-8. The adapters now
preserve non-JSON, non-text bodies as bytes.

- **`WebRequest.rawBody` carries a `Uint8Array<ArrayBuffer>`** when the request's `content-type` is neither `application/json` (or a `+json` suffix) nor `text/*`. A JSON content type keeps the
  pre-existing path — `setEncoding`, string accumulation, `parseJson` — so the fast path is untouched and no existing route changes shape.
- **`maxBodyBytes`, default 1 MiB, on both adapters.** Before #567 there was no request-body limit, making every `POST` route an unbounded allocation reachable by one request. Exceeding the
  implemented limit answers `413`; the Node adapter then destroys the connection for the reason `../upload/SPEC.md` §3 gives about draining.
- This **is** a change to what already happens, and it is the one exception to the promise at the top of this amendment. It is the right exception: the alternative is shipping a documented
  memory-exhaustion default so that a deployment which needs more than a megabyte of JSON does not have to write one line of configuration. A limit that can be raised is not a limitation; the absence
  of one cannot be fixed by the person it hurts.

### A8. Templates are declined, with the reason

Epic #564's item 7 allows a view-engine integration to ship _or_ be explicitly declined. It is declined.

1. What a `@Render('post')` decorator and a `setViewEngine` seam actually do is move a string from a function into a response, which `respond({ body: html, headers })` already does in one line. The
   convenience is one line deep.
2. A seam that resolves templates **by name** introduces a string key with no type behind it — a template renamed, a variable misspelled and a missing partial are all runtime failures in a project
   whose entire argument is that those are compile failures. This is the same objection that rejected a two-meaning `zmdb graph` verb in `../cli/SPEC.md` §1 and `.proto` parsing in
   `../microservices/grpc/SPEC.md` §3.
3. Compilation caching, partial resolution and hot reload are the engine's job and every engine already does them better than a seam could.
4. The real risk in server-rendered HTML is contextual escaping, and a seam does not improve it by a single character.

What a user does instead is call the engine and return the string, which needs no framework support at all and is what `../../../../docs-site/content/web-templates.md` now documents. `web-templates`
is `status: 'wontfix'` for the mapped upstream feature page, so the deliberate decline is counted as not planned rather than mistaken for unfinished implementation work.

### A9. What #566 froze and #567 now satisfies

1. `text('0')` still answers the single byte `0`, and `respond({ status: 302, headers })` still sends no body and no `content-type` — the byte-for-byte promise, asserted through the adapters and not
   only through `handle`.
2. An exhaustive `switch` over `ResponseBody` with no `default` is a compile error when an arm is added — a `*.type-test.ts`, since `scripts/typecheck.mjs` is what compiles those.
3. `{ kind: 'stream', …, length: undefined }` type-checks and `length?: number` does not; a `Uint8Array<ArrayBufferLike>` in the bytes arm fails at `new Response(...)`. Both are compile-time
   assertions and both are the reasons the surface has the shape it has.
4. A stream response through the Node adapter arrives complete and in order, and `write` returning `false` suspends production until `drain` — asserted with a `NodeResLike` double whose `write`
   returns `false` on demand.
5. A client disconnect mid-stream calls the source's `cancel`, asserted with a source that records it. Same for `HEAD`, `204` and `304`.
6. A stream that throws after the first chunk calls `onError` exactly once, calls `destroy`, and never calls `end`; a stream that throws before the first chunk is a `500` with a JSON body.
7. A `bytes` response's `content-length` is its `byteLength` even when the handler set a different one; a `stream` with a declared `length` that under-delivers destroys, and one that over-delivers
   cancels its source; a `stream` with no `length` sends no `content-length`.
8. All three arms round-trip through `toFetchHandler`.
9. `bodyText` reads all three arms, and the existing twenty assertion sites use it.
10. A non-JSON, non-text request body reaches `rawBody` as bytes with every byte intact, including a multi-byte sequence split across two chunks and a byte sequence that is not valid UTF-8 at all.
11. A request body over `maxBodyBytes` is a `413` and the connection is destroyed; the limit is configurable upward and rejects `0`, `Infinity` and a non-integer.

### Non-goals (rejected in this amendment)

- **`body: string | ResponseBody`.** The hybrid #565 warned against. Two narrowing mechanisms for one question, and it makes the tag optional exactly where the content-length decision needs it (§A1).
- **`AsyncIterable<Uint8Array>` as a fourth arm.** `ReadableStream.from` converts one in a line, at the boundary, where it is visible; a fourth arm doubles every adapter's cancellation and
  backpressure logic for a conversion the caller can do.
- **`Blob` or `Response` as an arm.** Both are containers for the three arms that exist, and both make `content-length` a question with two answers.
- **An `as` at either adapter** instead of parameterising `Uint8Array` (§A1, §2.5).
- **A default `onError`.** Defaulting it means defaulting to silence (§A2).
- **`onStreamError` on `toNodeHandler`.** Per-server reporting of a per-stream failure, and invisible to the fetch adapter (§A2).
- **Compression in this package's core.** It is `../compression/SPEC.md`, a middleware over the union, and brotli is declined there with a reason.
- **HTTP/2 server push, and response trailers.** Push is deprecated and removed from browsers; trailers have no consumer in this surface and would need a fourth field on `WebResponse` that every
  adapter ignores.
- **Multiple byte ranges in one response.** `../static/SPEC.md` §6.
- **`@Render`, `setViewEngine`, a bundled template engine** (§A8).
- **A logger anywhere in this package** (§A2).
- **Draining an over-limit request body to be polite** (§A7, `../upload/SPEC.md` §3).
