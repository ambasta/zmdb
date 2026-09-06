Supported dialect variant: `'cockroach'`. It inherits the Postgres wire and query family, overrides the type and feature decisions that differ, and carries Cockroach's retry classification. Support
here means the emitted SQL and refusals are covered; the repository does not currently run a live Cockroach server in its automated gate.

## Using it

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';
import { defineRepository } from '@zmdb/repository';
import { pgDriver } from 'zmdb/drivers/pg';

const compiler = createQueryCompiler('cockroach');
const userRepo = defineRepository(users, pgDriver(pool), { dialect: 'cockroach' });
```

The `zmdb/drivers/pg` compatibility facade delegates to `@zmdb/postgres`. The future `@zmdb/cockroach` package consumes `postgresFamilyDriver`, `postgresFamilyIntrospector`, and
`postgresFamilyMigrations` from that public parent surface; no Cockroach behavior is embedded in the PostgreSQL package.

Use a Postgres-protocol client through the [Postgres driver](./connect-postgres.html):

```ts
const pool = new Pool({ connectionString: process.env.COCKROACH_URL });
```

Ordinary selects, inserts, updates, deletes, joins, subqueries, `RETURNING` and `ON CONFLICT` inherit the Postgres grammar. Telemetry reports the Postgres wire family.

## Divergence and refusal matrix

| Construct                     | Emitted SQL / behavior                       | Caveat or refusal                                                             |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| identifiers / placeholders    | Postgres `"name"` and `$1`, `$2`, …          | use the bundled Postgres driver                                               |
| ordinary DML and upsert       | Postgres `RETURNING` and `ON CONFLICT` forms | inherited explicitly through the dialect traits                               |
| `serial`                      | `INT8 DEFAULT unique_rowid()`                | remains a numeric `Serial`; it is not rewritten to UUID                       |
| `integer`                     | `INT4`                                       | Cockroach's `INTEGER` alias is 64-bit                                         |
| materialized views            | Postgres `CREATE MATERIALIZED VIEW`          | refresh statements are not modeled                                            |
| full-text search              | refused                                      | Cockroach does not use `to_tsvector` / `@@`                                   |
| row-level security            | refused                                      | server support varies by version, so the Postgres policy shape is not assumed |
| stored routines               | Postgres function/procedure DDL and calls    | routine types still use Cockroach's `INT4` / `INT8` mappings                  |
| schema introspection          | the Postgres catalog introspector            | no live Cockroach qualification exists in this repository                     |
| transaction retry metadata    | `40001`                                      | retry is opt-in and re-runs the whole callback                                |
| database extensions / types   | refused                                      | extension DDL and extension-backed columns are exact-Postgres only            |
| vector / spatial operators    | refused                                      | the closed pgvector/PostGIS operators are exact-Postgres only                 |
| explicit index method/opclass | refused                                      | plain, partial and expression indexes remain available without those fields   |
| Cockroach-only clauses        | raw SQL                                      | `AS OF SYSTEM TIME`, locality and zone configuration have no builder node     |

For a UUID primary key, keep the explicit declaration:

```ts
import type { HasDefault, PrimaryKey, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: string & Sql<'text'> & PrimaryKey & HasDefault;
  email: string & Sql<'text'> & Unique;
}
```

```sql
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
```

`HasDefault` drops `id` from `CreateDTO<User>`'s required keys without claiming that it is an auto-incrementing integer.

## Retryable transactions

Cockroach is serializable by default, so `40001` (`RETRY_SERIALIZABLE`) under contention is normal. Give the pinned transaction connection the Cockroach dialect and opt into bounded retries:

```ts
const db = createTransactionalDb({ ...connection, dialect: 'cockroach' });

await db.transaction(
  async tx => {
    await accounts.withTransaction(tx).update(accountId, patch);
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

The callback may run five times in that example. Keep message publishing, HTTP calls, file writes and other non-idempotent side effects outside it; a database rollback cannot undo them. Without the
`retry` option, the callback runs once.

## Migration behavior

`ALTER TABLE` can return before the change has propagated, and several statements cannot share an explicit transaction. Split a migration whose later statement depends immediately on an earlier schema
change.

## Measured coverage

The automated suite covers every frozen matrix construct for `'cockroach'`, the two type overrides, inherited query and migration paths, materialized-view inheritance, RLS and full-text refusals,
Postgres-family routine DDL, catalog dispatch, and the opt-in `40001` retry sequence. It does not start a Cockroach server, so accepting the emitted SQL and observing schema-change behavior on a
specific Cockroach release remain deployment qualification.

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Transactions](./transactions.html) · [Raw SQL](./raw-sql.html)
