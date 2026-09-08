`@zmdb/cockroach` is the complete CockroachDB vertical. It is a one-way child of the public `@zmdb/postgres` family surface: PostgreSQL owns shared wire, compiler, migration, cursor, and catalog
primitives, while Cockroach owns every override, refusal, retry code, live-server assertion, and packed-consumer check.

## Database-selection workflow

The six official database packages use the same selection workflow. The [package reference](./package-reference.html) owns current install and peer ranges; the
[CockroachDB package README](https://github.com/ambasta/zmdb/tree/main/packages/cockroach#install) includes the standalone TypeScript setup and full capability table.

| Step             | CockroachDB selection                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install          | `yarn add @zmdb/cockroach@1.0.0-beta.1 pg@^8.23.0`                                                                                                                                                                                                          |
| Configure        | Supply an application-owned `pg` client to `cockroachDriver(client)`; the application closes it.                                                                                                                                                            |
| Compile          | `createQueryCompiler(cockroach)` from `@zmdb/sql` produces SQL and a separate parameter array.                                                                                                                                                              |
| Migrate          | `cockroach.migrations.emitUp(operation)` and `cockroach.migrations.connection(driver)` supply database-specific DDL and runner behavior; `@zmdb/migrations` owns `up`/`down`.                                                                               |
| Introspect       | `cockroach.introspector.snapshot(driver)` reads the real catalog.                                                                                                                                                                                           |
| Execute          | `driver.execute(query)` runs the compiled query; `driver.transaction(...)` pins transaction work.                                                                                                                                                           |
| Capabilities     | Read `cockroach.capabilities` and the package capability table; client-specific requirements still apply.                                                                                                                                                   |
| Refusals         | PostgreSQL extensions, full-text operators, row-level security and cancelVia; see the detailed boundaries below.                                                                                                                                            |
| Testing evidence | [The installed CockroachDB consumer](https://github.com/ambasta/zmdb/tree/main/fixtures/database-cockroach) and [the common six-database qualification](https://github.com/ambasta/zmdb/issues/676) prove their recorded package, client and server inputs. |

A hosted-service connection guide is a recipe using one of these owners or an explicitly supplied structural adapter. Protocol compatibility alone does not create another official package or transfer
the recorded server qualification to that service.

## Using it

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies users; this excerpt does not repeat those declarations."}
import { cockroach, cockroachDriver } from '@zmdb/cockroach';
import { createQueryCompiler } from '@zmdb/sql';
import { defineRepository } from '@zmdb/orm';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.COCKROACH_URL });
const driver = cockroachDriver(pool);
const compiler = createQueryCompiler(cockroach);
const userRepo = defineRepository(users, driver);
```

The application passes the exported `cockroach` object explicitly and still selects and owns its Postgres-protocol client; `pg` is not a hard dependency of this package.

Ordinary selects, inserts, updates, deletes, joins, subqueries, `RETURNING`, `ON CONFLICT`, cursors, schemas, sequences, generated columns, foreign keys, materialized views, and SQL routines inherit
the PostgreSQL-family implementation. The Cockroach package binds those operations to its own immutable dialect object and proves the claimed paths against a real server.

## Divergence and refusal matrix

| Construct                     | Emitted SQL / behavior                       | Caveat or refusal                                                                 |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| identifiers / placeholders    | Postgres `"name"` and `$1`, `$2`, …          | `cockroachDriver()` binds the public PostgreSQL-family primitive                  |
| ordinary DML and upsert       | Postgres `RETURNING` and `ON CONFLICT` forms | inherited explicitly through the dialect traits                                   |
| `serial`                      | `INT8 DEFAULT unique_rowid()`                | remains a numeric `Serial`; it is not rewritten to UUID                           |
| `integer`                     | `INT4`                                       | Cockroach's `INTEGER` alias is 64-bit                                             |
| materialized views            | Postgres `CREATE MATERIALIZED VIEW`          | refresh statements are not modeled                                                |
| full-text search              | refused                                      | package support is conservative across Cockroach versions                         |
| row-level security            | refused                                      | server support varies by version, so the PostgreSQL policy shape is not assumed   |
| stored routines               | Postgres function/procedure DDL and calls    | routine types still use Cockroach's `INT4` / `INT8` mappings                      |
| schema introspection          | PostgreSQL base plus Cockroach `SHOW` data   | reconstructs secondary/expression/partial indexes and normalizes `unique_rowid()` |
| migration transactions        | non-transactional DDL                        | `CREATE TABLE` remains after `ROLLBACK`; the migration runner warns               |
| transaction retry metadata    | `40001`                                      | retry is opt-in and re-runs the whole callback                                    |
| database extensions / types   | refused                                      | extension DDL and extension-backed columns are exact-Postgres only                |
| vector / spatial operators    | refused                                      | the closed pgvector/PostGIS operators are exact-Postgres only                     |
| explicit index method/opclass | refused                                      | plain, partial and expression indexes remain available without those fields       |
| cursor streaming              | inherited PostgreSQL cursor path             | child normalizes Cockroach's string-shaped backend id                             |
| server-side cancellation      | refused                                      | CockroachDB does not expose `pg_cancel_backend()`                                 |
| Cockroach-only clauses        | raw SQL                                      | `AS OF SYSTEM TIME`, locality and zone configuration have no builder node         |

The RLS and full-text rows are package support decisions, not claims that every current Cockroach release rejects every related SQL function. The vertical refuses both so its public contract remains
stable across the supported server floor instead of changing by deployment version.

`unique_rowid()` is an `INT8`. The raw `cockroachDriver()` therefore preserves node-postgres's decimal-string result, and the v26.2.2 lane proves current values exceed `Number.MAX_SAFE_INTEGER`. Treat
that raw value as an opaque parameter rather than coercing it to `Number`. Use the explicit UUID declaration below when the application needs a string-shaped generated key.

For a UUID primary key, keep the explicit declaration:

```ts {"mode":"compile","id":"example-002"}
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

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies accountId, accounts, cockroach, connection, createTransactionalDb, patch; this excerpt does not repeat those declarations."}
const db = createTransactionalDb({ ...connection, dialect: cockroach });

await db.transaction(
  async tx => {
    await accounts.withTransaction(tx).update(accountId, patch);
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

The callback may run five times in that example. Keep message publishing, HTTP calls, file writes, payment calls, and every other non-idempotent external side effect outside it; a database rollback
cannot undo them. If an external effect must be coupled to the transaction, write an outbox row and deliver it after commit. Without the `retry` option, the callback runs exactly once and a `40001`
reaches the caller.

## Migration behavior

CockroachDB v26.2.2 retains a successful `CREATE TABLE` after an explicit `ROLLBACK`. `@zmdb/cockroach` therefore reports `transactionalDdl: false`, does not inherit PostgreSQL's migration transaction
wrapper, and lets the runner warn that a failed migration may leave schema changes applied without its ledger row. Keep migrations small and independently recoverable.

Schema changes can also complete asynchronously, so do not couple a later statement to an immediately dependent write. Split that work across migration versions.

## Measured coverage

The always-on server lane starts CockroachDB v26.2.2 and runs the fail-closed packed consumer. It proves migrations, CRUD and all four `RETURNING` forms used by the fixture, transactions,
non-transactional DDL persistence, schemas, sequences, generated columns, foreign keys, materialized views, SQL functions, cursor streaming, serial/`INT4` normalization, expression and partial-index
catalog recovery, a real serialization conflict followed by explicit retry, cancellation refusal, and the installed Cockroach → PostgreSQL dependency direction. The local unit suite separately freezes
parent immutability and every pre-execution refusal.

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Transactions](./transactions.html) · [Raw SQL](./raw-sql.html)
