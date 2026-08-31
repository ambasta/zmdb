> **ToDo / feature gap.** There is no OpenTelemetry integration — no auto
> instrumentation, no span creation, no context propagation. Nothing in zmdb reads
> or writes a `traceparent` header.

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
      const out = await app.handle(toWebRequest(req));
      span.setAttribute('http.status_code', out.status);
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

`http.route` is the low-cardinality name. Without it, a trace backend shows one operation per id and aggregate latency is meaningless.

## Query spans with useful attributes

Even with auto-instrumentation giving you `pg` spans, adding zmdb-level context is worth it:

```ts
function traced(inner: Driver): Driver {
  return {
    async execute(query) {
      return tracer.startActiveSpan('db.query', async span => {
        span.setAttribute('db.statement', query.text);
        span.setAttribute('db.parameter_count', query.parameters.length);
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
> `db.statement` is safe because zmdb's compiled SQL contains **placeholders**, not
> values — that is the point of `CompiledQuery`. Never add
> `db.parameters`. Traces are retained, widely readable inside an organisation, and
> parameters are user data: emails, tokens, personal detail. Record the _count_, as
> above.

Also avoid putting request bodies, headers or full URLs on spans, for the same reason.

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

Without the extract, your service starts a new trace and the caller's trace ends at your door — which is the single most common tracing misconfiguration.

## Connecting traces to SQL

`pg_stat_activity` shows a slow query but not which request caused it. A [SQL comment](./sql-comments.html) closes the loop:

```ts
const traceId = trace.getActiveSpan()?.spanContext().traceId ?? '';
const text = `${query.text} /* trace=${encodeURIComponent(traceId)} */`;
```

`encodeURIComponent` because `*/` in an interpolated value terminates the comment early and turns the rest into SQL. A trace id is hex so it is safe in practice; encode anyway, because the next person to extend this will add something that is not.

## Sampling

Trace everything in development, sample in production — a busy service produces more span volume than logs, and the cost is real:

```ts
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

new NodeSDK({ sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.05) }) });
```

`ParentBasedSampler` keeps a trace whole: if the caller sampled it, you sample it. Independent sampling per service produces fragments, which are worse than no trace.

## What it would take

OpenTelemetry cannot be a dependency (Directive 7), so the framework's contribution would be an optional `@zmdb/web/otel` entry point behind a peer dependency, plus the two hooks the workarounds above need from the outside: a per-request observation point and a documented driver decorator. Both are the same gaps [metrics](./web-observability.html) hits.

Realistically the auto-instrumentation plus the twenty lines above gets 90% of the value today, which is why this is not near the top of the list.

---

See also: [Observability](./web-observability.html) · [SQL Comments](./sql-comments.html) · [Logging](./logging.html)
