# `@zmdb/jobs` — queues, workers and scheduling SPEC

> **Contract frozen by #645 and implemented by #650.** The measured `@zmdb/web` baseline contained 34 distinct public jobs symbols: 19 queue/worker symbols, 13 scheduling symbols and 2
> SQLite-memory-store symbols. #650 moved those symbols and added `jobsExtension`.

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

The package root is the complete convenience surface: the 34 symbols moved from web plus `jobsExtension`.

```text
AnyJobHandler Backoff Clock createQueue createWorker DeadJob DeadReason
EnqueueOptions JobContext JobDialect JobHandler JobOutcome JobStore jobsExtension
Queue QueueOptions RetryPolicy RunReport Worker WorkerOptions
createMemoryJobStore MemoryJobStore
createScheduler Cron Interval IntervalOptions LeaseStore ScheduleDef Scheduler
SchedulerOptions schedulesOf SkippedRun TaskDecorator TaskOptions TaskRuns
```

`@zmdb/jobs/schedule` owns:

```text
createScheduler Cron Interval IntervalOptions LeaseStore ScheduleDef Scheduler
SchedulerOptions schedulesOf SkippedRun TaskDecorator TaskOptions TaskRuns
```

`@zmdb/jobs/memory` owns `createMemoryJobStore` and `MemoryJobStore`. `@zmdb/jobs/schedule` owns the scheduling declarations above. The root re-exports both subpaths by identity; the subpaths remain
available for narrow imports. The backend remains an isolated SQLite database with the queue schema installed, is caller-disposable, and is intended for tests and local execution rather than durable
production storage.

## 4. Application lifecycle

Issue #650 adds one jobs-owned implementation of the app extension contract:

```ts
export function jobsExtension(options: { readonly workers?: readonly Worker[]; readonly schedulers?: readonly Scheduler[] }): ApplicationExtension;
```

`jobsExtension` has the fixed name `@zmdb/jobs`. It snapshots the supplied arrays at construction and owns no process-global registry. One extension therefore belongs to one application; two
applications in one process share nothing unless the caller explicitly gives both the same worker, scheduler, store or lease implementation.

Application startup remains lifecycle-driven rather than construction-driven:

1. constructing a queue, worker, scheduler or extension opens no timer and claims no work;
2. after app module/bootstrap hooks complete, `jobsExtension.start` starts workers in declaration order and then schedulers in declaration order;
3. handler and task registration stays explicit on `createWorker` and `createScheduler`; the extension does not scan `ApplicationExtensionContext`.

Stopping reverses the dependency:

1. schedulers stop in reverse declaration order, so no new scheduled enqueue begins while workers drain;
2. workers stop in reverse declaration order;
3. every eligible participant is attempted even after another stop rejects;
4. one rejection is preserved and multiple rejections become an `AggregateError` in attempt order.

`Worker.onShutdown` and `Scheduler.onShutdown` accept an optional `{ readonly graceMs: number }`. A direct call with no argument retains the component's configured grace. The extension records one
deadline from the non-negative grace supplied by `ApplicationExtension.stop`, passes each participant the smaller of its configured grace and the milliseconds remaining, and never refreshes the budget
per participant. Zero means stop intake and immediately abort/requeue or release rather than sleeping.

Both component shutdown methods and the extension are idempotent. The jobs package depends on the app contract; `@zmdb/app` never imports jobs.

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
3. all existing queue, memory-backend and schedule tests run from the new package boundaries without semantic changes, and an app lifecycle test proves extension start/stop ordering and one shared
   grace budget;
4. a packed consumer installs only `@zmdb/jobs` plus workspace dependencies, imports every subpath, runs the SQLite memory backend and typechecks worker/scheduler/extension usage;
5. a resolution test proves all old web jobs paths are absent and a repository grep proves no forwarding module remains;
6. before/after worker claim, drain and scheduler tests retain their deterministic clocks; no wall-clock performance claim is introduced by the package move.
