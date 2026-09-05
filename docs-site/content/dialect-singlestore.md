Supported dialect variant: `'singlestore'`. It inherits the MySQL query family and adds explicit distribution/storage declarations plus SingleStore-specific refusals. The repository ships no
MySQL-protocol driver and the automated gate does not run a licensed SingleStore service, so live-server acceptance remains deployment evidence rather than repository evidence.

## Using it

```ts
import type { Driver } from '@zmdb/repository';

const compiler = createQueryCompiler('singlestore');
const driver: Driver = {
  dialect: 'singlestore',
  async execute(query) {
    const [result] = await pool.execute(query.text, [...query.parameters]);
    return Array.isArray(result) ? result : [];
  },
};
const userRepo = defineRepository(users, driver, { dialect: 'singlestore' });
```

Connect with a MySQL-protocol client through the [custom-driver boundary](./custom-driver.html). Everything on the [MySQL dialect page](./dialect-mysql.html) still applies: backtick quoting, `?`
placeholders, `TINYINT(1)` booleans, `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, and no `RETURNING`.

## Divergence and refusal matrix

| Construct                   | Emitted SQL / behavior                              | Caveat or refusal                                               |
| --------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| identifiers / placeholders  | MySQL backticks and `?`                             | supply a MySQL-protocol `Driver`; none is bundled               |
| upsert                      | `ON DUPLICATE KEY UPDATE`                           | the MySQL family has no conflict-target syntax                  |
| returning rows              | refused                                             | repository paths do not issue a hidden follow-up read           |
| `serial`                    | `BIGINT AUTO_INCREMENT`                             | allocation is partitioned; `Serial` is still typed as `number`  |
| table storage/distribution  | `SHARD KEY`, `SORT KEY`, or `CREATE ROWSTORE TABLE` | every generated table must declare `ShardKey<…>` or `Rowstore`  |
| table-option change         | refused                                             | create a replacement table and copy the data                    |
| foreign keys                | refused                                             | enforce referential integrity in the application                |
| unique column               | emitted only when it includes the whole shard key   | otherwise migration generation refuses it                       |
| indexes                     | inherited `USING BTREE` / `USING HASH`              | expression indexes and operator classes are refused             |
| full-text search            | inherited MySQL `MATCH … AGAINST`                   | requires the corresponding live-server index                    |
| stored-routine calls        | inherited scalar-function and procedure calls       | set-returning functions are not a MySQL-family shape            |
| `RoutineDef` DDL            | refused                                             | SingleStore declaration grammar is not MySQL's                  |
| schema introspection        | the MySQL catalog introspector                      | no live SingleStore qualification exists in this repository     |
| migration transactions      | non-transactional DDL                               | the runner warns because a failed plan can be partially applied |
| database extensions / types | refused                                             | PostgreSQL-style extension contracts are not assumed            |
| vector / spatial operators  | refused                                             | the closed pgvector/PostGIS operators are exact-Postgres only   |

## Declare distribution and storage

Shard and sort keys are facts about the table, so they sit on the `extends` clause:

```ts
import type { PrimaryKey, ShardKey, SortKey, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'>, ShardKey<['customerId']>, SortKey<['id']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  customerId: bigint & Sql<'bigint'>;
}
```

The tags flow through reflection, the schema IR and the migration snapshot:

```sql
CREATE TABLE `orders` (
  `customerId` BIGINT NOT NULL,
  `id` BIGINT PRIMARY KEY,
  SHARD KEY (`customerId`),
  SORT KEY (`id`)
)
```

SingleStore's default is columnstore, so there is no `COLUMNSTORE` keyword in that statement. For a transactional hot path, opt into row-oriented storage:

```ts
import type { Rowstore } from 'zmdb/tags';

export interface Session extends Table<'sessions'>, Rowstore {
  id: string & Sql<'text'> & PrimaryKey;
  value: string & Sql<'text'>;
}
```

That emits `CREATE ROWSTORE TABLE`. A SingleStore table declaring neither `ShardKey<…>` nor `Rowstore` is refused instead of accepting an accidental storage/distribution default. Shard, sort and
rowstore settings are immutable through generated migrations; changing one tells you to create a replacement table and copy the data.

## Constraints and generated ids

**Foreign keys are refused.** SingleStore does not enforce them, so a `References<'users.id'>` declaration fails migration generation rather than silently dropping integrity the type promised.

**A unique column must include the whole shard key.** A table sharded by `id` cannot declare `email: string & Sql<'text'> & Unique`; generation names the column and shard key before a migration is
written. Either shard by the unique column or enforce uniqueness in the application, accepting the race that implies.

**`serial` emits `BIGINT AUTO_INCREMENT`.** Values are allocated per partition in large strides, so an `INT` domain is consumed faster than row count suggests. Ids are unique but not globally
monotonic; keyset pagination should order by a timestamp plus a tie-break rather than assuming a larger id is newer.

`Serial` remains a TypeScript `number`. If the generated id can exceed `Number.MAX_SAFE_INTEGER`, declare a `bigint & Sql<'bigint'> & PrimaryKey & HasDefault` column and use a hand-written migration
for its generation rule. That keeps the application type honest.

## Measured coverage

The automated suite covers every frozen matrix construct for `'singlestore'`, the `BIGINT AUTO_INCREMENT` override, shard/sort/rowstore reflection through snapshot and DDL, inherited MySQL repository
writes, full-text SQL, migration ledger behavior, and the table-option, foreign-key, uniqueness, expression index, routine-DDL, extension and `RETURNING` refusals.

No live SingleStore server is started. In particular, server acceptance of the emitted distribution DDL, auto-increment behavior and MySQL-catalog introspection remains deployment qualification.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Indexes & Constraints](./indexes-constraints.html) · [Tag Reference](./tags-reference.html)
