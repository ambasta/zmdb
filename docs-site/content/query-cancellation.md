> **ToDo / adapter gap.** Repository reads and `Driver.execute` now accept an
> `AbortSignal`. Already-aborted reads do not dispatch, and the same signal
> reaches the driver. The bundled drivers do not yet cancel a running
> server-side statement, so active cancellation still depends on a custom driver.

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

The driver is the layer that owns the client, so it is the layer that can
cancel. The repository passes the signal as the second argument:

```ts
const controller = new AbortController();
const pending = users.findAll({ signal: controller.signal });
controller.abort();
await pending; // rejects with signal.reason, or a DOMException named AbortError
```

A custom driver's `execute(query, { signal })` should check
`signal.throwIfAborted()` before dispatch and connect its abort event to the
client's real cancellation primitive. A driver that ignores the options remains
compatible; the repository rejects after that driver's promise settles.

> [!NOTE]
> `pg_cancel_backend` on the _same_ connection cancels the query you are
> waiting on. Postgres' own cancel-request protocol uses a second connection —
> `pg`'s `Client` exposes it via `client.connection.cancel()` on some versions.
> Check what your client actually does; several "cancel" APIs only stop reading
> the result and leave the server working.

## Where the signal comes from

`@zmdb/web`'s `Ctx` carries `params`, `body`, `query`, `headers`, `method`,
`path` and optional `span` — still no signal, since the framework's own request
type does not model one. The span is explicit observability context, not
cancellation. If you are behind `node:http`, `req.on('aborted')` is available at
the adapter; if you are behind `fetch`, `request.signal` is. Either way it has to
be captured at the adapter and passed down explicitly.

## What remains

The additive API is shipped. The remaining database work is per adapter:
Postgres needs a second connection for server cancellation, while SQLite can
observe abort only between stepped rows. HTTP request cancellation remains
explicit application wiring because `Ctx` and `WebRequest` do not carry a
database signal.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Streaming](./streaming.html)
