There is no `Logger` service and no bundled logger — [zero runtime
dependencies](./why-zmdb.html). What you get is the two seams worth logging at:
an [interceptor](./web-middleware.html) around a handler, and a `Driver` wrapper
around every query. Both take the sink as an argument, so tests assert on records
instead of scraping stdout.

## Structured, not printf

```ts
export interface Sink {
  (record: Readonly<Record<string, unknown>>): void;
}

export const jsonLines: Sink = record => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...record }));
};
```

One JSON object per line. Every log platform ingests it, every field is
queryable, and nothing needs a regex to parse. A formatted string is a field you
cannot filter on.

## Request logging

```ts
import type { Interceptor } from '@zmdb/web/middleware';

export function requestLog(sink: Sink): Interceptor {
  return {
    async intercept(ctx, next) {
      const started = performance.now();
      try {
        const result = await next();
        sink({ level: 'info', method: ctx.method, path: ctx.path, ms: round(performance.now() - started) });
        return result;
      } catch (error) {
        sink({
          level: 'error',
          method: ctx.method,
          path: ctx.path,
          ms: round(performance.now() - started),
          err: errorName(error),
        });
        throw error;
      }
    },
  };
}
```

Two corrections to the obvious version of this. `next()` resolves to the
**handler's return value**, not a `WebResponse` — there is no `result.status` to
log, because the router assigns the status after the chain is done. And `Ctx` has
no `route` field: the six fields are `params`, `body`, `query`, `headers`,
`method` and `path`. `ctx.path` is the concrete path, `/users/42`.

> [!WARNING]
> **The router does not call `runChain`**, so an interceptor registered on a
> controller does nothing — invoke the chain in the handler, or log in your adapter
> instead. See [Request Lifecycle](./web-request-lifecycle.html).

## Logging in the adapter instead

The adapter sees the status, the byte count and every request including the 404s,
which makes it the better place for access logging:

```ts
createServer(async (req, res) => {
  const started = performance.now();
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  const out = await app.handle(toWebRequest(req));
  jsonLines({
    level: out.status >= 500 ? 'error' : 'info',
    requestId,
    method: req.method,
    path: (req.url ?? '/').split('?')[0],
    status: out.status,
    ms: round(performance.now() - started),
  });
  res.writeHead(out.status, { ...out.headers, 'x-request-id': String(requestId) }).end(out.body);
});
```

Echo the request id back, and accept an inbound one so a trace spans services.

> [!NOTE]
> `ctx.path` is high-cardinality: `/users/1`, `/users/2`, … Fine in logs, wrong for
> [metrics](./web-observability.html) — label a counter with the route **pattern**
> from `getRoutes`, or you will create a time series per user id and take your
> metrics backend down.

## Logging queries

A `Driver` wrapper covers handlers, workers and CLI scripts alike, because it sits
under all of them:

```ts
import type { Driver } from '@zmdb/repository';

export function loggingDriver(inner: Driver, sink: Sink): Driver {
  return {
    async execute(query) {
      const started = performance.now();
      try {
        const rows = await inner.execute(query);
        sink({
          level: 'debug',
          sql: query.text,
          params: query.parameters.length,
          rows: rows.length,
          ms: round(performance.now() - started),
        });
        return rows;
      } catch (error) {
        sink({ level: 'error', sql: query.text, params: query.parameters.length, err: errorName(error) });
        throw error;
      }
    },
  };
}
```

`query.text` is safe to log: it contains placeholders (`$1`, `?`) and never the
values, because the compiler never interpolates. `query.parameters` is the
opposite — log the **count**, or the types, never the contents.

> [!WARNING]
> Query parameters are the user's data: email addresses, tokens, the plaintext of
> whatever you are about to hash. The same applies to request bodies, the
> `authorization` header, `cookie`, and any upstream response body. Logs are
> replicated, retained for years, and readable by more people than your database —
> a `console.log(ctx.body)` added during debugging is a data breach that passes
> code review because it looks like debugging.

Redact by allow-list, not deny-list — log the fields you chose, rather than
removing the ones you remembered.

## Levels, and what to put at each

| Level   | Content                                                                |
| ------- | ---------------------------------------------------------------------- |
| `error` | a request failed in a way that needs a human; always with a request id |
| `warn`  | a degraded path that succeeded — a cache miss storm, a retried call    |
| `info`  | one line per request, plus significant state changes                   |
| `debug` | queries, payload shapes; off in production                             |

Log an error **once**, where you handle it. Logging at every frame on the way up
turns one incident into thirty lines and makes the rate meaningless.

## Injecting the sink

```ts
export const SINK = createToken<Sink>('SINK');

@Module({ providers: [{ token: SINK, useValue: jsonLines }], controllers: [PostsController] })
export class AppModule {}
```

```ts
await using app = createTestApp(AppModule, {
  overrides: [{ token: SINK, useValue: record => records.push(record) }],
});

expect(records.at(-1)).toMatchObject({ level: 'error', status: 500 });
```

Which makes logging _testable_: the assertion that an error path actually logs is
the assertion nobody writes, and it is the one that matters at 3am.

## Design notes

- No global logger and no ambient context, so nothing to reset between tests and
  nothing shared between concurrent requests.
- `sink` is one function type — adapt pino, `console`, or an array in a test in a
  single line.
- Granular imports: `@zmdb/web/middleware`, `@zmdb/repository`.

---

See also: [Observability](./web-observability.html) · [Tracing](./web-tracing.html) · [Interceptors](./web-middleware.html)
