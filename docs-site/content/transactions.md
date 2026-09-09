The legitimate job `flush()` does elsewhere — atomically committing several writes — is handled by **explicit transactions**.

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies connection, orders, users; this excerpt does not repeat those declarations."}
import { createTransactionalDb } from '@zmdb/orm/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  const user = await users.withTransaction(tx).create({ email: 'a@b.com' });
  const order = await orders.withTransaction(tx).create({ userId: user.id, totalPrice: 42 });
  // throw → ROLLBACK (nothing persists); clean return → COMMIT
});
```

- `TransactionContext` is `{ execute, savepoint }` — there is no `tx.repo(...)`. `repo.withTransaction(tx)` returns a **new repository instance** bound to the transaction's connection; the original is
  untouched, so an accidental call on `users` rather than `users.withTransaction(tx)` runs outside the transaction. Bind once at the top of the callback and use the bound handles.
- SQL ordering is deterministic: `BEGIN … COMMIT` on success, `BEGIN … ROLLBACK` on throw.
- Nested `tx.savepoint(fn)` maps to `SAVEPOINT`/`RELEASE`/`ROLLBACK TO SAVEPOINT`.

## Retrying serialization failures

Retries are explicit because the callback is executed again, including any side effects outside the database:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies accountId, accounts, db, nextBalance; this excerpt does not repeat those declarations."}
await db.transaction(
  async tx => {
    await accounts.withTransaction(tx).update(accountId, { balance: nextBalance });
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

`maxRetries` is the number of retries after the first attempt. Backoff is exponential and capped. The wrapper retries only error codes classified by the selected connection dialect. With no `retry`
option, the callback runs once.

| Dialect            | Retried on                                                        |
| ------------------ | ----------------------------------------------------------------- |
| Postgres           | `40001` serialization failure, `40P01` deadlock                   |
| Cockroach          | `40001`                                                           |
| MySQL, SingleStore | `1213` deadlock, `1205` lock wait timeout                         |
| SQLite             | `SQLITE_BUSY`, `SQLITE_LOCKED`                                    |
| SQL Server         | `1205` deadlock victim, `3960` snapshot-isolation update conflict |

The dialect must be the one for the database you are connected to — `retryableCodes` is dialect metadata, so a connection without a dialect retries nothing. The identifier is read from whichever
property the driver uses: `code` on `pg`, `errno` on mysql2, `number` on `mssql`, `errcode` on `node:sqlite`.

Under Postgres's default `READ COMMITTED`, `40001` does not occur at all — the retry policy only becomes meaningful at `REPEATABLE READ` or `SERIALIZABLE`, which zmdb does not yet have an API to
request. Lock-contention retries (MySQL, SQLite, SQL Server) apply at the default isolation level.

Keep message publishing, HTTP calls, file writes and other non-idempotent work outside a retrying callback. A database rollback cannot undo them.

## Emitted SQL

```sql
BEGIN;
INSERT INTO "users" (...) VALUES (...);
INSERT INTO "orders" (...) VALUES (...);
COMMIT;   -- or ROLLBACK; if the callback threw
```

## Savepoints (nested)

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies db, orders, users; this excerpt does not repeat those declarations."}
await db.transaction(async tx => {
  await users.withTransaction(tx).create({ email: 'a@b.com' });
  await tx.savepoint(async sp => {
    await orders.withTransaction(sp).create({ userId: 1, total: 42 });
    // a throw here rolls back to the savepoint, keeping the outer tx alive
  });
});
```

```sql
BEGIN;
INSERT INTO "users" ...;
SAVEPOINT sp_1;
INSERT INTO "orders" ...;
RELEASE SAVEPOINT sp_1;   -- or ROLLBACK TO SAVEPOINT sp_1;
COMMIT;
```

> [!IMPORTANT] There is no implicit flush. A write happens only when you call `create`/`update`/`delete` — inside a transaction those run on the tx connection. This replaces the
> unit-of-work/auto-flush model (an [anti-pattern](./anti-patterns.html) here) with explicit, predictable writes.
