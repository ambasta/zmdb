# `@zmdb/web` — request pipeline & adapters SPEC

> The dispatcher that ties routing + Ctx + DI together, plus thin adapters
> (epic #272). Frozen before code. Supersedes/absorbs the old `makeEndpoint`.

## Contract

### Route registration

- **`createRouter()`** → a `Router`.
- **`router.register(controllerInstance)`** — read the controller's routes via
  `getRoutes(controllerInstance.constructor)` (built once at register time) and
  bind each to the instance's handler method. The resolved table is cached.
- Each route may carry an optional **`validateBody`** hook
  (`(raw: unknown) => Body`) that runs before the handler; if it throws, the
  handler is **not** called and the pipeline yields a 400.

### Incoming request → response

- **`router.handle(req: WebRequest): Promise<WebResponse>`** where:
  - `WebRequest = { method: string; path: string; headers; rawBody?: unknown; query? }`
  - `WebResponse = { status: number; body: string; headers }`
- Pipeline steps, in order:
  1. **Match** — the method and the path's segment count (`countSegments`) select
     a bucket of the cached table; candidates are tried in registration order
     against patterns compiled once by `compilePattern` at register time, using
     `matchCompiled`. No match → `404`. Routes that disagree on method or segment
     count are never examined, so this is not a scan of the whole table.
  2. **Build `Ctx`** — params from the match, `body`/`query`/`headers`/`method`/
     `path` from the request.
  3. **Validate** — if the route has `validateBody`, run it on `rawBody`; on throw
     → `400` with the error message (handler never runs).
  4. **Invoke** the handler with the ctx.
  5. **Serialize** the result to JSON (`200`); a thrown handler → `500`. A handler
     that returns a response built by one of the factories below is returned
     verbatim instead, status and headers included.
- No per-request reflection; one `Ctx` + one result object allocated per request.

### Handler-controlled responses

A handler that returns a plain value gets `200 application/json`, unchanged. To
choose a status, add headers, or send a body that is not JSON, it returns one of:

- **`json(value, { status?, headers? })`** — JSON body; supplied headers merge
  over `content-type: application/json`.
- **`text(body, { status?, headers? })`** — the body verbatim, with
  `content-type: text/plain; charset=utf-8`.
- **`respond({ status?, body?, headers? })`** — full control, **no** assumed
  content type; for HTML, CSV, a redirect, or a `204`.

These are recognised by a marker symbol (`Symbol.for('zmdb.web.response')`), not
by inspecting the result's shape. This is load-bearing: `{ status: 'draft' }` is
an ordinary body, and a structural check would silently promote its `status` to
an HTTP status. The marker is non-enumerable, so a `WebResponse` remains the
plain `{ status, body, headers }` record every existing consumer reads.

### Adapters (thin, optional, structurally typed — no hard deps)

- **`toNodeHandler(router)`** → an \`(req, res) => void\` compatible with
  \`node:http\` (reads method/url/headers, buffers the body, writes the response).
  Typed structurally so \`node:http\` is not a dependency.
- **`toFetchHandler(router)`** → a \`(request: Request) => Promise<Response>\`
  usable by Hono / any Fetch-based runtime. Typed against the global \`Request\`/
  \`Response\` (Node 26 has them) — no Hono dependency.

## Invariants

- **No `as`/`any`/`!` on the consumer surface.** Internal boundary reads (matched
  route handler, JSON parse) are commented boundaries per ARCHITECTURE.md §2.1.
- No reflection; validation via an injected hook (AOT `assert` fits) — no runtime
  parser baked in.

## Acceptance

- A registered controller's route dispatches: correct handler, params extracted,
  body validated before the handler (invalid → 400, handler not called),
  serialized 200 result; unknown path → 404; throwing handler → 500.
- The node + fetch adapters round-trip a request to a response (in-process test).
- `text('0')` answers with the single byte `0` and no quotes; `respond({status:302,
headers:{location}})` sends neither a body nor a `content-type`; a returned
  object carrying its own `status` field is still a `200` JSON body.
- One response's headers cannot leak into the next (the JSON default is a shared
  constant and must never be merged into).
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

Guards/pipes/interceptors/filters (epic #287), modules (#282), OpenAPI (#302).
