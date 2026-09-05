A driver is one method. That is the entire integration surface between zmdb and your database:

```ts
interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
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

zmdb never opens a connection, never pools, never retries and never parses a
connection string. It hands you text and parameters and expects rows back. An
observability wrapper may opt the compiler into the optional `telemetry` field;
a normal driver can ignore it because execution still uses only text and bound
parameters.

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

## Why the interface is this small

Every capability an ORM usually owns becomes something you can substitute without asking permission — and each of the following is a real page in these docs, implemented entirely in a driver wrapper:

| Concern                   | Where it lives                                           |
| ------------------------- | -------------------------------------------------------- |
| Pooling, TLS, DSN parsing | your client                                              |
| Query logging             | a wrapper — see [Logging](./logging.html)                |
| Read/write splitting      | [`withReplicas`](./read-replicas.html), itself a wrapper |
| Statement tagging         | [SQL comments](./sql-comments.html)                      |
| Cancellation              | [query cancellation](./query-cancellation.html)          |
| Retries                   | a wrapper — see [Cockroach](./dialect-cockroach.html)    |
| Type coercion             | this page, below                                         |

They compose, because each is `Driver → Driver`.

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
    async execute(query) {
      const start = performance.now();
      try {
        return await inner.execute(query);
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
  return { driver: { execute: q => (seen.push(q), inner.execute(q)) } satisfies Driver, seen };
}
```

See [Testing](./testing.html).

## Errors

Let them propagate. zmdb does not catch driver errors or translate them, so what your handler sees is your client's error object with its native code — `23505` on Postgres, `ER_DUP_ENTRY` on MySQL. That is deliberate: an ORM that wraps `UniqueViolation` in its own class loses the detail you need and gains a mapping table that is always incomplete. Translate at your HTTP boundary, where you know what the codes should become:

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
