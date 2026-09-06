> **Supported.** A configured `Meter` receives the HTTP request-duration and database operation-duration histograms. There is still no Prometheus client, exporter, backend, `@Metric` decorator or
> built-in `/metrics` endpoint.
>
> The metric names and units, and which attributes come from compile time rather than runtime, are frozen in `packages/web/src/observability/SPEC.md` against semantic conventions **v1.30.0**. Its #647
> ownership amendment assigns the generic ports and database instrumentation to `@zmdb/app/observability`; HTTP spans remain web-owned. The registry below remains a dependency-free alternative; values
> exported through the framework `Meter` use the conventional names and seconds units documented below.

`@zmdb/app/observability` and the HTTP instrumentation have no OpenTelemetry dependency. To adapt application-owned OpenTelemetry objects, install `@zmdb/otel@alpha @opentelemetry/api@^1.9.0`. Neither
is part of the `zmdb` default install. The adapter owns no provider, processor, exporter, collector client, global registration, or shutdown hook.

## The four things worth measuring

Instrument these and you can diagnose most incidents. Anything beyond them is usually noise.

| Metric                                  | Why                                    |
| --------------------------------------- | -------------------------------------- |
| Request rate, duration, status by route | the whole user-visible picture         |
| Query duration by statement shape       | where the time nearly always is        |
| Pool utilisation and wait time          | the usual ceiling under load           |
| Error rate by type                      | what broke, distinct from what is slow |

## A metrics registry without a dependency

```ts
export class Metrics {
  readonly #counters = new Map<string, number>();
  readonly #histograms = new Map<string, number[]>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = seriesKey(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + 1);
  }

  observe(name: string, ms: number, labels: Record<string, string> = {}): void {
    const key = seriesKey(name, labels);
    const list = this.#histograms.get(key) ?? [];
    list.push(ms);
    this.#histograms.set(key, list);
  }

  render(): string {
    const lines: string[] = [];
    for (const [key, value] of this.#counters) lines.push(`${key} ${value}`);
    for (const [key, values] of this.#histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      lines.push(`${key}_count ${sorted.length}`);
      lines.push(`${key}_p50 ${quantile(sorted, 0.5)}`);
      lines.push(`${key}_p95 ${quantile(sorted, 0.95)}`);
      lines.push(`${key}_p99 ${quantile(sorted, 0.99)}`);
    }
    return lines.join('\n') + '\n';
  }
}
```

```ts
function seriesKey(name: string, labels: Record<string, string>): string {
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return pairs.length === 0 ? name : `${name}{${pairs.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}
```

Sorting the labels is what makes the series key stable — otherwise the same metric with keys in a different order becomes two series.

Unbounded histogram arrays grow forever. Reset on scrape, or keep a reservoir sample; a naive version is a slow memory leak that only shows after days of uptime.

## Label cardinality is the trap

```ts
metrics.increment('http_requests', { path: ctx.path }); // wrong
metrics.increment('http_requests', { route: '/posts/:id' }); // right
```

`ctx.path` is `/posts/1`, `/posts/2`, … — one time series per id. That is how a metrics backend falls over, and how a bill arrives. Label by the **route pattern**, which you can get from `getRoutes`,
and never by a user id, email, tenant or request id.

Do not put personal data in a label either. Metrics are retained long-term and are usually less access-controlled than logs.

Getting the route pattern is harder than the two lines above suggest, and for a structural reason: `Ctx` carries `path`, the concrete one, and only the matched route knows the pattern. Reconstructing
it from `getRoutes` outside the router means re-running the match. The router therefore owns the server span and request histogram — it is the one place `http.route` exists without being derived
twice.

## Wiring in the framework metrics

`createRouter` and `createApp` accept the same `Observability` object. The separately installed OpenTelemetry adapter takes application-owned API objects:

```ts
import { metrics, trace } from '@opentelemetry/api';
import { tracedDriver } from '@zmdb/app/observability';
import { fromOpenTelemetry } from '@zmdb/otel';
import { createApp } from '@zmdb/web';

const observability = fromOpenTelemetry({
  tracer: trace.getTracer('checkout'),
  meter: metrics.getMeter('checkout'),
});

await using app = createApp(AppModule, { observability });
```

`@opentelemetry/api` is the sole required peer of the separately installed `@zmdb/otel` package. Neither the app kernel nor the HTTP core declares it or chooses an exporter or metrics backend.

Queries use `tracedDriver`. Passing `ctx.span` is what parents a query span to the handler; metrics work without a tracer:

```ts
const driver = tracedDriver(baseDriver, observability, ctx.span);
const users = defineRepository(UserSchema, driver, { dialect: 'postgres' });
```

The wrapper marks the driver as needing query telemetry. Repositories then ask the compiler to attach an optional `{ system, operation, collection }` object. Without that opt-in a compiled query
remains the same two-key `{ text, parameters }` value as before.

Do not derive the verb by parsing SQL. A first-word regex reads `WITH` for a CTE that ends in an `INSERT`, and a leading comment changes the first token. Optional compile-time telemetry exists so the
driver does not have to guess.

## Measured framework overhead

The committed run measured all three configurations on 2026-09-05 with Node 26.8.1 on an AMD Ryzen 7 7840U. Each row is the median of six samples after a 750 ms warmup per workload and mode; all six
mode orders were used. The recording case used a real `BasicTracerProvider`, `SimpleSpanProcessor` and bounded `SpanExporter`, with exporter flush/reset outside the timed interval and metrics
disabled.

| workload | configuration      | median ns/op | overhead vs off | exported spans/op | max/min spread |
| -------- | ------------------ | -----------: | --------------: | ----------------: | -------------: |
| request  | off                |       354.67 |        baseline |                 0 |         1.052x |
| request  | API no-op          |      1305.48 |         +268.1% |                 0 |         1.080x |
| request  | recording exporter |      6834.88 |        +1827.1% |                 3 |         1.022x |
| query    | off                |        76.97 |        baseline |                 0 |         1.115x |
| query    | API no-op          |       311.29 |         +304.4% |                 0 |         1.118x |
| query    | recording exporter |      2591.42 |        +3266.7% |                 1 |         1.090x |

The request workload is one matched `GET`; the query workload is one compiled `SELECT` through `tracedDriver`. These are nanosecond-scale framework microbenchmarks, not end-to-end service latency. The
raw 36 samples, runtime provenance, input hashes and median operations per second are published in `benchmarks/site/observability.json` and summarised on
[Web Performance & Benchmarks](./web-benchmarks.html).

## Exposing a hand-rolled registry

```ts
@Controller('/metrics')
export class MetricsController {
  @Inject(METRICS) private readonly metrics!: Metrics;

  @Get()
  scrape() {
    return { text: this.metrics.render() };
  }
}
```

Prometheus wants `text/plain` in its exposition format, which a handler can now return directly:

```ts
@Get('/metrics')
metrics() {
  return text(renderExposition());
}
```

Keep `/metrics` off your public listener, or require an auth header — it names every route and leaks traffic shape.

This endpoint is application code. zmdb does not install a registry, renderer or scrape route.

> [!WARNING] `/metrics` must not be publicly reachable. It reveals route inventory, traffic volumes, error rates and often internal identifiers — a reconnaissance gift. Bind it to a separate internal
> port (see [Multiple Servers](./web-multiple-servers.html)), or restrict it at the proxy.

## Structured logs may be enough

If you already emit one structured line per request, most backends derive rate, latency and error metrics from logs. That gives you the four measurements above with no metrics infrastructure — worth
doing before adding a second telemetry system. See [Logging](./logging.html).

## The names change if you export them

The registry on this page is yours, so `http_duration_ms` is whatever you say it is. The moment the numbers leave through a `Meter`, the names and units are a convention:

| this page          | convention                                       | unit        |
| ------------------ | ------------------------------------------------ | ----------- |
| `http_duration_ms` | `http.server.request.duration`                   | **seconds** |
| `db_query_ms`      | `db.client.operation.duration`                   | **seconds** |
| `http_errors`      | the HTTP histogram's optional `error.type` label | **seconds** |
| `db_errors`        | — application- or backend-owned                  |             |

**Seconds, not milliseconds**, and this is the one that bites without an error: the convention's histograms have bucket boundaries chosen for seconds, so millisecond observations exported under a
seconds-named metric all land in the top bucket and every percentile reads as "slower than the largest bucket". A dashboard built on it looks plausible and is meaningless.

The HTTP error rate is derivable from `error.type` on the request-duration histogram, so a separate HTTP error counter would be a second source for one number. The database-duration histogram has no
error label; derive database failures from spans or an application-owned counter. Two framework histograms, not four: pool statistics belong to a driver the framework does not own.

## Framework boundaries

The framework supplies a `Meter` port and the low-cardinality route information only the router knows. The separately installed `@zmdb/otel` package adapts caller-owned OpenTelemetry objects.

Exactly two histograms are emitted, and only when a meter exists: `http.server.request.duration` and `db.client.operation.duration`. HTTP error rate is derivable from the first histogram's optional
`error.type`; database error and pool metrics remain the application or driver's responsibility.

The per-request observation point for _interceptors_ remains deliberately absent: [`runChain` is still not wired into the router](./web-request-lifecycle.html), so there is no interceptor span or
interceptor-owned framework metric.

---

See also: [Tracing](./web-tracing.html) · [Logging](./logging.html) · [Health Checks](./web-health-checks.html)
