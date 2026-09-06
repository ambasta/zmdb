Set operations combine result sets from multiple queries — UNION, INTERSECT, and EXCEPT. Batch executes multiple statements in a single round-trip. zmdb's query compiler exposes both primitives
directly, giving you full control over SQL generation.

## UNION / UNION ALL

Combine rows from two or more SELECT statements. Use `union` for distinct rows, `unionAll` to keep duplicates.

<!-- snippet: set-operations.ts#snippet-1 -->

## INTERSECT & EXCEPT

`INTERSECT` returns rows present in both queries. `EXCEPT` returns rows from the first query that aren't in the second.

<!-- snippet: set-operations.ts#snippet-2 -->

> [!NOTE] All queries in a set operation must have the same column count and compatible types. The query compiler doesn't validate this — your database will reject mismatched unions.

## Batch Execution

When you need to run multiple independent statements in one database round-trip, use `batch`. This is useful for bulk inserts, multi-table updates, or running migrations.

<!-- snippet: set-operations.ts#snippet-3 -->

Generated SQL (parameterized):

```sql
INSERT INTO "users" ("name", "email") VALUES ($1, $2);
INSERT INTO "users" ("name", "email") VALUES ($3, $4);
-- Parameters: ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
```

## Parameter Renumbering

The query compiler automatically renumbers positional parameters (`$1`, `$2`, ...) when combining queries. This ensures parameters remain valid across the combined statement.

<!-- snippet: set-operations.ts#snippet-4 -->

> [!WARNING] Batch does NOT guarantee transaction semantics by default. Wrap in a transaction if you need atomicity.

---

See also: [Query Compiler](./select.html) · [Repository](./repository.html) · [Migrations](./migrations.html)
