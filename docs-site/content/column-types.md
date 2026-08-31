The builder functions map to SQL column types and drive both the derived
TypeScript type and the DDL emitted by [migrations](./migrations.html).

## Type mapping

| Builder           | SQL                    | TS type                             |
| ----------------- | ---------------------- | ----------------------------------- |
| `serial()`        | `SERIAL` / auto-inc PK | `number` (omitted from `CreateDTO`) |
| `integer()`       | `INTEGER`              | `number`                            |
| `bigint()`        | `BIGINT`               | `bigint`                            |
| `numeric()`       | `NUMERIC`              | `number`                            |
| `text()`          | `TEXT`                 | `string`                            |
| `varchar()`       | `VARCHAR(n)`           | `string`                            |
| `boolean()`       | `BOOLEAN`              | `boolean`                           |
| `timestamp()`     | `TIMESTAMP`            | `Date`                              |
| `json()`          | `JSON` / `JSONB`       | `unknown`                           |
| `jsonEnum([...])` | `TEXT` + check         | union of the literals               |

## Modifiers

Modifiers are pure and chainable; they return frozen column metadata.

```ts
serial().primaryKey();
text().notNull();
varchar().notNull(); // length via the builder
jsonEnum(['admin', 'user']).notNull().defaultTo('user');
references(integer().notNull(), 'users.id'); // functional, not chained
text().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$'));
timestamp().notNull().defaultTo('now');
```

> [!NOTE]
> `references` is a **function**, not a chained method — there is no
> `.references()` on a column. Wrap the column:
> `references(integer().notNull(), 'users.id')`, or pass the target schema for a
> type-checked foreign key: `references(integer().notNull(), UserSchema, 'id')`.

## How columns become DDL

A schema diffs into `CREATE TABLE` DDL through migrations:

```sql
CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
```

> [!TIP]
> `.notNull()` makes a field **required**; a column with `.defaultTo()` or
> `serial()` becomes **optional in `CreateDTO`** and is omitted where
> auto-generated. `nullable` columns become `T | null` in `Entity`. See
> [Type derivation](./type-derivation.html).

For richer schema objects (indexes, generated columns, sequences), see
[Indexes & constraints](./indexes-constraints.html) and
[Generated columns](./generated-columns.html).
