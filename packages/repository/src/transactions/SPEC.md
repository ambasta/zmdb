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

## Pending: this is where a retry belongs

`@zmdb/query-compiler`'s `src/dialects/SPEC.md` §4.4 decides that retrying a serialization failure is this
API's job, not a driver's and not the migration runner's. CockroachDB is serializable by default, so a
transaction failing with `40001` under contention is normal operation and the client is expected to re-run
it; Postgres does the same under `SERIALIZABLE`.

The reason it lands here rather than in the driver is that a retry re-runs a **unit of work**, and
`db.transaction(cb)` is the only place that holds the closure. A driver sees statements and cannot know which
ones belonged together. What the driver supplies is the error code, and what the dialect supplies is which
codes are worth retrying — a `retryableCodes` entry on the dialect traits record, beside `DIALECT_PARAM_LIMITS`,
which is the existing precedent for driver knowledge living in the compiler's per-dialect table.

Not yet decided, and deliberately left to whichever epic implements it: the attempt count, the backoff, and
whether an inner `savepoint` retries independently of its outer transaction. §3's emitted-SQL goldens are the
constraint on all three — a retry re-emits `BEGIN`, so a recording fake driver sees the statement sequence
twice, and any design that made that indistinguishable from two separate transactions would make those
goldens untestable.

## 6. Non-goals (rejected)

- Global ambient transaction state, implicit dirty-checking, auto-flush.
