# SPEC — First-party driver adapters (frozen)

## Issue #635 ownership exit

`Driver`, `ExecuteOptions`, and `TransactionalDriver` remain structural contracts in `@zmdb/orm`. Concrete adapters move to `@zmdb/sqlite`, `@zmdb/postgres`, and `@zmdb/mssql`. Their client peers and
acceptance fixtures move with them. ORM does not import, probe, register, or re-export a concrete adapter.

Epic #209. Ships official `Driver` implementations so users don't hand-write one. The `Driver` interface itself is `../../SPEC.md` §1 — one required method, `execute`, plus an optional `dialect` and
an optional `stream` (§1a there). Adapters are thin, dependency-injected wrappers — the repository still never opens connections itself.

## API

```ts
interface TransactionalDriver extends Driver {
  transaction<T>(run: (driver: Driver) => Promise<T>): Promise<T>;
}

// node:sqlite (built-in, zero external deps)
import { DatabaseSync } from 'node:sqlite';
interface SqliteOptions {
  maxCacheSize?: number;
}
function sqliteDriver(db: DatabaseSync, opts?: SqliteOptions): TransactionalDriver;

// pg (node-postgres) — pass a Pool or Client
import type { Pool, Client } from 'pg';
interface PgOptions {
  prepared?: boolean;
  maxCacheSize?: number;
  cancelVia?: PgQueryable;
} // opt-in server-side prepared stmts
function pgDriver(client: Pool | Client, opts?: PgOptions): TransactionalDriver;

// mssql — pass an already-connected node-mssql pool
interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest;
  query(text: string): Promise<{ recordset?: readonly Record<string, unknown>[] }>;
}
interface MssqlTransaction {
  begin(): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  request(): MssqlRequest;
}
interface MssqlPool {
  request(): MssqlRequest;
  transaction(): MssqlTransaction;
}
function mssqlDriver(pool: MssqlPool): TransactionalDriver;
```

## Frozen behaviour

### sqliteDriver (#212)

- `execute(q)`: Reuses cached compiled `db.prepare(q.text)` statement handles and cached read/write classification flags in memory, spreading positional `?` params.
- Internal statement handle and classification cache is LRU-bounded (default 1000 entries). When an entry is evicted, the `StatementSync` handle reference is dropped for garbage collection to free
  native memory.
- If the SQL is a read (`^\s*SELECT`) or has `RETURNING`, return `stmt.all(...params)` as rows; otherwise `stmt.run(...params)` and return `[]`.
- Synchronous under the hood, wrapped in a resolved Promise.
- Binds a `Date` as ISO-8601 UTC text, because `node:sqlite` throws on one and the DDL emitter declares the column `TEXT`. That spelling keeps lexicographic order chronological, so `ORDER BY` and
  `BETWEEN` mean what they say. A `bigint` is bound as itself — `node:sqlite` takes one for an `INTEGER` column.

### All adapters

- The app→db conversion belongs to the driver, which is the only layer that knows what its client binds. `pg` needs none: it binds a `Date` as a timestamp itself and stringifies a `bigint`.
- The db→app direction is the repository's, in one place for every driver (`decodeDbValue`), because it reads the form that arrived rather than the dialect that produced it. See `../../SPEC.md` §3a.
- All three return a `TransactionalDriver` for the migration runner. SQLite issues `BEGIN` / `COMMIT` / `ROLLBACK` on its database handle. Postgres pins the callback to one client; when given a pool
  it checks that client out and releases it in `finally`. SQL Server creates one node-mssql `Transaction` and every callback request comes from that transaction until commit or rollback.

### pgDriver (#213)

- `execute(q)`: `client.query(q.text, q.parameters)` → return `result.rows`.
- With `opts.prepared === true`, use a stable statement `name` derived from the SQL text so Postgres caches the plan (server-side prepared statement). Kept opt-in to preserve the zero-state default
  (see the benchmarks tail trade-off).
- Internal statement name cache is LRU-bounded (default 1000 entries); evicting a statement issues `DEALLOCATE <name>` to clean up server-side state.
- Ordinary `execute` never manages connection lifecycle. `transaction` is the explicit exception: a pool client is acquired for the callback and released afterwards so `BEGIN`, the work, and `COMMIT`
  or `ROLLBACK` cannot hop connections.

### mssqlDriver (#508)

- `execute(q)`: creates one request, binds the positional parameter array as `p1…pn` through `request.input(name, value)`, then calls `request.query(q.text)`.
- Returns `result.recordset`, or `[]` when node-mssql reports no recordset.
- The compiler emits `@p1…@pn`; node-mssql's `input()` receives the same names without the leading `@`.
- `transaction(run)` begins one node-mssql transaction, creates every callback request from it, commits on success and rolls back on failure. Root-pool requests are never used inside the callback.
- The adapter is structural and imports no node-mssql runtime. The application owns pool construction, connection, configuration and shutdown.

### Streaming and cancellation, per adapter (frozen — epic "Streaming reads and query cancellation")

The contract is `../../SPEC.md` §1a. What the two bundled adapters do under it:

```ts
interface SqliteOptions {
  maxCacheSize?: number;
} // unchanged
interface PgOptions {
  prepared?: boolean;
  maxCacheSize?: number;
  cancelVia?: PgQueryable;
}

export interface PgQueryable {
  query(/* … as today … */): Promise<{ rows: Record<string, unknown>[] }>;
  /** Optional. Without it, pgDriver ships no `stream`. */
  connect?(): Promise<PgConnection>;
}
interface PgConnection extends PgQueryable {
  release?(): void;
}
```

**`sqliteDriver` streams for real.** `StatementSync.prototype.iterate()` exists on the supported Node, so `stream` steps the statement and checks `opts.signal` between rows. `batchSize` is ignored —
there is no round trip to batch. The cache stays as it is, with one addition: a statement being iterated is not evictable, because dropping the handle mid-walk would free native memory the iterator is
standing on. Cancellation is only ever between rows; `node:sqlite` exposes no `sqlite3_interrupt`, so a slow single statement runs to completion.

**`pgDriver` streams only when it can check out a connection.** With no `connect` on the queryable, the returned object has **no `stream` property at all**, so the repository buffers by its normal
capability check instead of taking a cursor path that would throw.

With one: check out, read `pg_backend_pid()`, `BEGIN`, `DECLARE … CURSOR FOR <query.text>` with the parameters, `FETCH FORWARD <batchSize>` per round trip, then `CLOSE`, `COMMIT` and release on
cleanup — in a `finally`, so an abandoned iterator that does get closed cannot leave the connection in a transaction.

`cancelVia` is a separate queryable used for nothing but `SELECT pg_cancel_backend($1)`. It is explicit because the connection running the query cannot cancel it — the cancel would queue behind it —
and a `Pool` and a `Client` are indistinguishable through `PgQueryable`. Omitted, abort still stops the next `FETCH`, which bounds the work to one batch.

Prepared statements and cursors do not combine: `prepared: true` names a statement for plan reuse, and the cursor path issues `DECLARE`/`FETCH` utility statements instead. `stream` ignores `prepared`
rather than half-applying it.

## Packaging

- Exposed as `@zmdb/repository/drivers/sqlite`, `@zmdb/repository/drivers/pg` and `@zmdb/repository/drivers/mssql`.
- `pg` is an **optional peer/dev** dependency of the repo (the sqlite driver has zero external deps); importing the pg driver without `pg` installed fails clearly, not silently.
- `mssql` is a development dependency for the real E2E suite, not a published runtime dependency. Consumers install their chosen compatible node-mssql package and pass its connected pool to the
  structural adapter.

## Acceptance

- sqlite driver: E2E against an in-memory `node:sqlite` DB — create/find/list/ update/delete round-trips, native iterator streaming, abort between stepped rows, active-statement cache safety and a
  real rollback (always runs, no external service).
- pg driver: unit test with a fake `query` recorder asserts it calls `query(text, params)` and returns `.rows`; prepared mode passes a stable `name`; pool and transaction cursors prove command order
  and cleanup. Live-PG E2E proves parameterised `DECLARE`, repeated early-return pool safety and `pg_cancel_backend` cancellation when reachable.
- mssql driver: unit tests record the `p1…pn` bindings, recordset return and transaction-owned requests. A real suite runs DDL, CRUD and transactional rollback through SQL Server when `ZMDB_MSSQL_URL`
  is reachable, and emits a visible `[skip] SQL Server E2E: …` reason otherwise.

## Database vertical target (issue #666)

The sections above describe the current repository-owned adapters. Epic #665 moves each adapter into the package that owns the complete database vertical. This section supersedes the optional string
`Driver.dialect` contract for that target; it makes no runtime change in #666.

### Generic repository protocol

`@zmdb/repository` owns only these vendor-neutral interfaces:

```ts
export interface Driver<Name extends string = string> {
  readonly dialect: SqlDialect<Name>;
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery, options?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, options?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}

export interface TransactionalDriver<Name extends string = string> extends Driver<Name> {
  transaction<Result>(run: (driver: Driver<Name>) => Promise<Result>): Promise<Result>;
}

export interface DatabaseVertical<Name extends string, Connection, Options = undefined> {
  readonly dialect: SqlDialect<Name>;
  driver(connection: Connection, options?: Options): TransactionalDriver<Name>;
}
```

Every first-party package root exports one `DatabaseVertical` object, its dialect by identity, its named driver function and its named introspector:

```ts
export const sqlite: SqlDialect<'sqlite'>;
export const sqliteDriver: (database: SqliteDatabase, options?: SqliteOptions) => TransactionalDriver<'sqlite'>;
export const sqliteIntrospector: Introspector<'sqlite'>;
export const sqliteVertical: DatabaseVertical<'sqlite', SqliteDatabase, SqliteOptions>;

sqliteVertical.dialect === sqlite;
sqliteVertical.driver === sqliteDriver;
sqlite.introspector === sqliteIntrospector;
```

The other packages use the same naming pattern: `postgres` / `postgresDriver` / `postgresIntrospector` / `postgresVertical`, and correspondingly for MySQL, MSSQL, Cockroach and SingleStore. The short
package-named value is the normal compiler/config import; the `*Vertical` value proves the complete package contract and supports advanced composition.

A repository constructor receives a `Driver<Name>` and no separate dialect argument. It constructs its compiler from `driver.dialect`, reads limits/retries/returning support from that same frozen
object, and preserves the object by identity across `withTransaction`, replicas, streams, loaders and caches. A transactional callback driver cannot change the dialect.

### Adapter ownership and dependencies

| Current implementation                | Target owner                                                 | Client policy                                                                         |
| ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `sqlite.ts`                           | `@zmdb/sqlite` Node-specific export                          | `node:sqlite`; no third-party dependency                                              |
| `pg.ts`                               | `@zmdb/postgres`                                             | structural `pg` client; `pg` optional peer and development dependency                 |
| missing MySQL adapter                 | `@zmdb/mysql`                                                | structural `mysql2/promise` client; `mysql2` optional peer and development dependency |
| `mssql.ts`                            | `@zmdb/mssql`                                                | structural node-mssql pool; `mssql` optional peer and development dependency          |
| PostgreSQL adapter bound to Cockroach | `@zmdb/cockroach` through a public PostgreSQL-family factory | no copied adapter and no private parent import                                        |
| MySQL adapter bound to SingleStore    | `@zmdb/singlestore` through a public MySQL-family factory    | no copied adapter and no private parent import                                        |
| `transactional.ts` interface          | `@zmdb/repository`                                           | no client                                                                             |

No generic manifest may depend on `pg`, `mysql2`, `mssql` or another database client. A package root must also remain importable without resolving its optional client: the application constructs a
compatible connection and passes it to `driver`. SQLite's package root remains browser-safe; its `node:sqlite` adapter is a Node-specific public subpath.

Parent family packages expose only the narrow frozen primitives a child needs to bind the parent's structural adapter and catalog implementation to the child's `SqlDialect`. Those primitives accept
the child object explicitly and return a driver that reports that child object. Parents never import children.

### Streaming, cancellation and result semantics

`DatabaseCapabilities.streaming` and `.cancellation` report functionality the official adapter can supply under its documented connection/options contract. Method presence remains the runtime fact: a
configured adapter may omit `stream` when its supplied client cannot check out a cursor connection.

- PostgreSQL and Cockroach claim streaming and cancellation only with the already-specified checked-out and second-connection prerequisites.
- SQLite claims streaming and refuses in-flight engine cancellation; abort remains observable between rows.
- MySQL, SQL Server and SingleStore initially set both capabilities false. Their verticals may still execute buffered reads and honor already-aborted signals. A later claim requires a spec, driver
  lifecycle tests and real-server evidence.

MySQL's official adapter must not invent returned entities where the dialect refuses `RETURNING`. Driver result metadata such as affected rows or insert identifiers needs a separate explicit result
surface; it is not converted into a row array that looks like compiled `RETURNING`.

### Qualification

An official adapter is not qualified by recorder tests alone. Its package lane runs the public driver against the named server and proves:

- parameter binding and result decoding;
- a pinned transaction and real rollback;
- every claimed stream/cancel behavior and cleanup path;
- migration and introspection through the same driver;
- no undeclared client in the packed dependency tree; and
- a packed external consumer using public exports only.

SQLite runs in-process and cannot skip. The other five required release lanes fail when their service or credentials are missing. Optional local invocations may report a visible skip but are not
support evidence.
