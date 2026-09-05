Views in zmdb are declarative schema objects that encapsulate reusable SELECT queries. They provide a way to define virtual tables based on the result of a query, which is particularly useful for
complex joins, aggregations, or exposing a simplified API over normalized data.

> [!IMPORTANT] zmdb treats views as pure DDL declarations — you define them once and let the migration system handle creation/dropping. Views are **not** automatically synced with schema changes; you
> must manually update them when underlying tables change.

## Creating a Simple View

Use `createViewDdl` from `@zmdb/query-compiler/schema-objects` to generate the DDL for a view. The function accepts a `ViewDef` with the view name and SELECT query.

```ts
import { createViewDdl } from '@zmdb/query-compiler/schema-objects';

const viewDef = {
  name: 'user_with_post_count',
  select: `SELECT u.id, u.email, COUNT(p.id) AS post_count 
           FROM users u 
           LEFT JOIN posts p ON u.id = p.author_id 
           GROUP BY u.id, u.email`,
};

const ddl = createViewDdl(viewDef, 'postgres');
console.log(ddl);
```

```sql
CREATE VIEW "user_with_post_count" AS SELECT u.id, u.email, COUNT(p.id) AS post_count            FROM users u
           LEFT JOIN posts p ON u.id = p.author_id
           GROUP BY u.id, u.email
```

## Materialized Views

Materialized views store the result of the query physically on disk, making them useful for expensive aggregations or frequently accessed data that doesn't need to be real-time. PostgreSQL is the only
supported dialect.

```ts
import { createViewDdl, UnsupportedFeatureError } from '@zmdb/query-compiler/schema-objects';

// Only works on PostgreSQL
const materializedDef = {
  name: 'sales_summary',
  select: `SELECT region, SUM(amount) AS total_sales 
           FROM sales 
           GROUP BY region`,
  materialized: true,
};

const ddl = createViewDdl(materializedDef, 'postgres');
console.log(ddl);
```

```sql
CREATE MATERIALIZED VIEW "sales_summary" AS SELECT region, SUM(amount) AS total_sales
           FROM sales
           GROUP BY region
```

> [!NOTE] Materialized views require periodic refreshes. Use `REFRESH MATERIALIZED VIEW "view_name"` to update the data. On MySQL, SingleStore, SQLite or SQL Server, this will throw
> `UnsupportedFeatureError`; Cockroach inherits the Postgres form.

## Dropping Views

When migrating, you may need to drop existing views before recreating them. Use `dropViewDdl` for this.

```ts
import { dropViewDdl } from '@zmdb/query-compiler/schema-objects';

const dropDdl = dropViewDdl('user_with_post_count', 'postgres');
console.log(dropDdl);
```

```sql
DROP VIEW IF EXISTS "user_with_post_count"
```

## Using Views in Queries

Once a view exists in your database, you can query it like a regular table using zmdb's query compiler. The view's columns become available through standard SELECT operations.

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query = compiler.selectFrom('user_with_post_count').select(['id', 'email', 'post_count']).where('post_count', '>', 5).orderBy('post_count', 'desc').limit(10).compile();

console.log(query.text);
console.log(query.parameters);
```

```sql
SELECT "id", "email", "post_count" FROM "user_with_post_count" WHERE "post_count" > $1 ORDER BY "post_count" DESC LIMIT 10
-- parameters: [5]
```

> [!TIP] Views are read-only in most databases. If you need to modify data through a view, you'll need to define INSTEAD OF triggers or use an updatable view with the proper constraints.

## Related

- [Indexes & Constraints](./indexes-constraints.html) — optimize view queries with indexes
- [Sequences](./sequences.html) — another schema object for auto-incrementing values
- [Schema Declaration](./schema-declaration.html) — defining tables that views query
