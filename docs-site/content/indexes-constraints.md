Indexes and constraints are essential schema objects for data integrity and query performance. zmdb provides DDL functions to create indexes (including unique and partial indexes) and check
constraints.

> [!TIP] Indexes improve read performance but add overhead to writes. Use them strategically based on your query patterns. Constraints should always be defined to maintain data integrity.

## Creating a Basic Index

Use `createIndexDdl` to generate index DDL. The function accepts an `IndexDef` with the index name, table, and columns.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const indexDef = {
  name: 'idx_users_email',
  table: 'users',
  columns: ['email'],
};

const ddl = createIndexDdl(indexDef, 'postgres');
console.log(ddl);
```

```sql
CREATE INDEX "idx_users_email" ON "users" ("email")
```

## Unique Indexes

Unique indexes enforce uniqueness and can serve as alternative primary keys or enforce unique constraints on non-primary columns.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const uniqueIndex = {
  name: 'idx_users_email_unique',
  table: 'users',
  columns: ['email'],
  unique: true,
};

const ddl = createIndexDdl(uniqueIndex, 'postgres');
console.log(ddl);
```

```sql
CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" ("email")
```

> [!NOTE] PostgreSQL automatically creates a unique index for `UNIQUE` constraints and primary keys. Use explicit unique indexes when you need additional control or want a named index for management.

## Composite Indexes

For queries that filter on multiple columns, composite indexes can significantly improve performance. Column order matters — put the most selective column first.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const compositeIndex = {
  name: 'idx_orders_tenant_status',
  table: 'orders',
  columns: ['tenant_id', 'status', 'created_at'],
};

const ddl = createIndexDdl(compositeIndex, 'postgres');
console.log(ddl);
```

```sql
CREATE INDEX "idx_orders_tenant_status" ON "orders" ("tenant_id", "status", "created_at")
```

## Partial Indexes

Partial indexes only include rows that match a condition, making them smaller and faster for specific query patterns.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const partialIndex = {
  name: 'idx_orders_pending',
  table: 'orders',
  columns: ['id'],
  where: "status = 'pending'",
};

const ddl = createIndexDdl(partialIndex, 'postgres');
console.log(ddl);
```

```sql
CREATE INDEX "idx_orders_pending" ON "orders" ("id") WHERE status = 'pending'
```

> [!IMPORTANT] Partial indexes only help queries that include the WHERE condition. Make sure your application queries match the partial index condition.

## Check Constraints

Check constraints validate that column values meet a condition. Use `checkConstraintDdl` to generate the DDL.

```ts
import { checkConstraintDdl } from '@zmdb/query-compiler/schema-objects';

const constraint = {
  name: 'chk_users_age',
  table: 'users',
  expression: 'age >= 18',
};

const ddl = checkConstraintDdl('users', 'chk_users_age', 'age >= 18', 'postgres');
console.log(ddl);
```

```sql
ALTER TABLE "users" ADD CONSTRAINT "chk_users_age" CHECK (age >= 18)
```

## Common Constraint Patterns

### Positive Values

```ts
const positiveConstraint = checkConstraintDdl('products', 'chk_product_price', 'price > 0', 'postgres');
```

```sql
ALTER TABLE "products" ADD CONSTRAINT "chk_product_price" CHECK (price > 0)
```

### Enum-Like Constraints

```ts
const enumConstraint = checkConstraintDdl('orders', 'chk_order_status', "status IN ('pending', 'processing', 'completed', 'cancelled')", 'postgres');
```

```sql
ALTER TABLE "orders" ADD CONSTRAINT "chk_order_status" CHECK (status IN ('pending', 'processing', 'completed', 'cancelled'))
```

### String Length

```ts
const lengthConstraint = checkConstraintDdl('users', 'chk_username_length', 'char_length(username) >= 3', 'postgres');
```

```sql
ALTER TABLE "users" ADD CONSTRAINT "chk_username_length" CHECK (char_length(username) >= 3)
```

## Indexes on Expressions

For queries that use expressions in WHERE clauses, expression indexes can improve performance.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

// Lowercase email index for case-insensitive lookups
const expressionIndex = {
  name: 'idx_users_email_lower',
  table: 'users',
  columns: [{ expr: 'lower("email")' }],
};

const ddl = createIndexDdl(expressionIndex, 'postgres');
console.log(ddl);
```

```sql
CREATE INDEX "idx_users_email_lower" ON "users" (lower("email"))
```

Expression text is emitted verbatim, so quote identifiers inside it and never interpolate user input. PostgreSQL, Cockroach and SQLite accept this form. MySQL, SingleStore and SQL Server are refused
with an `UnsupportedFeatureError`; use a generated column there.

## Dropping Indexes and Constraints

Include drop statements in your migrations when removing indexes or constraints.

```ts
const dropIndexDdl = `DROP INDEX IF EXISTS "idx_users_email"`;
const dropConstraintDdl = `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"`;
```

```sql
DROP INDEX IF EXISTS "idx_users_email"
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"
```

## Related

- [Views](./views.html) — optimizing views with indexes
- [Generated Columns](./generated-columns.html) — indexing computed values
- [Schema Declaration](./schema-declaration.html) — defining tables with constraints
