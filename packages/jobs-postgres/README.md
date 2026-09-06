# @zmdb/jobs-postgres

`@zmdb/jobs-postgres` adapts a caller-owned node-postgres `Pool`, `PoolClient`, or `Client` to the `JobStore` port from `@zmdb/jobs`.

The adapter creates no connection and exposes no close method. The caller retains ownership of the PostgreSQL client and its lifecycle.

## Install

```bash
npm add @zmdb/jobs@alpha @zmdb/jobs-postgres@alpha pg@^8.23.0
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole peer is `pg@^8.23.0`. Neither it nor this adapter is installed by `npm add zmdb@alpha`; `@zmdb/jobs` remains the owner of queues, workers, schemas, retries, and scheduling.

## Usage

```ts
import { Pool } from 'pg';
import { createPgJobStore } from '@zmdb/jobs-postgres';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });
const store = createPgJobStore(pool, {
  prepared: true,
  maxCacheSize: 128,
});

// Pass store to createQueue/createWorker. The application still owns pool.
void store;
```

`prepared` and `maxCacheSize` preserve the bounded prepared-statement behavior of the zmdb PostgreSQL driver. `cancelVia` may name a caller-owned client that can cancel work through a second
connection. The adapter never calls `end()` or `release()`; the caller performs that shutdown after workers have drained.

## Entry points

- `@zmdb/jobs-postgres` — `createPgJobStore`, `PgJobClient`, and `PgJobStoreOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
