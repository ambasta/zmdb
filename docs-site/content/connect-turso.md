Dialect: `'sqlite'`. Turso is libSQL — SQLite with a server, replicas and an HTTP API — so the [SQLite dialect](./dialect-sqlite.html) applies, including its type conversions.

## Setup

```ts
import { createClient, type InValue } from '@libsql/client';
import type { Driver } from '@zmdb/repository';

const client = createClient({
  url: requireEnv('TURSO_DATABASE_URL'),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function toInValue(value: unknown): InValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (value instanceof Date || value instanceof Uint8Array) return value;
  return JSON.stringify(value); // json columns arrive as objects
}

export const driver: Driver = {
  async execute(query) {
    const result = await client.execute({
      sql: query.text,
      args: query.parameters.map(toInValue),
    });
    return result.rows.map(row => Object.fromEntries(result.columns.map((name, index) => [name, row[index]])));
  },
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the
first query.

Two boundary details, both of which other libSQL snippets paper over with a cast. `query.parameters` is `readonly unknown[]`, and libSQL's `InValue` is a closed union — so the conversion is a real
narrowing, and the `JSON.stringify` fallback is the decision about what happens to a JSON column value rather than a runtime surprise. And a libSQL `Row` is an array-like with numeric _and_ named
access; rebuilding it against `result.columns` gives you a plain `Record<string, unknown>`, which is what `Driver.execute` promises to return.

Works in Node, Bun, Deno, Cloudflare Workers and Vercel Edge, because it is `fetch` underneath.

## Embedded replicas

This is Turso's distinguishing feature: a local SQLite file kept in sync with the remote, so reads are local-disk fast and writes go to the primary.

```ts
const client = createClient({
  url: 'file:local.db',
  syncUrl: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncInterval: 60,
});
```

The consequence to internalise: **reads are eventually consistent.** A write followed immediately by a read may not see it, because the read went to the local replica. If a request writes and then
reads back, sync explicitly:

```ts
await repo.create(dto);
await client.sync();
const row = await repo.findOne({ email: { eq: dto.email } });
```

Or use the `RETURNING` clause so the write itself gives you the row — libSQL supports it, so `repo.create` gets the row back in one statement and no read-after-write question arises. That is the
better answer.

## Type conversion

libSQL returns SQLite's storage classes, so `boolean`, `timestamp` and `json` need hydrating exactly as on [local SQLite](./connect-sqlite.html):

```ts
const hydrate = (r: Record<string, unknown>) => ({
  ...r,
  active: r.active === undefined ? undefined : Boolean(r.active),
  createdAt: typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt,
});
```

Note that libSQL may return `bigint` for large integers rather than `number`, which will fail a validator check against a `number`-typed field — correctly. See [bigint keys](./bigint-keys.html).

## Batches and transactions

libSQL has a batch API that sends several statements in one round trip, which matters over HTTP:

```ts
await client.batch(
  [
    { sql: q1.text, args: q1.parameters.map(toInValue) },
    { sql: q2.text, args: q2.parameters.map(toInValue) },
  ],
  'write',
);
```

Compile the statements with the builder and hand over `text`/`parameters`. For interactive transactions, `client.transaction()` holds a session:

```ts
const tx = await client.transaction('write');
try {
  await tx.execute({ sql: q.text, args: q.parameters.map(toInValue) });
  await tx.commit();
} catch (e) {
  await tx.rollback();
  throw e;
}
```

Wrap that as a `Driver` and pass it to `createTransactionalDb`. See [Transactions](./transactions.html).

## Multi-tenancy by database

Turso's model makes a database-per-tenant genuinely practical, which sidesteps the [entity-filter problem](./entity-filters.html) entirely:

```ts
const clientFor = (tenant: string) =>
  createClient({
    url: `libsql://${tenant}-myorg.turso.io`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

const repo = defineRepository(users, driverFor(clientFor(tenant)), { dialect: 'sqlite' });
```

The cost is that migrations must run against every tenant database. `runCli` takes a connection, so that is a loop — and a loop that must be resumable, because failing halfway through a thousand
tenants is a state you have to recover from. Record progress.

---

See also: [Dialect: SQLite](./dialect-sqlite.html) · [Connect: SQLite](./connect-sqlite.html) · [Entity Filters](./entity-filters.html)
