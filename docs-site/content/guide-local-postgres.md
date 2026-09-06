The fastest correct setup: Postgres in Docker, migrations from your migration runner, and a test database you can reset in milliseconds.

## Docker Compose

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app_dev
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 2s
      timeout: 3s
      retries: 20
volumes: { pgdata }
```

```bash
docker compose up -d
```

Match the major version to production. A local 17 against a deployed 15 will let you use syntax that fails on deploy, and the differences that bite are exactly the ones you would not think to check.

The healthcheck matters for CI: the container accepts connections briefly during initialisation and then restarts, so a test suite that connects immediately fails intermittently.

## Connecting

```ts
import { Pool } from 'pg';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({ connectionString: 'postgres://postgres:dev@localhost:5432/app_dev', max: 5 });

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

See [Connect: Postgres](./connect-postgres.html).

## Applying the schema

From your schemas, so it cannot drift from a fixture:

```ts
import { diff, emitUp, snapshot } from 'zmdb/migrations';

for (const op of diff({ tables: {} }, snapshot(allSchemas))) {
  await driver.execute({ text: emitUp(op, 'postgres'), parameters: [] });
}
```

Or run your migration runner — `runCli('up', conn, migrations)` — which is what production does and is therefore what you should exercise. See [migrate](./cli-migrate.html).

## A separate test database

Never point tests at your development database. One `TRUNCATE` and your seed data is gone.

```bash
createdb -h localhost -U postgres app_test
```

```ts
const url = process.env.NODE_ENV === 'test' ? 'postgres://postgres:dev@localhost:5432/app_test' : 'postgres://postgres:dev@localhost:5432/app_dev';
```

## Resetting fast

Three options, fastest first.

**Truncate between tests** — milliseconds:

```ts
import { ALL_TABLES } from './domain/tables.ts'; // [schemaOf<User>(), schemaOf<Post>(), …]

const tables = ALL_TABLES.map(s => `"${s.table}"`).join(', ');
beforeEach(() => driver.execute({ text: `TRUNCATE ${tables} RESTART IDENTITY CASCADE`, parameters: [] }));
```

`RESTART IDENTITY` resets sequences, so ids are stable across tests. `CASCADE` handles foreign keys.

The table list is an array you keep, not a registry you query — a schema comes from a type, and a type cannot register itself. A table missing from `ALL_TABLES` is a table this helper silently skips,
so pin the array with a test; [Monorepo layout](./web-cli-monorepo.html) has one that walks the source for `extends Table<'…'>`.

**A transaction per test, rolled back** — also fast, and gives perfect isolation, but your code cannot use transactions of its own. That is a real limitation for anything testing `withTransaction`.

**Template databases** — `CREATE DATABASE app_test TEMPLATE app_test_template` gives a fresh schema-applied database per worker for parallel suites. More setup, worth it for large suites.

## Faster, for tests only

Postgres durability settings you would never use in production:

```yaml
command: >
  postgres -c fsync=off -c synchronous_commit=off
           -c full_page_writes=off -c shared_buffers=256MB
```

Often 2–5× on write-heavy suites. Only for a throwaway container — this configuration will corrupt data on an unclean shutdown, which is precisely why it is fast.

## `psql` for looking at things

```bash
docker compose exec db psql -U postgres app_dev
```

```
\dt              tables
\d+ users        one table, with indexes
\di              indexes
\x               expanded output — essential for wide rows
```

And for the thing you actually need most:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...
```

Paste in `query.text` from a compiled query and you are debugging the exact statement your application sends. See [Query Performance](./perf-queries.html).

## No Docker

[PGlite](./connect-pglite.html) is Postgres compiled to WebAssembly, in-process, no daemon — excellent for tests and for a machine where you cannot run Docker. It does not have every extension, so
PostGIS and pgvector still need a real server.

Homebrew (`brew install postgresql@17`) and Postgres.app are fine too; Docker just makes the version explicit and the teardown complete.

---

See also: [Connect: Postgres](./connect-postgres.html) · [PGlite](./connect-pglite.html) · [Testing](./testing.html)
