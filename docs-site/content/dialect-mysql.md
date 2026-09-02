MySQL is fully supported by the compiler. The differences from Postgres are in quoting, placeholders, and three type mappings — plus two behaviours that will surprise you if Postgres is your reference point.

## Selecting it

```ts
const compiler = createQueryCompiler('mysql');
const userRepo = defineRepository(users, mysqlDriver(pool), { dialect: 'mysql' });
```

## What it emits

|                    | MySQL                                                |
| ------------------ | ---------------------------------------------------- |
| Identifier quoting | `` `users`.`id` ``                                   |
| Placeholders       | `?`                                                  |
| `serial`           | `INT AUTO_INCREMENT`                                 |
| `bigint`           | `BIGINT`                                             |
| `boolean`          | `TINYINT(1)`                                         |
| `json`             | `JSON`                                               |
| `timestamp`        | `DATETIME`                                           |
| `numeric`          | `DECIMAL`                                            |
| `ilike`            | falls back to `LIKE`                                 |
| Materialized views | **not supported** — throws `UnsupportedFeatureError` |
| `RETURNING`        | **not supported** (MariaDB has it; MySQL does not)   |

```ts
compiler.selectFrom('users').where('email', '=', 'a@b.c').compile();
// { text: 'SELECT * FROM `users` WHERE `email` = ?', parameters: ['a@b.c'] }
```

## No `RETURNING`

This is the difference that changes application code. `repo.create()` cannot get the inserted row back in one statement, so on MySQL you need the generated id from the driver's result metadata:

```ts
const driver: Driver = {
  async execute(q) {
    const [result] = await pool.execute(q.text, [...q.parameters]);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    // an OkPacket from an INSERT/UPDATE/DELETE
    return [{ insertId: result.insertId, affectedRows: result.affectedRows }];
  },
};
```

Then read it back if you need the row:

```ts
await repo.create(dto);
const row = await repo.findOne({ email: { eq: dto.email } });
```

Two round trips. Selecting on a unique column rather than `LAST_INSERT_ID()` is safer across a pool, where the second statement may land on a different connection.

## `boolean` is `TINYINT(1)`

MySQL has no boolean type, so `Sql<'boolean'>` becomes `TINYINT(1)` and comes back as `0` or `1`, not `false` or `true`. `mysql2` does not convert it for you. Fix it in the driver, where you know the schema is a MySQL one:

```ts
// per-column, explicit — a generic 0/1 coercion will mangle real integers
return rows.map(r => ({ ...r, active: Boolean(r.active) }));
```

Or use `mysql2`'s `typeCast` to handle `TINY` columns with length 1 globally. Either way, decide it once — a row where `active` is `0` is truthy in JavaScript, and that bug reads as correct code.

## Case sensitivity

**`LIKE` is case-insensitive by default**, because the default collation is `utf8mb4_0900_ai_ci`. So `like` and `ilike` behave the same, and code written against MySQL will start matching differently the day it runs on Postgres. If you need case-sensitive matching, that is a collation choice:

```sql
ALTER TABLE users MODIFY email VARCHAR(255) COLLATE utf8mb4_0900_as_cs;
```

**Table names are case-sensitive on Linux and not on macOS/Windows**, per `lower_case_table_names`. Use lowercase table names and this never matters.

## `utf8mb4`, not `utf8`

MySQL's `utf8` is three bytes and cannot store an emoji or many CJK characters. Always `utf8mb4`:

```sql
CREATE DATABASE app CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

`VARCHAR(n)` also counts _characters_, but the index key limit counts bytes — so a `utf8mb4` `VARCHAR(768)` is the practical maximum for a single-column index on InnoDB.

## DDL is not transactional

MySQL auto-commits DDL, so a migration with two `ALTER TABLE`s can leave the first applied and the second failed. Wrapping it in `BEGIN`/`COMMIT` does not help. One statement per migration on MySQL. See [migrate](./cli-migrate.html).

## Connecting

[PlanetScale](./connect-planetscale.html), [TiDB](./connect-tidb.html), and any MySQL-compatible server. Note that PlanetScale disallows foreign keys by default, so a hand-written `REFERENCES` clause needs their FK support turned on.

---

See also: [Query Compiler](./select.html) · [Connect: PlanetScale](./connect-planetscale.html) · [Dialect: Postgres](./dialect-postgres.html)
