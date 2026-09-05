> **ToDo / feature gap.** There is no `'cockroach'` dialect. `Dialect` is
> `'postgres' | 'mysql' | 'sqlite' | 'mssql'`. CockroachDB speaks the Postgres wire
> protocol, so it **works today through `'postgres'`** — with the caveats below,
> which are the reason a dedicated dialect would exist.

## Using it now

```ts
const compiler = createQueryCompiler('postgres');
const userRepo = defineRepository(users, pgDriver(pool), { dialect: 'postgres' });
```

Any Postgres client connects, so the [Postgres driver](./connect-postgres.html) is unchanged:

```ts
const pool = new Pool({ connectionString: process.env.COCKROACH_URL });
```

Ordinary selects, inserts, updates, deletes, joins, subqueries and transactions all behave.

## Where `'postgres'` is wrong for Cockroach

**`SERIAL` is a trap at scale.** Cockroach implements it, but a monotonically increasing key concentrates all writes on one range, which is exactly what a distributed database cannot spread. The Cockroach answer is `UUID DEFAULT gen_random_uuid()` or their `unique_rowid()`. `Serial` on an `integer` column emits `SERIAL`, so on Cockroach you want a `text` id and a hand-written default:

```ts
import type { HasDefault, PrimaryKey, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: string & Sql<'text'> & PrimaryKey & HasDefault;
  email: string & Sql<'text'> & Unique;
}
```

```sql
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
```

`HasDefault` rather than `Serial` is the whole trick: it drops `id` from
`CreateDTO<User>`'s required keys without claiming the column is an auto-incrementing
integer, and the expression that fills it is a migration's business. No dialect change is
needed, because nothing about it is dialect-specific on zmdb's side.

**Retryable transaction errors are normal.** Cockroach is serializable by default, so a transaction can fail with `40001` (`RETRY_SERIALIZABLE`) under contention and the client is expected to retry it. Nothing in zmdb retries. Wrap it:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !isRetryable(e)) throw e;
      await new Promise(r => setTimeout(r, 2 ** i * 10));
    }
  }
}

const isRetryable = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '40001';
```

If you do not do this, you will see intermittent failures under load that look like bugs and are not. This is the single most important thing to know about running on Cockroach.

**`INTERLEAVE`, `AS OF SYSTEM TIME`, locality clauses and zone configs** have no representation. All available as [raw SQL](./raw-sql.html); `AS OF SYSTEM TIME` in particular is worth using for read-only queries, since it avoids contention entirely.

**Unsupported Postgres features.** Cockroach has no `LISTEN`/`NOTIFY`, no stored procedures until recently, and limited trigger support. If a page here suggests one of those — [transactional outbox](./transactional-outbox.html) mentions `NOTIFY` — poll instead.

**Schema changes are asynchronous.** `ALTER TABLE` returns before the change is complete across the cluster. A migration followed immediately by a query relying on the new column can fail. Cockroach also rejects several statements inside an explicit transaction, so a multi-statement `up` may need splitting.

## What a real dialect would change

`serial` would stay numeric and become `INT8 DEFAULT unique_rowid()`, because `Entity<T>` types a `Serial` column as a `number`; changing the storage type to UUID would make the generated TypeScript type false. UUID primary keys remain the explicit `Sql<'text'> & PrimaryKey & HasDefault` declaration shown above.

A dedicated dialect would also map `integer` to `INT4`, refuse Postgres full-text-search SQL, and classify `40001` for a transaction wrapper to retry. The wrapper owns the unit of work; neither the query compiler nor a driver can safely replay application side effects.

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Transactions](./transactions.html) · [Raw SQL](./raw-sql.html)
