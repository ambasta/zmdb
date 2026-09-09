An official database package binds its dialect, compiler traits, migration hooks, introspector and structural driver into one vertical. A `Driver` is its execution boundary: a required dialect object
and a method that runs a compiled query and returns rows, with optional streaming. Repositories, transactions, replicas, logging, caching and observability compose around that boundary.

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies ExecuteOptions; this excerpt does not repeat those declarations."}
import { type CompiledQuery, type SqlDialect } from '@zmdb/sql';

export interface Driver<Name extends string = string> {
  readonly dialect: SqlDialect<Name>;
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

`CompiledQuery` always has `text`, `parameters`, and `effects`. The compiler supplies the effects; raw queries declare them explicitly so replicas and drivers can route and execute without parsing
SQL. It may also have optional compile-time `telemetry` when an observing wrapper requests it. An ordinary driver hands the text and parameters to the client and returns rows; it does not parse SQL.
`Driver` lives in `@zmdb/orm`, not in the compiler.

## Six official database owners

| Database                                  | Owning package      | Driver              | Client selected by the application | Family direction                 |
| ----------------------------------------- | ------------------- | ------------------- | ---------------------------------- | -------------------------------- |
| [SQLite](./dialect-sqlite.html)           | `@zmdb/sqlite`      | `sqliteDriver`      | `node:sqlite`                      | independent                      |
| [PostgreSQL](./dialect-postgres.html)     | `@zmdb/postgres`    | `postgresDriver`    | `pg`                               | parent of CockroachDB            |
| [MySQL](./dialect-mysql.html)             | `@zmdb/mysql`       | `mysqlDriver`       | `mysql2/promise`                   | parent of SingleStore            |
| [SQL Server](./dialect-mssql.html)        | `@zmdb/mssql`       | `mssqlDriver`       | `mssql`                            | independent                      |
| [CockroachDB](./dialect-cockroach.html)   | `@zmdb/cockroach`   | `cockroachDriver`   | `pg`                               | depends on the PostgreSQL family |
| [SingleStore](./dialect-singlestore.html) | `@zmdb/singlestore` | `singlestoreDriver` | `mysql2/promise`                   | depends on the MySQL family      |

Each dialect guide follows the same install, configure, compile, migrate, introspect, execute, capability, refusal and evidence workflow. `@zmdb/core` includes SQLite; applications select another
provider and its client explicitly. The child packages own their differing schema, catalog and refusal rules. Neither parent imports or depends on its child.

## Configure the client

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies UserSchema; this excerpt does not repeat those declarations."}
// node:sqlite — no external dependency
import { DatabaseSync } from 'node:sqlite';
import { defineRepository } from '@zmdb/orm';
import { sqliteDriver } from '@zmdb/sqlite';

const db = new DatabaseSync('app.db');
const users = defineRepository(UserSchema, sqliteDriver(db));
```

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies UserSchema; this excerpt does not repeat those declarations."}
// mysql2 — selected by the application
import mysql2 from 'mysql2/promise';
import { mysqlDriver } from '@zmdb/mysql';
import { defineRepository } from '@zmdb/orm';

const pool = mysql2.createPool({
  uri: process.env.DATABASE_URL,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const users = defineRepository(UserSchema, mysqlDriver(pool));
```

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies UserSchema, defineRepository; this excerpt does not repeat those declarations."}
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

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies UserSchema, defineRepository; this excerpt does not repeat those declarations."}
// node-mssql — pass an already-connected pool
import sql from 'mssql';
import { mssqlDriver } from '@zmdb/mssql';

const pool = await sql.connect(process.env.DATABASE_URL!);
const users = defineRepository(UserSchema, mssqlDriver(pool));
```

The four base adapters accept **structural** types — `SqliteDatabase` is `{ exec(sql); prepare(sql) }`, `MysqlQueryable` is the `execute`/transaction subset of `mysql2/promise`, `PgQueryable` is
`{ query(…) }`, and `MssqlPool` is `{ request(); transaction() }` — so the real client objects are assignable without a client library becoming a runtime dependency of the adapter. `@zmdb/sqlite`
declares no third-party database client; `node:sqlite` is built in. `@zmdb/postgres`, `@zmdb/mysql` and `@zmdb/mssql` declare their clients only as optional peers. The CockroachDB and SingleStore
adapters reuse those structural client shapes while binding their own dialects. Install `mysql2`, `pg`, or `mssql` in the application that selects the corresponding adapter.

> [!NOTE] Every driver declares its dialect object. Driver wrappers must preserve the wrapped dialect. The repository uses that same frozen `SqlDialect` object for compilation, limits, retries and
> returning behavior.

The SQLite and Postgres drivers cache prepared statements keyed by SQL text, LRU-evicting at `maxCacheSize` (1000 by default). Since the compiler emits one text per query shape and parameterises the
values, that cache has a bounded number of entries — unless you build SQL by string concatenation, which you should not be doing.

The SQL Server adapter creates one request per execution and maps positional parameters onto node-mssql names `p1…pn`; the compiler emits the matching `@p1…@pn` placeholders. Pool lifecycle and client
configuration remain yours.

`sqliteDriver` exposes a native stepped stream. `postgresDriver` exposes a server-cursor stream when given a `Pool`, fetching `batchSize` rows per round trip and releasing the checked-out connection
on iterator cleanup. A bare Postgres `Client` and the SQL Server adapter omit `stream`, so repositories use their documented buffered fallback unless `requireCursor: true` refuses it.

## Qualification and provider recipes

An official vertical has a public immutable dialect/driver pair, explicit capability and refusal metadata, its own migration and catalog semantics, and an independent packed consumer. The
[six-database qualification](https://github.com/ambasta/zmdb/issues/676) installs real npm archives and checks public declarations, dependency/client ownership, parameterized CRUD, migrations,
transaction rollback and catalog introspection. Database-specific consumers cover the additional claimed semantics against their recorded servers. Missing required services fail qualification; a
structural or captured-query unit test alone is not live-server evidence.

Hosted PostgreSQL/MySQL services, HTTP database APIs and alternate SQLite bindings are connection recipes unless they have their own admitted package and qualification. A recipe can reuse a family
dialect where its behavior matches, but must state the limits of its adapter and cannot inherit a server's evidence merely by speaking a similar protocol.

## Writing your own

Supply a structural adapter when the selected provider API does not fit an official client adapter. Preserve the dialect and parameter array, and implement only the transaction, streaming and
cancellation behavior that the provider actually supports:

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies D1Database; this excerpt does not repeat those declarations."}
import { type Driver } from '@zmdb/orm';
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

Because a driver has one execution method plus its required dialect object, a wrapper is a driver. Wrappers must preserve `dialect` and forward the optional execute options so cancellation is not
lost:

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies cachingDriver, loggingDriver, primary, replicas, sink, store, withReplicas; this excerpt does not repeat those declarations."}
const driver = loggingDriver(cachingDriver(withReplicas({ primary, replicas }), store, 5_000), sink);
```

This is the extension point the framework leans on hardest. Logging, tracing, metrics, a query budget, replica routing and per-tenant connections are driver wrappers, so each one covers handlers,
workers and CLI scripts alike rather than just the HTTP path. Retrying a whole transaction is different: the transaction helper owns the callback and replays it only after explicit opt-in.
`tracedDriver` preserves the wrapped dialect, sets `queryTelemetry: true`, and accepts an explicit parent span such as `ctx.span`; there is no ambient current span. See [Logging](./web-logging.html),
[Read Replicas](./read-replicas.html), [Transactions](./transactions.html) and [Request Context](./web-request-context.html).

## With a repository

Either form works. `defineRepository` recovers the declared type from the schema, and its relations with it:

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies UserSchema, defineRepository, driver; this excerpt does not repeat those declarations."}
const users = defineRepository(UserSchema, driver);
```

The driver carries the required dialect object, so repository construction needs no separate database selector.

Or a subclass, when you want to add methods or [lifecycle hooks](./lifecycle-hooks.html):

```ts {"mode":"illustrative","id":"example-009","reason":"The surrounding example supplies User, UserSchema, driver; this excerpt does not repeat those declarations."}
import { BaseRepository } from '@zmdb/orm';

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

const users = new UserRepository(driver); // derives driver.dialect
```

Repository construction uses `driver.dialect`; there is no implicit database or string-name fallback.

## Transactions

A transaction is a driver bound to one connection. `withTransaction` re-binds a repository onto it, so every method on the returned repository runs inside the transaction:

```ts {"mode":"illustrative","id":"example-010","reason":"The surrounding example supplies CompiledQuery, accounts, driver, pool, users; this excerpt does not repeat those declarations."}
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const tx = {
    dialect: driver.dialect,
    execute: (q: CompiledQuery) => client.query(q.text, [...q.parameters]).then(r => r.rows),
  };
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

`@zmdb/orm/transactions` wraps this pattern — see [Transactions](./transactions.html).

> [!WARNING] `repo.update(id, { balance: dec(amount) })` emits `balance = balance - $1` through the repository's transaction-bound driver. A read-then-write is **not** equivalent: two concurrent
> transfers can both read 100, both write 90, and lose one debit. See [Increment & Decrement](./guide-increment-decrement.html).

## Connection strings

zmdb parses none — that is your client's job, and every client already does it. `new Pool({ connectionString })` and `createPool({ uri })` both accept a URL directly.

```ts {"mode":"illustrative","id":"example-011","reason":"The surrounding example supplies Pool; this excerpt does not repeat those declarations."}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
```

> [!WARNING] Read credentials from the environment or a secret manager, never from source. And never `ssl: { rejectUnauthorized: false }` — it disables certificate verification entirely, which turns
> TLS into obfuscation and makes a man-in-the-middle attack on your database traffic trivial. Supply the CA certificate instead.

Pool sizing, PgBouncer and serverless connection limits are on [Connect to Postgres](./connect-postgres.html).

## Testing without a database

A driver is a function, so a fake is three lines:

```ts {"mode":"illustrative","id":"example-012","reason":"The surrounding example supplies CompiledQuery, Driver, defineRepository, expect, users; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';

const calls: CompiledQuery[] = [];
const spy: Driver = { dialect: postgres, execute: async q => (calls.push(q), []) };

await defineRepository(users, spy).findAll();
expect(calls[0]?.text).toContain('SELECT');
```

Asserting on the compiled SQL is the fastest test in the suite and catches the mistakes that matter — a missing `WHERE`, a wrong join, an unparameterised value. For end-to-end coverage, `node:sqlite`
gives you a real database with no server; see [Testing](./testing.html).

---

See also: [Custom Driver](./custom-driver.html) · [Read Replicas](./read-replicas.html) · [Transactions](./transactions.html)

Continue with [migrations](./migrations.html), then use the selected driver in the [blog API tutorial](./tutorial-blog-api.html). [Package reference](./package-reference.html) owns provider
installation and support evidence.
