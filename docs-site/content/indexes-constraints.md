Indexes and constraints are essential schema objects for data integrity and query performance. zmdb provides DDL functions to create indexes (including unique and partial indexes) and check
constraints.

> [!TIP] Indexes improve read performance but add overhead to writes. Use them strategically based on your query patterns. Constraints should always be defined to maintain data integrity.

## Creating a Basic Index

Use `createIndexDdl` to generate index DDL. The function accepts an `IndexDef` with the index name, table, and columns.

<!-- snippet: indexes-constraints.ts#snippet-1 -->

```sql
CREATE INDEX "idx_users_email" ON "users" ("email")
```

## Unique Indexes

Unique indexes enforce uniqueness and can serve as alternative primary keys or enforce unique constraints on non-primary columns.

<!-- snippet: indexes-constraints.ts#snippet-2 -->

```sql
CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" ("email")
```

> [!NOTE] PostgreSQL automatically creates a unique index for `UNIQUE` constraints and primary keys. Use explicit unique indexes when you need additional control or want a named index for management.

## Composite Indexes

For queries that filter on multiple columns, composite indexes can significantly improve performance. Column order matters — put the most selective column first.

<!-- snippet: indexes-constraints.ts#snippet-3 -->

```sql
CREATE INDEX "idx_orders_tenant_status" ON "orders" ("tenant_id", "status", "created_at")
```

## Partial Indexes

Partial indexes only include rows that match a condition, making them smaller and faster for specific query patterns.

<!-- snippet: indexes-constraints.ts#snippet-4 -->

```sql
CREATE INDEX "idx_orders_pending" ON "orders" ("id") WHERE status = 'pending'
```

> [!IMPORTANT] Partial indexes only help queries that include the WHERE condition. Make sure your application queries match the partial index condition.

## Check Constraints

Check constraints validate that column values meet a condition. Use `checkConstraintDdl` to generate the DDL.

<!-- snippet: indexes-constraints.ts#snippet-5 -->

```sql
ALTER TABLE "users" ADD CONSTRAINT "chk_users_age" CHECK (age >= 18)
```

## Common Constraint Patterns

### Positive Values

<!-- snippet: indexes-constraints.ts#snippet-6 -->

```sql
ALTER TABLE "products" ADD CONSTRAINT "chk_product_price" CHECK (price > 0)
```

### Enum-Like Constraints

<!-- snippet: indexes-constraints.ts#snippet-7 -->

```sql
ALTER TABLE "orders" ADD CONSTRAINT "chk_order_status" CHECK (status IN ('pending', 'processing', 'completed', 'cancelled'))
```

### String Length

<!-- snippet: indexes-constraints.ts#snippet-8 -->

```sql
ALTER TABLE "users" ADD CONSTRAINT "chk_username_length" CHECK (char_length(username) >= 3)
```

## Indexes on Expressions

For queries that use expressions in WHERE clauses, expression indexes can improve performance.

<!-- snippet: indexes-constraints.ts#snippet-9 -->

```sql
CREATE INDEX "idx_users_email_lower" ON "users" (lower("email"))
```

Expression text is emitted verbatim, so quote identifiers inside it and never interpolate user input. PostgreSQL, Cockroach and SQLite accept this form. MySQL, SingleStore and SQL Server are refused
with an `UnsupportedFeatureError`; use a generated column there.

## Dropping Indexes and Constraints

Include drop statements in your migrations when removing indexes or constraints.

<!-- snippet: indexes-constraints.ts#snippet-10 -->

```sql
DROP INDEX IF EXISTS "idx_users_email"
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"
```

## Related

- [Views](./views.html) — optimizing views with indexes
- [Generated Columns](./generated-columns.html) — indexing computed values
- [Schema Declaration](./schema-declaration.html) — defining tables with constraints
