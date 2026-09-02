The builder functions map to SQL column types and drive both the derived
TypeScript type and the DDL emitted by [migrations](./migrations.html).

## Type mapping

Each dialect renders the type it owns. The schema itself stays abstract — it says
`timestamp`, never `TIMESTAMPTZ` — and the DDL emitter is where that becomes a real
type, because the three databases do not agree and the schema should not have to pick.

| Builder           | Postgres      | MySQL                | SQLite    | TS type                             |
| ----------------- | ------------- | -------------------- | --------- | ----------------------------------- |
| `serial()`        | `SERIAL`      | `INT AUTO_INCREMENT` | `INTEGER` | `number` (omitted from `CreateDTO`) |
| `integer()`       | `INTEGER`     | `INT`                | `INTEGER` | `number`                            |
| `bigint()`        | `BIGINT`      | `BIGINT`             | `INTEGER` | `bigint`                            |
| `numeric()`       | `NUMERIC`     | `DECIMAL`            | `NUMERIC` | `number`                            |
| `text()`          | `TEXT`        | `TEXT`               | `TEXT`    | `string`                            |
| `varchar(n)`      | `VARCHAR(n)`  | `VARCHAR(n)`         | `TEXT`    | `string`                            |
| `boolean()`       | `BOOLEAN`     | `TINYINT(1)`         | `INTEGER` | `boolean`                           |
| `timestamp()`     | `TIMESTAMPTZ` | `DATETIME(3)`        | `TEXT`    | `Date`                              |
| `json()`          | `JSONB`       | `JSON`               | `TEXT`    | `unknown`                           |
| `jsonEnum([...])` | `TEXT`        | `TEXT`               | `TEXT`    | union of the literals               |

Three of those rows are worth a sentence:

- **`timestamp` is `TIMESTAMPTZ` in Postgres**, not `TIMESTAMP`. `TIMESTAMP` there means
  _without_ time zone: it keeps the wall clock and discards the offset, so a `Date`
  written from one zone reads back as a different instant in another. MySQL has no
  zone-aware type with a usable range — `TIMESTAMP` converts to the session zone and
  stops in 2038 — so `DATETIME(3)` holds UTC with the milliseconds a `Date` has.
- **`varchar` needs its length.** `varchar(255)` becomes `VARCHAR(255)` everywhere it can
  be; a `varchar()` with no length is unlimited in Postgres, and a syntax error in MySQL,
  so it degrades to `TEXT` there rather than emitting DDL that cannot run.
- **SQLite has affinities, not types.** `INTEGER PRIMARY KEY` _is_ the rowid, which is
  what makes `serial()` auto-increment without an `AUTOINCREMENT` keyword.

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
-- postgres
CREATE TABLE "users" ("createdAt" TIMESTAMPTZ NOT NULL, "email" TEXT NOT NULL, "id" SERIAL PRIMARY KEY, "role" TEXT NOT NULL)
-- mysql
CREATE TABLE `users` (`createdAt` DATETIME(3) NOT NULL, `email` TEXT NOT NULL, `id` INT AUTO_INCREMENT PRIMARY KEY, `role` TEXT NOT NULL)
```

Columns come out sorted by name, because a snapshot has to be byte-stable to be
diffable. Two things a snapshot does not yet carry, and so the DDL does not either:
`DEFAULT` clauses and `UNIQUE`/`CHECK` constraints. `defaultTo()` and `validate()` are
enforced by the repository, not by the table.

> [!TIP]
> `.notNull()` makes a field **required**; a column with `.defaultTo()` or
> `serial()` becomes **optional in `CreateDTO`** and is omitted where
> auto-generated. `nullable` columns become `T | null` in `Entity`. See
> [Type derivation](./type-derivation.html).

For richer schema objects (indexes, generated columns, sequences), see
[Indexes & constraints](./indexes-constraints.html) and
[Generated columns](./generated-columns.html).
