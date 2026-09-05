MySQL in Docker, with the settings that decide whether your local behaviour matches production.

## Docker Compose

```yaml
services:
  db:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: dev
      MYSQL_DATABASE: app_dev
    ports: ['3306:3306']
    command: >
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_0900_ai_ci
      --sql-mode=STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO
    volumes: ['mysqldata:/var/lib/mysql']
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-pdev']
      interval: 2s
      retries: 20
volumes: { mysqldata }
```

The `command` block is the important part, and it is not optional.

**`utf8mb4`.** MySQL's `utf8` is three bytes and cannot store emoji or many CJK characters. Inserting one either errors or truncates depending on the mode — and truncation silently loses data. `utf8mb4` is the real UTF-8. Set it server-side, per database _and_ per connection, because a mismatch at any layer causes mojibake.

**`STRICT_TRANS_TABLES`.** Without it MySQL truncates an over-long string, turns an invalid date into `0000-00-00` and stores `0` for a bad number — all with a warning, not an error. Strict mode is the default in 8.x, but stating it means a change of image cannot quietly remove it.

**Collation.** `utf8mb4_0900_ai_ci` is accent- and case-**insensitive**, which is MySQL's default and means a unique index on a `varchar` column is already case-insensitive — the opposite of Postgres. Account for that before choosing a [portable uniqueness strategy](./guide-case-insensitive-unique.html). Use `utf8mb4_0900_as_cs` if you want case-sensitive comparisons.

## Connecting

```ts
import { createPool } from 'mysql2/promise';
import type { Driver } from '@zmdb/repository';

const pool = createPool({
  uri: 'mysql://root:dev@localhost:3306/app_dev',
  connectionLimit: 5,
  charset: 'utf8mb4',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export const driver: Driver = {
  async execute(query) {
    const [rows] = await pool.query(query.text, [...query.parameters]);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  },
};
```

`bigNumberStrings` keeps `bigint` columns as strings rather than losing precision in a `number` past 2^53. See [Connect: MySQL](./dialect-mysql.html).

## Applying the schema

```ts
for (const op of diff({ tables: {} }, snapshot(allSchemas))) {
  await driver.execute({ text: emitUp(op, 'mysql'), parameters: [] });
}
```

> [!WARNING]
> MySQL has **no transactional DDL**. A migration that fails halfway leaves the
> schema half-changed, and the runner cannot roll it back. Keep each migration to
> one DDL statement where you can, and be ready to fix state by hand. This is the
> largest practical difference from Postgres. See [Custom Migrations](./migrations-custom.html).

## Resetting between tests

```ts
const tables = ALL_TABLES.map(s => `\`${s.table}\``); // the array you keep — see below

beforeEach(async () => {
  await driver.execute({ text: 'SET FOREIGN_KEY_CHECKS = 0', parameters: [] });
  for (const t of tables) await driver.execute({ text: `TRUNCATE TABLE ${t}`, parameters: [] });
  await driver.execute({ text: 'SET FOREIGN_KEY_CHECKS = 1', parameters: [] });
});
```

`TRUNCATE` is DDL in MySQL, so it commits — you cannot wrap the reset in a transaction, and there is no `CASCADE`. Hence the checks toggle, and hence resetting is slower than on Postgres.

`ALL_TABLES` is an array you keep — `[schemaOf<User>(), schemaOf<Post>(), …]` — because nothing enumerates your tables: a schema comes from a type, and a type cannot register itself. See [Discovery](./web-discovery.html).

Use a separate `app_test` database. Restore `FOREIGN_KEY_CHECKS` in a `finally`, or a failed truncate leaves the session with constraints disabled and later tests pass when they should not.

## Faster for tests

```yaml
command: >
  --innodb-flush-log-at-trx-commit=0
  --sync-binlog=0
  --innodb-doublewrite=0
```

Substantially faster, unsafe on crash, fine for a disposable container.

## What differs from production Postgres

If you develop on MySQL and deploy on Postgres, or run tests on one and ship the other, these are what break:

|                          | MySQL                              | Postgres       |
| ------------------------ | ---------------------------------- | -------------- |
| `RETURNING`              | no                                 | yes            |
| Transactional DDL        | no                                 | yes            |
| `ILIKE`                  | no — `LIKE` is already insensitive | yes            |
| Default collation        | case-insensitive                   | case-sensitive |
| `bigint` from the driver | string                             | string         |
| Upsert                   | `ON DUPLICATE KEY UPDATE`          | `ON CONFLICT`  |
| Boolean                  | `tinyint(1)`                       | real `boolean` |

Pick one dialect per deployment target and test on it. See [Dialect: MySQL](./dialect-mysql.html).

## MariaDB

Mostly compatible, and it does have `RETURNING`. Not identical on JSON functions or window functions. If you deploy MariaDB, develop on MariaDB.

## The client

```bash
docker compose exec db mysql -uroot -pdev app_dev
```

```
SHOW TABLES;
SHOW CREATE TABLE users\G     -- \G for vertical output
EXPLAIN ANALYZE SELECT ...;
SHOW VARIABLES LIKE 'collation%';
```

That last one is the first thing to check when text comparisons behave unexpectedly.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Local Postgres](./guide-local-postgres.html) · [Testing](./testing.html)
