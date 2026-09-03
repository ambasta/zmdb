# `@zmdb/web` — spans, metrics and trace propagation SPEC

> The span hierarchy, every attribute name pinned to a stated semantic-convention
> version, W3C context in both directions, and zero cost when nothing is configured
> (epic #578, sub-issue #579). Frozen before code.

Health probes are `../health/SPEC.md`. The SQL comment this file's trace context ends up
inside is `../../../query-compiler/src/comments/SPEC.md`. This file is the telemetry the
framework emits and the shape of the seam it emits through.

## 1. Span names are a public interface

Dashboards, alert rules, SLO definitions and saved queries are all written against span
names and attribute keys. Renaming one is not a refactor, it is a breaking change to
somebody's on-call rotation, and it breaks silently: nothing fails to compile, the panel
just goes flat. That is why this file is a freeze rather than a design note, and why §3
pins a version number.

**The conventions are pinned to OpenTelemetry semantic conventions v1.30.0.** HTTP became
stable at v1.23.0 and database client conventions settled at v1.30.0, which is the later
of the two and therefore the floor for citing both. A convention release that renames an
attribute is an **edit to this file** with a new section recording the old name, the new
one and the release that changed it — never a rename in code with the spec left behind.
Anything a future release adds is additive and needs no amendment.

## 2. Directive 7, and why `Tracer` is declared here

ARCHITECTURE.md directive 7 rules out a runtime dependency, so `@opentelemetry/api`
cannot be imported by this package. The types are therefore declared locally as a narrow
port:

```ts
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
  setStatus(status: { readonly error: boolean }): void;
  end(): void;
  spanContext(): SpanContext;
}

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

export interface Tracer {
  startSpan(name: string, options?: { readonly parent?: SpanContext; readonly link?: SpanContext }): Span;
}

export interface Meter {
  counter(name: string): { add(value: number, attributes: Attributes): void };
  histogram(name: string, unit: 's'): { record(value: number, attributes: Attributes): void };
}

export type Attributes = Readonly<Record<string, string | number | boolean>>;

export interface Observability {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly comments?: { readonly keys: readonly [CommentKey, ...CommentKey[]] };
}
```

**This spec does not claim structural compatibility with `@opentelemetry/api`.** Its
`Tracer.startActiveSpan` has four overloads and its `Span` has around ten methods, and a
claim that a locally declared interface satisfies them cannot be compiled in a package
that is forbidden from importing the thing it is claiming compatibility with. A claim that
cannot be checked is a claim that rots in silence. So the port above is a port, the
adapter from it to OpenTelemetry is roughly ten lines, and the adapter belongs in the
optional `@zmdb/web/otel` entry point that `docs-site/content/web-tracing.md` already
proposes — where the peer is a devDependency and the compatibility claim is therefore
_typechecked_. That subpath is #582's work; this file freezes what it adapts to.

**`comments` corrects the sketch.** #579 has
`comments?: { readonly enabled: boolean; readonly keys: readonly CommentKey[] }`, in which
`enabled: false` is a second spelling of the absent `comments` and `keys: []` is a third.
An option with three ways to mean off has two of them nobody tests. Present means on, and
`readonly [CommentKey, ...CommentKey[]]` makes the empty array a compile error. `CommentKey`
is defined by `../../../query-compiler/src/comments/SPEC.md` §2 and re-exported here.

## 3. Zero cost when off means no call, not a no-op

`tracer` absent must cost nothing measurable, and the mechanism is one `undefined` check at
the top of `Router.handle` after which the existing code path runs unchanged — the same
statements, the same allocations, the same shape for the JIT.

A no-op tracer is rejected even though it deletes the branch. A no-op span still costs a
call per attribute per span, five to ten calls per request that a profiler cannot
distinguish from real work, and it makes the instrumented and uninstrumented paths the
same code, so the fast path never gets measured on its own. The branch is one comparison
against a value that is monomorphic for the process's lifetime.

`Ctx` gains one field:

```ts
readonly span?: Span;
```

filled by the router only inside the branch where a tracer exists and it therefore holds a
definite `Span`. Verified: under `exactOptionalPropertyTypes` that assignment compiles,
while `{ ...ctx, span: maybeSpan }` from a computed `Span | undefined` does not — the same
correction `../pipeline/SPEC.md` made for a stream's `length` and `../openapi/SPEC.md` §S3
made for `scopes`. Readers use `ctx.span?.setAttribute(…)`.

**There is no ambient context, and that is deliberate.** `AsyncLocalStorage` is the
conventional answer and it is refused twice over: it is a `node:async_hooks` import in a
package whose whole shape is a Fetch-runtime handler, and it makes the current span
implicit, which is only correct if every await boundary in the process is well behaved.
Explicit propagation through `Ctx` costs more wiring and buys a property
`docs-site/content/sql-comments.md` already names as a virtue:

> Because there is no ambient request context, the closure is how the tag gets in — which
> is more wiring than a global, and also the reason two concurrent requests cannot tag
> each other's queries.

## 4. The span hierarchy

Four spans, not the five step 5 lists. The list of children is corrected because one of
them cannot exist yet:

```
zmdb.request               server span, created by the Router
├── zmdb.route             route resolution
├── zmdb.validate          body validation, only when RouteOptions.validateBody is set
├── zmdb.handler           the handler invocation
└── <db operation>         one per query, created by the driver decorator
```

**No interceptor span.** #573 established that `runChain` has no caller in the pipeline —
every call site in the repository is a `*.spec.ts` — so an interceptor never runs and a
span wrapping one would never be recorded. A span for a code path that does not execute is
worse than a missing span: it appears in this document, somebody builds a panel expecting
it, and the panel is empty for a reason nobody can find. The interceptor span arrives with
the wiring, in whatever issue owns `runChain`.

**The server span is created by the router, not by the adapter, and this is forced.**
Semconv requires the span name to be `{method} {http.route}` with a low-cardinality route,
and `http.route` is not derivable from anything a handler or an adapter sees: `Ctx` is
`{ params, body, query, headers, method, path }` and `path` is the concrete `/posts/1`.
Only the matched route knows `/posts/:id`. This is precisely the gap
`docs-site/content/web-tracing.md` papers over with a hand-written `routeFor(req)` and
that `web-observability.md` warns about, and moving span creation into the router is
what closes it rather than documenting a workaround for it.

A request that matches no route has no `http.route`, so its span name is the method alone —
`GET` — because semconv forbids putting the raw path in a span name and an unmatched path
is unbounded cardinality by definition.

`zmdb.route` is a child rather than an attribute because route resolution is where a
pathological route table shows up, and a duration is the only way to see it. It is expected
to be microseconds; a `zmdb.route` that is not is the finding.

## 5. Attributes, and which side of the compile they come from

Server span, `zmdb.request`:

| attribute                   | source  | note                                                 |
| --------------------------- | ------- | ---------------------------------------------------- |
| `http.request.method`       | runtime | uppercase, `_OTHER` for a method not in the RFC list |
| `http.route`                | startup | the matched pattern; absent when nothing matched     |
| `url.path`                  | runtime | the concrete path — an attribute, never a span name  |
| `url.scheme`                | runtime | from the request                                     |
| `http.response.status_code` | runtime | set at the end, so it is absent on an abandoned span |
| `error.type`                | runtime | the thrown value's constructor name, or the status   |
| `server.address`            | runtime | the `host` header, when present                      |

Database span, one per `Driver.execute`:

| attribute                 | source       | note                                             |
| ------------------------- | ------------ | ------------------------------------------------ |
| `db.system.name`          | compile time | from `Dialect` — `postgresql`, `mysql`, `sqlite` |
| `db.operation.name`       | compile time | `SELECT`, `INSERT`, `UPDATE`, `DELETE`           |
| `db.collection.name`      | compile time | the primary table                                |
| `db.query.text`           | compile time | the placeholder-only SQL — §6                    |
| `db.namespace`            | runtime      | the driver's database or schema, when it knows   |
| `db.response.status_code` | runtime      | the dialect's own error code on failure          |
| `zmdb.db.parameter_count` | runtime      | `parameters.length` — §6                         |

**All four of #579's database attribute names are the deprecated spellings** and are
corrected here, which is the concrete reason step 5 asks for a pinned version:

| in the issue   | v1.30.0              |
| -------------- | -------------------- |
| `db.system`    | `db.system.name`     |
| `db.operation` | `db.operation.name`  |
| `db.sql.table` | `db.collection.name` |
| `db.statement` | `db.query.text`      |

`docs-site/content/web-tracing.md` uses `db.statement` in two places and
`http.status_code` in one, the latter renamed to `http.response.status_code` by the
v1.23.0 HTTP stabilisation. That page is corrected with this freeze.

**The compile-time set is attached to the compiled query**, per step 6:

```ts
export interface QueryTelemetry {
  readonly system: 'postgresql' | 'mysql' | 'sqlite';
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: QueryTelemetry;
}
```

Attached rather than re-derived, and the alternative is a bug that is already written down.
`web-observability.md` derives the operation with
`(/^\s*(\w+)/.exec(sql)?.[1] ?? 'other').toUpperCase()`, which is a parse of SQL that the
compiler generated moments earlier and had exact knowledge of. It reads `WITH` for a CTE
that ends in an `INSERT`, and it returns `other` for any statement with a leading comment —
which is to say that turning on §11 of the comment spec, in its leading form, would silently
degrade every database metric label in the application. The compiler knows the dialect, the
verb and the table without a regular expression, so it says so once.

`telemetry` is optional and populated only when the compiler is built with it enabled. Not
for backwards compatibility, but because a field nothing reads is a field that changes the
shape every existing `toEqual` compares for no benefit; when a tracer or a meter exists,
something reads it.

`zmdb.db.parameter_count` is deliberately namespaced outside `db.`. Semconv reserves that
prefix, and recent releases use `db.operation.parameter.<key>` for parameter _values_ —
which §6 refuses to emit under any setting, so squatting on the neighbouring key would
invite exactly the confusion the refusal is about.

## 6. Statement recording, and the one thing that is never recorded

**`db.query.text` is recorded by default, and zmdb has an unusually strong right to do it.**
`CompiledQuery` is `{ text, parameters }` (`packages/query-compiler/src/index.ts:77-80`)
with parameters bound by the driver, so the text is a placeholder-only template. It contains
no user data by _construction_ — not because a redaction pass looked for values and did not
find any. An ORM that interpolates has to default this off, because its "statement" is a
document containing whatever was in the request; zmdb's cannot be, and the difference is
worth stating rather than inheriting the cautious default from tools that need it.

`web-tracing.md` already makes this argument. The freeze keeps it and hardens the other
half.

**Parameter values are never recorded, at any level, and there is no option that enables
it.** Not off-by-default: absent. An option to record parameters is a switch somebody flips
to debug staging and does not unflip, in a system where traces are retained for weeks and
readable by everyone in the organisation, and where parameters are emails, tokens, addresses
and whatever a request body contained. The count is emitted instead, which answers the
question the values are usually reached for — whether the query is the shape you think it is.

Request bodies, response bodies, header values and full URLs with query strings are not
recorded either, for the same reason. `url.path` is the path, not the query string.

## 7. Metrics

Emitted only when `meter` is present; the `undefined` check is §3's, in the same branch.

| metric                         | kind      | unit    | attributes                                                                     |
| ------------------------------ | --------- | ------- | ------------------------------------------------------------------------------ |
| `http.server.request.duration` | histogram | seconds | `http.request.method`, `http.route`, `http.response.status_code`, `error.type` |
| `db.client.operation.duration` | histogram | seconds | `db.system.name`, `db.operation.name`, `db.collection.name`                    |

**Seconds, not milliseconds.** Semconv's duration histograms are in seconds with bucket
boundaries chosen for that unit, and a millisecond histogram exported under a
seconds-named metric lands every observation in the top bucket. This corrects
`web-observability.md`, whose worked example uses `http_duration_ms` and `db_query_ms`;
those names are fine for the hand-rolled registry on that page and wrong for anything
exported through a `Meter`.

Two metrics and not four. `web-observability.md`'s table names pool utilisation and error
rate as well: pool statistics belong to a driver the framework does not own, and error rate
is derivable from the `error.type` attribute on the duration histogram, so a separate
counter would be a second source for one number.

The attribute sets are exactly semconv's required and recommended keys, which is the
cardinality bound. `url.path` never appears on a metric — that is
`web-observability.md`'s worked mistake, and the framework is now the thing that knows
`http.route`, so it is the framework's job not to make it.

## 8. Propagation, in both directions

**Inbound.** `traceparent` and `tracestate` are read from the request headers and the
server span is created as a child of the extracted context. `traceparent` is accepted when
it is exactly the W3C shape: four hyphen-separated fields of 2, 32, 16 and 2 lowercase hex
digits, a trace-id that is not all zeroes, a span-id that is not all zeroes, and a version
that is not `ff`. A version above `00` is accepted by reading the first four fields and
ignoring the remainder, which is the forward-compatibility rule the W3C spec requires and
the one an implementation is most likely to get wrong by rejecting instead.

**A malformed `traceparent` is ignored and a new trace begins. It never fails the
request.** A header a client controls must not be able to produce a `400` on a route that
has nothing to do with tracing, and the failure mode of the alternative is a
telemetry-shaped outage: a misconfigured upstream injecting a bad header takes down every
downstream service at once. `tracestate` that fails to parse is dropped while
`traceparent` is kept, because the two carry different things and the vendor field is the
one nobody's correctness depends on.

Without extraction the caller's trace ends at the door, which
`docs-site/content/web-tracing.md` calls the single most common tracing
misconfiguration. The framework doing it is the point of doing it in the framework.

**Outbound.** The framework does not wrap `fetch`. It exports

```ts
export declare function toTraceparent(span: Span): string;
```

and the caller writes one header. Patching a global is what a no-dependency package should
be least willing to do, the auto-instrumentation on `web-tracing.md` already patches
`fetch` for anyone who wants that, and two things patching the same global is a debugging
session nobody enjoys.

**Message transports.** `../events`, `../cqrs` and `../microservices` carry objects rather
than HTTP requests, so the context travels as a `traceparent` field on the envelope, with
the same string `toTraceparent` produces and the same validation on the way in. A consumer
that runs synchronously with its producer — a request/reply call — starts a **child** span.
A consumer that dequeues a message some time after it was produced starts a span **linked**
to the producer instead, because a parent-child edge across an unbounded queue delay
produces a trace whose duration is the queue's latency and whose waterfall is unreadable.
Semconv says the same; the reason is worth having in the file.

## 9. What #580 has to assert

1. With no `Observability` configured, `Router.handle` produces byte-identical responses and
   the tracer port is never constructed — asserted by passing a `Tracer` whose every method
   throws, alongside a run with no tracer at all, so a no-op-tracer implementation fails.
2. The span tree of one request is exactly §4's four kinds in that nesting, with
   `zmdb.validate` absent when `validateBody` is unset and present when it is set.
3. The server span's name is `GET /posts/:id` for a matched route and `GET` for an unmatched
   one, and `url.path` carries `/posts/1` in both.
4. Every attribute key in §5 asserted by literal string. A test that compares against a
   constant exported from the implementation would pass through a rename, which is the exact
   failure §1 is about.
5. `db.query.text` is present and equals `CompiledQuery.text`; no attribute on any span
   contains a parameter value, asserted by taking a query whose parameter is a distinctive
   string and searching every recorded attribute for it.
6. `db.operation.name` is `INSERT` for a CTE that begins `WITH` and ends in an insert — the
   assertion the regex on `web-observability.md` fails.
7. Durations are recorded in seconds, asserted by an operation held open past one second
   producing a value greater than one and less than a hundred.
8. Each of §8's malformed `traceparent` cases — wrong field count, wrong length, uppercase
   hex, all-zero trace-id, all-zero span-id, version `ff` — produces a `200` and a root
   span with a fresh trace-id, and a version `01` header with a trailing field is
   _accepted_.
9. A valid `traceparent` makes the server span a child of it, with the trace-id preserved.
10. `toTraceparent(span)` round-trips: the string it produces is accepted by the inbound
    parser and yields the same trace-id and span-id.
11. A queued message's consumer span is linked, not parented, and a request/reply consumer
    span is parented.

## Non-goals (rejected)

- **Depending on `@opentelemetry/api`** (§2), and claiming structural compatibility with it
  from a package that cannot import it.
- **A no-op tracer instead of a branch** (§3).
- **`AsyncLocalStorage` or any ambient current-span** (§3).
- **An interceptor span** (§4), until `runChain` has a caller.
- **The raw path in a span name or a metric attribute** (§4, §7).
- **Recording parameter values, behind any option** (§6).
- **Recording request or response bodies, header values, or query strings** (§6).
- **Pool and connection metrics** (§7). The framework does not own a pool.
- **A separate error counter** (§7).
- **Sampling.** A sampler is the SDK's job and the port has no place to express one;
  `web-tracing.md`'s `ParentBasedSampler` stays the right advice and stays outside this
  package.
- **A metrics exposition endpoint.** `web-observability.md` builds one in fifteen lines and
  a Prometheus text format renderer in the framework would be a second telemetry pipeline
  next to the `Meter` port.
- **Wrapping `fetch`** (§8).
- **A per-request logger, or logs correlated by an injected trace id.** `web-logging` argues
  against a logger and nothing here changes that argument; a caller with `ctx.span` can put
  the trace id in its own log line.
