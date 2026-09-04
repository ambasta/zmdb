The legitimate job `flush()` does elsewhere — atomically committing several writes — is handled by **explicit transactions**.

<!-- snippet: transactions.ts#snippet-1 -->

- `TransactionContext` is `{ execute, savepoint }` — there is no `tx.repo(...)`. `repo.withTransaction(tx)` returns a **new repository instance** bound to the transaction's connection; the original is
  untouched, so an accidental call on `users` rather than `users.withTransaction(tx)` runs outside the transaction. Bind once at the top of the callback and use the bound handles.
- SQL ordering is deterministic: `BEGIN … COMMIT` on success, `BEGIN … ROLLBACK` on throw.
- Nested `tx.savepoint(fn)` maps to `SAVEPOINT`/`RELEASE`/`ROLLBACK TO SAVEPOINT`.

## Retrying serialization failures

Retries are explicit because the callback is executed again, including any side effects outside the database:

```ts
await db.transaction(
  async tx => {
    await accounts.withTransaction(tx).update(accountId, { balance: nextBalance });
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

`maxRetries` is the number of retries after the first attempt. Backoff is exponential and capped. The wrapper retries only error codes classified by the selected connection dialect — Cockroach retries
`40001`; Postgres also classifies `40P01`. With no `retry` option, the callback runs once.

Keep message publishing, HTTP calls, file writes and other non-idempotent work outside a retrying callback. A database rollback cannot undo them.

## Emitted SQL

```sql
BEGIN;
INSERT INTO "users" (...) VALUES (...);
INSERT INTO "orders" (...) VALUES (...);
COMMIT;   -- or ROLLBACK; if the callback threw
```

## Savepoints (nested)

<!-- snippet: transactions.ts#snippet-2 -->

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
