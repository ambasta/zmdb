A `Driver` is the whole database abstraction: one required method that runs a compiled query and returns rows, plus optional streaming and capability metadata. Everything above it — repositories,
transactions, replicas, logging, caching and observability — composes around that boundary.

```ts
import type { CompiledQuery, Dialect, SqlDialect } from '@zmdb/query-compiler';

export interface Driver<Name extends string = string> {
  readonly dialect?: SqlDialect<Name> | Dialect;
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

`CompiledQuery` always has `text` and `parameters`. It may also have optional compile-time `telemetry` when an observing wrapper requests it. An ordinary driver hands the text and parameters to the
client and returns rows; it does not parse SQL. `Driver` lives in `@zmdb/repository`, not in the compiler.

## First-party drivers

```ts
// node:sqlite — no external dependency
import { DatabaseSync } from 'node:sqlite';
import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';

const db = new DatabaseSync('app.db');
const users = defineRepository(UserSchema, sqliteDriver(db));
```

```ts
// mysql2 — selected by the application
import mysql2 from 'mysql2/promise';
import { mysqlDriver } from '@zmdb/mysql';
import { defineRepository } from '@zmdb/repository';

const pool = mysql2.createPool({
  uri: process.env.DATABASE_URL,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const users = defineRepository(UserSchema, mysqlDriver(pool));
```

```ts
// pg (node-postgres)
import { Pool } from 'pg';
import { postgresDriver } from '@zmdb/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const users = defineRepository(UserSchema, postgresDriver(pool));

// opt-in server-side prepared statements (caches the plan per SQL text)
const fast = postgresDriver(pool, { prepared: true });

// active AbortSignal cancellation; the pool must have a spare connection
const cancellable = postgresDriver(pool, { cancelVia: pool });
```

```ts
// node-mssql — pass an already-connected pool
import sql from 'mssql';
import { mssqlDriver } from '@zmdb/repository/drivers/mssql';

const pool = await sql.connect(process.env.DATABASE_URL!);
const users = defineRepository(UserSchema, mssqlDriver(pool));
```

All four accept **structural** types — `SqliteDatabase` is `{ exec(sql); prepare(sql) }`, `MysqlQueryable` is the `execute`/transaction subset of `mysql2/promise`, `PgQueryable` is `{ query(…) }`, and
`MssqlPool` is `{ request() }` — so the real client objects are assignable without a client library becoming a runtime dependency of the adapter. `@zmdb/sqlite` declares no third-party database
client; `node:sqlite` is built in. `@zmdb/mysql` declares `mysql2` only as an optional peer. Install `mysql2`, `pg`, or `mssql` in the application that selects the corresponding adapter.

> [!NOTE] First-party drivers declare their dialect object. `defineRepository` uses an explicit option first, then `driver.dialect`, then the temporary `'postgres'` fallback. Driver wrappers must
> preserve the wrapped dialect. A third-party driver can attach a frozen `SqlDialect` object, and the repository uses that same object for compilation, limits, retries and returning behavior.

The SQLite and Postgres drivers cache prepared statements keyed by SQL text, LRU-evicting at `maxCacheSize` (1000 by default). Since the compiler emits one text per query shape and parameterises the
values, that cache has a bounded number of entries — unless you build SQL by string concatenation, which you should not be doing.

The SQL Server adapter creates one request per execution and maps positional parameters onto node-mssql names `p1…pn`; the compiler emits the matching `@p1…@pn` placeholders. Pool lifecycle and client
configuration remain yours.

`sqliteDriver` exposes a native stepped stream. `postgresDriver` exposes a server-cursor stream when given a `Pool`, fetching `batchSize` rows per round trip and releasing the checked-out connection
on iterator cleanup. A bare Postgres `Client` and the SQL Server adapter omit `stream`, so repositories use their documented buffered fallback unless `requireCursor: true` refuses it.

## Writing your own

Any database with a client that takes SQL plus parameters:

```ts
import type { Driver } from '@zmdb/repository';
import { sqlite } from '@zmdb/sqlite';

export function d1Driver(db: D1Database): Driver {
  return {
    dialect: sqlite,
    async execute(query) {
      const { results } = await db
        .prepare(query.text)
        .bind(...query.parameters)
        .all();
      return results;
    },
  };
}
```

Three rules for a correct driver:

- **Return rows, always.** An `INSERT` without `RETURNING` yields none — return `[]`, not `undefined`. Every read path in the repository funnels through one row-shape boundary that expects an array.
- **Never touch `query.text`.** Rewriting SQL in a driver breaks the dialect contract, and appending anything to it defeats the parameterisation that makes the compiler injection-proof.
- **Let errors through.** The repository does not translate driver errors, by design: your client's native code (`23505`, `ER_DUP_ENTRY`) carries more information than any wrapper class. Translate at
  the boundary where you know what the code should become — see [Custom Driver](./custom-driver.html).

## Composing drivers

Because a driver has one required method, a wrapper is a driver. Wrappers must forward the optional execute options so cancellation is not lost:

```ts
const driver = loggingDriver(cachingDriver(withReplicas({ primary, replicas }), store, 5_000), sink);
```

This is the extension point the framework leans on hardest. Logging, tracing, metrics, a query budget, replica routing and per-tenant connections are driver wrappers, so each one covers handlers,
workers and CLI scripts alike rather than just the HTTP path. Retrying a whole transaction is different: the transaction helper owns the callback and replays it only after explicit opt-in.
`tracedDriver` preserves the wrapped dialect, sets `queryTelemetry: true`, and accepts an explicit parent span such as `ctx.span`; there is no ambient current span. See [Logging](./web-logging.html),
[Read Replicas](./read-replicas.html), [Transactions](./transactions.html) and [Request Context](./web-request-context.html).

## With a repository

Either form works. `defineRepository` recovers the declared type from the schema, and its relations with it:

```ts
const users = defineRepository(UserSchema, driver, { dialect: 'postgres' });
```

When `driver.dialect` is present, the explicit option is unnecessary:

```ts
const users = defineRepository(UserSchema, driver);
```

Or a subclass, when you want to add methods or [lifecycle hooks](./lifecycle-hooks.html):

```ts
import { BaseRepository } from '@zmdb/repository';

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

const users = new UserRepository(driver); // derives driver.dialect
```

The compatibility constructor is `(driver: Driver, dialect: DialectTarget = driver.dialect ?? 'postgres')`. Database-package extraction will make the object on `driver.dialect` required and remove the
separate argument.

## Transactions

A transaction is a driver bound to one connection. `withTransaction` re-binds a repository onto it, so every method on the returned repository runs inside the transaction:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const tx = { execute: (q: CompiledQuery) => client.query(q.text, [...q.parameters]).then(r => r.rows) };
  const txUsers = users.withTransaction(tx);
  const txAccounts = accounts.withTransaction(tx);

  await txUsers.create({ email: 'ada@example.com' });
  await txAccounts.update(1, { status: 'active' });

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

Two things to be careful about:

- **Check out one client and use it for everything.** A `Pool` hands a different connection to each `query`, so `BEGIN` on one connection and an `INSERT` on another means the insert is not in the
  transaction and the rollback does nothing. `withTransaction` exists to make that mistake structural rather than silent.
- **`ROLLBACK` can throw too** (a dead connection), which would mask the original error. Log it and rethrow the original.

`@zmdb/repository/transactions` wraps this pattern — see [Transactions](./transactions.html).

> [!WARNING] `repo.update(id, { balance: dec(amount) })` emits `balance = balance - $1` through the repository's transaction-bound driver. A read-then-write is **not** equivalent: two concurrent
> transfers can both read 100, both write 90, and lose one debit. See [Increment & Decrement](./guide-increment-decrement.html).

## Connection strings

zmdb parses none — that is your client's job, and every client already does it. `new Pool({ connectionString })` and `createPool({ uri })` both accept a URL directly.

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
```

> [!WARNING] Read credentials from the environment or a secret manager, never from source. And never `ssl: { rejectUnauthorized: false }` — it disables certificate verification entirely, which turns
> TLS into obfuscation and makes a man-in-the-middle attack on your database traffic trivial. Supply the CA certificate instead.

Pool sizing, PgBouncer and serverless connection limits are on [Connect to Postgres](./connect-postgres.html).

## Testing without a database

A driver is a function, so a fake is three lines:

```ts
const calls: CompiledQuery[] = [];
const spy: Driver = { dialect: 'postgres', execute: async q => (calls.push(q), []) };

await defineRepository(users, spy).findAll();
expect(calls[0]?.text).toContain('SELECT');
```

Asserting on the compiled SQL is the fastest test in the suite and catches the mistakes that matter — a missing `WHERE`, a wrong join, an unparameterised value. For end-to-end coverage, `node:sqlite`
gives you a real database with no server; see [Testing](./testing.html).

---

See also: [Custom Driver](./custom-driver.html) · [Read Replicas](./read-replicas.html) · [Transactions](./transactions.html)
