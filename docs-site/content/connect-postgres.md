Install `@zmdb/postgres` with the `pg` client selected by your application. The package supplies the immutable PostgreSQL dialect, migrations, introspector, and structural driver adapter; it never
constructs a pool or opens a connection.

## With `node-postgres`

```ts
import { Pool } from 'pg';
import { postgresDriver } from '@zmdb/postgres';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  statement_timeout: 5_000,
  idle_in_transaction_session_timeout: 10_000,
  application_name: 'my-service',
});

export const driver = postgresDriver(pool, { cancelVia: pool });
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

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the
first query.

"Unsafe" here means "not built from a template tag" — the parameters are still bound, not interpolated. Concatenating values into `query.text` would be unsafe; this is not.

## Using it

```ts
import { defineRepository } from '@zmdb/repository';

const repo = defineRepository(users, driver);

await repo.findOne({ email: { eq: 'ada@example.com' } });
```

## Pool sizing

The number that matters is `max × instance count ≤ max_connections − headroom`. A `max` of 20 across 10 containers is 200 connections, which is over the default Postgres limit of 100 — and the symptom
is `too many clients already` under load, not at startup.

Keep `max` small. Postgres connections are processes, and a pool of 10 that queues is usually faster than a pool of 50 that thrashes. If you genuinely need more concurrency than that, put PgBouncer in
front — see below.

## PgBouncer

Prepared statements are opt-in in `postgresDriver`. Keep the default when a proxy cannot preserve named statements for a backend session:

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 5_000 });
const driver = postgresDriver(pool); // prepared defaults to false
```

`postgres.js` needs `prepare: false`. Also note that `SET LOCAL` works (it is transaction-scoped) but plain `SET` does not persist, which matters for [SQL comments](./sql-comments.html) and any
session variable you rely on.

## Transactions

A transaction needs one pinned connection; a pool is free to use any. `postgresDriver(pool).transaction()` checks out one client for the whole callback and releases it in `finally`:

```ts
await driver.transaction(async transaction => {
  await transaction.execute({ text: 'SET LOCAL statement_timeout = 5000', parameters: [] });
  // every query here uses the same checked-out client
});
```

The adapter owns only the checkout/release lifecycle for that callback. Pool construction, configuration, and shutdown remain application responsibilities.

## SSL

Managed providers require TLS. Do not disable verification:

```ts
new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
```

`ssl: { rejectUnauthorized: false }` appears in a lot of tutorials and it turns TLS into obfuscation — it encrypts the connection and accepts any certificate, so it does not protect against the attack
TLS exists to prevent. If you need a provider's CA, pass it:

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
