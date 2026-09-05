Dialect: `'postgres'`. Vercel Postgres is Neon underneath, and the `@vercel/postgres` client is a thin wrapper over `@neondatabase/serverless` — so everything on the [Neon page](./connect-neon.html)
applies.

## Setup

```ts
import { sql } from '@vercel/postgres';
import type { Driver } from '@zmdb/repository';

export const driver: Driver = {
  async execute(query) {
    const result = await sql.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

`sql.query(text, params)` is the parameterised form. The tagged-template form (`sql\`SELECT ...\``) is for hand-written queries; a compiled query already has its parameters separated, so `query` is
the one you want.

The client reads `POSTGRES_URL` from the environment automatically, which `vercel env pull` populates locally.

## Transactions

`@vercel/postgres`'s default export is HTTP-based, and HTTP cannot hold a transaction across statements. Use the pooled client:

```ts
import { createPool } from '@vercel/postgres';

const pool = createPool({ connectionString: process.env.POSTGRES_URL });

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

The same warning as Neon: over HTTP, a transaction block does not error — it just does not give you atomicity. See [Neon](./connect-neon.html).

## Edge runtime

The driver above works in an Edge function unchanged, because it is `fetch` underneath. zmdb itself has nothing that needs Node built-ins on the read path — the compiler is string manipulation and the
validators are generated code:

```ts
export const runtime = 'edge';

export async function GET() {
  const users = await repo.list({ page: { limit: 20 } });
  return Response.json(users);
}
```

## Migrations do not belong in a function

There is no release step in a Vercel deploy, so run migrations from CI before promoting, or manually:

```yaml
- run: node --experimental-strip-types scripts/migrate.ts up
  env: { DATABASE_URL: ${{ secrets.POSTGRES_URL_NON_POOLING }} }
```

Use the **non-pooling** URL for migrations. Multi-statement DDL through a transaction-mode pooler is how you get a half-applied migration. Vercel exposes it as `POSTGRES_URL_NON_POOLING`.

Do not run the migrator at module scope in a serverless function. Every cold start would race every other cold start.

## Instance count and connections

Serverless functions scale to many instances, each potentially holding a connection. Use the pooled URL for request handling, keep your own `max` at 1 or 2 per instance, and let the pooler do the
multiplexing. A `max: 10` in a function that scales to 100 instances is 1000 connections aimed at a database that will accept a fraction of that.

---

See also: [Neon](./connect-neon.html) · [Deploy to Vercel](./deploy-vercel.html) · [Serverless Performance](./perf-serverless.html)
