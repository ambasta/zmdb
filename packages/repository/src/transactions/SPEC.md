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

## 6. Non-goals (rejected)

- Global ambient transaction state, implicit dirty-checking, auto-flush.
