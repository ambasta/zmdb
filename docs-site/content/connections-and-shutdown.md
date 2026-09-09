zmdb never opens a connection and never closes one. Every driver takes a client you constructed — `postgresDriver(pool)`, `mysqlDriver(pool)`, `sqliteDriver(db)` — and keeps a plain reference to it.
There is no `driver.close()`, no `driver.end()`, and no pool inside zmdb to configure.

That is deliberate. Your pool is usually shared with a migration runner, a job store and a health check, and a library that closed it out from under you would break all three. The cost is that two
things are yours: the sizing, and the order in which things stop.

## Who closes what

| Resource                                             | Created by | Closed by                                                  |
| ---------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| `pg` `Pool`, `mysql2` pool                           | you        | you, with `pool.end()`                                     |
| `node:sqlite` `DatabaseSync`                         | you        | you, with `db.close()`                                     |
| The `cancelVia` queryable                            | you        | you, **after** the pool whose queries it cancels           |
| A connection checked out for a transaction or cursor | the driver | the driver, in a `finally` — including on error or `break` |

`@zmdb/app` does not close it either. The lifecycle calls `onShutdown()` on instances that have the method, and a `Pool` does not have one: register a pool directly as a value provider and **nothing
will ever close it**, so the process hangs at exit holding an open socket. Give the pool an owner instead.

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies env; this excerpt does not repeat that declaration."}
import { createToken } from '@zmdb/app/di';
import type { OnShutdown } from '@zmdb/app/lifecycle';
import { Module } from '@zmdb/app/modules';
import { postgresDriver } from '@zmdb/postgres';
import { Pool } from 'pg';

export class Database implements OnShutdown {
  readonly pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  readonly driver = postgresDriver(this.pool);

  async onShutdown(): Promise<void> {
    await this.pool.end();
  }
}

export const DATABASE = createToken<Database>('DATABASE');

@Module({ providers: [{ token: DATABASE, useFactory: () => new Database() }] })
export class DatabaseModule {}
```

Everything that needs the driver injects `DATABASE` and reads `database.driver`. One owner, one `end()` call. Because the owner is constructed before anything that resolves it,
reverse-construction-order teardown closes the pool last on its own — you do not order it by hand.

The rule that follows: **do not call `end()` from a component that did not create the pool.** A controller that ends the pool in its own `onShutdown` runs before the providers it injected, so the next
hook down the list gets a closed pool. The `pool.end()` shown on [Standalone Applications](./web-standalone.html) is that same call in a single-component script, where the component _is_ the owner.

[Read replicas](./read-replicas.html) are one pool per driver: `withReplicas` wraps drivers, so each of them has a client you must close. End them from one owner with `Promise.allSettled`, so a
primary that fails to close does not skip the replicas.

## What holds a connection, and for how long

| Operation                                     | Connections held                                                                    | Released                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `execute` on a pool                           | one, for the statement                                                              | by your pool, when the query settles                 |
| `execute` on a pool with `prepared: true`     | one, checked out explicitly, so the server-side statement name stays on one backend | after that one `execute`                             |
| `transaction(fn)`                             | exactly one, for the whole callback, `BEGIN` to `COMMIT`/`ROLLBACK`                 | in a `finally`, after the callback settles           |
| `stream(query)` on a pool                     | one, for the whole iteration, in its own transaction — a cursor needs one           | in a `finally`, after `CLOSE`, including on `break`  |
| `execute(query, { signal })` with `cancelVia` | one, plus one on the cancelling queryable                                           | the cancel statement is fire-and-forget on that pool |

Sizing follows from the middle rows:

```text
max ≥ peak concurrent transactions + peak concurrent streams + 1
```

A transaction that cannot get a client waits, and it waits behind transactions that are themselves holding clients. Undersizing a pool does not make an application slower; past the point where every
client is inside a transaction, it stops. Then apply the deployment arithmetic — `max × instances ≤ max_connections − headroom`, from [Deployment](./deployment.html).

`cancelVia` must be a **separate** queryable, because `pg_cancel_backend()` has to run on a connection other than the one it interrupts. A second pool with `max: 1` is enough. See
[Query Cancellation](./query-cancellation.html).

MySQL is the same contract with a smaller surface: `mysqlDriver` checks a connection out per transaction and releases it, and it has neither cursor streaming nor cancellation, so the sizing rule is
peak concurrent transactions plus headroom. SQLite has no pool at all — `node:sqlite` is one synchronous connection, and the owner calls `db.close()` where the examples above call `pool.end()`.

## The shutdown order

1. **Stop accepting new work.** `server.close()`, stop broker consumers. First for a reason that is not politeness — see below.
2. **`await app[Symbol.asyncDispose]()`.** Extensions stop first, in reverse start order, sharing one `graceMs` budget (default 5,000 ms, set with `createApp(AppModule, { graceMs })`). `jobsExtension`
   stops schedulers, then workers, then job stores, so nothing can enqueue work after drain begins.
3. **`onShutdown()` on every constructed provider and controller, in reverse construction order.** A dependent stops before the thing it depends on. Errors do not abort the sequence: every remaining
   hook still runs, and dispose rejects at the end with an `AggregateError`.
4. **The pool closes last**, inside step 3, because its owner was constructed first.
5. **Exit.**

Only step 2 has a budget. `graceMs` is handed to each extension's `stop` — the remaining share of it, so the extensions cannot each spend the whole thing — and `jobsExtension` enforces it as a
deadline per participant. An `onShutdown` hook receives nothing and is not bounded, so a `pool.end()` that never resolves hangs the process indefinitely. Keep a hard-exit timer.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies app, server; this excerpt does not repeat those declarations."}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    const hard = setTimeout(() => process.exit(1), 15_000).unref();
    server.close(() => {
      void app[Symbol.asyncDispose]().then(
        () => {
          clearTimeout(hard);
          process.exit(0);
        },
        error => {
          console.error(error);
          process.exit(1);
        },
      );
    });
  });
}
```

## `pool.end()` is not a cancel

This is the part that produces hung deploys. It is `node-postgres` behaviour rather than zmdb's, and it is worth stating exactly, because the two cases look identical from the call site:

- A query **already sent to the server** finishes normally, and `end()` resolves after it. Measured against pg 8.23: a 400 ms `pg_sleep` returned its row, and `end()` resolved 2 ms later.
- A query **still waiting for a free client** when `end()` is called never settles at all. The pending queue is dropped, `end()` resolves immediately, and whoever awaited that query waits forever.

So a request that arrives during shutdown and loses the race for a connection is not rejected — it goes silent, and it takes its handler with it. Both mitigations are already in the list above: stop
accepting work before you dispose, and put a hard timer around the whole sequence.

In serverless, none of this applies per invocation: do not end a pool you intend the next invocation to reuse. See [Serverless Performance](./perf-serverless.html).

## Checklist

- One owner per pool, and it is the only thing that calls `end()`.
- `max ≥ peak transactions + peak streams + 1`, then `max × instances ≤ max_connections − headroom`.
- `cancelVia` is a separate pool, closed after the pool it cancels for.
- Traffic and broker consumers stop before `app[Symbol.asyncDispose]()`.
- A hard-exit timer bounds the whole sequence.
- A test starts a query and disposes while it is in flight. This page is only true where it is tested.

---

See also: [Deployment](./deployment.html) · [Transactions](./transactions.html) · [Streaming Results](./streaming.html) · [Standalone Applications](./web-standalone.html) ·
[Serverless Performance](./perf-serverless.html)
