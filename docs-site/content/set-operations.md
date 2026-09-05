Set operations combine result sets from multiple queries — UNION, INTERSECT, and EXCEPT. Batch executes multiple statements in a single round-trip. zmdb's query compiler exposes both primitives
directly, giving you full control over SQL generation.

## UNION / UNION ALL

Combine rows from two or more SELECT statements. Use `union` for distinct rows, `unionAll` to keep duplicates.

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const query1 = compiler.selectFrom('users').select(['id', 'name']).where('active', '=', true).compile();

const query2 = compiler.selectFrom('archived_users').select(['id', 'name']).compile();

import { setOperation, union } from '@zmdb/query-compiler/set-ops';

const combined = setOperation('union', [query1, query2], 'postgres');

// combined.text => SELECT ... UNION SELECT ...
// combined.parameters => [...]
```

## INTERSECT & EXCEPT

`INTERSECT` returns rows present in both queries. `EXCEPT` returns rows from the first query that aren't in the second.

```ts
import { setOperation } from '@zmdb/query-compiler/set-ops';

// Active users who have placed orders
const activeWithOrders = setOperation('intersect', [activeUsersQuery, ordersQuery], 'postgres');

// Users who have never ordered
const neverOrdered = setOperation('except', [allUsersQuery, ordersQuery], 'postgres');
```

> [!NOTE] All queries in a set operation must have the same column count and compatible types. The query compiler doesn't validate this — your database will reject mismatched unions.

## Batch Execution

When you need to run multiple independent statements in one database round-trip, use `batch`. This is useful for bulk inserts, multi-table updates, or running migrations.

```ts
import { batch, createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const stmt1 = compiler.insertInto('users').values({ name: 'Alice', email: 'alice@example.com' }).compile();

const stmt2 = compiler.insertInto('users').values({ name: 'Bob', email: 'bob@example.com' }).compile();

const batchHandle = batch([stmt1, stmt2]);

// Execute against your driver
const results = await batchHandle.execute(async statements => {
  // Run all statements in a single transaction or call
  return driver.executeMulti(statements);
});
```

Generated SQL (parameterized):

```sql
INSERT INTO "users" ("name", "email") VALUES ($1, $2);
INSERT INTO "users" ("name", "email") VALUES ($3, $4);
-- Parameters: ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
```

## Parameter Renumbering

The query compiler automatically renumbers positional parameters (`$1`, `$2`, ...) when combining queries. This ensures parameters remain valid across the combined statement.

```ts
// Two queries with overlapping parameter positions
const q1 = compiler.selectFrom('orders').where('user_id', '=', 1).compile();
const q2 = compiler.selectFrom('products').where('category_id', '=', 2).compile();

// After union, q1's $1 stays $1, q2's $1 becomes $3
const combined = setOperation('union', [q1, q2], 'postgres');
// combined.parameters => [1, 2] (assuming q2 had one param)
```

> [!WARNING] Batch does NOT guarantee transaction semantics by default. Wrap in a transaction if you need atomicity.

---

See also: [Query Compiler](./select.html) · [Repository](./repository.html) · [Migrations](./migrations.html)
