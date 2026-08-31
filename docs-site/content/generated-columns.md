Generated columns are table columns whose values are computed automatically from an expression. They're computed at write time (stored) or read time (virtual), ensuring data consistency without application-level calculations.

> [!IMPORTANT]
> Generated columns are computed by the database, not by zmdb. This ensures values are always consistent even if written directly to the database. zmdb supports them through DDL emission and treats them as read-only in the schema.

## Creating a Generated Column

Use `generatedColumnDdl` from `@zmdb/query-compiler/schema-objects` to generate the DDL. The function accepts a `GeneratedColumn` definition with the column name, SQL type, and expression.

```ts
import { generatedColumnDdl } from '@zmdb/query-compiler/schema-objects';

const genCol = {
  name: 'full_name',
  type: 'VARCHAR(255)',
  expression: "first_name || ' ' || last_name",
  stored: true,
};

const ddl = generatedColumnDdl(genCol, 'postgres');
console.log(ddl);
```

```sql
"full_name" VARCHAR(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
```

> [!NOTE]
> The `stored: true` option makes the column "stored" (computed and written to disk). Omit it for virtual columns (computed on read). PostgreSQL requires `STORED` for generated columns.

## Common Use Cases

### Computed Timestamps

Track elapsed time or derive timestamps from other columns.

```ts
import { timestamp, integer } from '@zmdb/schema-core';

const auditLogDef = {
  name: 'duration_ms',
  type: 'INTEGER',
  expression: 'EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000',
  stored: true,
};
```

```sql
"duration_ms" INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) STORED
```

### JSON Extraction

Extract values from JSON columns into dedicated fields for indexing or querying.

```ts
const jsonExtractionDef = {
  name: 'user_email',
  type: 'VARCHAR(255)',
  expression: "(payload->>'user')::text",
  stored: true,
};
```

```sql
"user_email" VARCHAR(255) GENERATED ALWAYS AS ((payload->>'user')::text) STORED
```

### Arithmetic Expressions

Precompute values that are frequently queried but expensive to calculate.

```ts
const totalPriceDef = {
  name: 'total_price',
  type: 'NUMERIC(10,2)',
  expression: 'unit_price * quantity',
  stored: true,
};
```

```sql
"total_price" NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED
```

## Using Generated Columns with defineSchema

When defining a schema with `defineSchema`, treat generated columns as read-only. They won't have a corresponding entry in your column builders since they're managed by the database.

```ts
import { defineSchema, serial, integer, numeric } from '@zmdb/schema-core';

// Define the base columns (non-generated)
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  unit_price: numeric(10, 2).notNull(),
  quantity: integer().notNull(),
  // generated columns are added via DDL migration, not in defineSchema
});
```

> [!WARNING]
> Do not include generated columns in your `CreateDTO` or `UpdateDTO` types. The database will reject any INSERT/UPDATE attempts on generated columns since they're computed automatically.

## Querying Generated Columns

Generated columns can be selected like regular columns. They're computed automatically, so you don't need to do anything special in your queries.

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query = compiler.selectFrom('orders').select(['id', 'unit_price', 'quantity', 'total_price']).compile();

console.log(query.text);
```

```sql
SELECT "id", "unit_price", "quantity", "total_price" FROM "orders"
```

> [!TIP]
> Generated columns are particularly useful for indexes. Create an index on a generated column for fast lookups on computed values without duplicating the computation logic.

## Dialect Support

| Dialect    | Generated Columns | Notes                                      |
| ---------- | ----------------- | ------------------------------------------ |
| PostgreSQL | ✅                | Requires `STORED` keyword                  |
| SQLite     | ✅                | Virtual (without STORED) or stored         |
| MySQL      | ✅                | Virtual by default, `STORED` for persisted |

> [!NOTE]
> MySQL and SQLite may have different syntax. The `generatedColumnDdl` function assumes PostgreSQL-style output. For other dialects, you may need custom DDL or conditional logic.

## Related

- [Indexes & Constraints](./indexes-constraints.html) — index generated columns for performance
- [Schema Declaration](./schema-declaration.html) — defining tables with all column types
- [Views](./views.html) — virtual tables that can also compute values
