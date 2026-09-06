Installable database vertical: `@zmdb/singlestore`. It is a one-way child of `@zmdb/mysql`: ordinary MySQL query compilation, quoting, placeholders, connection pinning, and catalog parsing stay in the
parent, while the child owns SingleStore storage/distribution declarations, catalog adaptation, and conservative refusals. The mandatory packed-consumer lane runs against the official SingleStore Dev
Image.

## Using it

```ts
import { singlestore, singlestoreDriver } from '@zmdb/singlestore';
import { createQueryCompiler } from '@zmdb/query-compiler';
import mysql2 from 'mysql2/promise';

const pool = mysql2.createPool(process.env.SINGLESTORE_URL!);
const compiler = createQueryCompiler(singlestore);
const driver = singlestoreDriver(pool);
```

The application constructs and owns the mysql2-compatible pool. `mysql2` is an optional peer, not a hard dependency. Everything on the [MySQL dialect page](./dialect-mysql.html) still applies where
SingleStore does not diverge: backtick quoting, `?` placeholders, `TINYINT(1)` booleans, `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, and no `RETURNING`.

## Divergence and refusal matrix

| Construct                   | Emitted SQL / behavior                              | Caveat or refusal                                               |
| --------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| identifiers / placeholders  | MySQL backticks and `?`                             | `singlestoreDriver` binds a mysql2-compatible pool              |
| upsert                      | `ON DUPLICATE KEY UPDATE`                           | the MySQL family has no conflict-target syntax                  |
| returning rows              | refused                                             | repository paths do not issue a hidden follow-up read           |
| `serial`                    | `BIGINT AUTO_INCREMENT`                             | allocation is partitioned; `Serial` is still typed as `number`  |
| `timestamp`                 | `DATETIME(6)`                                       | SingleStore accepts fractional precision 0 or 6, not MySQL's 3  |
| table storage/distribution  | `SHARD KEY`, `SORT KEY`, or `CREATE ROWSTORE TABLE` | every generated table must declare `ShardKey<…>` or `Rowstore`  |
| rowstore sort key           | refused before execution                            | explicit rowstore tables cannot use columnstore `SORT KEY`      |
| table-option change         | refused                                             | create a replacement table and copy the data                    |
| foreign keys                | refused before execution                            | not qualified by this package's frozen capability contract      |
| unique column               | emitted only when it includes the whole shard key   | otherwise migration generation refuses it                       |
| indexes                     | ordinary methodless secondary indexes               | explicit methods need unavailable table-storage evidence        |
| check constraints           | refused before execution                            | SingleStore 9.0.12 rejects `CHECK` constraint DDL               |
| full-text search            | parameterized `MATCH(column) AGAINST(?)`            | requires a version-1 `FULLTEXT (column)` table declaration      |
| stored-routine calls        | inherited scalar-function and procedure calls       | set-returning functions are not a MySQL-family shape            |
| `RoutineDef` DDL            | refused                                             | SingleStore declaration grammar is not MySQL's                  |
| generated columns           | `AS (...) PERSISTED <type>`                         | syntax and catalog round-trip are server-proven                 |
| schema introspection        | MySQL parser plus SingleStore catalog adaptation    | storage, shard, sort, computed columns, and physical indexes    |
| migration transactions      | non-transactional DDL                               | the runner warns because a failed plan can be partially applied |
| database extensions / types | refused                                             | PostgreSQL-style extension contracts are not assumed            |
| vector / spatial operators  | refused                                             | the closed pgvector/PostGIS operators are exact-Postgres only   |

## Declare distribution and storage

Shard and sort keys are facts about the table, so they sit on the `extends` clause:

```ts
import type { PrimaryKey, ShardKey, SortKey, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'>, ShardKey<['customerId']>, SortKey<['id']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  customerId: bigint & Sql<'bigint'> & PrimaryKey;
}
```

The tags flow through reflection, the schema IR and the migration snapshot:

```sql
CREATE TABLE `orders` (
  `customerId` BIGINT NOT NULL,
  `id` BIGINT NOT NULL,
  PRIMARY KEY (`customerId`, `id`),
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

**Foreign keys are refused by `@zmdb/singlestore`.** This is a package qualification boundary, not a claim that current SingleStore servers lack the feature. A `References<'users.id'>` declaration
fails migration generation because this vertical has not qualified foreign-key semantics across its storage and distribution model.

**A unique column must include the whole shard key.** A table sharded by `id` cannot declare `email: string & Sql<'text'> & Unique`; generation names the column and shard key before a migration is
written. An explicit rowstore with no shard key cannot add a separate unique column either. Declare a compatible shard key or enforce uniqueness in the application, accepting the race that implies.

**`serial` emits `BIGINT AUTO_INCREMENT`.** Values are allocated per partition in large strides, so an `INT` domain is consumed faster than row count suggests. Ids are unique but not globally
monotonic; keyset pagination should order by a timestamp plus a tie-break rather than assuming a larger id is newer.

`Serial` remains a TypeScript `number`. If the generated id can exceed `Number.MAX_SAFE_INTEGER`, declare a `bigint & Sql<'bigint'> & PrimaryKey & HasDefault` column and use a hand-written migration
for its generation rule. That keeps the application type honest.

## Measured coverage

The measured packed run uses eight local package archives plus consumer-selected mysql2 against SingleStore 9.0.12. It creates explicit rowstore and columnstore tables, applies a rowstore migration
ledger, executes CRUD and rollback transactions, observes non-transactional DDL, and round-trips `INMEMORY_ROWSTORE`/`COLUMNSTORE`, shard keys, sort keys, persisted computed columns, and ordinary
secondary indexes. The same run proves foreign-key, incompatible-unique-key, and storage-transition refusals happen before execution and verifies the dependency direction `@zmdb/singlestore` →
`@zmdb/mysql` with no private or reverse edge. A focused source-bound rerun on the same server additionally proves exact `DATETIME(6)` migration/CRUD/catalog behavior and the rowstore outbox
DDL/index, parameterized full-text SQL, and the storage-dependent index/check-constraint refusal boundaries.

CI and release use the digest-pinned official Dev Image and fail closed when the service or `ZMDB_SINGLESTORE_URL` is absent.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Indexes & Constraints](./indexes-constraints.html) · [Tag Reference](./tags-reference.html)
