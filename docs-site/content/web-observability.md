> **ToDo / feature gap.** There are no metrics — no Prometheus endpoint, no
> `@Metric`, no built-in counters or histograms. [Directive 7](./anti-patterns.html)
> means no metrics client is a dependency.

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

## Wiring it in

Requests, in your adapter — the framework has no hook that sees every request:

```ts
createServer(async (req, res) => {
  const start = performance.now();
  const out = await app.handle(toWebRequest(req));
  metrics.observe('http_duration_ms', performance.now() - start, {
    route: routeFor(req) ?? 'unmatched',
    method: req.method ?? 'GET',
    status: String(out.status),
  });
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

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

## What it would take

For metrics themselves, nothing framework-level — the class above is the feature, and a Prometheus client as a dependency is ruled out by Directive 7. What would genuinely help is a hook the framework does not have: a place to observe every request without owning the adapter, which is the same gap [interceptors](./web-middleware.html) have while [`runChain` is not wired into the router](./web-request-lifecycle.html).

---

See also: [Tracing](./web-tracing.html) · [Logging](./logging.html) · [Health Checks](./web-health-checks.html)
