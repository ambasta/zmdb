Dialect: `'mysql'`. TiDB speaks the MySQL protocol, so `mysql2` connects and the [MySQL dialect](./dialect-mysql.html) applies. TiDB Serverless additionally offers an HTTP driver for edge runtimes.

## Setup

```ts {"mode":"compile","id":"example-001"}
import { createPool } from 'mysql2/promise';
import { mysqlDriver } from '@zmdb/mysql';

const uri = process.env.TIDB_URL;
if (uri === undefined) throw new Error('TIDB_URL is required');

const pool = createPool({
  uri,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
});

export const driver = mysqlDriver(pool);
```

TiDB Cloud requires TLS 1.2 or higher and will reject a connection without it.

## What being distributed changes

**`AUTO_INCREMENT` is allocated in per-node batches.** Ids are unique but not globally monotonic, so "higher id means newer" is false. That breaks two common patterns:

- [Keyset pagination](./guide-cursor-pagination.html) ordered by id can return rows out of insertion order. Order by a timestamp with the id as a tie-break.
- Any code inferring recency from an id is wrong. Use a `createdAt` column.

TiDB also offers `AUTO_RANDOM` for primary keys, which spreads writes rather than concentrating them on the last region. On a write-heavy table that is the better choice, and it needs a hand-written
migration since `Serial` emits `AUTO_INCREMENT`:

```ts {"mode":"illustrative","id":"example-002","reason":"This object or configuration fragment omits the surrounding assignment or call that supplies its context."}
{
  version: 1,
  name: 'events',
  up: `CREATE TABLE events (
         id BIGINT PRIMARY KEY AUTO_RANDOM,
         payload JSON NOT NULL
       )`,
  down: 'DROP TABLE events',
}
```

Declare it as `id: bigint & Sql<'bigint'> & PrimaryKey` on the interface — `Serial` would emit `AUTO_INCREMENT` and fight the migration — and read [bigint keys](./bigint-keys.html), because
`AUTO_RANDOM` produces values well above `Number.MAX_SAFE_INTEGER`. This is the one place where the string representation is not optional.

**Optimistic transactions retry.** TiDB's default transaction mode can fail on write conflict and expects the client to retry. The MySQL dialect does not classify TiDB-specific retry codes, so wrap
that error explicitly; the [Cockroach page](./dialect-cockroach.html) shows why replaying a transaction body must be opt-in.

**`SELECT ... FOR UPDATE` behaves differently** under optimistic transactions. If your own raw SQL relies on row locks, use pessimistic transaction mode, which is the default on recent versions but
worth confirming. The shipped [transactional outbox](./transactional-outbox.html) does not need that mode: it claims with a conditional lease update and authoritative token read-back.

## HTAP and follower reads

TiDB's column-store replicas (TiFlash) make analytical queries fast without a separate warehouse. There is no builder support for targeting them; it is a session variable or a hint, so
[raw SQL](./raw-sql.html):

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies driver; this excerpt does not repeat those declarations."}
await driver.execute({ effects: { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: false }, text: `SET SESSION tidb_isolation_read_engines = 'tiflash'`, parameters: [] });
```

Do this on a dedicated read driver rather than your main one — see [Read Replicas](./read-replicas.html) for the wrapper pattern, which composes here.

## The MySQL caveats still apply

No `RETURNING`: row-returning repository `create`/ordinary `update`/ordinary `upsert` refuse, while the documented one-statement expression branches resolve to `undefined`. Also account for `boolean`
as `TINYINT(1)`, case-insensitive `LIKE` by default, and non-transactional DDL. See [Dialect: MySQL](./dialect-mysql.html).

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [bigint keys](./bigint-keys.html) · [Read Replicas](./read-replicas.html)
