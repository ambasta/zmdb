# `@zmdb/web` — spans, metrics and trace propagation SPEC

> The span hierarchy, every attribute name pinned to a stated semantic-convention version, W3C context in both directions, and zero cost when nothing is configured (epic #578, sub-issue #579). Frozen
> before code.

Health probes are `../health/SPEC.md`. The SQL comment this file's trace context ends up inside is `../../../query-compiler/src/comments/SPEC.md`. This file is the telemetry the framework emits and
the shape of the seam it emits through.

> **Ownership target frozen by #654:** generic `Observability`, tracer/meter/span ports and propagation move to `@zmdb/app` under #647. The OpenTelemetry conversion moves to `@zmdb/otel`, whose only
> required peer is `@opentelemetry/api@^1.9.0`. `@zmdb/web/otel` is removed with no forwarding subpath. The adapter still borrows caller-owned objects, installs no provider or ambient context, and
> owns no SDK or exporter.

## 1. Span names are a public interface

Dashboards, alert rules, SLO definitions and saved queries are all written against span names and attribute keys. Renaming one is not a refactor, it is a breaking change to somebody's on-call
rotation, and it breaks silently: nothing fails to compile, the panel just goes flat. That is why this file is a freeze rather than a design note, and why §3 pins a version number.

**The conventions are pinned to OpenTelemetry semantic conventions v1.30.0.** HTTP became stable at v1.23.0 and database client conventions settled at v1.30.0, which is the later of the two and
therefore the floor for citing both.

A convention release that renames an attribute is an **edit to this file** with a new section recording the old name, the new one and the release that changed it — never a rename in code with the spec
left behind. Anything a future release adds is additive and needs no amendment.

## 2. Directive 7, and why `Tracer` is declared here

ARCHITECTURE.md directive 7 rules out a runtime dependency, so `@opentelemetry/api` cannot be imported by this package. The types are therefore declared locally as a narrow port:

```ts
export interface Span {
  updateName(name: string): void;
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
  readonly isRemote?: boolean;
  readonly traceState?: string;
}

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface Tracer {
  startSpan(
    name: string,
    options?: {
      readonly kind?: SpanKind;
      readonly parent?: SpanContext;
      readonly link?: SpanContext;
    },
  ): Span;
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

`updateName` is the sixth span method for a concrete reason rather than convenience: the server span must exist before matching so `zmdb.route` can time the real lookup, while the conventional
server-span name is only known after that lookup. The router starts it with the method, measures matching under the route child, then renames it to `{method} {http.route}`.

**This spec does not claim structural compatibility with `@opentelemetry/api`.** Its `Tracer.startActiveSpan` has four overloads and its `Span` has around ten methods, and a claim that a locally
declared interface satisfies them cannot be compiled from the dependency-free core entry points. A claim that cannot be checked is a claim that rots in silence.

So the port above is a port. It currently lives beside the optional `@zmdb/web/otel` adapter, where `@opentelemetry/api` is both an optional peer and a dev dependency and the compatibility claim is
therefore _typechecked_. Under #654 the adapter moves to `@zmdb/otel`, where that API becomes the selected package's required peer; importing core app or web still does not resolve it.

**`comments` corrects the sketch.** #579 has `comments?: { readonly enabled: boolean; readonly keys: readonly CommentKey[] }`, in which `enabled: false` is a second spelling of the absent `comments`
and `keys: []` is a third. An option with three ways to mean off has two of them nobody tests. Present means on, and `readonly [CommentKey, ...CommentKey[]]` makes the empty array a compile error.
`CommentKey` is defined by `../../../query-compiler/src/comments/SPEC.md` §2 and re-exported here.

## 3. Zero cost when off means no call, not a no-op

`tracer` absent must cost nothing measurable, and the mechanism is one `undefined` check at the top of `Router.handle` after which the existing code path runs unchanged — the same statements, the same
allocations, the same shape for the JIT.

A no-op tracer is rejected even though it deletes the branch. A no-op span still costs a call per attribute per span, five to ten calls per request that a profiler cannot distinguish from real work,
and it makes the instrumented and uninstrumented paths the same code, so the fast path never gets measured on its own. The branch is one comparison against a value that is monomorphic for the
process's lifetime.

`Ctx` gains one field:

```ts
readonly span?: Span;
```

filled by the router only inside the branch where a tracer exists and it therefore holds a definite `Span`. Verified: under `exactOptionalPropertyTypes` that assignment compiles, while
`{ ...ctx, span: maybeSpan }` from a computed `Span | undefined` does not — the same correction `../pipeline/SPEC.md` made for a stream's `length` and `../openapi/SPEC.md` §S3 made for `scopes`.
Readers use `ctx.span?.setAttribute(…)`.

**There is no ambient context, and that is deliberate.** `AsyncLocalStorage` is the conventional answer and it is refused twice over: it is a `node:async_hooks` import in a package whose whole shape
is a Fetch-runtime handler, and it makes the current span implicit, which is only correct if every await boundary in the process is well behaved. Explicit propagation through `Ctx` costs more wiring
and buys a property `docs-site/content/sql-comments.md` already names as a virtue:

> Because there is no ambient request context, the closure is how the tag gets in — which is more wiring than a global, and also the reason two concurrent requests cannot tag each other's queries.

The OpenTelemetry adapter preserves that decision: it starts spans against the explicit parent context and does not install them into `context.active()`. Auto-instrumented libraries therefore remain a
separate instrumentation layer; the framework's own database span is parented by passing `ctx.span` to `tracedDriver`.

## 4. The span hierarchy

One server span with three framework children, plus one database span per query. The list is shorter than the issue sketch because one of its children cannot exist yet:

```
zmdb.request               server span, created by the Router
├── zmdb.route             route resolution
├── zmdb.validate          body validation, only when RouteOptions.validateBody is set
└── zmdb.handler           the handler invocation
    └── <db operation>     one per query, created by the driver decorator
```

The database edge is explicit. `tracedDriver(inner, observability, ctx.span)` creates query spans under that request's handler. A process-wide wrapper with no parent still emits useful root database
spans, but it cannot infer a request parent because §3 deliberately has no ambient current span.

**No interceptor span.** #573 established that `runChain` has no caller in the pipeline — every call site in the repository is a `*.spec.ts` — so an interceptor never runs and a span wrapping one
would never be recorded.

A span for a code path that does not execute is worse than a missing span: it appears in this document, somebody builds a panel expecting it, and the panel is empty for a reason nobody can find. The
interceptor span arrives with the wiring, in whatever issue owns `runChain`.

**The server span is created by the router, not by the adapter, and this is forced.** Semconv requires the span name to be `{method} {http.route}` with a low-cardinality route, and `http.route` is not
derivable from anything a handler or an adapter sees: `Ctx` has `params`, `body`, `query`, `headers`, `method`, `path` and an optional handler `span`, while `path` is still the concrete `/posts/1`.

Only the matched route knows `/posts/:id`. This is precisely the gap `docs-site/content/web-tracing.md` papers over with a hand-written `routeFor(req)` and that `web-observability.md` warns about, and
moving span creation into the router is what closes it rather than documenting a workaround for it.

A request that matches no route has no `http.route`, so its span name remains the method alone — `GET` — because semconv forbids putting the raw path in a span name and an unmatched path is unbounded
cardinality by definition.

`zmdb.route` is a child rather than an attribute because route resolution is where a pathological route table shows up, and a duration is the only way to see it. It is expected to be microseconds; a
`zmdb.route` that is not is the finding. The server span therefore starts before matching with the provisional method-only name, and `updateName` applies the matched pattern after `zmdb.route` ends.

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

For a server span, a normal `4xx` response is not an OpenTelemetry error: it records `http.response.status_code` but leaves span status unset and omits `error.type`. A `5xx` response is an error. A
validation or handler child can still record the exception it handled even when the server response is `400`; that distinction keeps the server convention correct without hiding where the request was
rejected.

Database span, one per `Driver.execute`:

| attribute                 | source       | note                                                                              |
| ------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `db.system.name`          | compile time | from the resolved dialect family; built-in Postgres is normalized to `postgresql` |
| `db.operation.name`       | compile time | `SELECT`, `INSERT`, `UPDATE`, `DELETE`                                            |
| `db.collection.name`      | compile time | the primary table                                                                 |
| `db.query.text`           | compile time | the placeholder-only SQL — §6                                                     |
| `db.response.status_code` | runtime      | the dialect's own error code on failure                                           |
| `zmdb.db.parameter_count` | runtime      | `parameters.length` — §6                                                          |

**All four of #579's database attribute names are the deprecated spellings** and are corrected here, which is the concrete reason step 5 asks for a pinned version:

| in the issue   | v1.30.0              |
| -------------- | -------------------- |
| `db.system`    | `db.system.name`     |
| `db.operation` | `db.operation.name`  |
| `db.sql.table` | `db.collection.name` |
| `db.statement` | `db.query.text`      |

`docs-site/content/web-tracing.md` uses `db.statement` in two places and `http.status_code` in one, the latter renamed to `http.response.status_code` by the v1.23.0 HTTP stabilisation. That page is
corrected with this freeze.

**The compile-time set is attached to the compiled query**, per step 6:

```ts
export interface QueryTelemetry {
  readonly system: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: QueryTelemetry;
}
```

Attached rather than re-derived, and the alternative is a bug that is already written down. `web-observability.md` derives the operation with `(/^\s*(\w+)/.exec(sql)?.[1] ?? 'other').toUpperCase()`,
which is a parse of SQL that the compiler generated moments earlier and had exact knowledge of.

It reads `WITH` for a CTE that ends in an `INSERT`, and it returns `other` for any statement with a leading comment — which is to say that turning on §11 of the comment spec, in its leading form,
would silently degrade every database metric label in the application.

The compiler knows the dialect, the verb and the table without a regular expression, so it says so once. The four built-in root families emit `postgresql`, `mysql`, `sqlite` and `mssql`; the `string`
type also carries an injected third-party dialect family without adding it to a central union.

`telemetry` is optional and populated only when the compiler is built with it enabled. Not for backwards compatibility, but because a field nothing reads is a field that changes the shape every
existing `toEqual` compares for no benefit; when a tracer or a meter exists, something reads it.

`zmdb.db.parameter_count` is deliberately namespaced outside `db.`. Semconv reserves that prefix, and recent releases use `db.operation.parameter.<key>` for parameter _values_ — which §6 refuses to
emit under any setting, so squatting on the neighbouring key would invite exactly the confusion the refusal is about.

## 6. Statement recording, and the one thing that is never recorded

**`db.query.text` is recorded by default, and zmdb has an unusually strong right to do it.** `CompiledQuery` always separates `text` from `parameters`; the optional compile-time `telemetry` field
carries only the database system, operation and collection. Parameters are bound by the driver, so the text is a placeholder-only template.

It contains no user data by _construction_ — not because a redaction pass looked for values and did not find any.

An ORM that interpolates values must disable this by default because its "statement" may contain request data. zmdb statements contain placeholders, so they do not need to inherit that default.

`web-tracing.md` already makes this argument. The freeze keeps it and hardens the other half.

**Parameter values are never recorded, at any level, and there is no option that enables it.** Not off-by-default: absent.

An option to record parameters is a switch somebody flips to debug staging and does not unflip, in a system where traces are retained for weeks and readable by everyone in the organisation, and where
parameters are emails, tokens, addresses and whatever a request body contained.

The count is emitted instead, which answers the question the values are usually reached for — whether the query is the shape you think it is.

Request bodies, response bodies, header values and full URLs with query strings are not recorded either, for the same reason. `url.path` is the path, not the query string.

## 7. Metrics

Emitted only when `meter` is present; the `undefined` check is §3's, in the same branch.

| metric                         | kind      | unit    | attributes                                                                     |
| ------------------------------ | --------- | ------- | ------------------------------------------------------------------------------ |
| `http.server.request.duration` | histogram | seconds | `http.request.method`, `http.route`, `http.response.status_code`, `error.type` |
| `db.client.operation.duration` | histogram | seconds | `db.system.name`, `db.operation.name`, `db.collection.name`                    |

**Seconds, not milliseconds.** Semconv's duration histograms are in seconds with bucket boundaries chosen for that unit, and a millisecond histogram exported under a seconds-named metric lands every
observation in the top bucket. This corrects `web-observability.md`, whose worked example uses `http_duration_ms` and `db_query_ms`; those names are fine for the hand-rolled registry on that page and
wrong for anything exported through a `Meter`.

Two metrics and not four. `web-observability.md`'s table names pool utilisation and error rate as well: pool statistics belong to a driver the framework does not own, and error rate is derivable from
the `error.type` attribute on the duration histogram, so a separate counter would be a second source for one number.

The attribute sets are exactly semconv's required and recommended keys, which is the cardinality bound. `url.path` never appears on a metric — that is `web-observability.md`'s worked mistake, and the
framework is now the thing that knows `http.route`, so it is the framework's job not to make it.

## 8. Propagation, in both directions

**Inbound.** `traceparent` and `tracestate` are read from the request headers by `fromTraceContext`, and the server span is created as a child of the extracted remote context. `traceparent` is
accepted when it is exactly the W3C shape: four hyphen-separated fields of 2, 32, 16 and 2 lowercase hex digits, a trace-id that is not all zeroes, a span-id that is not all zeroes, and a version that
is not `ff`.

A version above `00` is accepted by reading the first four fields and ignoring the remainder, which is the forward-compatibility rule the W3C spec requires and the one an implementation is most likely
to get wrong by rejecting instead.

**A malformed `traceparent` is ignored and a new trace begins.

It never fails the request.** A header a client controls must not be able to produce a `400` on a route that has nothing to do with tracing, and the failure mode of the alternative is a
telemetry-shaped outage: a misconfigured upstream injecting a bad header takes down every downstream service at once. `tracestate` that fails to parse is dropped while `traceparent` is kept, because
the two carry different things and the vendor field is the one nobody's correctness depends on.

A valid list is preserved, in order, on `SpanContext.traceState`; `isRemote: true` survives the optional OpenTelemetry adapter so parent-based sampling can distinguish an extracted parent from a
locally-created context.

Without extraction the caller's trace ends at the door, which `docs-site/content/web-tracing.md` calls the single most common tracing misconfiguration. The framework doing it is the point of doing it
in the framework.

**Outbound.** The framework does not wrap `fetch`. It exports both the exact single-header helper and a carrier helper:

```ts
export declare function toTraceparent(span: Span): string;
export declare function toTraceHeaders(span: Span): {
  readonly traceparent: string;
  readonly tracestate?: string;
};
```

and the caller writes those headers. Patching a global is what a no-dependency package should be least willing to do, the auto-instrumentation on `web-tracing.md` already patches `fetch` for anyone
who wants that, and two things patching the same global is a debugging session nobody enjoys.

**Message transports.** `../microservices` crosses a process boundary, so the same `traceparent`/`tracestate` carrier travels on its request and event envelopes and is validated on the way in. The
application event registry and command bus are in-process calls, not transports, so they carry no wire header. A consumer that runs synchronously with its producer — a request/reply call — starts a
**child** span.

A consumer that dequeues a message some time after it was produced starts a span **linked** to the producer instead, because a parent-child edge across an unbounded queue delay produces a trace whose
duration is the queue's latency and whose waterfall is unreadable. Semconv says the same; the reason is worth having in the file.

## 9. What #580 asserts

1. With no `Observability` configured, `Router.handle` produces byte-identical responses and the tracer port is never constructed — asserted by passing a `Tracer` whose every method throws, alongside
   a run with no tracer at all, so a no-op-tracer implementation fails.
2. The span tree of one request is exactly §4's hierarchy, with `zmdb.validate` absent when `validateBody` is unset and present when it is set.
3. The server span's name is `GET /posts/:id` for a matched route and `GET` for an unmatched one, and `url.path` carries `/posts/1` in both.
4. Every attribute key in §5 asserted by literal string. A test that compares against a constant exported from the implementation would pass through a rename, which is the exact failure §1 is about.
5. `db.query.text` is present and equals `CompiledQuery.text`; no attribute on any span contains a parameter value, asserted by taking a query whose parameter is a distinctive string and searching
   every recorded attribute for it.
6. `db.operation.name` is `INSERT` for a CTE that begins `WITH` and ends in an insert — the assertion the regex on `web-observability.md` fails.
7. Durations are recorded in seconds, asserted by an operation held open past one second producing a value greater than one and less than a hundred.
8. Each of §8's malformed `traceparent` cases — wrong field count, wrong length, uppercase hex, all-zero trace-id, all-zero span-id, version `ff` — produces a `200` and a root span with a fresh
   trace-id, and a version `01` header with a trailing field is _accepted_.
9. A valid `traceparent` makes the server span a child of it, with the trace-id preserved.
10. Valid `tracestate` and the remote marker reach the adapter; malformed `tracestate` is dropped without discarding a valid parent.
11. `toTraceparent(span)` round-trips: the string it produces is accepted by the inbound parser and yields the same trace-id and span-id; `toTraceHeaders` also carries state.
12. HTTP, database and message spans use `server`, `client` and `consumer` kinds respectively, while the framework children are `internal`.
13. A `4xx` server response does not set error status, while a `5xx` does.
14. A queued message's consumer span is linked, not parented, and a request/reply consumer span is parented.

## Non-goals (rejected)

- **Making `@opentelemetry/api` required or importing it from the core entry points** (§2). The selected `@zmdb/otel` package is the only integration boundary.
- **A no-op tracer instead of a branch** (§3).
- **`AsyncLocalStorage` or any ambient current-span** (§3).
- **An interceptor span** (§4), until `runChain` has a caller.
- **The raw path in a span name or a metric attribute** (§4, §7).
- **Recording parameter values, behind any option** (§6).
- **Recording request or response bodies, header values, or query strings** (§6).
- **Pool and connection metrics** (§7). The framework does not own a pool.
- **A separate error counter** (§7).
- **Sampling.** A sampler is the SDK's job and the port has no place to express one; `web-tracing.md`'s `ParentBasedSampler` stays the right advice and stays outside this package.
- **A metrics exposition endpoint.** `web-observability.md` builds one in fifteen lines and a Prometheus text format renderer in the framework would be a second telemetry pipeline next to the `Meter`
  port.
- **Wrapping `fetch`** (§8).
- **A per-request logger, or logs correlated by an injected trace id.** `web-logging` argues against a logger and nothing here changes that argument; a caller with `ctx.span` can put the trace id in
  its own log line.

## Package ownership amendment (#645)

The narrow ports, W3C propagation, message spans and driver instrumentation move to `@zmdb/app/observability`. That owner includes `Attributes`, `SpanKind`, `SpanContext`, `TraceCarrier`, `Span`,
`SpanOptions`, `Tracer`, `Meter`, `Observability`, `CommentKey`, `CommentKeys`, `CommentPairs`, `QueryTelemetry`, `ExecutingDriver`, `tracedDriver`, `consumerSpan`, `fromTraceContext`,
`fromTraceparent`, `toTraceHeaders` and `toTraceparent`.

`createTracedRouter` remains HTTP-owned in `@zmdb/web`. The broad `@zmdb/web/observability` entry is deleted when its implementation moves to app. In this slice, `@zmdb/web/otel` remains the
OpenTelemetry compatibility adapter; its later extraction moves `fromOpenTelemetry` and `OpenTelemetryOptions` to `@zmdb/otel`, the sole owner of the OpenTelemetry peer.
