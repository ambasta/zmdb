Postgres is the dialect with the fewest compromises: it is the only one where materialized views compile, and its placeholder and quoting rules are what the compiler was designed around first.

## Selecting it

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';
import { defineRepository } from '@zmdb/repository';

const compiler = createQueryCompiler('postgres');
const userRepo = defineRepository(users, pgDriver(pool), { dialect: 'postgres' });
```

## What it emits

|                         | Postgres                           |
| ----------------------- | ---------------------------------- |
| Identifier quoting      | `"users"."id"`                     |
| Placeholders            | `$1`, `$2`, …                      |
| `serial`                | `SERIAL`                           |
| `bigint`                | `BIGINT`                           |
| `boolean`               | `BOOLEAN`                          |
| `json`                  | `JSONB`                            |
| `timestamp`             | `TIMESTAMP`                        |
| `numeric`               | `NUMERIC`                          |
| Case-insensitive `LIKE` | `ILIKE` — the only dialect with it |
| Materialized views      | supported                          |
| `RETURNING`             | supported                          |

```ts
compiler.selectFrom('users').where('email', '=', 'a@b.c').compile();
// { text: 'SELECT * FROM "users" WHERE "email" = $1', parameters: ['a@b.c'] }
```

## `ilike`

`ilike` is a first-class operator in both the builder and the DTO, and Postgres is the only dialect where it maps to a native operator:

```ts
await repo.find({ name: { ilike: '%ada%' } });
// WHERE "name" ILIKE $1
```

On MySQL and SQL Server, case-insensitivity normally comes from the collation instead; on SQLite,
`LIKE` is already case-insensitive for ASCII. If a query has to behave the same on all four,
that difference is worth a test.

## Features you reach past the builder for

Postgres has a lot the builder does not model. All of them work through [raw SQL](./raw-sql.html):

- `ON CONFLICT` — see [Upsert](./upsert.html)
- `JSONB` operators (`->>`, `@>`, `?`) — see [JSON Properties](./json-properties.html)
- full-text search with `tsvector` — see [Full-Text Search](./full-text-search.html)
- window functions, recursive CTEs, `LATERAL`
- `FOR UPDATE SKIP LOCKED` — raw SQL only; the
  [Transactional Outbox](./transactional-outbox.html) deliberately uses a
  portable conditional lease update instead
- arrays and ranges
- extension SQL beyond the closed pgvector distance and
  `ST_Contains`/`ST_DWithin` surfaces — see
  [Database Extensions](./db-extensions.html)

## Operational settings worth having

These belong in your driver's pool config, and each one prevents a specific bad afternoon:

```ts
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

**`numeric` comes back as a string** too, for the same reason. If you are storing money, keeping it a string and doing the arithmetic in the database is the correct answer; parsing it to a float is how you get rounding errors in an invoice.

**`timestamp` versus `timestamptz`.** `Sql<'timestamp'>` emits plain `TIMESTAMP`, which has no timezone. If you want `timestamptz`, that is a hand-written migration and a [custom type](./custom-types.html).

## Connecting

Any Postgres-wire-compatible service works through this dialect: [local Postgres](./connect-postgres.html), [Neon](./connect-neon.html), [Supabase](./connect-supabase.html), [Vercel Postgres](./connect-vercel-postgres.html), [Xata](./connect-xata.html), [Nile](./connect-nile.html), [PGlite](./connect-pglite.html), [AWS Data API](./connect-aws-data-api.html) and [Cockroach](./dialect-cockroach.html).

---

See also: [Query Compiler](./select.html) · [Connect: Postgres](./connect-postgres.html) · [Raw SQL](./raw-sql.html)
