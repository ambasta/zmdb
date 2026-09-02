Dialect: `'mysql'`. PlanetScale is MySQL-compatible (Vitess underneath), so the MySQL dialect applies — along with two constraints that change how you design a schema.

## Setup

Over the serverless HTTP driver, which works in edge runtimes:

```ts
import { connect } from '@planetscale/database';
import type { Driver } from '@zmdb/repository';

const conn = connect({ url: process.env.DATABASE_URL });

export const driver: Driver = {
  async execute(query) {
    const result = await conn.execute(query.text, [...query.parameters]);
    return result.rows as Record<string, unknown>[];
  },
};
```

Or over `mysql2` for a long-running server:

```ts
import { createPool } from 'mysql2/promise';

const pool = createPool({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

export const driver: Driver = {
  async execute(query) {
    const [rows] = await pool.execute(query.text, [...query.parameters]);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  },
};
```

## Foreign keys

PlanetScale historically disallowed them, and support depends on your plan and configuration. If they are off, a `REFERENCES` clause is rejected.

What you keep either way is the **declaration**: `References<'authors.id'>` records the target on the column IR, where the query compiler and the emitted documents can read it, and that costs nothing at the database. It is a string literal, though — nothing cross-checks that `authors.id` exists. What you lose is enforcement — so a dangling `authorId` becomes possible, and cascades do not exist. See [Cascading](./cascading.html).

If FKs are unavailable, do writes through repositories and add integrity checks you run periodically:

```ts
const orphans = await driver.execute({
  text: 'SELECT p.id FROM posts p LEFT JOIN authors a ON a.id = p.author_id WHERE a.id IS NULL',
  parameters: [],
});
```

## No transactional DDL, and deploy requests

Vitess applies schema changes through its own workflow (deploy requests / online DDL) rather than by running your `ALTER TABLE` directly. That has two implications for [migrations](./migrations.html):

- **Multi-statement `up` values are risky.** One statement per migration. MySQL auto-commits DDL anyway — see [Dialect: MySQL](./dialect-mysql.html).
- **The migration may be applied out of band.** If your team uses deploy requests, the SQL from [generate](./cli-generate.html) is the input to that process rather than something `runCli` applies. Export it:

  ```bash
  node --experimental-strip-types scripts/export.ts mysql
  ```

  See [export](./cli-export.html).

## Branches

PlanetScale branches are a good fit for zmdb's offline generation: the migration SQL in the pull request is generated without a database, then applied to a branch to verify, then promoted. Point `DATABASE_URL` at the branch in CI.

## The MySQL differences still apply

- **No `RETURNING`.** `repo.create()` cannot return the row; read it back. See [Dialect: MySQL](./dialect-mysql.html).
- **`boolean` is `TINYINT(1)`** and comes back as `0`/`1`. Convert in the driver — `0` is truthy in JavaScript, and that bug reads as correct code.
- **`LIKE` is case-insensitive** by default collation, so `like` and `ilike` behave the same.

## Serverless

The HTTP driver has no connection to establish, which makes it a genuinely good serverless story — no pool sizing, no connection-count arithmetic. It also cannot hold a transaction across statements, for the same reason [Neon's HTTP path](./connect-neon.html) cannot. Use `mysql2` where you need one.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Cascading](./cascading.html) · [Serverless Performance](./perf-serverless.html)
