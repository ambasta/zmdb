# @zmdb/jobs

Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.

## Install

```bash
npm add @zmdb/jobs@alpha
```

The package is ESM-only and requires Node.js 26 or later. It has no third-party runtime peer. `npm add zmdb@alpha` does not install it, and there is no `zmdb/jobs` facade.

## Entry points

- `@zmdb/jobs` — queues, workers, the common clock, lifecycle integration, and the complete convenience surface
- `@zmdb/jobs/memory` — caller-disposable `node:sqlite` `:memory:` storage with the queue schema installed
- `@zmdb/jobs/schedule` — cron and interval decorators, schedulers, and the lease-store port

Workers and schedulers are explicit instances. Pass them to `jobsExtension({ workers, schedulers })` to start after application bootstrap and stop under the application's bounded grace period.

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

Replace the empty arrays with the workers and schedulers owned by that application. The extension uses the same startup, rollback, reverse shutdown, and grace deadline as every other `@zmdb/app`
extension.

The default package has no `pg` peer. PostgreSQL-backed workers add `@zmdb/jobs-postgres@alpha` and `pg@^8.23.0`; that adapter borrows a caller-owned pool or client and never closes or releases it.

## Alpha migration

Replace any branch-only or pre-release `zmdb/jobs` import with `@zmdb/jobs`, and replace `zmdb/jobs/schedule` with `@zmdb/jobs/schedule`. No runtime forwarder or duplicate facade implementation is
shipped.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
