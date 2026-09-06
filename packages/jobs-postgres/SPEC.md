# `@zmdb/jobs-postgres` — explicit PostgreSQL jobs provider

> Frozen by #654 for the first adapter, then superseded by issue #753's complete provider boundary. At the measured baseline the package adapts only the SQL-shaped `JobStore`; #756 moves all
> PostgreSQL jobs persistence into this package.

## 1. Package boundary

The root is the only export. Direct production dependencies are exactly `@zmdb/jobs` and `@zmdb/postgres` at `workspace:^`. The package has no `optionalDependencies` and declares exactly one required
peer, `pg@^8.23.0`.

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

Single-statement store calls rely on PostgreSQL statement atomicity. A caller must not invoke an ordinary store call on a `PoolClient` or `Client` that already has a caller-managed transaction: the
store does not join it or create a savepoint. Transactional application work uses `pgJobEnqueuer` instead. Claim is conditional on pending state and lease expiry. Settlement is conditional on the
current holder. A lost lease returns `false`; it never overwrites another worker's claim.

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

Internally acquired pool clients are always released on success, failure, cancellation, and shutdown. No query or borrowed client survives the bounded port call that acquired it.

When the store is supplied to `jobsExtension({ stores: [...] })`, extension shutdown stops schedulers, then workers, then closes the adapter under the one remaining application deadline.

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
