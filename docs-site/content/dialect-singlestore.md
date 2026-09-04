> **ToDo / feature gap.** There is no `'singlestore'` dialect. SingleStore speaks
> the MySQL wire protocol and accepts most MySQL syntax, so it **works today
> through `'mysql'`** — with the caveats below, which are what a dedicated dialect
> would handle.

## Using it now

```ts
const compiler = createQueryCompiler('mysql');
const userRepo = defineRepository(users, mysqlDriver(pool), { dialect: 'mysql' });
```

Connect with `mysql2`, exactly as for [MySQL](./connect-planetscale.html):

```ts
const pool = createPool({ uri: process.env.SINGLESTORE_URL });
```

Everything on the [MySQL dialect page](./dialect-mysql.html) applies — backtick quoting, `?` placeholders, `TINYINT(1)` booleans, no `RETURNING`.

## Where `'mysql'` is not enough

**Tables need a shard key, and the default is not what you want.** SingleStore distributes rows by a shard key, and a table created without one gets an arbitrary choice. The generated DDL has no shard-key clause, so every table zmdb creates is distributed on whatever SingleStore picks — usually the primary key, which is often fine and occasionally very wrong. Create the important tables by hand:

```ts
{
  version: 1,
  name: 'orders',
  up: `CREATE TABLE orders (
         id BIGINT NOT NULL,
         customer_id BIGINT NOT NULL,
         total DECIMAL(10,2) NOT NULL,
         SHARD KEY (customer_id),
         SORT KEY (id)
       )`,
  down: 'DROP TABLE orders',
}
```

Sharding on `customer_id` means a query filtered by customer touches one partition. Sharding on `id` means every such query fans out to all of them. This is the decision that determines whether SingleStore is fast for your workload, and zmdb cannot make it for you.

**Rowstore versus columnstore.** SingleStore's default for new tables is columnstore, which is excellent for aggregates and poor for single-row point lookups and updates. `CREATE TABLE` with no `SORT KEY` and no explicit rowstore hint is a decision being made by omission. If a table is your transactional hot path, declare it rowstore.

**No foreign keys.** SingleStore does not enforce them. `References<'users.id'>`
now reaches the migration snapshot and emits a real constraint on supported
dialects, so a SingleStore dialect must refuse that declaration before writing
SQL rather than inheriting MySQL's foreign-key emitter. Referential integrity is
your application's job here, which is a reason to be stricter about doing writes
through repositories.

**Unique indexes must include the shard key.** A `Unique` column that is not part of the shard key cannot be enforced globally, and SingleStore will reject the index. So `email: string & Sql<'text'> & Unique` fails on a table sharded by `id`. Either shard by `email` or drop the constraint and enforce uniqueness in the application — with the race that implies.

**`AUTO_INCREMENT` is per-partition.** Ids are unique but not monotonic across the cluster, so anything that assumes "higher id means newer" is wrong. [Keyset pagination](./guide-cursor-pagination.html) ordered by id is therefore unreliable — order by a timestamp plus a tie-break instead.

## What a real dialect would change

`ShardKey<…>` and `SortKey<…>` tags on the `extends` clause — the same place
`Fts<…>` sits, because both are facts about the table rather than one column —
would flow through the snapshot into DDL, with a `Rowstore` tag for the explicit
alternative to SingleStore's default columnstore. A unique index outside the shard
key can be refused when DDL is generated, before a migration is written; it cannot
be a compile-time reflection error because reflection has no dialect value. There
must also use its `foreignKeys: false` trait to refuse a table whose snapshot
contains constraints. Silently dropping the constraint would make the
declaration promise integrity the database does not enforce.

---

See also: [Dialect: MySQL](./dialect-mysql.html) · [Connect: PlanetScale](./connect-planetscale.html) · [Indexes & Constraints](./indexes-constraints.html)
