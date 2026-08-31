Batch operations execute multiple statements in a single database round-trip. Use `batch` when you need to run several independent queries together — bulk inserts, multi-table updates, or grouped operations that benefit from a single network call.

## The Batch Handle

Create a batch handle from compiled statements:

```ts
import { batch, createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const stmt1 = compiler.insertInto('users').values({ name: 'Alice', email: 'alice@example.com' }).compile();

const stmt2 = compiler.insertInto('users').values({ name: 'Bob', email: 'bob@example.com' }).compile();

const batchHandle = batch([stmt1, stmt2]);
// batchHandle.statements => [stmt1, stmt2]
```

## Executing a Batch

The `execute` method runs all statements via your driver:

```ts
const results = await batchHandle.execute(async statements => {
  // Your driver must support multi-statement execution
  // For PostgreSQL: client.query(text + ';' + text, [...params1, ...params2])
  return driver.executeMulti(statements);
});
// results => [result1, result2]
```

The callback receives all compiled statements and returns an array of results in the same order.

> [!NOTE]
> Not all drivers support multi-statement execution. Check your driver documentation. For PostgreSQL, use `pg`'s query chaining or a transaction.

## Bulk Inserts

Combine multiple inserts into one batch:

```ts
const users = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' },
];

const statements = users.map(u => compiler.insertInto('users').values(u).compile());

const result = await batch(statements).execute(driver.executeMulti.bind(driver));
```

## Parameter Handling

The query compiler handles parameter arrays correctly. Each statement has its own parameter list, which the batch executor flattens:

```ts
// stmt1.parameters => ['Alice', 'alice@example.com']
// stmt2.parameters => ['Bob', 'bob@example.com']

// After batch execute:
// Combined params => ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
```

> [!WARNING]
> Batch does NOT guarantee atomicity by default. Wrap in a transaction if all-or-nothing semantics are required.

## Empty Batches

An empty batch returns an empty array immediately without calling the runner:

```ts
const empty = batch([]);
const result = await empty.execute(async () => {
  throw new Error('Should not run');
});
// result => []
```

> [!TIP]
> Use batch for independent operations. If operations have dependencies (e.g., insert then query the ID), use a transaction instead.

---

See also: [Set Operations](./set-operations.html) · [Query Compiler](./select.html) · [Drivers](./drivers.html)
