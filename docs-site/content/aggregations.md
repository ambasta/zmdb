Grouped aggregates — `count`, `sum`, `avg`, `min`, `max` with `GROUP BY` and `HAVING` — compiled to real SQL and verified against PostgreSQL in the [benchmarks](../benchmarks/index.html).

## Count

```ts {"mode":"compile","id":"example-001"}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres).selectFrom(trustedTable('orders')).count('id', 'orderCount').compile();
```

```sql
SELECT COUNT("id") AS "orderCount" FROM "orders"
```

## Group by + multiple aggregates

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies aggregateSelectFrom; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres).selectFrom(trustedTable('orders')).select(['userId']).count('id', 'orderCount').sum('total', 'revenue').groupBy('userId').compile();
```

```sql
SELECT "userId", COUNT("id") AS "orderCount", SUM("total") AS "revenue"
FROM "orders" GROUP BY "userId"
```

## Having

Filter on an aggregate with `having`:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies aggregateSelectFrom; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres).selectFrom(trustedTable('orders')).select(['userId']).count('id', 'orderCount').groupBy('userId').having('orderCount', '>', 5).compile();
```

```sql
SELECT "userId", COUNT("id") AS "orderCount" FROM "orders"
GROUP BY "userId" HAVING COUNT("id") > $1
```

> [!TIP] Pass a declared schema value to `selectFrom` for typed selected columns and computed aggregates. The physical-table examples above use `trustedTable` and return `UnknownRow`. Repository
> aggregate specs also derive result types — see [Typed aggregate results](./aggregate-results.html).
