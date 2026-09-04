Batch operations execute multiple statements in a single database round-trip. Use `batch` when you need to run several independent queries together — bulk inserts, multi-table updates, or grouped
operations that benefit from a single network call.

## The Batch Handle

Create a batch handle from compiled statements:

<!-- snippet: batch.ts#snippet-1 -->

## Executing a Batch

The `execute` method runs all statements via your driver:

<!-- snippet: batch.ts#snippet-2 -->

The callback receives all compiled statements and returns an array of results in the same order.

> [!NOTE] Not all drivers support multi-statement execution. Check your driver documentation. For PostgreSQL, use `pg`'s query chaining or a transaction.

## Bulk Inserts

Combine multiple inserts into one batch:

<!-- snippet: batch.ts#snippet-3 -->

## Parameter Handling

The query compiler handles parameter arrays correctly. Each statement has its own parameter list, which the batch executor flattens:

<!-- snippet: batch.ts#snippet-4 -->

> [!WARNING] Batch does NOT guarantee atomicity by default. Wrap in a transaction if all-or-nothing semantics are required.

## Empty Batches

An empty batch returns an empty array immediately without calling the runner:

<!-- snippet: batch.ts#snippet-5 -->

> [!TIP] Use batch for independent operations. If operations have dependencies (e.g., insert then query the ID), use a transaction instead.

---

See also: [Set Operations](./set-operations.html) · [Query Compiler](./select.html) · [Drivers](./drivers.html)
