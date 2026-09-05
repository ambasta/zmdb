# @zmdb/jobs

Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.

## Install

```bash
npm add @zmdb/jobs@alpha
```

The package is ESM-only and requires Node.js 26 or later. It has no third-party runtime peer.

## Entry points

- `@zmdb/jobs` — queues, workers, the common clock, lifecycle integration, and the complete convenience surface
- `@zmdb/jobs/memory` — caller-disposable `node:sqlite` `:memory:` storage with the queue schema installed
- `@zmdb/jobs/schedule` — cron and interval decorators, schedulers, and the lease-store port

Workers and schedulers are explicit instances. Pass them to `jobsExtension({ workers, schedulers })` to start after application bootstrap and stop under the application's bounded grace period.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
