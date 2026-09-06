Sequences are database objects that generate auto-incrementing numeric values. In PostgreSQL, they're the underlying mechanism behind `SERIAL` columns; SQL Server also exposes them as independent
schema objects. zmdb provides declarative DDL functions to create and manage sequences independently.

> [!TIP] While a `Serial` column creates a sequence implicitly, you may need explicit sequences for custom auto-increment behavior, multiple tables sharing a sequence, or generating unique IDs for
> external systems.

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

With `'mssql'`, the same definition emits:

```sql
CREATE SEQUENCE [order_number_seq] START WITH 1000 INCREMENT BY 1
```

## Using a Sequence from a Column

A column fed by an explicit sequence is an ordinary `integer` column that says `HasDefault`:

```ts
import type { HasDefault, PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'> {
  order_id: number & Sql<'integer'> & PrimaryKey;
  order_number: number & Sql<'integer'> & HasDefault;
  created_at: number & Sql<'integer'>; // timestamp as unix epoch
}
```

`HasDefault` makes `order_number` optional in `CreateDTO<Order>`, which is the part the compiler needs to know. Which sequence, and the `nextval(...)` call itself, goes in the
[migration](./migrations-custom.html):

```sql
ALTER TABLE "orders" ALTER COLUMN "order_number" SET DEFAULT nextval('order_number_seq');
```

> [!IMPORTANT] This is raw dialect SQL and it belongs next to the `CREATE SEQUENCE`, in the same migration — the ordering matters, and a declaration that named the sequence could not enforce it
> anyway. Note this is also _not_ `Serial`: `Serial` means "the database generates it, do not send one", which is the same optionality plus an exclusion from `CreateDTO` and a `SERIAL` in the
> generated DDL. Use `HasDefault` when you own the sequence.

## Getting the Next Value

To use a sequence in your application, call `nextval()` to retrieve the next value. This is typically done at the application level or through a trigger.

```ts
// Generating next sequence value via query compiler
import { createQueryCompiler } from '@zmdb/query-compiler';
import { postgres } from '@zmdb/postgres';

const compiler = createQueryCompiler(postgres);

const nextValQuery = compiler.selectFrom('order_number_seq').select(['nextval']).compile();

console.log(nextValQuery.text);
```

```sql
SELECT nextval('order_number_seq')
```

> [!NOTE] zmdb's query compiler doesn't have a dedicated `nextval` helper. For production use, consider creating a function or using raw SQL queries through your driver.

## Dropping a Sequence

Sequences can be dropped using standard DDL. Include this in your migration files when removing tables that depend on custom sequences.

```ts
const dropSequenceDdl = `DROP SEQUENCE IF EXISTS "order_number_seq"`;
```

```sql
DROP SEQUENCE IF EXISTS "order_number_seq"
```

## Sequences vs Serial Columns

The `Serial` tag abstracts away the sequence creation. Here's when to use explicit sequences:

| Use Case                      | Recommendation                                                        |
| ----------------------------- | --------------------------------------------------------------------- |
| Simple auto-increment PK      | `Serial` — creates the sequence automatically                         |
| Custom start value            | `createSequenceDdl` + an `integer` column with `HasDefault`           |
| Shared sequence across tables | An explicit sequence, `nextval()` in the migration                    |
| UUID generation               | `gen_random_uuid()` in the migration, with `HasDefault` on the column |

> [!WARNING] MySQL and SQLite don't have native sequence objects. On these dialects, `createSequenceDdl` throws `UnsupportedFeatureError`. Use auto-increment columns instead.

## Related

- [Schema Declaration](./schema-declaration.html) — declaring tables with serial columns
- [Tag Reference](./tags-reference.html) — `Serial` versus `HasDefault`
- [Indexes & Constraints](./indexes-constraints.html) — adding constraints to tables with sequences
- [Generated Columns](./generated-columns.html) — computed columns that depend on sequences
