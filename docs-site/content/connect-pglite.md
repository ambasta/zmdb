Dialect: `'postgres'`. PGlite is real Postgres compiled to WebAssembly — so you get `ILIKE`, `RETURNING`, `ON CONFLICT`, `JSONB` operators and transactional DDL, all in-process, with no server.

## Setup

```ts
import { PGlite } from '@electric-sql/pglite';
import type { Driver } from '@zmdb/repository';

const pg = await PGlite.create(); // in-memory
// or: await PGlite.create('./data/app')  — persisted to disk

export const driver: Driver = {
  async execute(query) {
    const result = await pg.query<Record<string, unknown>>(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

`pg.query` is generic over the row type, so passing `Record<string, unknown>` as the type argument satisfies `Driver.execute` with no cast — the repository does its own row-shape narrowing at one
audited boundary, and a driver that asserts here only hides a mismatch.

Then use the Postgres dialect, because it _is_ Postgres:

```ts
const repo = defineRepository(users, driver, { dialect: 'postgres' });
```

## Why this is the best test database for a Postgres project

[SQLite is faster to start](./connect-sqlite.html), but it is a different database — testing on SQLite leaves `ILIKE`, `RETURNING`, `ON CONFLICT`, JSON operators and transactional DDL untested. PGlite
closes that gap:

```ts
import { beforeEach } from 'vitest';
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';

let driver: Driver;

beforeEach(async () => {
  const pg = await PGlite.create();
  for (const op of diff({ tables: {} }, snapshot(allSchemas))) {
    await pg.exec(emitUp(op, 'postgres'));
  }
  driver = { execute: async q => (await pg.query<Record<string, unknown>>(q.text, [...q.parameters])).rows };
});
```

Startup is tens of milliseconds rather than the sub-millisecond of `:memory:` SQLite, so a suite of thousands of tests will notice. A reasonable split: SQLite for unit tests that only need _a_
database, PGlite for anything that exercises Postgres-specific SQL, and a real Postgres in CI for the integration suite.

## Persistence and reuse

```ts
const pg = await PGlite.create('./data/app'); // Node: a directory
const pg = await PGlite.create('idb://my-app'); // browser: IndexedDB
const pg = await PGlite.create('opfs-ahp://my-app'); // browser: OPFS, faster
```

To reuse one instance across a test file and reset between tests, truncate rather than recreate — it is much faster than a fresh instance:

```ts
beforeEach(async () => {
  await pg.exec(`TRUNCATE ${allSchemas.map(s => `"${s.table}"`).join(', ')} CASCADE`);
});
```

## Extensions

PGlite bundles several, including `pgvector` — which makes it the only way to exercise [vector search](./guide-vector-search.html) without a server:

```ts
import { vector } from '@electric-sql/pglite/vector';

const pg = await PGlite.create({ extensions: { vector } });
await pg.exec('CREATE EXTENSION IF NOT EXISTS vector');
```

## In the browser

The whole read path works client-side, because the compiler is pure string manipulation:

```ts
const q = createQueryCompiler('postgres').selectFrom('users').where('active', '=', true).compile();
const rows = await pg.query(q.text, [...q.parameters]);
```

Migrations work too — `runCli` needs a [`MigrationConnection`](./migrations-web-mobile.html). Four methods are required over `pg.exec`; optional checksum and transaction members provide the same
integrity guarantees as the packaged driver adapter.

## Limits

**Single connection.** No pool, one statement at a time. Fine for tests and local-first apps; not a server database.

**A subset of Postgres.** No `LISTEN`/`NOTIFY` across processes, no replication, no background workers.

**Memory.** The in-memory variant holds the whole database in the WASM heap. A large seed will hit the limit.

**Not for production traffic.** It is Postgres semantics without Postgres operations — no backups, no failover, no concurrent writers.

---

See also: [Testing](./testing.html) · [Dialect: Postgres](./dialect-postgres.html) · [Connect: SQLite](./connect-sqlite.html)
