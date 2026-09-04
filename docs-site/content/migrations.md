Migrations manage schema evolution over time. zmdb provides snapshot and diff utilities that compare your in-code schema definitions against the live database, generating the DDL needed to align them.

## The packaged workflow

Most projects should use the CLI so config discovery, atomic files, checksums, exit codes, and driver cleanup stay uniform:

```bash
npx zmdb generate --name add_slug
git diff -- migrations/
npx zmdb migrate
npx zmdb status
npx zmdb check
```

`generate` writes one reviewed up/down SQL file plus `snapshot.json`. `migrate` applies pending versions and records their checksums; `status` shows the ledger; `check` reports uncommitted schema,
malformed history, and optional live drift. See the [CLI overview](./cli-overview.html) for the complete command and exit contract.

Use the library sections below when an application owns snapshots or migration arrays in memory rather than files on disk.

## Taking a Snapshot

Capture the current state of your schemas:

<!-- snippet: migrations.ts#snippet-1 -->

The snapshot captures table names, column types, nullability, and each table's ordered primary key.

## Computing the Diff

Compare two snapshots to generate change operations:

<!-- snippet: migrations.ts#snippet-2 -->

Change operations include:

- `create_extension` — extension required by a declared column type
- `create_table` — new table with all columns and its ordered primary key
- `drop_table` — removed table
- `add_column` — new column in existing table
- `drop_column` — removed column
- `alter_column_type` — type change
- `alter_primary_key` — ordered primary-key change; explicitly refused on SQLite and SQL Server (the latter needs the existing constraint name)

## Generating DDL

Convert change operations to SQL for your dialect:

<!-- snippet: migrations.ts#snippet-3 -->

> [!NOTE] Column renames are not detected — they're treated as drop + add. Track renames manually or use a naming convention.

## Version Table

The PostgreSQL migration runner creates a `_zmdb_migrations` table to track applied versions:

```sql
CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  checksum TEXT
)
```

PostgreSQL binds `applied_at` as a JavaScript `Date`, preserving an instant rather than a local wall clock. SQLite uses `INTEGER` for both numeric columns because its integer storage is already
64-bit; other database packages own their corresponding ledger representation. A null checksum identifies history written by an older runner; new rows store SHA-256 over the exact `up` section.

> [!TIP] Always store migrations in version control. Pair with the CLI runner for local development.

---

See also: [Migrations CLI](./migrations-cli.html) · [Query Compiler](./select.html) · [Schema Core](./schema-declaration.html)
