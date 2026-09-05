> **Supported.** `createRouter` and `createApp` accept an `Observability` configuration. The router creates request, route, validation and handler spans; `tracedDriver` creates database spans; and
> HTTP and message carriers propagate W3C `traceparent` plus optional `tracestate`.
>
> The span hierarchy, every attribute name, and propagation in both directions are frozen in `packages/web/src/observability/SPEC.md` against semantic conventions **v1.30.0**. zmdb ships ports and an
> optional OpenTelemetry adapter, not an SDK, exporter, collector configuration or global auto-instrumentation.

## Configure the framework

The core entry point declares narrow `Tracer`, `Span` and `Meter` ports and has no third-party runtime dependency. The optional adapter is the only surface that imports `@opentelemetry/api`, which is
an optional peer:

```ts
import { metrics, trace } from '@opentelemetry/api';
import { createApp } from '@zmdb/web';
import { fromOpenTelemetry } from '@zmdb/web/otel';

const observability = fromOpenTelemetry({
  tracer: trace.getTracer('checkout'),
  meter: metrics.getMeter('checkout'),
});

await using app = createApp(AppModule, { observability });
```

If you construct the router directly, pass the same object to `createRouter(observability)`. The app forwards it to both the HTTP router and its message dispatcher.

OpenTelemetry's Node auto-instrumentation remains an alternative for patching `node:http`, database clients and `fetch`. Enabling its HTTP or database instrumentation alongside zmdb's corresponding
spans can produce two spans for one operation, so choose deliberately.

## The framework span tree

For a matched route with validation and one query:

```text
POST /posts
├── zmdb.route
├── zmdb.validate
└── zmdb.handler
    └── INSERT posts
```

`http.route` is the low-cardinality name. Without it, a trace backend shows one operation per id and aggregate latency is meaningless. `http.response.status_code`, not `http.status_code` — the v1.23.0
HTTP stabilisation renamed it.

**`http.route` is not derivable from anything a handler or an adapter sees.** `Ctx` carries `params`, `body`, `query`, `headers`, `method`, `path` and an optional `span`; `path` is the concrete
`/posts/1`. Only the matched route knows `/posts/:id`, so the router creates the server span. A request that matches nothing has no `http.route`; its span is named only for the method, with the raw
path kept as an attribute.

There is deliberately no interceptor span. The router runs its effective guards, validation and handler, but `runChain` remains an explicit handler-level call.

### Server-span attributes

These are the complete server-span attributes emitted today under the pinned OpenTelemetry semantic conventions **v1.30.0**:

| attribute                   | when present                    | value                                  |
| --------------------------- | ------------------------------- | -------------------------------------- |
| `http.request.method`       | every observed request          | uppercase method, or `_OTHER`          |
| `http.route`                | a route matched                 | registered low-cardinality pattern     |
| `url.path`                  | every observed request          | concrete request path                  |
| `url.scheme`                | every observed request          | request scheme, defaulting to `http`   |
| `http.response.status_code` | the router produced a response  | numeric response status                |
| `error.type`                | the response is `5xx`           | thrown constructor name or status text |
| `server.address`            | the request has a `host` header | host-header value                      |

A normal `4xx` records the response status but is not marked as a server-span error. An unmatched request has no `http.route`; its concrete path remains in `url.path`.

## Query spans with useful attributes

`tracedDriver` instruments the execute boundary. Parenting is explicit: pass the handler's `ctx.span` when the query should appear beneath that handler.

```ts
import { tracedDriver } from '@zmdb/web/observability';

async function list(ctx: Ctx) {
  const driver = tracedDriver(baseDriver, observability, ctx.span);
  const users = defineRepository(UserSchema, driver, { dialect: 'postgres' });
  return users.findAll();
}
```

There is no ambient current span and the OpenTelemetry adapter does not consult ambient context. Omitting the third argument therefore creates root database spans; passing `ctx.span` is what
establishes the handler → query edge.

The database-span table is likewise the complete emitted set:

| attribute                 | when present                               | value                                            |
| ------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `db.system.name`          | compile-time query telemetry is available  | `postgresql`, `mysql`, `sqlite` or `mssql`       |
| `db.operation.name`       | compile-time query telemetry is available  | `SELECT`, `INSERT`, `UPDATE` or `DELETE`         |
| `db.collection.name`      | compile-time query telemetry is available  | primary table                                    |
| `db.query.text`           | every traced execution                     | placeholder-only SQL before any sqlcommenter tag |
| `db.response.status_code` | a failed driver call exposes an error code | dialect error code                               |
| `zmdb.db.parameter_count` | every traced execution                     | `CompiledQuery.parameters.length`                |

> [!WARNING] `db.query.text` is safe because zmdb's compiled SQL contains **placeholders**, not values — that is the point of `CompiledQuery`. Never record the parameters. Traces are retained, widely
> readable inside an organisation, and parameters are user data: emails, tokens, personal detail. Record the _count_, as above.

Also avoid putting request bodies, headers or full URLs on spans, for the same reason.

`db.statement`, `db.system`, `db.operation` and `db.sql.table` are the pre-v1.30.0 spellings. They are why the frozen spec pins a convention version and treats a rename as an edit to the file: nothing
fails to compile when an attribute is renamed, the dashboard just goes flat.

`zmdb.db.parameter_count` is namespaced outside `db.` on purpose. Recent conventions use `db.operation.parameter.<key>` for parameter _values_, which is exactly what the warning above forbids, and a
neighbouring key would invite the confusion.

The whole compile-time half of that set — system, operation and table — is attached to the compiled query rather than re-derived, which matters more than it sounds; see the note on statement parsing
under [Observability](./web-observability.html).

## Propagation

HTTP headers and message envelopes are carriers for `traceparent` and optional `tracestate`. The router extracts valid inbound context before creating the server span. A malformed `traceparent` is
ignored and starts a new trace; it never fails the request. Invalid `tracestate` is dropped while a valid `traceparent` is retained.

zmdb does not patch `fetch`. Use your SDK's propagation API, or write the framework span into an outbound carrier:

```ts
import { toTraceHeaders } from '@zmdb/web/observability';

const headers = ctx.span === undefined ? {} : toTraceHeaders(ctx.span);
await fetch(url, { headers });
```

The validation is exact and the frozen spec spells it out, including the case an implementation is most likely to get wrong: a version **above** `00` is accepted by reading the first four fields and
ignoring the rest, because that is the forward-compatibility rule W3C requires. Rejecting it is how a service stops accepting traces the day the spec gains a field.

The message client and event publisher accept an explicit span and put its carrier on `TransportRequest` / the emitted envelope. A custom `TransportStrategy` must preserve both carrier fields. A
**request/reply** consumer is a child of the supplied span; a **queued** consumer is linked to it and starts its own trace. Linking avoids making queue delay look like handler duration.

## Connecting traces to SQL

`pg_stat_activity` shows a slow query but not which request caused it. The sqlcommenter decorator can append the query span's `traceparent` plus selected route metadata. It remains off unless
`observability.comments` is present, so configuring tracing alone does not change SQL text. See [SQL Comments](./sql-comments.html) for the wiring, escaping and statement-cache trade-offs.

## Sampling

Trace everything in development, sample in production — a busy service produces more span volume than logs, and the cost is real:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

new NodeSDK({ sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.05) }) });
```

`ParentBasedSampler` keeps a trace whole: if the caller sampled it, you sample it. Independent sampling per service produces fragments, which are worse than no trace.

## Deliberate boundaries

OpenTelemetry is not a required dependency. `@zmdb/web` declares a narrow port, and `@zmdb/web/otel` adapts the optional `@opentelemetry/api` peer.

The port is a port rather than a claim of structural compatibility, which is a deliberately modest position. `@opentelemetry/api`'s `Tracer.startActiveSpan` has four overloads and its `Span` has
around ten methods, and the dependency-free core entry points cannot compile an assertion against that API. A claim that cannot be checked rots in silence. In the `otel` subpath the peer is a
devDependency, so there the claim is typechecked — which is the only place it is worth making.

- **No configured tracer or meter:** the original router path runs after one branch; no no-op span is installed.
- **No ambient context:** the current span rides explicitly on `Ctx`.
- **No exporter, SDK or collector configuration:** application-owned.
- **No global `fetch` patch and no sampling policy:** SDK responsibilities.
- **No interceptor span:** `runChain` is still explicit rather than router-owned.

---

See also: [Observability](./web-observability.html) · [SQL Comments](./sql-comments.html) · [Logging](./logging.html)
