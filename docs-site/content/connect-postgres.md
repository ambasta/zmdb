Dialect: `'postgres'`. zmdb has no client of its own — you write a `Driver` over `pg` or `postgres.js` and pass it to your repositories.

## With `node-postgres`

```ts
import { Pool } from 'pg';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  statement_timeout: 5_000,
  idle_in_transaction_session_timeout: 10_000,
  application_name: 'my-service',
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

## With `postgres.js`

`postgres.js` prefers tagged templates, but its `unsafe` method takes text and parameters, which is what a compiled query is:

```ts
import postgres from 'postgres';

const sql = postgres(requireEnv('DATABASE_URL'), { max: 10 });

export const driver: Driver = {
  async execute(query) {
    return await sql.unsafe(query.text, query.parameters as never[]);
  },
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the first query.

"Unsafe" here means "not built from a template tag" — the parameters are still bound, not interpolated. Concatenating values into `query.text` would be unsafe; this is not.

## Using it

```ts
import { defineRepository } from '@zmdb/repository';

const repo = defineRepository(users, pgDriver(pool), { dialect: 'postgres' });

await repo.findOne({ email: { eq: 'ada@example.com' } });
```

## Pool sizing

The number that matters is `max × instance count ≤ max_connections − headroom`. A `max` of 20 across 10 containers is 200 connections, which is over the default Postgres limit of 100 — and the symptom is `too many clients already` under load, not at startup.

Keep `max` small. Postgres connections are processes, and a pool of 10 that queues is usually faster than a pool of 50 that thrashes. If you genuinely need more concurrency than that, put PgBouncer in front — see below.

## PgBouncer

In **transaction pooling** mode, prepared statements do not survive between statements, so turn them off in your client:

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 5_000 });
// node-postgres: do not use `pool.query({ name: '...' })` — named statements break in transaction mode
```

`postgres.js` needs `prepare: false`. Also note that `SET LOCAL` works (it is transaction-scoped) but plain `SET` does not persist, which matters for [SQL comments](./sql-comments.html) and any session variable you rely on.

## Transactions

A transaction needs one pinned connection; a pool is free to use any. So build the transactional connection from a checked-out client:

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const client = await pool.connect();
try {
  const db = createTransactionalDb({
    execute: async q => (await client.query(q.text, [...q.parameters])).rows,
  });
  await db.transaction(async () => {
    /* ... */
  });
} finally {
  client.release();
}
```

The `finally` is not optional — a client that is never released is a connection leaked for the lifetime of the process.

## SSL

Managed providers require TLS. Do not disable verification:

```ts
new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
```

`ssl: { rejectUnauthorized: false }` appears in a lot of tutorials and it turns TLS into obfuscation — it encrypts the connection and accepts any certificate, so it does not protect against the attack TLS exists to prevent. If you need a provider's CA, pass it:

```ts
ssl: {
  ca: readFileSync('./ca.pem', 'utf8');
}
```

## Health check

```ts
export async function ping(): Promise<boolean> {
  try {
    await driver.execute({ text: 'SELECT 1', parameters: [] });
    return true;
  } catch {
    return false;
  }
}
```

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Writing a Driver](./custom-driver.html) · [Transactions](./transactions.html)
