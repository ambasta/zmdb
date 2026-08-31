> **ToDo / feature gap.** `IndexDef.columns` is a list of column names, so
> `UNIQUE (lower(email))` — a functional index — is not expressible. `unique()`
> gives you a case-**sensitive** constraint.

## The problem

```ts
email: varchar(255).notNull().unique(),
```

`Alice@example.com` and `alice@example.com` are two different values, so both rows insert. Then your login query with one casing finds nothing, and support has two accounts to merge.

## Workaround 1 — a functional unique index, hand-written

The correct fix, via a [custom migration](./migrations-custom.html):

```sql
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
```

Then query through the same expression, or the index is not used:

```ts
await driver.execute({
  text: 'SELECT * FROM "users" WHERE lower("email") = lower($1)',
  parameters: [input],
});
```

Both sides matter. `WHERE email = $1` will not use `lower(email)`, and `WHERE lower(email) = $1` with an unnormalised parameter misses rows.

MySQL 8 needs a generated column to index an expression (see below). SQLite supports expression indexes since 3.9.

## Workaround 2 — a generated column

Portable to MySQL, and it makes the normalised value queryable through the typed API:

```ts
import { generatedColumnDdl, createIndexDdl } from '@zmdb/query-compiler/schema-objects';

generatedColumnDdl(
  'users',
  { name: 'email_lower', type: 'text', expression: 'lower(email)', stored: true },
  'postgres',
);
createIndexDdl({ name: 'users_email_lower', table: 'users', columns: ['email_lower'], unique: true }, 'postgres');
```

Declare it in the schema as a plain column so you can filter on it, and never write to it:

```ts
emailLower: text().notNull(),   // maintained by the database; do not include in CreateDTO usage
```

The wart is that `CreateDTO` will ask for it. Omitting it from the schema and querying it via the builder is cleaner if you can live without the type.

## Workaround 3 — normalise in the application

```ts
class UserRepository extends BaseRepository<typeof users> {
  protected override preInsert(row: CreateDTO<typeof users>) {
    return { ...row, email: row.email.toLowerCase() };
  }
  protected override preUpdate(row: UpdateDTO<typeof users>) {
    return row.email !== undefined ? { ...row, email: row.email.toLowerCase() } : row;
  }
}
```

Store lowercase, so the plain `unique()` constraint is now case-insensitive in effect.

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

Now `=` and `unique()` are insensitive with no query changes. Since `SqlType` has no `citext`, declare the column as `text()` and change the type in a migration — see [Database Extensions](./db-extensions.html). Cleanest option if you are Postgres-only, and it applies to every writer.

## What it would take

`IndexDef.columns` accepting an expression as well as a name, and `unique()` gaining an option for it. The design question is how an expression is represented safely — index expressions cannot be parameterised, so this is unavoidably a string that ends up in DDL, which needs the same care as [raw SQL](./raw-sql.html). The same expression support would unblock functional indexes generally, which is a bigger win than this one case.

---

See also: [Indexes & Constraints](./indexes-constraints.html) · [Database Extensions](./db-extensions.html) · [Custom Migrations](./migrations-custom.html)
