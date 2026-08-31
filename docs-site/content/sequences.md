Sequences are database objects that generate auto-incrementing numeric values. In PostgreSQL, they're the underlying mechanism behind `SERIAL` columns. zmdb provides declarative DDL functions to create and manage sequences independently.

> [!TIP]
> While zmdb's `serial()` column builder creates sequences implicitly, you may need explicit sequences for custom auto-increment behavior, multiple tables sharing a sequence, or generating unique IDs for external systems.

## Creating a Sequence

Use `createSequenceDdl` to generate the DDL for a sequence. You can specify optional `start` and `increment` values.

```ts
import { createSequenceDdl } from '@zmdb/query-compiler/schema-objects';

const seqDef = {
  name: 'order_number_seq',
  start: 1000,
  increment: 1,
};

const ddl = createSequenceDdl(seqDef, 'postgres');
console.log(ddl);
```

```sql
CREATE SEQUENCE "order_number_seq" START 1000 INCREMENT 1
```

## Using Sequences with Column Builders

Sequences pair well with `integer()` columns that need custom sequence behavior. Create the sequence first, then reference it in your column definition.

```ts
import { integer, defaultTo, defineSchema } from '@zmdb/schema-core';

const OrderSchema = defineSchema('orders', {
  order_id: integer().notNull(),
  order_number: integer().notNull().defaultTo("nextval('order_number_seq')"),
  created_at: integer().notNull(), // timestamp as unix epoch
});
```

> [!IMPORTANT]
> The `defaultTo` value uses raw SQL (`nextval(...)`). This is passed through as-is to the generated DDL. Ensure the sequence exists before running migrations.

## Getting the Next Value

To use a sequence in your application, call `nextval()` to retrieve the next value. This is typically done at the application level or through a trigger.

```ts
// Generating next sequence value via query compiler
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

const nextValQuery = compiler.selectFrom('order_number_seq').select(['nextval']).compile();

console.log(nextValQuery.text);
```

```sql
SELECT nextval('order_number_seq')
```

> [!NOTE]
> zmdb's query compiler doesn't have a dedicated `nextval` helper. For production use, consider creating a function or using raw SQL queries through your driver.

## Dropping a Sequence

Sequences can be dropped using standard DDL. Include this in your migration files when removing tables that depend on custom sequences.

```ts
const dropSequenceDdl = `DROP SEQUENCE IF EXISTS "order_number_seq"`;
```

```sql
DROP SEQUENCE IF EXISTS "order_number_seq"
```

## Sequences vs Serial Columns

zmdb's `serial()` column builder abstracts away the sequence creation. Here's when to use explicit sequences:

| Use Case                      | Recommendation                                                  |
| ----------------------------- | --------------------------------------------------------------- |
| Simple auto-increment PK      | Use `serial()` — creates sequence automatically                 |
| Custom start value            | Use explicit `createSequenceDdl` + `integer()` with `defaultTo` |
| Shared sequence across tables | Use explicit sequence with `nextval()`                          |
| UUID generation               | Use `gen_random_uuid()` instead                                 |

> [!WARNING]
> MySQL and SQLite don't have native sequence objects. On these dialects, `createSequenceDdl` will generate syntactically invalid DDL or throw an error. Use auto-increment columns instead.

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with serial columns
- [Indexes & Constraints](./indexes-constraints.html) — adding constraints to tables with sequences
- [Generated Columns](./generated-columns.html) — computed columns that depend on sequences
