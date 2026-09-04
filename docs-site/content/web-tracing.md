> **ToDo / feature gap.** There is no OpenTelemetry integration — no auto
> instrumentation, no span creation, no context propagation. Nothing in zmdb reads
> or writes a `traceparent` header.
>
> The span hierarchy, every attribute name, and propagation in both directions are
> frozen in `packages/web/src/observability/SPEC.md` against semantic conventions
> **v1.30.0**. Four attribute names on this page are the deprecated spellings and
> are corrected below.

## What you get for free

Nothing framework-specific — but OpenTelemetry's Node auto-instrumentation patches `node:http`, `pg`, `mysql2` and `fetch` at the module level, which means:

```ts
// tracing.ts — imported before anything else
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();
```

```bash
node --import ./dist/tracing.js dist/main.js
```

gets you an HTTP server span per request and a database span per query, with correct parent-child nesting, without zmdb participating at all. That covers the two things a trace is usually for.

The `--import` matters: the SDK must patch the modules before your code requires them. Importing it at the top of `main.ts` often works and sometimes silently does not, depending on hoisting.

What is missing is the middle: no span for "handler", no route name on the HTTP span (so spans are grouped by `/posts/1` rather than `/posts/:id`), and no zmdb-level attributes.

## Adding the missing layer

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('zmdb-web');

createServer(async (req, res) => {
  const route = routeFor(req) ?? 'unmatched';
  await tracer.startActiveSpan(`${req.method} ${route}`, async span => {
    span.setAttribute('http.route', route);
    try {
      const out = await app.handle(await webRequest(req));
      span.setAttribute('http.response.status_code', out.status);
      if (out.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      res.writeHead(out.status, { ...out.headers }).end(out.body);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
});
```

`span.end()` in a `finally` is not optional — a leaked span is a memory leak and a trace that never exports.

`webRequest(req)` is the `WebRequest` the adapter builds itself — there is no `toWebRequest` to import; it is written out in [Request Lifecycle](./web-request-lifecycle.html).

`http.route` is the low-cardinality name. Without it, a trace backend shows one operation per id and aggregate latency is meaningless. `http.response.status_code`, not `http.status_code` — the v1.23.0 HTTP stabilisation renamed it.

The awkward part of this snippet is `routeFor(req)`, and it is awkward for a structural reason rather than a missing convenience. **`http.route` is not derivable from anything a handler or an adapter sees.** `Ctx` is `{ params, body, query, headers, method, path }` and `path` is the concrete `/posts/1`; only the matched route knows `/posts/:id`. That is why the frozen design has the **router** create the server span rather than the adapter — it is the one component that knows both the method and the pattern. A request that matches nothing has no route, so its span is named `GET` with the path as an attribute, because a raw path in a span name is unbounded cardinality by definition.

## Query spans with useful attributes

Even with auto-instrumentation giving you `pg` spans, adding zmdb-level context is worth it:

```ts
function traced(inner: Driver): Driver {
  return {
    async execute(query) {
      return tracer.startActiveSpan('db.query', async span => {
        span.setAttribute('db.query.text', query.text);
        span.setAttribute('zmdb.db.parameter_count', query.parameters.length);
        try {
          return await inner.execute(query);
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}
```

> [!WARNING]
> `db.query.text` is safe because zmdb's compiled SQL contains **placeholders**, not
> values — that is the point of `CompiledQuery`. Never record the parameters.
> Traces are retained, widely readable inside an organisation, and parameters are
> user data: emails, tokens, personal detail. Record the _count_, as above.

Also avoid putting request bodies, headers or full URLs on spans, for the same reason.

The names are `db.query.text` and `db.system.name`, `db.operation.name`,
`db.collection.name` for the rest of the set. `db.statement`, `db.system`,
`db.operation` and `db.sql.table` are the pre-v1.30.0 spellings, and they are the
reason the frozen spec pins a convention version and treats a rename as an edit to
the file: nothing fails to compile when an attribute is renamed, the dashboard just
goes flat.

`zmdb.db.parameter_count` is namespaced outside `db.` on purpose. Recent conventions
use `db.operation.parameter.<key>` for parameter _values_, which is exactly what the
warning above forbids, and a neighbouring key would invite the confusion.

In the frozen design the whole compile-time half of that set — system, operation,
table — is attached to the compiled query rather than re-derived, which matters more
than it sounds; see the note on statement parsing under
[Observability](./web-observability.html).

## Propagating to upstreams

Auto-instrumented `fetch` injects `traceparent`. Doing it manually:

```ts
import { propagation, context } from '@opentelemetry/api';

const headers: Record<string, string> = {};
propagation.inject(context.active(), headers);
await fetch(url, { headers });
```

And accepting an incoming trace context in your adapter:

```ts
const parent = propagation.extract(context.active(), req.headers);
await context.with(parent, () => tracer.startActiveSpan(name, handler));
```

Without the extract, your service starts a new trace and the caller's trace ends at your door — which is the single most common tracing misconfiguration, and the reason the framework doing it is the point of doing it in the framework.

**A malformed `traceparent` is ignored, and a new trace begins. It never fails the request.** A header the client controls must not be able to produce a `400` on a route with nothing to do with tracing, and the alternative has a telemetry-shaped outage as its failure mode: one misconfigured upstream injecting a bad header takes down every service downstream of it at once. `tracestate` that fails to parse is dropped while `traceparent` is kept — nobody's correctness depends on the vendor field.

The validation is exact and the frozen spec spells it out, including the case an implementation is most likely to get wrong: a version **above** `00` is accepted by reading the first four fields and ignoring the rest, because that is the forward-compatibility rule W3C requires. Rejecting it is how a service stops accepting traces the day the spec gains a field.

The same header travels on a message envelope, and there the edge is not the same one. A **request/reply** consumer is a child of the producer's span; a **queued** consumer is _linked_ to it and starts its own trace. That is a rule in the frozen spec rather than a preference, because a parent-child edge across an unbounded queue delay produces a trace whose duration is the queue's latency — a waterfall claiming the request took four hours because the message sat in a queue, with the real work an invisible sliver at the end. A link keeps both properties: the consumer's duration is its own, and the producer is still one click away.

## Connecting traces to SQL

`pg_stat_activity` shows a slow query but not which request caused it. A [SQL comment](./sql-comments.html) closes the loop:

```ts
const traceId = trace.getActiveSpan()?.spanContext().traceId ?? '';
const text = `${query.text} /* trace=${encodeURIComponent(traceId)} */`;
```

`encodeURIComponent` because `*/` in an interpolated value terminates the comment early and turns the rest into SQL. A trace id is hex so it is safe in practice; encode anyway, because the next person to extend this will add something that is not — and read the escaping section of [SQL comments](./sql-comments.html) before you do, because `encodeURIComponent` alone is not sufficient and the reason is not obvious.

One thing to know before turning this on in production: a `traceparent` contains a fresh span id per query, so every statement text becomes unique. That is the trade the frozen design puts in your hands rather than deciding for you — it is what closes the loop from `pg_stat_activity` to a waterfall, and it is also what fills `pg_stat_statements` with one row per query.

## Sampling

Trace everything in development, sample in production — a busy service produces more span volume than logs, and the cost is real:

```ts
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

new NodeSDK({ sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.05) }) });
```

`ParentBasedSampler` keeps a trace whole: if the caller sampled it, you sample it. Independent sampling per service produces fragments, which are worse than no trace.

## What it would take

OpenTelemetry cannot be a dependency (Directive 7), and the frozen design's answer is a **narrow port** declared in `@zmdb/web` — a `Span` with five methods and a `Tracer` with one — plus an optional `@zmdb/web/otel` entry point holding the ten-line adapter behind a peer dependency.

The port is a port rather than a claim of structural compatibility, which is a deliberately modest position. `@opentelemetry/api`'s `Tracer.startActiveSpan` has four overloads and its `Span` has around ten methods, and a package forbidden from importing that API cannot compile the assertion that its own interface satisfies it. A claim that cannot be checked rots in silence. In the `otel` subpath the peer is a devDependency, so there the claim is typechecked — which is the only place it is worth making.

Two things follow from that, and both are why this is a spec and not a patch:

- **`tracer` absent must cost nothing**, and the mechanism is one `undefined` check at the top of `handle` after which today's exact code path runs. Not a no-op tracer: a no-op span still costs a call per attribute, five to ten per request that a profiler cannot tell from real work, and it makes the fast and slow paths the same code so the fast one never gets measured alone.
- **There is no ambient current span.** `AsyncLocalStorage` is the conventional answer and it is refused twice — it is a `node:async_hooks` import in a package whose whole shape is a Fetch handler, and it makes the current span implicit, which is only correct if every await boundary in the process behaves. The span rides on `Ctx` instead. More wiring, and the same property [SQL comments](./sql-comments.html) already credits: two concurrent requests cannot borrow each other's context.

The span tree is four kinds — a server span, then routing, validation and the handler — and notably **not** an interceptor span, because `runChain` still has no caller in the pipeline, so a span wrapping an interceptor would never be recorded. A span that appears in a design document and never in a trace is worse than a missing one: somebody builds a panel for it and it is empty for a reason nobody can find.

Realistically the auto-instrumentation plus the twenty lines above gets most of the value today. What it cannot get is `http.route`, which is the attribute the whole aggregate view depends on.

---

See also: [Observability](./web-observability.html) · [SQL Comments](./sql-comments.html) · [Logging](./logging.html)
