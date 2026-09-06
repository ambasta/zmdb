# `@zmdb/jobs-sqlite` — explicit SQLite jobs provider

> **Target contract frozen by issue #753.** This is a roadmap-only package at commit `961aaae0b0c9b4e29fc864f41454707933154a0e`: the directory has no package manifest or runtime source until #756
> implements the split.

## 1. Package boundary

The package has one public entry, `@zmdb/jobs-sqlite`. Its direct production dependencies are exactly `@zmdb/jobs` and `@zmdb/sqlite` at `workspace:^`. It declares no `optionalDependencies`, external
runtime dependency, or peer dependency.

It owns SQLite implementations of the public `JobStore`, `LeaseStore`, `JobEnqueuer`, and `JobStoreResource` contracts. It also owns the SQLite queue/marker/lease schema and SQL. It does not own
workers, retries, handler validation, dead-letter policy, scheduler timing, lifecycle ordering, or a second jobs state machine.

The exact root surface is:

```ts
export interface SqliteJobStore extends JobStore, LeaseStore, JobStoreResource {}

export interface SqliteJobStoreOptions {
  readonly maxCacheSize?: number;
}

export function createSqliteJobStore(database: SqliteDatabase, options?: SqliteJobStoreOptions): SqliteJobStore;

export interface MemoryJobStore extends SqliteJobStore, Disposable {
  readonly database: DatabaseSync;
}

export function createMemoryJobStore(options?: SqliteJobStoreOptions): MemoryJobStore;

export function sqliteJobEnqueuer(database: SqliteDatabase): JobEnqueuer;

export const jobsSqliteMigrations: readonly JobStoreMigration[];
```

`JobStoreMigration` is the structural `{ version, name, up, down }` record frozen in `packages/jobs/SPEC.md`; the provider does not import a private migrations implementation.

## 2. Transactions and atomicity

`SqliteDatabase` is the public structural connection from `@zmdb/sqlite`. `sqliteJobEnqueuer(database)` executes against exactly that connection. If the caller has opened a transaction on the
connection, queue insertion and the caller's write commit or roll back together. The adapter never issues `BEGIN`, `COMMIT`, or `ROLLBACK` around `enqueueInTransaction`.

Each ordinary `JobStore` port call that needs more than one statement issues and owns one bounded `BEGIN`/`COMMIT` transaction, with `ROLLBACK` on failure. A single-statement call relies on SQLite's
statement atomicity. The caller must not invoke an ordinary store call while the borrowed database is already inside a caller-managed transaction: the provider does not join that transaction or create
a savepoint, and the nested `BEGIN` fails. Transactional application work uses `sqliteJobEnqueuer(database)` instead. Claim is conditional on pending state and expiry; settlement is conditional on the
current holder. A lost lease returns `false` instead of overwriting another worker's claim.

The provider stores timestamps in UTC ISO-8601 text, uses the current `zmdb_job` and `zmdb_job_done` logical columns, and adds `zmdb_job_lease` for scheduler coordination. The exact migrations are:

|          Version | Name                  | Behavior                                                                              |
| ---------------: | --------------------- | ------------------------------------------------------------------------------------- |
| `20260906000100` | `jobs_queue`          | creates queue/completion tables, dedupe constraint, pending/lease/dead-letter indexes |
| `20260906000200` | `jobs_schedule_lease` | creates renewable schedule leases and expiry lookup                                   |

`createSqliteJobStore` never applies them. Applications apply `jobsSqliteMigrations` through their selected migration path before starting workers or cluster schedules.

## 3. Resource ownership and shutdown

`createSqliteJobStore(database)` borrows the caller's connection. Its idempotent `close()` releases only provider-owned cache/state and never calls `database.close()`.

`createMemoryJobStore()` is the explicit convenience exception. It creates one private `node:sqlite` `DatabaseSync(':memory:')`, applies the two frozen migrations to that fresh database, and owns the
connection. Its idempotent `close()` and `[Symbol.dispose]()` close that database exactly once. It is intended for tests and local execution, not durable production storage.

When either store is supplied to `jobsExtension({ stores: [...] })`, extension shutdown stops schedulers, then workers, then closes the distinct stores under the one remaining application deadline. A
caller-owned SQLite connection remains usable after the adapter and application stop.

## 4. Refusals and evidence

The package must not:

- appear in the packed `@zmdb/jobs` or `zmdb` closure;
- depend on PostgreSQL, `pg`, repository/query-compiler directly, or another jobs provider;
- auto-migrate a caller-owned database;
- close a caller-owned connection;
- accept a repository transaction and inspect its dialect; or
- expose `@zmdb/jobs-sqlite/memory`, another provider subpath, or a compatibility implementation under `@zmdb/jobs/memory`.

Packed evidence must cover ordinary enqueue, transaction enqueue/rollback, disjoint claims, retry, dead-letter/replay, dedupe completion, scheduled lease renewal/loss, bounded shutdown, migrations,
borrowed-connection survival, and owned-memory close-once behavior.
