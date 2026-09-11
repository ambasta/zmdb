`@zmdb/postgres` is the official PostgreSQL vertical. Its frozen dialect owns compiler traits, migrations, catalog introspection and structural execution; `@zmdb/cockroach` extends its public family
surface with a separate server contract.

## Database-selection workflow

The six official database packages use the same selection workflow. The [package reference](./package-reference.html) owns current install and peer ranges; the
[PostgreSQL package README](https://github.com/ambasta/zmdb/tree/main/packages/postgres#install) includes the standalone TypeScript setup and full capability table.

| Step             | PostgreSQL selection                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install          | `yarn add @zmdb/postgres@1.0.0-beta.2 pg@^8.23.0`                                                                                                                                                                                                         |
| Configure        | Supply an application-owned `pg` client to `postgresDriver(client)`; the application closes it.                                                                                                                                                           |
| Compile          | `createQueryCompiler(postgres)` from `@zmdb/sql` produces SQL and a separate parameter array.                                                                                                                                                             |
| Migrate          | `postgres.migrations.emitUp(operation)` and `postgres.migrations.connection(driver)` supply database-specific DDL and runner behavior; `@zmdb/migrations` owns `up`/`down`.                                                                               |
| Introspect       | `postgres.introspector.snapshot(driver)` reads the real catalog.                                                                                                                                                                                          |
| Execute          | `driver.execute(query)` runs the compiled query; `driver.transaction(...)` pins transaction work.                                                                                                                                                         |
| Capabilities     | Read `postgres.capabilities` and the package capability table; client-specific requirements still apply.                                                                                                                                                  |
| Refusals         | cursor/cancellation paths without the required client support; see the detailed boundaries below.                                                                                                                                                         |
| Testing evidence | [The installed PostgreSQL consumer](https://github.com/ambasta/zmdb/tree/main/fixtures/database-postgres) and [the common six-database qualification](https://github.com/ambasta/zmdb/issues/676) prove their recorded package, client and server inputs. |

A hosted-service connection guide is a recipe using one of these owners or an explicitly supplied structural adapter. Protocol compatibility alone does not create another official package or transfer
the recorded server qualification to that service.

## Selecting it

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies pool, users; this excerpt does not repeat those declarations."}
import { createQueryCompiler } from '@zmdb/sql';
import { postgres, postgresDriver } from '@zmdb/postgres';
import { defineRepository } from '@zmdb/orm';

const compiler = createQueryCompiler(postgres);
const userRepo = defineRepository(users, postgresDriver(pool));
```

## What it emits

|                         | Postgres                               |
| ----------------------- | -------------------------------------- |
| Identifier quoting      | `"users"."id"`                         |
| Placeholders            | `$1`, `$2`, …                          |
| `serial`                | `SERIAL`                               |
| `bigint`                | `BIGINT`                               |
| `boolean`               | `BOOLEAN`                              |
| `json`                  | `JSONB`                                |
| `timestamp`             | `TIMESTAMPTZ`                          |
| `numeric`               | `NUMERIC`                              |
| Case-insensitive `LIKE` | `ILIKE`; also inherited by CockroachDB |
| Materialized views      | supported                              |
| `RETURNING`             | supported                              |

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies compiler; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

compiler.selectFrom(trustedTable('users')).where('email', '=', 'a@b.c').compile();
// { text: 'SELECT * FROM "users" WHERE "email" = $1', parameters: ['a@b.c'], effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true } }
```

## `ilike`

`ilike` is a first-class operator in both the builder and the DTO. PostgreSQL and its CockroachDB family map it to a native operator:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies repo; this excerpt does not repeat those declarations."}
await repo.find({ name: { ilike: '%ada%' } });
// WHERE "name" ILIKE $1
```

On MySQL/SingleStore and SQL Server, case-insensitivity normally comes from the collation instead; on SQLite, `LIKE` is already case-insensitive for ASCII. Cockroach follows the Postgres operator
grammar. If a query has to behave the same on all six, that difference is worth a test.

## SQL features and explicit escape hatches

These guides cover the modeled operations and the places that still require [raw SQL](./raw-sql.html):

- `ON CONFLICT` — see [Upsert](./upsert.html)
- `JSONB` operators (`->>`, `@>`, `?`) — via `unsafeOperator('@>')`, see [JSON Properties](./json-properties.html)
- full-text search with `tsvector` — see [Full-Text Search](./full-text-search.html)
- window functions, recursive CTEs, `LATERAL`
- `FOR UPDATE SKIP LOCKED` — raw SQL only; the [Transactional Outbox](./transactional-outbox.html) deliberately uses a portable conditional lease update instead
- arrays and ranges
- extension SQL beyond the closed pgvector distance and `ST_Contains`/`ST_DWithin` surfaces — see [Database Extensions](./db-extensions.html)

## Operational settings worth having

These belong in your driver's pool config, and each one prevents a specific bad afternoon:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies Pool; this excerpt does not repeat those declarations."}
new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // must be < max_connections / instance count
  statement_timeout: 5_000, // an unbounded query cannot hold a connection forever
  idle_in_transaction_session_timeout: 10_000, // a leaked transaction cannot hold locks forever
  application_name: 'my-service', // shows up in pg_stat_activity
});
```

`idle_in_transaction_session_timeout` is the underrated one: a transaction left open by a thrown error blocks `ALTER TABLE` indefinitely, and this turns that from an outage into an error.

## Types that need a decision

**`bigint` comes back as a string** from `node-postgres`, deliberately, to avoid precision loss. Decide in the driver — see [bigint keys](./bigint-keys.html).

**`numeric` comes back as a string** too, for the same reason. If you are storing money, keeping it a string and doing the arithmetic in the database is the correct answer; parsing it to a float is
how you get rounding errors in an invoice.

**`timestamp` means an instant.** `Sql<'timestamp'>` emits `TIMESTAMPTZ`. Use a [custom type](./custom-types.html) when the driver representation or application wire form needs to differ from `Date`.

## Connecting

Postgres-wire-compatible services include [local Postgres](./connect-postgres.html), [Neon](./connect-neon.html), [Supabase](./connect-supabase.html),
[Vercel Postgres](./connect-vercel-postgres.html), [Xata](./connect-xata.html), [Nile](./connect-nile.html), [PGlite](./connect-pglite.html) and [AWS Data API](./connect-aws-data-api.html). Cockroach
uses the public PostgreSQL-family adapter through its dedicated [`@zmdb/cockroach` package](./dialect-cockroach.html). These hosted-service guides describe connection recipes; they are not additional
official database packages or automatic qualification of every provider API.

---

See also: [Query Compiler](./select.html) · [Connect: Postgres](./connect-postgres.html) · [Raw SQL](./raw-sql.html)
