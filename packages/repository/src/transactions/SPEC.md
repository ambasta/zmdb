# Transactions & Explicit Unit of Work — Frozen Spec (Issue #35)

> Status: **FROZEN** for TDD. Implementation (#36–#39) must satisfy this spec.
> Part of `@zmdb/repository`. Targets: Node 26+, ESM, TS 7. No proxy change tracking.

## 1. Transaction API

```ts
db.transaction(async (tx) => { ... }): Promise<Result>
```

- On successful resolution → `COMMIT`.
- On throw → `ROLLBACK`, error re-thrown.
- `tx` exposes a `TransactionContext` bound to a single connection.

## 2. TransactionContext

```ts
interface TransactionContext {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  savepoint<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;
}
```

## 3. Emitted SQL ordering (asserted with a recording fake driver)

```
db.transaction(cb):                 BEGIN … <cb ops> … COMMIT
cb throws:                          BEGIN … ROLLBACK
tx.savepoint(inner) inner ok:       SAVEPOINT s1 … RELEASE SAVEPOINT s1
tx.savepoint(inner) inner throws:   SAVEPOINT s1 … ROLLBACK TO SAVEPOINT s1
```

Outer writes survive an inner savepoint rollback.

## 4. Transaction-scoped repositories

`tx.repo(RepoClass)` (or `repo.withTransaction(tx)`) routes all repository SQL
through the transaction connection so multiple ops share one atomic transaction.

## 5. Batching helper

`batch(tx, [...ops])` runs the ops within one transaction / one flush; all-or-nothing.

## 5a. Explicit transaction retry policy

`@zmdb/query-compiler`'s `src/dialects/SPEC.md` §4.4 decides that retrying a serialization failure is this
API's job, not a driver's and not the migration runner's. CockroachDB is serializable by default, so a
transaction failing with `40001` under contention is normal operation and the client is expected to re-run
it; Postgres does the same under `SERIALIZABLE`.

The reason it lands here rather than in the driver is that a retry re-runs a **unit of work**, and
`db.transaction(cb)` is the only place that holds the closure. A driver sees statements and cannot know which
ones belonged together. What the driver supplies is the error code, and what the dialect supplies is which
codes are worth retrying — a `retryableCodes` entry on the dialect traits record, beside `DIALECT_PARAM_LIMITS`,
which is the existing precedent for driver knowledge living in the compiler's per-dialect table.

Retry is opt-in:

```ts
await db.transaction(
  async tx => {
    // database work only
  },
  { retry: { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 1000 } },
);
```

`maxRetries` counts retries after the first attempt. Delays use capped
exponential backoff; the defaults are 10 ms and 1,000 ms. Only a direct driver
error code listed in the selected dialect's `retryableCodes` is retried:
Postgres has `40001` and `40P01`, while Cockroach narrows that to `40001`.
Each retry issues a new `BEGIN`; a failed attempt rolls back before waiting.
Savepoints do not retry independently.

The opt-in is the safety boundary. The callback is run again in full, so an HTTP
call, message publish, file write or other external side effect inside it may
happen more than once. The default remains one attempt, and callers enable
retry only for a unit of work whose non-database effects are idempotent or kept
outside the callback.

## 6. Non-goals (rejected)

- Global ambient transaction state, implicit dirty-checking, auto-flush.
