There is no logger in zmdb — no `logger` option, no log levels, no output. What there is instead is a `Driver` with one required method, which turns query logging into a wrapper you control.

## Logging queries

```ts
import type { Driver } from '@zmdb/repository';

export function withLogging(inner: Driver, log: (e: object) => void): Driver {
  return {
    ...inner,
    async execute(query, options) {
      const start = performance.now();
      try {
        const rows = await inner.execute(query, options);
        log({ sql: query.text, ms: +(performance.now() - start).toFixed(1), rows: rows.length });
        return rows;
      } catch (error) {
        log({ sql: query.text, ms: +(performance.now() - start).toFixed(1), error: String(error) });
        throw error;
      }
    },
  };
}

export const driver = withLogging(baseDriver, e => console.log(JSON.stringify(e)));
```

Wrappers compose, so this stacks with [replicas](./read-replicas.html), [tagging](./sql-comments.html) and retries — each is `Driver → Driver`.

## Log the text, think hard about the parameters

`query.text` is safe: it is generated, and the values are placeholders. `query.parameters` is your users' data — emails, tokens, names, whatever your columns hold. Logging it wholesale puts personal
data in your log aggregator, usually with a longer retention than your database.

If you need parameters for debugging, gate them and redact:

```ts
const shape = (p: readonly unknown[]) => p.map(v => (v === null ? 'null' : typeof v));
log({ sql: query.text, params: settings.logParams ? p : shape(query.parameters) });
```

Logging the _types_ rather than the values is often enough to diagnose a query and carries no data.

And never log an interpolated statement. See [Query Utilities](./query-utils.html) — the interpolating helper there is for a local console, not for production.

## Slow queries only

Full query logs are unreadable at any volume. A threshold is more useful:

```ts
export function logSlow(inner: Driver, thresholdMs = 100): Driver {
  return {
    ...inner,
    async execute(query, options) {
      const start = performance.now();
      try {
        return await inner.execute(query, options);
      } finally {
        const ms = performance.now() - start;
        if (ms > thresholdMs) console.warn(JSON.stringify({ slow: true, ms: Math.round(ms), sql: query.text }));
      }
    },
  };
}
```

Pair it with a database-side `log_min_duration_statement`, which sees the time the database spent rather than the time your process observed — the difference between the two is queueing, and knowing
which one you have is the whole diagnosis.

## Counting queries per request

The N+1 detector, and worth having in development:

```ts
export function counting(inner: Driver) {
  let n = 0;
  return {
    driver: {
      ...inner,
      execute: (q, options) => (n++, inner.execute(q, options)),
    } satisfies Driver,
    count: () => n,
  };
}
```

Build it per request and log the count at the end. A handler that issues 40 queries will show up immediately; a handler that issues 3 will not need looking at. See
[Query Performance](./perf-queries.html).

## In `@zmdb/web`

There is no logging middleware. A handler logs what it wants, or you wrap the app:

```ts
const app = createApp(AppModule);
await app.init();

async function handle(req: WebRequest): Promise<WebResponse> {
  const start = performance.now();
  const res = await app.handle(req);
  console.log(
    JSON.stringify({
      method: req.method,
      path: req.path,
      status: res.status,
      ms: +(performance.now() - start).toFixed(1),
    }),
  );
  return res;
}
```

Log `req.path`, not the full URL with its query string — query parameters routinely carry tokens and search terms.

## Structured, one line, JSON

Whatever you use, emit one JSON object per line. Every log aggregator parses it, and multi-line output interleaves under concurrency into something unparseable.

There is no logger dependency to pick for you. `pino` if you want speed and levels; `console.log(JSON.stringify(...))` is genuinely fine for a small service and adds nothing to your tree.

## What is deliberately absent

An ORM that logs needs a logger, log levels, a formatter and a configuration surface for all three — and then you configure it to match the logger you already have. Passing a function to a wrapper is
the whole feature, and it means the log line has exactly the fields you want in the format your aggregator expects.

---

See also: [Writing a Driver](./custom-driver.html) · [SQL Comments](./sql-comments.html) · [Observability](./web-observability.html)
