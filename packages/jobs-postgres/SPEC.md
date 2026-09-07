# `@zmdb/jobs-postgres` — explicit PostgreSQL jobs provider

> Frozen by #654 for the first adapter, then superseded by issue #753's complete provider boundary. At the measured baseline the package adapts only the SQL-shaped `JobStore`; #756 moves all
> PostgreSQL jobs persistence into this package.

## 1. Package boundary

The root is the only export. The sole production dependency is `@zmdb/postgres: workspace:1.0.0-alpha.4`. Required peers are `@zmdb/jobs: 1.0.0-alpha.4` and `pg: ^8.23.0`; the jobs workspace
dependency is development-only at `workspace:^`. The package declares no optional dependency or optional peer.

It owns PostgreSQL implementations of the public `JobStore`, `LeaseStore`, `JobEnqueuer`, and `JobStoreResource` contracts. It also owns the PostgreSQL queue/marker/lease schema, SQL, transaction
boundaries, prepared-statement options, and cancellation. It does not own queue behavior, workers, retries, scheduling semantics, migrations execution, or a second state machine.

The exact root surface is:

```ts
export type PgJobClient = Pool | PoolClient | Client;
export type PgJobTransactionClient = PoolClient | Client;

export interface PgJobStoreOptions {
  readonly prepared?: boolean;
  readonly maxCacheSize?: number;
  readonly cancelVia?: PgJobClient;
  readonly signal?: AbortSignal;
  readonly operationTimeoutMs?: number;
}

export interface PgJobStore extends JobStore, LeaseStore, JobStoreResource {}

export function createPgJobStore(client: PgJobClient, options?: PgJobStoreOptions): PgJobStore;

export function pgJobEnqueuer(client: PgJobTransactionClient, options?: PgJobStoreOptions): JobEnqueuer;

export const jobsPostgresMigrations: readonly JobStoreMigration[];
```

`JobStoreMigration` is the structural `{ version, name, up, down }` record frozen in `packages/jobs/SPEC.md`.

## 2. Transactions and atomicity

`pgJobEnqueuer` accepts only a pinned `PoolClient` or `Client`. It rejects `Pool`, because two calls through a pool are not guaranteed to use the transaction connection. The adapter executes on the
supplied client and never begins, commits, rolls back, releases, or ends it. Queue insertion therefore commits or rolls back with the caller's transaction.

`createPgJobStore` accepts a `Pool`, `PoolClient`, or `Client`:

- with a `Pool`, a multi-statement atomic operation acquires one client, issues `BEGIN`, commits or rolls back, and releases only that internally acquired client;
- with a `PoolClient` or `Client`, a multi-statement atomic operation issues its own `BEGIN`, commits or rolls back on the supplied pinned connection, and never calls `release()` or `end()`; and
- prepared-statement caching and cancellation retain the public `@zmdb/postgres` behavior and options without importing private source.

Ordinary store calls use an owned transaction; transaction enqueuers do not. A caller must not invoke an ordinary store call on a `PoolClient` or `Client` that already has a caller-managed
transaction: the store does not join it or create a savepoint. Transactional application work uses `pgJobEnqueuer` instead. Claim is conditional on pending state and lease expiry. Settlement is
conditional on the current holder. A lost lease returns `false`; it never overwrites another worker's claim.

## 3. Migrations

The package exports PostgreSQL SQL for exactly:

|          Version | Name                  | Behavior                                                                              |
| ---------------: | --------------------- | ------------------------------------------------------------------------------------- |
| `20260906000100` | `jobs_queue`          | creates queue/completion tables, dedupe constraint, pending/lease/dead-letter indexes |
| `20260906000200` | `jobs_schedule_lease` | creates renewable schedule leases and expiry lookup                                   |

The bundle uses PostgreSQL types, partial indexes, and transactional DDL where appropriate, with reversible `down` SQL. Constructing or importing the provider never applies migrations. Applications
register `jobsPostgresMigrations` through their selected migration path before workers or cluster schedules start.

The SQLite and PostgreSQL bundles share logical versions and names so the state-machine schema is auditable across providers, but an application registers only the bundle for the target database.

## 4. Resource ownership and shutdown

The caller owns every supplied `Pool`, `PoolClient`, `Client`, and `cancelVia` resource. `PgJobStore.close()` is idempotent, clears only adapter-owned caches/state, and never calls `end()` or
`release()` on a supplied resource. A pool/client remains usable after adapter and application shutdown.

Internally acquired pool clients are always released on success, failure, cancellation, and shutdown. An operation timeout bounds the caller wait. Actual acquisition, SQL and cleanup remain tracked
until settled; the borrowed-connection serial slot remains occupied during late cleanup. No business SQL or COMMIT starts after abort, and a late acquired client is released without entering the body.

When the store is supplied to `jobsExtension({ stores: [...] })`, extension shutdown stops schedulers, then workers, then closes the adapter under the one remaining application deadline.

`operationTimeoutMs` defaults to 30,000 and must be a positive safe integer at most 2,147,483,647. One deadline covers queueing, acquisition, BEGIN, body, COMMIT and cleanup; it is never refreshed per
statement. Timeout rejects `DOMException` named `TimeoutError` with `@zmdb/jobs-postgres: operation deadline exceeded; database outcome may be incomplete`. A pre-aborted lifetime signal performs no
SQL or acquisition and preserves its reason. Later calls refuse an aborted lifetime signal.

`close(options?: { readonly graceMs: number })` stops admission and aborts active operations. It awaits actual cleanup for the lesser of its supplied nonnegative grace and the operation timeout.
Incomplete cleanup rejects `TimeoutError` with `@zmdb/jobs-postgres: shutdown deadline exceeded; cleanup incomplete`. Repeated valid close calls return the same promise; post-close ports reject
`Error` with `@zmdb/jobs-postgres: store is closed`. An invalid grace throws `RangeError` without starting shutdown.

With `cancelVia`, the public PostgreSQL driver cancels through an independent connection. Without it, the caller's wait is bounded but outstanding SQL can finish later; cleanup remains tracked. Failed
BEGIN triggers no rollback. Body or COMMIT failure after BEGIN triggers rollback, whose failure is retained in `AggregateError` after the primary error. Acquired-client release failures are retained
as well; an uncertain COMMIT is never retried. A transaction enqueuer leaves recovery to its caller.

Prepared statement identities and bounded cache state belong to the physical connection, so successive stores and enqueuers cannot reuse one name for different SQL. Smaller cache limits apply on hits
and misses. No private node-postgres protocol state is accessed.

## 5. Installation, refusals, and evidence

```sh
npm install zmdb@alpha @zmdb/jobs@alpha @zmdb/jobs-postgres@alpha pg@^8.23.0
```

The package must not:

- appear in the packed `@zmdb/jobs` or `zmdb` closure;
- depend on SQLite, `@zmdb/jobs-sqlite`, or another jobs provider;
- make `pg` optional, bundle it, or import it through an undeclared path;
- auto-migrate;
- release/end a caller-supplied client or pool; or
- accept `Pool` as a transaction enqueuer.

Packed evidence must cover the exact peer range, ordinary and transaction enqueue/rollback, disjoint concurrent claims, retry, dead-letter/replay, dedupe completion, scheduled leases,
prepared-statement bounds, cancellation, migrations, borrowed-resource survival, internally acquired client release, and bounded shutdown.
