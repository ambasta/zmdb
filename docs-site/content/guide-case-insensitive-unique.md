> **Supported.** `IndexDef.columns` accepts a tagged expression, so PostgreSQL and
> SQLite can emit a unique index on `lower(email)`. MySQL uses the generated-column
> form below. The `Unique` tag itself remains case-**sensitive**.

## The problem

```ts
email: string & Sql<'varchar'> & Length<255> & Unique;
```

`Alice@example.com` and `alice@example.com` are two different values, so both rows insert. Then your login query with one casing finds nothing, and support has two accounts to merge.

## Expression unique index

For PostgreSQL and SQLite, emit the index from a [custom migration](./migrations-custom.html):

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

await exec(ddl);
```

```sql
CREATE UNIQUE INDEX "users_email_lower" ON "users" (lower("email"))
```

Then query through the same expression, or the index is not used:

```ts
await driver.execute({
  text: 'SELECT * FROM "users" WHERE lower("email") = lower($1)',
  parameters: [input],
});
```

Both sides matter. `WHERE email = $1` will not use `lower(email)`, and `WHERE lower(email) = $1` with an unnormalised parameter misses rows.

The expression is emitted verbatim. Quote identifiers inside it yourself and never interpolate
request data. MySQL is deliberately refused because its functional-key-part syntax differs;
use the generated column below. SQLite supports expression indexes since 3.9.

## Generated column

Portable to MySQL, and it makes the normalised value queryable through the typed API:

```ts
import { generatedColumnDdl, createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const col = generatedColumnDdl(
  { name: 'email_lower', type: 'text', expression: 'lower(email)', stored: true },
  'postgres',
);
// '"email_lower" text GENERATED ALWAYS AS (lower(email)) STORED'
await exec(`ALTER TABLE "users" ADD COLUMN ${col}`);
await exec(
  createIndexDdl({ name: 'users_email_lower', table: 'users', columns: ['email_lower'], unique: true }, 'postgres'),
);
```

`generatedColumnDdl` takes the column and a dialect — it emits a column _fragment_, not a statement, because the same text belongs in a `CREATE TABLE` body and in an `ALTER TABLE … ADD COLUMN`. The table name is yours to write.

Declare it on the interface as a plain column so you can filter on it, and mark it `HasDefault` so `CreateDTO` does not ask for a value the database computes:

```ts
emailLower: string & Sql<'text'> & HasDefault; // maintained by the database; never write to it
```

`HasDefault` is the closest tag to "the database supplies this" — it makes the property optional in `CreateDTO<User>`. It does not stop you from _passing_ a value, which a generated column will reject at the database. The alternative is to leave the column off the interface entirely and reach it through the query builder, which costs you the type and keeps the write path honest by construction.

## Workaround 3 — normalise in the application

```ts
class UserRepository extends BaseRepository<User> {
  protected override preInsert(row: Record<string, unknown>): void {
    if (typeof row.email === 'string') row.email = row.email.toLowerCase();
  }
  protected override preUpdate(row: Record<string, unknown>): void {
    if (typeof row.email === 'string') row.email = row.email.toLowerCase();
  }
}
```

Both hooks return `void` and take `Record<string, unknown>` — they are handed the sanitised payload _by reference_, so you normalise in place rather than returning a new object. A returned value is discarded. `upsert` goes through `preInsert` too.

They also run **after** validation, which is the ordering you want here: a `Pattern` or `MaxLength` check sees what the caller actually sent, and the normalisation cannot smuggle a value past a constraint.

Store lowercase, so the plain `Unique` constraint is now case-insensitive in effect.

This is the simplest option and it has a real hole: any writer that is not this repository — a migration, a data fix, another service — can insert mixed case, and the constraint will not stop it. Belt and braces is a `CHECK (email = lower(email))` in a migration.

> [!WARNING]
> `toLowerCase()` is not the same as Unicode case folding. `'İ'.toLowerCase()` is
> two code points in some locales, and `ß` versus `SS` differs again. For email
> addresses this rarely matters; for usernames it is a real
> account-confusion vector. Postgres `lower()` and JavaScript `toLowerCase()` can
> also disagree, which is worth knowing if you use both approaches together.

Also note: the local part of an email address is technically case-sensitive per RFC 5321. In practice every mail provider treats it as insensitive, and treating it otherwise creates duplicate accounts — so lowercase it, but understand that you are choosing a convention.

## `citext`

Postgres has a case-insensitive text type, in the `citext` extension:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ALTER COLUMN email TYPE citext;
```

Now `=` and `Unique` are insensitive with no query changes. Since `SqlType` has no `citext`, declare the column as `Sql<'text'>` and change the type in a migration — see [Database Extensions](./db-extensions.html). Cleanest option if you are Postgres-only, and it applies to every writer.

## Declaration boundary

`IndexDef` emits the functional index, but the type-level `Unique` tag carries no arguments and
therefore cannot derive it from the interface. Keep the index declaration beside the schema in a
migration. Its expression is raw DDL and needs the same care as [raw SQL](./raw-sql.html).

---

See also: [Indexes & Constraints](./indexes-constraints.html) · [Database Extensions](./db-extensions.html) · [Custom Migrations](./migrations-custom.html)
