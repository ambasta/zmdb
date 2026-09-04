> **ToDo / feature gap.** There are no metrics — no Prometheus endpoint, no
> `@Metric`, no built-in counters or histograms. [Directive 7](./anti-patterns.html)
> means no metrics client is a dependency.
>
> The metric names and units, and which attributes come from compile time rather
> than runtime, are frozen in `packages/web/src/observability/SPEC.md` against
> semantic conventions **v1.30.0**. The registry below stays the right shape for a
> hand-rolled setup; two of its names and one of its derivations are wrong for
> anything exported through a `Meter`, and both are corrected in place.

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

`ctx.path` is `/posts/1`, `/posts/2`, … — one time series per id. That is how a metrics backend falls over, and how a bill arrives. Label by the **route pattern**, which you can get from `getRoutes`, and never by a user id, email, tenant or request id.

Do not put personal data in a label either. Metrics are retained long-term and are usually less access-controlled than logs.

Getting the route pattern is harder than the two lines above suggest, and for a structural reason: `Ctx` carries `path`, the concrete one, and only the matched route knows the pattern. Reconstructing it from `getRoutes` outside the router means re-running the match. That is why the frozen design has the router own the server span and the request histogram — it is the one place `http.route` exists without being derived twice.

## Wiring it in

Requests, in your adapter — the framework has no hook that sees every request:

```ts
createServer(async (req, res) => {
  const start = performance.now();
  const out = await app.handle(await webRequest(req));
  metrics.observe('http_duration_ms', performance.now() - start, {
    route: routeFor(req) ?? 'unmatched',
    method: req.method ?? 'GET',
    status: String(out.status),
  });
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

`webRequest(req)` is the `WebRequest` the adapter builds itself — there is no `toWebRequest` to import; it is written out in [Request Lifecycle](./web-request-lifecycle.html).

Queries, in a driver wrapper — the cleanest instrumentation point in the whole stack:

```ts
function measured(inner: Driver, metrics: Metrics): Driver {
  return {
    async execute(query) {
      const start = performance.now();
      try {
        const rows = await inner.execute(query);
        metrics.observe('db_query_ms', performance.now() - start, { op: verb(query.text) });
        return rows;
      } catch (error) {
        metrics.increment('db_errors', { op: verb(query.text) });
        throw error;
      }
    },
  };
}

const verb = (sql: string) => (/^\s*(\w+)/.exec(sql)?.[1] ?? 'other').toUpperCase();
```

Label by the SQL **verb**, not the text. Full statements have effectively unbounded cardinality and can contain values.

But do not derive the verb by parsing, which is what `verb` above does. It is a regular expression over SQL that the compiler generated moments earlier and had exact knowledge of, and it is wrong twice: it reads `WITH` for a CTE that ends in an `INSERT`, and it returns `OTHER` for any statement carrying a leading comment (the fallback is `'other'` in the source and `.toUpperCase()` applies to it too, so `OTHER` is the label to look for on a dashboard) — so turning on [SQL comments](./sql-comments.html) in their leading form would silently relabel every database metric in the application. The frozen design attaches the dialect, the operation and the table to the compiled query instead, where they are already known without a parse. That is also one of the reasons the comment is specified as **trailing**.

If you are hand-rolling this today, `query.telemetry` does not exist yet, so the regex is what you have. Know that it lies about CTEs.

## Exposing it

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

> [!WARNING]
> `/metrics` must not be publicly reachable. It reveals route inventory, traffic
> volumes, error rates and often internal identifiers — a reconnaissance gift. Bind
> it to a separate internal port (see [Multiple Servers](./web-multiple-servers.html)),
> or restrict it at the proxy.

## Structured logs may be enough

If you already emit one structured line per request, most backends derive rate, latency and error metrics from logs. That gives you the four measurements above with no metrics infrastructure — worth doing before adding a second telemetry system. See [Logging](./logging.html).

## The names change if you export them

The registry on this page is yours, so `http_duration_ms` is whatever you say it is. The moment the numbers leave through a `Meter`, the names and units are a convention:

| this page          | convention                     | unit        |
| ------------------ | ------------------------------ | ----------- |
| `http_duration_ms` | `http.server.request.duration` | **seconds** |
| `db_query_ms`      | `db.client.operation.duration` | **seconds** |
| `db_errors`        | — derived from `error.type`    |             |

**Seconds, not milliseconds**, and this is the one that bites without an error: the convention's histograms have bucket boundaries chosen for seconds, so millisecond observations exported under a seconds-named metric all land in the top bucket and every percentile reads as "slower than the largest bucket". A dashboard built on it looks plausible and is meaningless.

`db_errors` disappears because the error rate is derivable from the `error.type` attribute on the duration histogram, and a separate counter is a second source for one number that will eventually disagree with the first. Two metrics, not four: pool statistics belong to a driver the framework does not own.

## What it would take

For metrics themselves, nothing framework-level — the class above is the feature, and a Prometheus client as a dependency is ruled out by Directive 7. What the framework adds is a `Meter` **port** (declared locally, adapted in an optional `@zmdb/web/otel` entry point) and the one thing an adapter cannot get from outside: `http.route`.

The hook this page has been asking for is the same one [tracing](./web-tracing.html) needs, and the frozen answer is that the router emits both — a server span and the request histogram — because the router is where the matched pattern exists. Emitted only when a `Meter` is configured, behind the same single `undefined` check that keeps the untraced path byte-for-byte what it is today.

The per-request observation point for _interceptors_ remains a genuine gap: [`runChain` is still not wired into the router](./web-request-lifecycle.html), which is also why the frozen span tree has no interceptor span.

---

See also: [Tracing](./web-tracing.html) · [Logging](./logging.html) · [Health Checks](./web-health-checks.html)
