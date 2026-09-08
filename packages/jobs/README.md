# @zmdb/jobs

Typed queues, workers, dead letters, scheduling, leases, and explicit provider ports for zmdb applications.

## Install

```bash
npm add @zmdb/jobs@1.0.0-beta.1
```

The package is ESM-only and requires Node.js 26 or later. It has no third-party runtime peer. `npm add zmdb@1.0.0-beta.1` does not install it, and there is no `zmdb/jobs` facade.

## Choose the capability and its storage

The default [SQLite HTTP application](https://ambasta.github.io/zmdb/docs/web-overview.html) starts with `npm add zmdb@1.0.0-beta.1`. Add jobs when the application needs background work:

| Choice                                  | Install                                                                       | Public imports                            |
| --------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Portable queues and scheduling          | `npm add @zmdb/jobs@1.0.0-beta.1`                                             | `@zmdb/jobs`, `@zmdb/jobs/schedule`       |
| SQLite jobs, including the memory store | `npm add @zmdb/jobs@1.0.0-beta.1 @zmdb/jobs-sqlite@1.0.0-beta.1`              | `@zmdb/jobs`, `@zmdb/jobs-sqlite`         |
| PostgreSQL jobs                         | `npm add @zmdb/jobs@1.0.0-beta.1 @zmdb/jobs-postgres@1.0.0-beta.1 pg@^8.23.0` | `@zmdb/jobs`, `@zmdb/jobs-postgres`, `pg` |

The portable install supplies behavior and provider ports. Queue and worker constructors require an explicit `store` and throw `TypeError` when it is missing; they never choose SQLite automatically.
Per-replica schedules can run without a database. A cluster schedule requires a supplied `LeaseStore` and is refused before startup when it is missing. These package boundaries let applications select
storage and upgrade providers independently while using the same jobs APIs and application lifecycle.

## Migrations and ownership

| Constructor                                                 | Before starting work                                                            | Resource ownership                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createMemoryJobStore()` from `@zmdb/jobs-sqlite`           | Creates and migrates a fresh memory database automatically                      | The store owns and closes that database                                                                |
| `createSqliteJobStore(database)` from `@zmdb/jobs-sqlite`   | Apply the exported `jobsSqliteMigrations` to the caller's database              | Closing the store leaves the supplied database open                                                    |
| `createPgJobStore(poolOrClient)` from `@zmdb/jobs-postgres` | Apply the exported `jobsPostgresMigrations` to the selected PostgreSQL database | The caller owns the supplied pool/client; the adapter releases only connections it acquires internally |

Durable providers do not apply migrations automatically. Their stores also implement the scheduler's lease port, so a cluster scheduler can use the selected store as `leases`. Distinct replicas need
shared storage; a fresh process-local memory store cannot coordinate them.

Include a store in `jobsExtension({ workers, schedulers, stores })` to close its adapter after schedulers and workers stop. Await `app[Symbol.asyncDispose]()` before closing a caller-owned database or
pool. If a store is managed outside the extension, the caller closes it after background work stops, as in the complete server example below.

## Entry points

- `@zmdb/jobs` — queues, workers, the common clock, lifecycle integration, and the complete convenience surface
- `@zmdb/jobs/schedule` — cron and interval decorators, schedulers, and the lease-store port

Workers and schedulers are explicit instances. Pass them to `jobsExtension({ workers, schedulers, stores })` to start after application bootstrap and stop under the application's bounded grace period.

```ts
import { createApplication, Module } from '@zmdb/app';
import { jobsExtension } from '@zmdb/jobs';

@Module({ controllers: [] })
class Application {}

const app = createApplication(Application, {
  extensions: [jobsExtension({ workers: [], schedulers: [] })],
});
await app.init();
await app[Symbol.asyncDispose]();
```

The [complete server example](https://ambasta.github.io/zmdb/docs/web-overview.html) creates a real SQLite worker and supplies this extension to `createApp`, so HTTP and jobs share one application
lifecycle.

Replace the empty arrays with the workers and schedulers owned by that application. The extension uses the same startup, rollback, reverse shutdown, and grace deadline as every other `@zmdb/app`
extension.

The default package has no `pg` peer. SQLite workers add `@zmdb/jobs-sqlite@1.0.0-beta.1`, which owns both durable and memory storage. PostgreSQL workers add `@zmdb/jobs-postgres@1.0.0-beta.1` and
`pg@^8.23.0`; that adapter borrows a caller-owned pool or client and never closes the supplied resource; it releases only connections it acquires internally.

## Alpha migration

Update the selected dependency and import together:

| Removed or branch-only import | Current import                                  | Required selection                             |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `@zmdb/jobs/memory`           | `createMemoryJobStore` from `@zmdb/jobs-sqlite` | Add `@zmdb/jobs-sqlite` alongside `@zmdb/jobs` |
| `zmdb/jobs`                   | `@zmdb/jobs`                                    | Add `@zmdb/jobs` explicitly                    |
| `zmdb/jobs/schedule`          | `@zmdb/jobs/schedule`                           | Add `@zmdb/jobs` explicitly                    |
| `zmdb/jobs/memory`            | `createMemoryJobStore` from `@zmdb/jobs-sqlite` | Add both jobs and the SQLite provider          |

The memory constructor now belongs to the SQLite provider. Keep portable queues, workers and schedules imported from `@zmdb/jobs`; supply the chosen provider through its public ports. The retired
entries have no runtime forwarders. The [queues guide](https://ambasta.github.io/zmdb/docs/web-queues.html) covers provider migrations, transactions and bounded shutdown.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
