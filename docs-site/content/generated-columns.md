Generated columns are table columns whose values are computed automatically from an expression. They're computed at write time (stored) or read time (virtual), ensuring data consistency without application-level calculations.

> [!IMPORTANT]
> Generated columns are computed by the database, not by zmdb. This ensures values are always consistent even if written directly to the database. zmdb supports them through DDL emission; a generated column is simply left out of the declaration, which is what makes it read-only everywhere downstream.

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

## Leaving them out of the declaration

Declare the base columns and stop there. A generated column has no property, which is exactly
how it stays out of `CreateDTO` and `UpdateDTO`:

```ts
import type { Numeric, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  unit_price: number & Sql<'numeric'> & Numeric<10, 2>;
  quantity: number & Sql<'integer'>;
  // total_price is generated — it lives in the migration, not here
}
```

> [!WARNING]
> Do not add a property for a generated column. It would appear in `CreateDTO<Order>` as
> something to insert, and the database rejects any INSERT/UPDATE that targets a generated
> column. There is no tag that would fix this, and there should not be: the expression is
> dialect-specific SQL and a type cannot hold SQL.

If you need to _read_ it through a typed path, declare a second interface over a view — see
[Virtual Entities](./virtual-entities.html).

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
- [Schema Declaration](./schema-declaration.html) — declaring tables with all column types
- [Views](./views.html) — virtual tables that can also compute values
