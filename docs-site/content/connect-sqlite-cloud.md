Dialect: `'sqlite'`. SQLite Cloud is hosted SQLite with a wire protocol and an HTTP API. Everything on the [SQLite dialect page](./dialect-sqlite.html) applies.

## Setup

```ts
import { Database } from '@sqlitecloud/drivers';
import type { Driver } from '@zmdb/repository';

const db = new Database(requireEnv('SQLITECLOUD_URL'));

export const driver: Driver = {
  async execute(query) {
    const rows = await db.sql(query.text, ...query.parameters);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  },
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the first query.

The `sql` method takes the statement and positional parameters, which is what a compiled query gives you. Its return type varies by statement kind, hence the `Array.isArray` guard — a write returns metadata, not rows, and `Driver.execute` must resolve to an array.

## Type conversion

The same three types need handling as [local SQLite](./connect-sqlite.html): `boolean` arrives as `0`/`1`, `timestamp` as a string, `json` as text. Hydrate per column in the driver.

## What the hosting adds

**Replicas and read routing.** Reads can be served by a replica; writes go to the primary. That composes with [`withReplicas`](./read-replicas.html) if you have separate connection strings, but read the caveat there — routing is decided from the SQL text, so an unusual statement (a CTE that writes) can be routed wrongly. Send anything unusual to the primary explicitly.

**Eventual consistency on replicas.** A read immediately after a write may not see it. Where that matters, use `RETURNING` so the write returns the row rather than reading it back — SQLite 3.35+ supports it, and `repo.create` uses it.

**Pub/sub and webhooks.** Outside what zmdb touches. If you use them, note that they observe changes the database sees, so writes made through zmdb are visible to them without any integration.

## Concurrency

It is still SQLite: one writer at a time. The hosting removes the deployment constraints — you can autoscale your application, which [local SQLite](./connect-sqlite.html) does not allow — but it does not remove write serialisation. A write-heavy workload will queue.

Set a generous busy timeout if the client exposes one, and prefer batched writes over many small ones:

```ts
const q = createQueryCompiler('sqlite').insertInto('events').values(rows).compile();
await driver.execute(q);
```

One statement inserting 500 rows rather than 500 statements is the difference between usable and not, over a network.

## Migrations

`MigrationConnection` over the same client:

```ts
export const conn: MigrationConnection = {
  async exec(sql) {
    await db.sql(sql);
  },
  async appliedVersions() {
    const rows = await db.sql(`SELECT version FROM "_zmdb_migrations"`);
    return (rows as { version: number }[]).map(r => r.version);
  },
  async appliedMigrations() {
    return db.sql(`SELECT version, name, checksum FROM "_zmdb_migrations" ORDER BY version`);
  },
  async recordApplied(version, name, checksum) {
    await db.sql(
      `INSERT INTO "_zmdb_migrations" (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`,
      version,
      name,
      Date.now(),
      checksum ?? null,
    );
  },
  async recordReverted(version) {
    await db.sql(`DELETE FROM "_zmdb_migrations" WHERE version = ?`, version);
  },
};
```

See [Migration Runner](./migrations-cli.html).

---

See also: [Dialect: SQLite](./dialect-sqlite.html) · [Turso](./connect-turso.html) · [Read Replicas](./read-replicas.html)
