> **ToDo / feature gap.** There is no `zmdb up` executable. `runCli` is the
> command, complete and public; only the wrapper is missing.

## Running it

```ts
import { runCli } from '@zmdb/query-compiler/migrations/runner';
import { conn, migrations } from './db-config.js';

await runCli('up', conn, migrations);
```

What happens, in order:

1. `conn.appliedVersions()` — which versions the database says it has
2. filter `migrations` to those not applied, sorted by `version`
3. for each: `conn.exec(m.up)`, then `conn.recordApplied(m.version, m.name)`

Idempotent, because step 1 is a query rather than an assumption. `runCli('down', …)` reverses the most recent applied migration and calls `recordReverted`.

## `up` versus `migrate`

They are the same operation. Drizzle and MikroORM both ship two names for it — `migrate` from the SQL-file world, `up` from the umzug world — and zmdb's runner takes `'up'` and `'down'`. See [migrate](./cli-migrate.html) for deployment, locking and rolling-deploy ordering, which is where the real content is.

## The connection

`MigrationConnection` is four methods and you implement it once:

```ts
export const conn: MigrationConnection = {
  async exec(sql) {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  },
  async appliedVersions() {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "_migrations" ("version" BIGINT PRIMARY KEY, "name" TEXT NOT NULL,
        "applied_at" TIMESTAMP NOT NULL DEFAULT now())`,
    );
    const r = await client.query(`SELECT version FROM "_migrations" ORDER BY version`);
    return r.rows.map(row => Number(row.version));
  },
  async recordApplied(version, name) {
    await client.query(`INSERT INTO "_migrations" ("version","name") VALUES ($1,$2)`, [version, name]);
  },
  async recordReverted(version) {
    await client.query(`DELETE FROM "_migrations" WHERE "version" = $1`, [version]);
  },
};
```

The `CREATE TABLE IF NOT EXISTS` inside `appliedVersions` is deliberate: it makes a fresh database work with no bootstrap step. See [Migration Runner](./migrations-cli.html).

## Applying only some of them

`runCli` applies everything pending. To stop at a version, filter the array — the runner takes the migrations as an argument, so this needs no feature:

```ts
await runCli(
  'up',
  conn,
  migrations.filter(m => m.version <= target),
);
```

Which is also how you write a test that exercises the state between two migrations.

## What a real `up` would add

`--to <version>`, `--step <n>`, `--dry-run` printing the SQL, and a `status` subcommand listing applied and pending versions. Each is a few lines over `appliedVersions()` and the array; `status` is the one worth writing first, because "which migrations has production actually run" is a question you ask under pressure.

---

See also: [migrate](./cli-migrate.html) · [Migration Runner](./migrations-cli.html) · [CLI Overview](./cli-overview.html)
