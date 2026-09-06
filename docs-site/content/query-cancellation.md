Every repository read accepts an `AbortSignal`. Already-aborted reads do not compile or dispatch, and a later abort rejects with `signal.reason` once the driver settles. Whether it also stops active
database work is a driver and dialect capability.

## Why it matters

An abandoned request whose query keeps running is work the database does for nobody. Under load that compounds: a slow endpoint times out at the load balancer, the client retries, and the original
query is still holding its buffers and its row locks. Cancellation is how you stop paying for requests that have already been given up on.

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

## Cancellation through a driver

The driver is the layer that owns the client, so it is the layer that can cancel. The repository passes the signal as the second argument:

```ts
const controller = new AbortController();
const pending = users.findAll({ signal: controller.signal });
controller.abort();
await pending; // rejects with signal.reason, or a DOMException named AbortError
```

For the bundled Postgres adapter, give `cancelVia` a queryable that can obtain a connection other than the one running the statement:

```ts
import { Pool } from 'pg';
import { postgresDriver } from '@zmdb/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const driver = postgresDriver(pool, { cancelVia: pool });
```

On abort, the driver reads the running backend's pid and sends `SELECT pg_cancel_backend($1)` through `cancelVia`. Reusing the same pool is safe only when it has spare capacity; a pool whose single
connection is busy cannot carry its own cancel request. A separate cancellation pool is also valid.

A custom driver's `execute(query, { signal })` should check `signal.throwIfAborted()` before dispatch and connect its abort event to the client's real cancellation primitive. A driver that ignores the
options remains compatible; the repository rejects after that driver's promise settles.

> [!NOTE] A SQL cancel sent on the busy connection queues behind the statement it was meant to stop. Cancellation must travel over another connection. Merely rejecting the JavaScript promise or
> stopping result reads leaves the server doing work for a caller that has already gone away.

`sqliteDriver` cannot stop one native step already in progress because `node:sqlite` exposes no `sqlite3_interrupt`. Its real stream checks the signal between rows and stops further stepping with the
exact abort reason.

## Per-dialect truth

| Driver                                     | Active abort behaviour                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgresDriver(pool, { cancelVia })`      | Reads the busy backend pid and sends `pg_cancel_backend` over another connection. The same pool needs spare capacity, or `cancelVia` can be a separate pool.   |
| `postgresDriver(pool)` without `cancelVia` | Rejects before dispatch or after the current query/fetch settles. A stream stops fetching further batches, but an in-flight server statement is not cancelled. |
| `sqliteDriver`                             | A stream stops between stepped rows. A synchronous statement already executing inside SQLite runs until that native step returns.                              |
| `mssqlDriver`                              | Currently advisory: repository code stops waiting only after the node-mssql request settles. Pair it with a server/request timeout.                            |
| Third-party MySQL driver                   | Active cancellation requires `KILL QUERY <connection-id>` over a second connection. zmdb bundles no MySQL driver.                                              |

## Where the signal comes from

`@zmdb/web`'s `Ctx` carries `params`, `body`, `query`, `headers`, `method`, `path` and optional `span` — still no signal, since the framework's own request type does not model one. The span is
explicit observability context, not cancellation. If you are behind `node:http`, `req.on('aborted')` is available at the adapter; if you are behind `fetch`, `request.signal` is. Either way it has to
be captured at the adapter and passed down explicitly.

## Application wiring and adapter limits

HTTP request cancellation remains explicit application wiring because `Ctx` and `WebRequest` do not carry a database signal. SQL Server and third-party drivers also remain advisory unless their
adapters connect the signal to a real server-side cancellation primitive.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Streaming](./streaming.html)
