> **Dialect available; qualification still TODO.** `'cockroach'` is a
> `Dialect` variant of Postgres. It has dedicated types, refusals and transaction
> retry classification, while the existing Postgres wire adapter is reused.

## Using it

```ts
const compiler = createQueryCompiler('cockroach');
const userRepo = defineRepository(users, pgDriver(pool), { dialect: 'cockroach' });
```

Any Postgres client connects, so the [Postgres driver](./connect-postgres.html)
is unchanged:

```ts
const pool = new Pool({ connectionString: process.env.COCKROACH_URL });
```

Ordinary selects, inserts, updates, deletes, joins and subqueries inherit the
Postgres grammar. Telemetry also reports the Postgres wire family.

## The dedicated divergences

**`serial` stays numeric and emits `INT8 DEFAULT unique_rowid()`.** `Entity<T>`
types a `Serial` column as a `number`, so mapping it to a UUID would make the
generated TypeScript type false. The dialect also maps `integer` to `INT4`;
Cockroach's `INTEGER` alias is 64-bit and can exceed JavaScript's safe integer
range.

For a UUID primary key, keep the explicit declaration:

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

`HasDefault` drops `id` from `CreateDTO<User>`'s required keys without claiming
that it is an auto-incrementing integer.

**Retryable transaction errors are explicit.** Cockroach is serializable by
default, so `40001` (`RETRY_SERIALIZABLE`) under contention is normal. Give the
pinned transaction connection the Cockroach dialect and opt into bounded
retries:

```ts
const db = createTransactionalDb({ ...connection, dialect: 'cockroach' });

await db.transaction(
  async tx => {
    await accounts.withTransaction(tx).update(accountId, patch);
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

The callback may run five times in that example. Keep message publishing, HTTP
calls, file writes and other non-idempotent side effects outside it; a database
rollback cannot undo them. Without the `retry` option, the callback runs once.

**Full-text search and row-level security are refused.** Cockroach does not use
Postgres's `to_tsvector`/`@@` full-text grammar. RLS support also varies by
server version, so the dialect refuses the Postgres policy shape rather than
guessing. Materialized views remain inherited.

**Stored routines inherit Postgres grammar.** `RoutineDef` DDL, scalar and
procedure calls, and set-returning function calls use the Postgres forms while
routine types still use Cockroach's `INT4` and `INT8` mappings.

**Cockroach-only clauses remain raw SQL.** `INTERLEAVE`, `AS OF SYSTEM TIME`,
locality clauses and zone configs have no builder representation.

**Schema changes are asynchronous.** `ALTER TABLE` can return before the change
has propagated, and several statements cannot share an explicit transaction.
Split a migration whose later statement depends immediately on an earlier
schema change.

The automated suite proves the SQL and retry policy but does not currently run
a Cockroach server image; deployment qualification remains a separate evidence
step.

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Transactions](./transactions.html) · [Raw SQL](./raw-sql.html)
