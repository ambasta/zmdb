# @zmdb/jobs-postgres

`@zmdb/jobs-postgres` adapts a caller-owned node-postgres `Pool`, `PoolClient`, or `Client` to the `JobStore` port from `@zmdb/jobs`.

The adapter creates no connection and exposes no close method. The caller retains ownership of the PostgreSQL client and its lifecycle.

## Install

```bash
npm add @zmdb/jobs-postgres@alpha pg
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Usage

```ts
import { Pool } from 'pg';
import { createPgJobStore } from '@zmdb/jobs-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = createPgJobStore(pool, {
  prepared: true,
  maxCacheSize: 128,
});

// Pass store to createQueue/createWorker. The application still owns pool.
```

`prepared` and `maxCacheSize` preserve the bounded prepared-statement behavior of the zmdb PostgreSQL driver. `cancelVia` may name a caller-owned client that can cancel work through a second
connection.

## Entry points

- `@zmdb/jobs-postgres` — `createPgJobStore`, `PgJobClient`, and `PgJobStoreOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
