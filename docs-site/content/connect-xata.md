Dialect: `'postgres'`. Xata offers a Postgres-compatible endpoint, so a standard client works and the Xata SDK is not needed.

## Setup

```ts
import { Pool } from 'pg';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({
  connectionString: process.env.XATA_POSTGRES_URL,
  ssl: { rejectUnauthorized: true },
  max: 5,
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

The connection string comes from Xata's dashboard and includes the branch. Everything on the [Postgres dialect page](./dialect-postgres.html) applies.

## Branches

Xata's branching model is the same idea as [Neon's](./connect-neon.html), and it fits zmdb's offline generation the same way: the connection string encodes the branch, so pointing at a preview branch
is an environment variable change.

```ts
const branch = process.env.XATA_BRANCH ?? 'main';
```

Run `runCli('up', conn, migrations)` against the branch and you have a database with your schema, from the same SQL that will run against `main`.

## Xata's own schema layer

Xata historically presented a schema of its own, managed through its API and CLI, with columns like `xata.version` and a `link` column type. If your database was created that way, those columns exist
and zmdb's schema objects do not know about them.

Two consequences:

- **Declare every column, including Xata's.** A column absent from the schema object looks like a column to drop when you generate a migration. See [Schema-first](./schema-first.html).
- **Prefer letting zmdb own the schema.** Creating tables through zmdb migrations rather than the Xata UI means one source of truth. Mixing the two gives you two systems that both believe they define
  the table.

If you are adopting an existing Xata database, run [`zmdb pull`](./cli-pull.html) through the configured PostgreSQL driver, review the protected staging declarations, then add the comparison from
[Schema-first](./schema-first.html). Xata-specific columns that the declaration vocabulary cannot represent are omitted with structural warnings and matching `TODO` comments.

## File attachments and search

Xata's file storage and its search API are not SQL, so they are outside what zmdb touches. Use their SDK for those and the Postgres endpoint for your relational data; the two coexist in one
application without interacting.

For full-text search over ordinary columns, Postgres' own `tsvector` works through the Postgres endpoint — see [Full-Text Search](./full-text-search.html) — so Xata's search API is a choice rather
than a requirement.

## Serverless

Xata is aimed at serverless, so the [connection-count arithmetic](./connect-postgres.html) matters: keep `max` low per instance, and prefer their pooled endpoint if one is offered for your plan. See
[Serverless Performance](./perf-serverless.html).

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Schema-first](./schema-first.html) · [Serverless Performance](./perf-serverless.html)
