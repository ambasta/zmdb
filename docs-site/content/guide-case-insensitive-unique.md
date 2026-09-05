> **Supported.** `createIndexDdl` emits a functional unique index on the PostgreSQL family and SQLite. The MySQL family and SQL Server use a generated lowercase column plus an ordinary unique index.

Case sensitivity is a database property, not a property of the TypeScript string. A plain unique index follows its column's type and collation: PostgreSQL `text` is case-sensitive, MySQL's usual
`utf8mb4_0900_ai_ci` collation is not, and SQL Server follows the collation you selected. If account identity must be case-insensitive, make that contract explicit rather than inheriting a server
default.

The `Unique` tag records uniqueness in the schema IR, but the ordinary generated migration path does not create a standalone unique constraint for the root dialects. Every recipe below therefore
creates the unique index explicitly.

## Expression unique index

PostgreSQL, Cockroach and SQLite accept the tagged expression form:

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const ddl = createIndexDdl(
  {
    name: 'users_email_lower',
    table: 'users',
    columns: [{ expr: 'lower("email")' }],
    unique: true,
  },
  'postgres',
);

await driver.execute({ text: ddl, parameters: [] });
```

```sql
CREATE UNIQUE INDEX "users_email_lower" ON "users" (lower("email"))
```

Query through the same expression:

```ts
await driver.execute({
  text: 'SELECT * FROM "users" WHERE lower("email") = lower($1)',
  parameters: [input],
});
```

Both sides matter. `WHERE email = $1` does not match the indexed expression, and `WHERE lower(email) = $1` with an unnormalised parameter misses rows. Repository filters take column names, so this
expression query is deliberately raw SQL at the driver boundary.

The expression is emitted verbatim and compared byte-for-byte in migration snapshots. Quote identifiers inside it, never interpolate request data, and expect a whitespace or casing change to recreate
the index. A bare string is a column name: `columns: ['lower(email)']` produces an index on a column literally named `lower(email)`.

MySQL, SingleStore and SQL Server throw `UnsupportedFeatureError` for the expression form because their grammar differs. The error names the index, table, expression and generated-column alternative.

## Generated column for the MySQL family and SQL Server

`generatedColumnDdl` emits a column fragment, and `createIndexDdl` emits the ordinary unique index over it:

```ts
import { createIndexDdl, generatedColumnDdl } from '@zmdb/query-compiler/schema-objects';

const column = generatedColumnDdl(
  {
    name: 'email_lower',
    type: 'VARCHAR(255)',
    expression: 'lower(`email`)',
    stored: true,
  },
  'mysql',
);
const index = createIndexDdl(
  {
    name: 'users_email_lower',
    table: 'users',
    columns: ['email_lower'],
    unique: true,
  },
  'mysql',
);

await driver.execute({
  text: `ALTER TABLE \`users\` ADD COLUMN ${column}`,
  parameters: [],
});
await driver.execute({ text: index, parameters: [] });
```

The measured MySQL output is:

```sql
`email_lower` VARCHAR(255) GENERATED ALWAYS AS (lower(`email`)) STORED
CREATE UNIQUE INDEX `users_email_lower` ON `users` (`email_lower`)
```

For SQL Server the same two functions emit:

```sql
[email_lower] AS (LOWER([email])) PERSISTED
CREATE UNIQUE INDEX [users_email_lower] ON [users] ([email_lower])
```

SingleStore inherits the MySQL spelling. Its unique index must also include the whole shard key, so a tenant-sharded table normally indexes `['tenantId', 'email_lower']`, not `email_lower` alone.

Leave the generated column out of the table interface. `HasDefault` only makes a property optional on create; it does not make the property read-only, so a repository write could still target the
generated column and the database would reject it. If you need a typed read of the generated value, expose a view with a separate interface. See [Generated Columns](./generated-columns.html).

## Application normalisation

Normalising before every repository write lets an ordinary unique index enforce the stored lowercase value:

```ts
class UserRepository extends BaseRepository<User> {
  protected override preInsert(row: Record<string, unknown>): void {
    if (typeof row.email === 'string') row.email = row.email.toLowerCase();
  }

  protected override preUpdate(patch: Record<string, unknown>): void {
    if (typeof patch.email === 'string') patch.email = patch.email.toLowerCase();
  }
}
```

Both hooks receive the validated object by reference and return `void`. `preUpdate` gets the `undefined`-stripped patch in schema order. `upsert` runs `preInsert` for its create payload; its
conflict-update object does not also run `preUpdate`.

Hooks run after validation, and their mutations are not validated a second time. Keep the change constraint-preserving, then create an explicit unique index on `email` with `createIndexDdl`.

This approach has a real hole: a migration, data fix or another service can write mixed case without passing through the hooks. A database `CHECK (email = lower(email))` closes that hole.

> [!WARNING] `toLowerCase()` is not Unicode case folding. JavaScript and the database can also produce different results for the same non-ASCII input. Test the character set your identity contract
> accepts.

## Postgres `citext`

`citext` makes ordinary equality case-insensitive for every writer:

```ts
import type { Ext, Table } from 'zmdb/tags';

interface User extends Table<'users'> {
  email: string & Ext<'citext', 'citext'>;
}
```

The generated migration installs the extension before creating the table. Add the unique index explicitly:

```ts
createIndexDdl(
  {
    name: 'users_email_unique',
    table: 'users',
    columns: ['email'],
    unique: true,
  },
  'postgres',
);
```

This is the cleanest Postgres-only option when the column's semantics are case-insensitive, not merely one lookup. See [Database Extensions](./db-extensions.html).

## Declaration boundary

The type-level `Unique` tag carries no expression, so it cannot derive `lower(email)` from the interface. Keep the explicit index beside the schema in a reviewed migration. Its expression is raw DDL
and needs the same care as [raw SQL](./raw-sql.html).

---

See also: [Indexes & Constraints](./indexes-constraints.html) · [Generated Columns](./generated-columns.html) · [Database Extensions](./db-extensions.html) ·
[Custom Migrations](./migrations-custom.html)
