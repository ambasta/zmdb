> **ToDo / feature gap.** No zmdb API accepts an `AbortSignal`.
> `Driver.execute(query)` takes one argument, and repository methods take DTOs.
> A client that disconnects mid-request does not cancel the query it triggered.

## Why it matters

An abandoned request whose query keeps running is work the database does for nobody. Under load that compounds: a slow endpoint times out at the load balancer, the client retries, and the original query is still holding its buffers and its row locks. Cancellation is how you stop paying for requests that have already been given up on.

## Timeouts, which cover most of the need

A statement timeout is not cancellation, but it bounds the damage and it is enforced by the database rather than by hopeful client-side code:

```ts
// postgres, per transaction
await driver.execute({ text: 'SET LOCAL statement_timeout = 5000', parameters: [] });

// postgres, per connection, in the pool config
new Pool({ ...cfg, statement_timeout: 5_000 });

// mysql
new Pool({ ...cfg, connectTimeout: 5_000 }); // and MAX_EXECUTION_TIME hints per query
```

Set this. A default statement timeout is one line of config and it prevents a single pathological query from occupying a connection indefinitely.

## Cancellation in your driver

The driver is the layer that owns the client, so it is the layer that can cancel. Thread the signal in through a factory rather than an argument:

```ts
function driverFor(signal: AbortSignal): Driver {
  return {
    async execute(q) {
      const client = await pool.connect();
      const onAbort = () => {
        void client.query('SELECT pg_cancel_backend(pg_backend_pid())');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await client.query(q.text, [...q.parameters]);
        return res.rows;
      } finally {
        signal.removeEventListener('abort', onAbort);
        client.release();
      }
    },
  };
}
```

Then build the repository per request with that driver. This is the same per-request-driver pattern [SQL comments](./sql-comments.html) and [multi-tenancy](./entity-filters.html) use, and it works because a repository is a cheap object over a driver, not a connection pool of its own.

> [!NOTE]
> `pg_cancel_backend` on the _same_ connection cancels the query you are
> waiting on. Postgres' own cancel-request protocol uses a second connection —
> `pg`'s `Client` exposes it via `client.connection.cancel()` on some versions.
> Check what your client actually does; several "cancel" APIs only stop reading
> the result and leave the server working.

## Where the signal comes from

`@zmdb/web`'s `Ctx` carries `params`, `body`, `query`, `headers`, `method` and `path` — no signal, since the framework's own request type does not model one. If you are behind `node:http`, `req.on('aborted')` is available at the adapter; if you are behind `fetch`, `request.signal` is. Either way it has to be captured at the adapter and passed down explicitly.

## What it would take

Two additive changes and one decision. The additive part: `execute(query, options?: { signal?: AbortSignal })` on `Driver`, and an optional `signal` on the repository DTOs. The decision: whether `Ctx` grows a `signal`, which means `WebRequest` grows one, which means every adapter has to supply it — reasonable, but it changes a type that every handler in every application touches, so it wants doing once and properly rather than twice.

The [GraphQL subscription](./web-graphql-subscriptions.html) freeze answered half of that decision without forcing the other half, and although that layer is [not being built](./web-graphql.html), the reasoning is what survives it: a long-lived connection's context carries a `signal` because it genuinely has one, and `Ctx` and `WebRequest` are left alone. It also settles the primitive: cancellation is a signal passed _in_, never a teardown function handed back, because a caller cannot forget a parameter — which is the argument for threading it through `Driver.execute` too.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Streaming](./streaming.html)
