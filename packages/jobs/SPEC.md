# `@zmdb/jobs` — selected, provider-neutral background work

> **Selection and storage boundary frozen by issue #753 for epic #752.** This document separates the graph measured at commit `961aaae0b0c9b4e29fc864f41454707933154a0e` from the implementation target.
> Issue #753 changes no package manifest or runtime source.

## 1. Measured packed baseline

The baseline was measured from packed `1.0.0-alpha.4` tarballs in clean, non-workspace Yarn 4.18.0 consumers on Node 26.8.1, Linux x64 GNU. Optional peers were not injected by the probe.

| Direct consumer dependency | Catalog packages in the installed production closure                                                                                                                                                       | Other installed packages                                                                                                              | Root import |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `zmdb`                     | `zmdb`, `@zmdb/ai`, `@zmdb/aot-validator`, `@zmdb/app`, `@zmdb/migrations`, `@zmdb/query-compiler`, `@zmdb/repository`, `@zmdb/schema-core`, `@zmdb/sqlite`, `@zmdb/web`                                   | `esbuild@0.28.2`, `@esbuild/linux-x64@0.28.2`, `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`                | exits 0     |
| `@zmdb/jobs`               | `@zmdb/ai`, `@zmdb/aot-validator`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/migrations`, `@zmdb/query-compiler`, `@zmdb/repository`, `@zmdb/schema-core`, `@zmdb/sqlite`                                          | `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`                                                               | exits 0     |
| `@zmdb/jobs-postgres`      | `@zmdb/ai`, `@zmdb/aot-validator`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/jobs-postgres`, `@zmdb/migrations`, `@zmdb/postgres`, `@zmdb/query-compiler`, `@zmdb/repository`, `@zmdb/schema-core`, `@zmdb/sqlite` | `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`; `pg` is absent until the consumer installs the required peer | exits 0     |

The corresponding installed-package counts are 15, 12, and 14. The repository model at this commit contains 36 catalog packages and 69 direct non-development workspace edges.

Selection classes are contextual to a product journey:

- **default core** is a catalog package installed by `zmdb` that supplies or implements its schema, ORM, validation, application, or web runtime;
- **selected first-party capability** is product-owned and documented as part of zmdb, but enters the graph only through an explicit direct install;
- **concrete provider** implements a technology-specific storage or database boundary; a product may deliberately include one provider in an opinionated journey;
- **development-only** is installed for an explicit CLI/compiler/migration/tooling entry and must be unreachable from ordinary runtime entries; and
- **private** is a non-catalog transitive implementation package with no selection or import step in the journey. “Private” here does not assert that the npm package itself is unpublished.

Every package relevant to the three journeys has one class:

| Package                                                          | Class                           | Baseline disposition                                                         |
| ---------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `zmdb`                                                           | default core                    | direct default install and product facade                                    |
| `@zmdb/schema-core`                                              | default core                    | schema and DTO vocabulary                                                    |
| `@zmdb/query-compiler`                                           | default core                    | SQL vocabulary and compilation                                               |
| `@zmdb/aot-validator`                                            | default core                    | validation and compiler-backed validation surface                            |
| `@zmdb/ai`                                                       | default core                    | current transitive implementation dependency of `@zmdb/aot-validator`        |
| `@zmdb/repository`                                               | default core                    | ORM and transaction contracts                                                |
| `@zmdb/app`                                                      | default core                    | application kernel                                                           |
| `@zmdb/web`                                                      | default core                    | HTTP framework                                                               |
| `@zmdb/sqlite`                                                   | concrete provider               | selected explicitly for the SQLite journey                                   |
| `@zmdb/migrations`, `esbuild`, `oxfmt`                           | development-only                | explicit migration, CLI, config, compiler, or formatting entries             |
| `@esbuild/linux-x64`, `@oxfmt/binding-linux-x64-gnu`, `tinypool` | private                         | non-catalog transitive implementation packages in these measured journeys    |
| `@zmdb/jobs`                                                     | selected first-party capability | currently also selects SQLite transitively; that coupling is removed by #756 |
| `@zmdb/jobs-sqlite`                                              | concrete provider               | target package; no manifest exists at this baseline                          |
| `@zmdb/jobs-postgres`                                            | concrete provider               | current PostgreSQL adapter                                                   |
| `@zmdb/postgres`, `pg`                                           | concrete provider               | PostgreSQL database package and its consumer-installed client peer           |

The current jobs-related public entries are:

| Entry                                                 | Current owner                                      | Class                              | Target                                             |
| ----------------------------------------------------- | -------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `@zmdb/jobs`                                          | `packages/jobs/src/index.ts`                       | selected first-party capability    | retain as the portable root                        |
| `@zmdb/jobs/schedule`                                 | `packages/jobs/src/schedule/index.ts`              | selected first-party capability    | retain                                             |
| `@zmdb/jobs/memory`                                   | `packages/jobs/src/queues/backends/memory.ts`      | concrete provider embedded in core | remove; migrate to `@zmdb/jobs-sqlite`             |
| `@zmdb/jobs-postgres`                                 | `packages/jobs-postgres/src/index.ts`              | concrete provider                  | retain and expand to the complete PostgreSQL store |
| `@zmdb/jobs-sqlite`                                   | absent                                             | concrete provider                  | add as one root-only package                       |
| `zmdb/jobs`, `zmdb/jobs/schedule`, `zmdb/jobs/memory` | absent from the current 16-entry `zmdb` export map | none                               | remain absent                                      |

## 2. Product-selection contract

The default product is the opinionated `zmdb` schema, ORM, validation, application-kernel, and HTTP journey. Installing `zmdb` must install the metadata-declared default closure and must not install a
database package, `@zmdb/jobs`, a jobs provider, or `pg`.

Jobs is one **selected first-party capability**. It is cohesive without being mandatory:

1. **APIs:** `@zmdb/jobs` owns one queue/worker/retry/dead-letter/scheduler/lease vocabulary and providers implement its public ports without copying behavior.
2. **Tooling:** product metadata, fixture discovery, release planning, and generated support/package-reference material recognise the capability id `jobs` and its providers.
3. **Documentation:** the zmdb documentation presents one jobs capability and gives provider-specific install tabs; it does not present package boundaries as competing products.
4. **Identity:** a value or type composed by a provider is the direct `@zmdb/jobs` value or type. Providers do not wrap, subclass, redeclare, or bundle a second jobs runtime.

None of those cohesion rules authorises a production dependency from `zmdb` to jobs. Mandatory installation is explicitly not a cohesion mechanism.

## 3. Frozen target graph

```text
default:

zmdb
 ├─ schema / validator / ORM packages
 ├─ @zmdb/app
 └─ @zmdb/web

selected jobs:

@zmdb/jobs ──> @zmdb/app         (portable behavior and ports only)
      ▲
      ├── @zmdb/jobs-sqlite ──> @zmdb/sqlite
      └── @zmdb/jobs-postgres ─> @zmdb/postgres ── peer: pg
```

The exact direct production contracts are:

| Package               | `dependencies`                         | `optionalDependencies` | runtime peers                 | Public entries    |
| --------------------- | -------------------------------------- | ---------------------- | ----------------------------- | ----------------- |
| `@zmdb/jobs`          | exactly `@zmdb/app`                    | none                   | none                          | `.`, `./schedule` |
| `@zmdb/jobs-sqlite`   | exactly `@zmdb/jobs`, `@zmdb/sqlite`   | none                   | none                          | `.`               |
| `@zmdb/jobs-postgres` | exactly `@zmdb/jobs`, `@zmdb/postgres` | none                   | exactly required `pg@^8.23.0` | `.`               |
| `zmdb`                | its metadata-declared default packages | none for jobs          | none for jobs                 | no `./jobs` entry |

Forbidden direct or transitive production edges are:

- `zmdb -> @zmdb/jobs`, `zmdb -> @zmdb/jobs-sqlite`, and `zmdb -> @zmdb/jobs-postgres`;
- `@zmdb/jobs -> @zmdb/sqlite`, `@zmdb/jobs -> @zmdb/postgres`, `@zmdb/jobs -> @zmdb/migrations`, `@zmdb/jobs -> @zmdb/query-compiler`, `@zmdb/jobs -> @zmdb/repository`, or `@zmdb/jobs -> pg`;
- either jobs provider reaching the other provider or the other database technology;
- any provider or facade importing another package's private source, a workspace source path, or an undeclared package; and
- an optional dependency, conditional export, dynamic import, package-manager hook, source resolver, or catch-and-fallback import that makes jobs appear through `zmdb`.

## 4. Provider-neutral core API

The core retains the current queue, worker, retry, dead-letter, schedule, lease, clock, cancellation, drain, and application-extension semantics. It removes only storage implementation and SQL
shaping. `JobDialect`, raw SQL, table names, migration execution/SQL, database clients, and provider resource ownership are not core concepts; `JobStoreMigration` is only the dependency-free record
shape shared by provider bundles.

The exact root values are:

```text
createQueue createWorker jobsExtension
Cron Interval createScheduler schedulesOf
```

The exact root types are:

```text
AnyJobHandler Backoff Clock DeadJob DeadReason EnqueueOptions
JobContext JobHandler JobOutcome Queue QueueOptions RetryPolicy RunReport
Worker WorkerOptions
JobEnqueue JobEnqueueResult JobEnqueuer JobCandidate ClaimedJob
JobSettlement JobStore JobStoreResource JobStoreMigration
IntervalOptions LeaseStore ScheduleDef Scheduler SchedulerOptions
SkippedRun TaskDecorator TaskOptions TaskRuns
```

`@zmdb/jobs/schedule` owns `Cron`, `Interval`, `createScheduler`, `schedulesOf`, and the schedule/lease types in the last two lines. The root re-exports those declarations by identity. No root or
subpath exports `createMemoryJobStore`, `MemoryJobStore`, or `JobDialect`.

The target store seam is domain-shaped:

```ts
export interface JobEnqueue {
  readonly id: string;
  readonly name: string;
  readonly payload: string;
  readonly enqueuedAt: Date;
  readonly availableAt: Date;
  readonly dedupeKey?: string;
}

export type JobEnqueueResult = { readonly kind: 'inserted'; readonly jobId: string } | { readonly kind: 'duplicate'; readonly jobId: string };

export interface JobEnqueuer {
  enqueue(job: JobEnqueue): Promise<JobEnqueueResult>;
}

export interface JobCandidate {
  readonly id: string;
  readonly name: string;
  readonly enqueuedAt: Date;
}

export interface ClaimedJob extends JobCandidate {
  readonly payload: string;
  readonly attempts: number;
  readonly dedupeKey?: string;
  readonly holder: string;
}

export type JobSettlement =
  | { readonly kind: 'done'; readonly jobId: string; readonly holder: string; readonly idempotencyKey: string; readonly completedAt: Date }
  | { readonly kind: 'retry'; readonly jobId: string; readonly holder: string; readonly attempts: number; readonly availableAt: Date; readonly detail: string }
  | { readonly kind: 'dead'; readonly jobId: string; readonly holder: string; readonly attempts: number; readonly reason: DeadReason; readonly detail: string; readonly deadAt: Date }
  | { readonly kind: 'release'; readonly jobId: string; readonly holder: string; readonly availableAt: Date };

export interface JobStore extends JobEnqueuer {
  candidates(options: { readonly now: Date; readonly limit: number }): Promise<readonly JobCandidate[]>;
  claim(options: { readonly ids: readonly string[]; readonly holder: string; readonly now: Date; readonly leaseUntil: Date }): Promise<readonly ClaimedJob[]>;
  completed(idempotencyKey: string): Promise<boolean>;
  settle(settlement: JobSettlement): Promise<boolean>;
  listDead(options: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]>;
  replay(jobId: string, availableAt: Date): Promise<boolean>;
}

export interface JobStoreResource {
  close(): void | Promise<void>;
}

export interface JobStoreMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}
```

`claim` and `settle` are compare-and-set operations: a provider returns only rows claimed by `holder`, and settlement returns `false` after lease loss. A `done` settlement writes the completion marker
and terminal job state atomically. Core selects candidates according to worker and per-handler concurrency before asking the provider to claim them. Providers own the database transaction needed to
make each port call atomic.

Ordinary `JobStore` calls and transaction-scoped enqueueing have separate ownership. A provider-backed `JobStore` owns any transaction required to make one of its port calls atomic and must not join
an ambient application transaction. A provider-created `JobEnqueuer` does the inverse: it executes on the caller's already-pinned transaction connection and never begins, commits, rolls back, or
releases that transaction.

`Queue.enqueueInTransaction` becomes:

```ts
enqueueInTransaction<K extends keyof M & string>(
  enqueuer: JobEnqueuer,
  name: K,
  payload: M[K],
  options?: EnqueueOptions,
): Promise<string>;
```

The caller obtains that `JobEnqueuer` from the selected provider for the exact transaction connection. Core never accepts a repository `TransactionContext`, SQLite connection, PostgreSQL pool, or
driver directly and never detects a dialect.

`LeaseStore` remains the existing provider-neutral `acquire`/`renew`/`release` contract under `@zmdb/jobs/schedule`. Both first-party storage providers implement `JobStore`, `LeaseStore`, and
`JobStoreResource`.

`jobsExtension` gains `stores?: readonly JobStoreResource[]`. It stops schedulers, then workers, then distinct stores, each group in reverse declaration order, under one application-wide remaining
grace deadline. Every participant is attempted; one failure is preserved and multiple failures become an `AggregateError` in attempt order. Repeated shutdown is idempotent.

## 5. Storage-provider ownership

[`../jobs-sqlite/SPEC.md`](../jobs-sqlite/SPEC.md) is the complete SQLite contract. [`../jobs-postgres/SPEC.md`](../jobs-postgres/SPEC.md) is the complete PostgreSQL contract.

Both providers own:

- queue, completion-marker, dead-letter, scheduling-lease schema and provider-specific SQL;
- atomic claim, settlement, deduplication, replay, and renewable-lease operations;
- transaction-scoped `JobEnqueuer` construction;
- migration objects and database-specific conformance tests; and
- resource adaptation and shutdown behavior.

Core owns the state machine and calls the ports. Providers do not own workers, retries, clocks, scheduler timing, handlers, lifecycle ordering, or a second state machine.

The durable providers never create, migrate, close, end, or release a caller-owned database resource. They never auto-apply migrations. The SQLite in-memory convenience constructor is the one
exception: it creates a fresh private `:memory:` database, applies the provider's two frozen migrations, and closes that database exactly once through its resource contract.

The migration records use these exact versions and names in both dialect-specific bundles:

|          Version | Name                  | Owns                                                                              |
| ---------------: | --------------------- | --------------------------------------------------------------------------------- |
| `20260906000100` | `jobs_queue`          | `zmdb_job`, `zmdb_job_done`, dedupe constraint, pending/lease/dead-letter indexes |
| `20260906000200` | `jobs_schedule_lease` | `zmdb_job_lease` and its expiry lookup                                            |

The provider bundles emit dialect-specific reversible SQL. Applications register exactly one bundle per target database; installing a provider alone performs no schema mutation.

## 6. Facade decision and exact journeys

There is no runtime `zmdb/jobs` facade now or in the target. Product/catalog metadata may generate package-reference, support-matrix, fixture, or install guidance at tooling time, but generated
discovery is not a JavaScript export and adds no `zmdb` dependency.

### Default

```sh
npm install zmdb@alpha @zmdb/sqlite@alpha
```

```ts
import { assert, defineRepository, schemaOf } from 'zmdb';
import { sqliteDriver } from 'zmdb/sqlite';
import { Controller, Get, createApp } from 'zmdb/web';
```

The installed graph must contain the default metadata closure and must contain none of `@zmdb/jobs`, `@zmdb/jobs-sqlite`, `@zmdb/jobs-postgres`, or `pg`.

### SQLite jobs

```sh
npm install zmdb@alpha @zmdb/jobs@alpha @zmdb/jobs-sqlite@alpha
```

```ts
import { createQueue, createScheduler, createWorker, jobsExtension } from '@zmdb/jobs';
import type { JobStore, LeaseStore } from '@zmdb/jobs';
import { createMemoryJobStore, createSqliteJobStore, jobsSqliteMigrations, sqliteJobEnqueuer } from '@zmdb/jobs-sqlite';
```

`@zmdb/jobs` imports and typechecks before a provider is installed. A queue or worker cannot be constructed without a `JobStore`; a once-per-cluster scheduler cannot be constructed without a
`LeaseStore`. The missing-provider result is therefore an explicit construction/type boundary, not a module-resolution fallback.

### PostgreSQL jobs

```sh
npm install zmdb@alpha @zmdb/jobs@alpha @zmdb/jobs-postgres@alpha pg@^8.23.0
```

```ts
import { createQueue, createScheduler, createWorker, jobsExtension } from '@zmdb/jobs';
import type { JobStore, LeaseStore } from '@zmdb/jobs';
import { createPgJobStore, jobsPostgresMigrations, pgJobEnqueuer } from '@zmdb/jobs-postgres';
```

The required peer is consumer-owned and explicit. No PostgreSQL package, `pg`, or SQLite package may enter through the portable jobs package.

## 7. Metadata-derived graph budgets

The product catalog extends `optionality` with `capability` and `provider` records as frozen in [`../../scripts/product/SPEC.md`](../../scripts/product/SPEC.md). The architecture verifier derives
installed closures from packed manifests, beginning at the catalog id named by each journey. It follows `dependencies` and `optionalDependencies`; it follows a peer only when the clean consumer
declares that peer. It does not trust workspace hoisting or a prose package list.

At the target boundary, the metadata-derived budgets are:

| Journey root          |   Direct catalog edges |                                 Catalog closure | Provider/peer budget                                                                    |
| --------------------- | ---------------------: | ----------------------------------------------: | --------------------------------------------------------------------------------------- |
| `zmdb`                | current metadata value |                     10 at the measured baseline | zero jobs capability/provider packages and zero `pg`                                    |
| `@zmdb/jobs`          |              exactly 1 |          exactly 7 with the current app closure | zero provider packages, external runtime dependencies, optional dependencies, and peers |
| `@zmdb/jobs-sqlite`   |              exactly 2 | exactly 10 with the current app/SQLite closures | exactly one jobs provider, no PostgreSQL package or peer                                |
| `@zmdb/jobs-postgres` |              exactly 2 |                exactly 10 before external peers | exactly one jobs provider and required `pg@^8.23.0`, no SQLite jobs provider            |

The verifier prints the resolved package names and edges when a count or class changes. Counts are review budgets, not substitutes for the forbidden-edge assertions in §3: swapping one forbidden
provider for another while preserving a number still fails.

## 8. Alpha migration

This is a hard alpha cutover with no runtime forwarders:

| Alpha import or API                                              | Replacement                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@zmdb/jobs/memory`                                              | install/import `@zmdb/jobs-sqlite`                                                    |
| `createMemoryJobStore` or `MemoryJobStore` from `@zmdb/jobs`     | import from `@zmdb/jobs-sqlite`                                                       |
| SQL-shaped `JobStore`, `JobDialect`, or raw `execute` adapters   | implement/use the domain-shaped `JobStore` from §4                                    |
| repository `TransactionContext` passed to `enqueueInTransaction` | pass `sqliteJobEnqueuer(transactionConnection)` or `pgJobEnqueuer(transactionClient)` |
| planned or branch-only `zmdb/jobs`                               | install/import `@zmdb/jobs`                                                           |
| planned or branch-only `zmdb/jobs/schedule`                      | import `@zmdb/jobs/schedule`                                                          |
| planned or branch-only `zmdb/jobs/memory`                        | install/import `@zmdb/jobs-sqlite`                                                    |

No tombstone export, deprecated alias, optional dependency, dynamic importer, source import, or duplicate facade implementation survives the cutover.

## 9. Evidence required from split work

Issue #754 freezes failing packed-consumer and negative-edge tests against this exact contract. #755 enforces direct capability selection, application-lifecycle composition, and the absence of an
umbrella dependency or runtime facade. #756 moves storage and migrations into the providers. #757 proves all three packed journeys. #758 completes the provider-aware generated documentation after
those package boundaries exist.

Required evidence is dependency/install, API identity, transaction, migration, behavior, and shutdown evidence. No benchmark or performance claim is part of this contract.
