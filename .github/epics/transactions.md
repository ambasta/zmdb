# [EPIC] Transactions & Explicit Unit of Work

## Goal

Provide transactional guarantees comparable to mikro-orm's Unit of Work — but **explicit** and **stateless**, with no proxy change-tracking. Callers group operations into a transaction boundary; the framework flushes them as a single atomic SQL transaction.

## Parity Reference

- **mikro-orm**: Unit of Work, `em.transactional()`, flush, cascade.

## Adopted (aligned with our architecture)

- Explicit transaction API in `@zmdb/repository`: `await db.transaction(async (tx) => { ... })`.
- Transaction-scoped repository instances that route through the active connection.
- Savepoints / nested transaction support via SQL savepoints.
- Explicit batching helper for grouping inserts/updates into one round-trip.

## Explicitly Rejected (anti-patterns for us)

- ❌ Implicit change tracking via proxies / dirty checking.
- ❌ Auto-flush on entity mutation.
- ❌ Identity-map-backed cascades. Cascades, if any, are explicit and opt-in.

## Definition of Done

Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:

1. Frozen spec for the transaction API and isolation semantics.
2. Connection/transaction context primitive.
3. Transaction-scoped repository binding.
4. Savepoint / nested transaction support.
5. Explicit write-batching helper.

## Constraints

- No global mutable state; transaction context passed explicitly.
- Zero heap-retained metadata for non-transactional queries.
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues linked below as a task list.
