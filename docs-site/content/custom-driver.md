A driver has one required method. Streaming is an optional capability:

```ts
interface Driver {
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}

interface ExecuteOptions {
  readonly signal?: AbortSignal;
  /** Rows per client/server round trip. Drivers may clamp this value. */
  readonly batchSize?: number;
}

interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: {
    readonly system: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
    readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
    readonly collection: string;
  };
}
```

The options parameter and `stream` are both optional. A pre-existing
`execute(query)` implementation still satisfies the interface. The repository
checks `signal` before dispatch and again after `execute` settles; active
server-side cancellation requires driver cooperation.

The driver boundary never opens a connection, pools, retries a statement or
parses a connection string. It hands you text and parameters and expects rows
back. The transaction helper can re-run an entire callback only when the caller
opts into a dialect-classified retry policy. An observability wrapper may opt
the compiler into the optional `telemetry` field; a normal driver can ignore it
because execution still uses only text and bound parameters.

## The minimum

```ts
import { Pool } from 'pg';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

The spread on `query.parameters` is because it is `readonly unknown[]` and most clients want a mutable array.

## Streaming and cancellation

Implement `stream` only when the client can step or fetch rows without
materialising the complete result. The method returns a plain `AsyncIterable`;
the repository adds single-shot use and `AsyncDisposable`.

A correct cursor implementation has four responsibilities:

1. Acquire its connection lazily, when iteration starts.
2. Fetch at most `batchSize` rows per round trip and yield only as the consumer
   asks, so backpressure is real.
3. Close the cursor and release the connection in `finally`, including when the
   consumer breaks or throws.
4. Check `signal` between batches and connect abort to the client's real
   server-side cancellation primitive when one exists. Cancellation commonly
   needs a second connection; rejecting only the JavaScript promise leaves the
   database working.

```ts
stream(query, options) {
  const batchSize = options?.batchSize ?? 100;
  return {
    async *[Symbol.asyncIterator]() {
      const connection = await pool.connect();
      const cursor = await openClientCursor(connection, query); // client-specific
      try {
        for (;;) {
          options?.signal?.throwIfAborted();
          const rows = await cursor.read(batchSize);
          options?.signal?.throwIfAborted();
          if (rows.length === 0) return;
          yield* rows;
        }
      } finally {
        try {
          await cursor.close();
        } finally {
          connection.release();
        }
      }
    },
  };
}
```

If a driver omits `stream`, `repo.stream()` calls `execute` once and yields the
buffered array. That preserves compatibility but costs memory proportional to
the whole result. `requireCursor: true` refuses the fallback. Do not advertise a
`stream` method that secretly buffers; absence is the capability signal.

For ordinary `execute`, check `signal.throwIfAborted()` before dispatch, attach
the client's cancellation primitive while the query is active, remove that
listener in `finally`, and reject with the exact `signal.reason`. See
[Query Cancellation](./query-cancellation.html) and
[Streaming](./streaming.html).

## Why the interface is this small

Every capability an ORM usually owns becomes something you can substitute without asking permission — and each of the following is a real page in these docs, implemented entirely in a driver wrapper:

| Concern                   | Where it lives                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| Pooling, TLS, DSN parsing | your client                                                             |
| Query logging             | a wrapper — see [Logging](./logging.html)                               |
| Read/write splitting      | [`withReplicas`](./read-replicas.html), itself a wrapper                |
| Statement tagging         | [SQL comments](./sql-comments.html)                                     |
| Cancellation              | [query cancellation](./query-cancellation.html)                         |
| Transaction retries       | explicit transaction policy — see [Cockroach](./dialect-cockroach.html) |
| Type coercion             | this page, below                                                        |

The driver wrappers compose as `Driver → Driver`. Transaction retries are the
exception: only the transaction helper owns the whole callback that must be
replayed.

## Type coercion belongs here

The driver is the only layer that knows which client it wraps, and clients disagree about `bigint`, `numeric`, `boolean`, dates and JSON. Fix it once, per column, explicitly:

```ts
export const driver: Driver = {
  async execute(query) {
    const { rows } = await pool.query(query.text, [...query.parameters]);
    return rows.map(r => ({
      ...r,
      // node-postgres returns BIGINT and NUMERIC as strings to avoid precision loss
      total: r.total === null ? null : Number(r.total),
    }));
  },
};
```

Per-column rather than by type, because a blanket rule cannot tell a `numeric` you want as a float from one you must keep as a string. See [bigint keys](./bigint-keys.html).

## Statements that return nothing

`execute` must resolve to an array. For an `INSERT` without `RETURNING`, return `[]` — not `undefined`:

```ts
const isSelect = /^\s*(select|with)/i.test(query.text);
return isSelect ? result.rows : [];
```

`mysql2` needs this because it returns an `OkPacket` rather than rows for writes. See [MySQL](./dialect-mysql.html) for getting the insert id out.

## A logging wrapper

```ts
export function withLogging(inner: Driver, log = console): Driver {
  return {
    ...inner,
    async execute(query, options) {
      const start = performance.now();
      try {
        return await inner.execute(query, options);
      } finally {
        const ms = performance.now() - start;
        if (ms > 100) log.warn({ ms, sql: query.text }, 'slow query');
      }
    },
  };
}
```

Log `query.text`, never the interpolated form, and think before logging `parameters` — they are your users' data.

## A fake driver for tests

Because the interface is one method, a test double is one object:

```ts
export function fakeDriver(responses: Record<string, Record<string, unknown>[]>): Driver {
  return { execute: async q => responses[q.text] ?? [] };
}
```

Or record what was asked, which is how you assert on query counts:

```ts
export function recordingDriver(inner: Driver) {
  const seen: CompiledQuery[] = [];
  return {
    driver: {
      ...inner,
      execute: (q, options) => (seen.push(q), inner.execute(q, options)),
    } satisfies Driver,
    seen,
  };
}
```

See [Testing](./testing.html).

## Errors

Let them propagate. Outside an explicitly retrying transaction, zmdb does not
catch or translate driver errors, so what your handler sees is your client's
error object with its native code — `23505` on Postgres, `ER_DUP_ENTRY` on
MySQL. The transaction wrapper may inspect the direct `code` only when the
caller opts into a dialect-classified retry; it still rethrows the original
error when retries are disabled or exhausted. Translate at your HTTP boundary,
where you know what the codes should become:

```ts
try {
  return await repo.create(dto);
} catch (e) {
  if (isUniqueViolation(e)) throw new ValidationError('already exists', []);
  throw e;
}
```

That produces a 400, not a 409. A _thrown_ error still maps to 400 or 500 — to answer 409, catch it and return the response instead of throwing:

```ts
catch (error) {
  if (isUniqueViolation(error)) return json({ error: 'already exists' }, { status: 409 });
  throw error;
}
```

See [Request Lifecycle](./web-request-lifecycle.html).

## Transactions

`Driver` has no transaction method. `createTransactionalDb(conn)` takes a connection abstraction instead, because a transaction must run on one pinned connection while a pool-backed driver is free to use any. See [Transactions](./transactions.html).

---

See also: [Transactions](./transactions.html) · [Read Replicas](./read-replicas.html) · [Testing](./testing.html)
