> **Dialect available; server qualification still TODO.** `'singlestore'` is a
> `Dialect` variant of MySQL. It inherits MySQL query grammar and adds explicit
> distribution/storage declarations plus SingleStore-specific refusals.

## Using it

```ts
const compiler = createQueryCompiler('singlestore');
const userRepo = defineRepository(users, mysqlDriver(pool), { dialect: 'singlestore' });
```

Connect with a MySQL-protocol client. Everything on the
[MySQL dialect page](./dialect-mysql.html) still applies: backtick quoting, `?`
placeholders, `TINYINT(1)` booleans, `INSERT IGNORE`,
`ON DUPLICATE KEY UPDATE`, and no `RETURNING`.

## Declare distribution and storage

Shard and sort keys are facts about the table, so they sit on the `extends`
clause:

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

SingleStore's default is columnstore, so there is no `COLUMNSTORE` keyword in
that statement. For a transactional hot path, opt into row-oriented storage:

```ts
import type { Rowstore } from 'zmdb/tags';

export interface Session extends Table<'sessions'>, Rowstore {
  id: string & Sql<'text'> & PrimaryKey;
  value: string & Sql<'text'>;
}
```

That emits `CREATE ROWSTORE TABLE`. A SingleStore table declaring neither
`ShardKey<…>` nor `Rowstore` is refused instead of accepting an accidental
storage/distribution default. Shard, sort and rowstore settings are immutable
through generated migrations; changing one tells you to create a replacement
table and copy the data.

## Constraints and generated ids

**Foreign keys are refused.** SingleStore does not enforce them, so a
`References<'users.id'>` declaration fails migration generation rather than
silently dropping integrity the type promised.

**A unique column must include the whole shard key.** A table sharded by `id`
cannot declare `email: string & Sql<'text'> & Unique`; generation names the
column and shard key before a migration is written. Either shard by the unique
column or enforce uniqueness in the application, accepting the race that
implies.

**`serial` emits `BIGINT AUTO_INCREMENT`.** Values are allocated per partition
in large strides, so an `INT` domain is consumed faster than row count suggests.
Ids are unique but not globally monotonic; keyset pagination should order by a
timestamp plus a tie-break rather than assuming a larger id is newer.

## Other inherited and refused grammar

Explicit `USING BTREE` and `USING HASH` indexes inherit the MySQL form.
Expression indexes retain the MySQL-family refusal and point to a generated
column instead.

Scalar-function and procedure calls also inherit MySQL quoting and
placeholders. `RoutineDef` DDL is refused: SingleStore's routine declaration
grammar is distinct, so create it in a hand-written migration rather than
emitting a MySQL statement that only looks plausible.

There is no bundled SingleStore driver or licensed SingleStore service in the
automated gate. The suite proves the complete SQL matrix and migration
refusals; accepting the emitted DDL on a live SingleStore server remains a
deployment qualification step.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Indexes & Constraints](./indexes-constraints.html) · [Tag Reference](./tags-reference.html)
