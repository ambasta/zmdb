Dialect: `'postgres'`. Neon is serverless Postgres with two access paths, and which you pick depends on where your code runs.

## Over HTTP — for serverless and edge

```ts
import { neon } from '@neondatabase/serverless';
import type { Driver } from '@zmdb/repository';

const sql = neon(requireEnv('DATABASE_URL'));

export const driver: Driver = {
  async execute(query) {
    return (await sql.query(query.text, [...query.parameters])) as Record<string, unknown>[];
  },
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the
first query.

One HTTP round trip per statement, no connection to establish, and it works in Cloudflare Workers, Vercel Edge and Deno Deploy. This is the right choice for anything short-lived.

## Over WebSockets — when you need a session

```ts
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

Use this when you need **transactions**, since those require several statements on one connection. The HTTP path cannot do that — each `sql.query` is independent, so `BEGIN` and `COMMIT` land on
different sessions and the transaction does nothing.

> [!WARNING] This is the failure mode worth internalising: over HTTP, a `db.transaction()` block runs each statement in its own implicit transaction, succeeds, and gives you no atomicity. It does not
> error. Use the `Pool` for anything transactional.

## Connection pooling

Neon offers a pooled endpoint (a `-pooler` host) backed by PgBouncer in transaction mode. Use it for serverless, where each invocation may open a connection, and remember that transaction-mode pooling
breaks prepared statements and session-level `SET`. See [Postgres](./connect-postgres.html).

For long-running servers, the direct endpoint plus your own pool is usually better — you keep prepared statements and session state.

## Cold starts

A Neon compute suspends after inactivity and takes a few hundred milliseconds to resume. The first query after idle is slow. Two things help:

- Set a `statement_timeout` generous enough not to trip over a resume.
- Do not use a health check that hits the database on a tight interval purely to keep it warm — that defeats scale-to-zero, which is what you are paying for.

## Branches

Neon's database branching pairs well with zmdb's offline migration generation: create a branch per pull request, point `DATABASE_URL` at it, run `runCli('up', …)`, and the branch is a real database
with your schema in it.

```yaml
- run: node --experimental-strip-types scripts/migrate.ts up
  env:
    DATABASE_URL: ${{ steps.neon-branch.outputs.db_url }}
```

Because [generate](./cli-generate.html) never reads the database, the migration SQL in the pull request is the same SQL that will run against production — the branch is validating it, not producing
it.

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Serverless Performance](./perf-serverless.html) · [Deploy to Vercel](./deploy-vercel.html)
