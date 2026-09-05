# `@zmdb/jobs` — queues, workers and scheduling SPEC

> **Target contract — issue #645.** This specification freezes the jobs package before source or manifests move. The measured `@zmdb/web` baseline contains 34 distinct public jobs symbols: 19
> queue/worker symbols, 13 scheduling symbols and 2 SQLite-memory-store symbols.

## 1. Ownership

`@zmdb/jobs` owns:

- typed enqueueing, workers, retries, dead-letter inspection and replay;
- job leases, cancellation, bounded drain and worker lifecycle;
- cron and interval declarations, scheduler execution and cluster leases;
- the process-local SQLite `:memory:` backend built on `node:sqlite`.

It does not own HTTP, application DI/modules, PostgreSQL, another database client, broker transports, OpenTelemetry, reflection or code generation.

## 2. Package and dependency contract

The package publishes:

```text
@zmdb/jobs
@zmdb/jobs/memory
@zmdb/jobs/schedule
```

Its direct runtime dependencies are exactly:

```text
@zmdb/app
@zmdb/query-compiler
@zmdb/repository
```

All are workspace dependencies. `@zmdb/jobs` declares no third-party `dependencies`, `optionalDependencies` or `peerDependencies`. The built-in backend uses `node:sqlite`; the PostgreSQL adapter and
its `pg` peer belong only to `@zmdb/jobs-postgres`.

The permitted edge is `jobs -> app`, never `app -> jobs`. Jobs may implement app lifecycle interfaces structurally, but app must remain usable without importing this package.

## 3. Public surface

The package root owns the queue and worker surface:

```text
AnyJobHandler Backoff Clock createQueue createWorker DeadJob DeadReason
EnqueueOptions JobContext JobDialect JobHandler JobOutcome JobStore Queue
QueueOptions RetryPolicy RunReport Worker WorkerOptions
```

`@zmdb/jobs/schedule` owns:

```text
createScheduler Cron Interval IntervalOptions LeaseStore ScheduleDef Scheduler
SchedulerOptions schedulesOf SkippedRun TaskDecorator TaskOptions TaskRuns
```

`@zmdb/jobs/memory` owns `createMemoryJobStore` and `MemoryJobStore`. The backend remains an isolated SQLite database with the queue schema installed, is caller-disposable, and is intended for tests
and local execution rather than durable production storage.

## 4. Application lifecycle

Workers and schedulers retain their existing operational semantics. A worker or scheduler registered as an application provider participates through its structural `OnShutdown` implementation:

- startup remains explicit (`start()`), so constructing an application does not begin polling or timers;
- shutdown stops new claims/ticks, aborts or drains accepted work under the component's configured grace, then resolves;
- app shutdown invokes those hooks in reverse construction order;
- the jobs package does not install a global scheduler, worker registry or implicit extension.

An application may wrap explicit startup in its own `ApplicationExtension`; the jobs package does not make `@zmdb/app` depend on jobs.

## 5. Migration

| Current path                       | Target path           |
| ---------------------------------- | --------------------- |
| `@zmdb/web/queues`                 | `@zmdb/jobs`          |
| `@zmdb/web/queues/backends/memory` | `@zmdb/jobs/memory`   |
| `@zmdb/web/schedule`               | `@zmdb/jobs/schedule` |
| `@zmdb/web/queues/backends/pg`     | `@zmdb/jobs-postgres` |

The old paths are deleted in the same implementation change that adds the new exports. They do not forward, warn or remain as deprecated aliases. Runtime implementations move; they are not copied.

## 6. Evidence required from the implementation issues

1. the #645 export oracle reports exactly the 34 jobs-owned names frozen in `packages/web/SPEC.md`;
2. package manifests prove no third-party peer and no `web -> jobs` or `app -> jobs` reverse edge;
3. all existing queue, memory-backend and schedule tests run from the new package boundaries without semantic changes;
4. a packed consumer installs only `@zmdb/jobs` plus workspace dependencies, imports every subpath, runs the SQLite memory backend and typechecks worker/scheduler usage;
5. a resolution test proves all old web jobs paths are absent and a repository grep proves no forwarding module remains;
6. before/after worker claim, drain and scheduler tests retain their deterministic clocks; no wall-clock performance claim is introduced by the package move.
