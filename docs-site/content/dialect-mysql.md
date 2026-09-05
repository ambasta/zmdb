The query compiler and DDL emitter support MySQL. The repository has no bundled MySQL driver or live-server gate, and its row-returning write methods are deliberately narrower: `create`, ordinary
`update`, and ordinary `upsert` refuse because MySQL cannot satisfy their returned-entity contract in one statement.

## Selecting it

```ts
const compiler = createQueryCompiler('mysql');
const userRepo = defineRepository(users, driver, { dialect: 'mysql' });
```

`driver` is your `Driver` adapter around `mysql2`, PlanetScale, TiDB, or another MySQL-protocol client; none is bundled.

## What it emits

|                    | MySQL                                                |
| ------------------ | ---------------------------------------------------- |
| Identifier quoting | `` `users`.`id` ``                                   |
| Placeholders       | `?`                                                  |
| `serial`           | `INT AUTO_INCREMENT`                                 |
| `bigint`           | `BIGINT`                                             |
| `boolean`          | `TINYINT(1)`                                         |
| `json`             | `JSON`                                               |
| `timestamp`        | `DATETIME(3)`                                        |
| `numeric`          | `DECIMAL`                                            |
| `ilike`            | falls back to `LIKE`                                 |
| Materialized views | **not supported** — throws `UnsupportedFeatureError` |
| `RETURNING`        | **not supported** (MariaDB has it; MySQL does not)   |

```ts
compiler.selectFrom('users').where('email', '=', 'a@b.c').compile();
// { text: 'SELECT * FROM `users` WHERE `email` = ?', parameters: ['a@b.c'] }
```

## No `RETURNING`

The compiler refuses every MySQL `returning()` request before producing a `CompiledQuery`:

```text
returning is not supported for INSERT on dialect "mysql"; omit returning() and perform an explicit read
```

The capability is declared separately for INSERT, upsert, UPDATE, and DELETE. That distinction can represent an INSERT-only MariaDB dialect later without making MySQL emit syntax it does not support.

`BaseRepository.create`, an ordinary value-bearing `update`, and an ordinary `upsert` propagate that refusal before driver execution because their public return types promise a row. They neither emit
invalid SQL nor silently resolve to `undefined`. Use a lower-level statement without `returning()` and then read by a known primary or unique key:

```ts
const driver: Driver = {
  async execute(q) {
    const [result] = await pool.execute(q.text, [...q.parameters]);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    // an OkPacket from an INSERT/UPDATE/DELETE
    return [{ insertId: result.insertId, affectedRows: result.affectedRows }];
  },
};

await driver.execute(compiler.insertInto('users').values(dto).compile());
const row = await userRepo.findOne({ email: { eq: dto.email } });
```

That is two round trips and bypasses repository write validation, so validate the payload before compiling. Selecting on a supplied unique value is safe across a pool; `LAST_INSERT_ID()` is
connection-local and needs both statements pinned to the same connection.

Expression-valued repository writes have a narrower explicit contract: `update(id, { count: inc(1) })`, `increment`, every `updateMany`, and an expression-valued `upsert` update object omit
unsupported `RETURNING`, execute one statement, and resolve to `undefined`. They do not issue a hidden follow-up `SELECT`.

## `boolean` is `TINYINT(1)`

MySQL has no boolean type, so `Sql<'boolean'>` becomes `TINYINT(1)` and comes back as `0` or `1`, not `false` or `true`. `mysql2` does not convert it for you. Fix it in the driver, where you know the
schema is a MySQL one:

```ts
// per-column, explicit — a generic 0/1 coercion will mangle real integers
return rows.map(r => ({ ...r, active: Boolean(r.active) }));
```

Or use `mysql2`'s `typeCast` to handle `TINY` columns with length 1 globally. Either way, decide it once — a row where `active` is `0` is truthy in JavaScript, and that bug reads as correct code.

## Case sensitivity

**`LIKE` is case-insensitive by default**, because the default collation is `utf8mb4_0900_ai_ci`. So `like` and `ilike` behave the same, and code written against MySQL will start matching differently
the day it runs on Postgres. If you need case-sensitive matching, that is a collation choice:

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

MySQL auto-commits DDL, so a migration with two `ALTER TABLE`s can leave the first applied and the second failed. Wrapping it in `BEGIN`/`COMMIT` does not help. One statement per migration on MySQL.
See [migrate](./cli-migrate.html).

## Connecting

[PlanetScale](./connect-planetscale.html), [TiDB](./connect-tidb.html), and any MySQL-compatible server. PlanetScale may have foreign keys disabled; generated constraints from `References<…>` need
that support turned on before migration.

---

See also: [Query Compiler](./select.html) · [Connect: PlanetScale](./connect-planetscale.html) · [Dialect: Postgres](./dialect-postgres.html)
