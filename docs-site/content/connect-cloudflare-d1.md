Dialect: `'sqlite'`. D1 is SQLite at the edge, accessed through a Worker binding rather than a connection string — which is the main thing that shapes how you wire it up.

## Setup

```ts
import type { Driver } from '@zmdb/repository';

export function d1Driver(db: D1Database): Driver {
  return {
    async execute(query) {
      const stmt = db.prepare(query.text).bind(...query.parameters);
      const { results } = await stmt.all<Record<string, unknown>>();
      return results ?? [];
    },
  };
}
```

There is no module-scope client, because the binding only exists inside a request:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = defineRepository(users, d1Driver(env.DB), { dialect: 'sqlite' });
    const { items } = await repo.list({ page: { limit: 20 } });
    return Response.json(items);
  },
};
```

Constructing the repository per request is cheap — it is an object over a driver, not a pool.

## `wrangler.toml`

```toml
[[d1_databases]]
binding = "DB"
database_name = "app"
database_id = "..."
```

## Batching matters more here than anywhere else

D1 charges round trips, and an edge Worker may be far from the database. Use the batch API for multiple statements:

```ts
const stmts = queries.map(q => db.prepare(q.text).bind(...q.parameters));
const results = await db.batch(stmts);
```

Compile with the builder, hand over `text`/`parameters`. A `populate` call is two statements — fine. A loop of `findById` calls is a loop of round trips, and that is where a request goes from 20ms to 2s. See [Loading Strategies](./loading-strategies.html).

## Transactions

D1 has **no interactive transactions.** `db.batch()` is atomic — all statements succeed or none do — but you cannot read a value, decide, and then write within one transaction. That rules out:

- the read-then-write [upsert workaround](./upsert.html) — use raw `ON CONFLICT` instead, which D1 supports
- `createTransactionalDb`, which assumes an interactive session
- anything needing `SELECT ... FOR UPDATE`

Design around it: make writes idempotent, use `ON CONFLICT`, and put multi-statement atomic work in one `batch`.

## Type conversion

SQLite storage classes, so `boolean`, `timestamp` and `json` need hydrating — see [Connect: SQLite](./connect-sqlite.html). D1 returns plain JSON values, so a `boolean` column is `0` or `1`.

## Migrations

Wrangler has its own migration system (`wrangler d1 migrations`), which expects `.sql` files in a directory. That pairs well with zmdb: [generate](./cli-generate.html) writes the SQL, Wrangler applies it.

```bash
node --experimental-strip-types scripts/generate.ts add_slug   # writes migrations/*.up.sql
wrangler d1 migrations apply app
```

Point your generate script at `migrations/` with Wrangler's naming convention and the two fit together with no glue. Using `runCli` instead is possible — a `MigrationConnection` over the binding — but it can only run inside a Worker, which is an awkward place to run migrations.

## Limits

Database size, statement count per batch and query duration are all capped, and the caps change. A `find({})` over a large table will hit one of them. Paginate everything; there is no [streaming](./streaming.html) to fall back on.

---

See also: [Dialect: SQLite](./dialect-sqlite.html) · [Durable Objects](./connect-cloudflare-do.html) · [Serverless Performance](./perf-serverless.html)
