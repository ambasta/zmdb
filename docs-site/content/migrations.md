`@zmdb/migrations` owns schema snapshots, diffs, DDL plans and ledger execution. Snapshots describe the schemas supplied by the caller; live database comparison uses the selected database's
introspector. The library does not discover a TypeScript project or depend on the compiler or CLI.

## The packaged workflow

Most projects should use the CLI so config discovery, atomic files, checksums, exit codes, and driver cleanup stay uniform:

```bash
yarn zmdb generate --name add_slug
git diff -- migrations/
yarn zmdb migrate
yarn zmdb status
yarn zmdb check
```

`generate` writes one reviewed up/down SQL file plus `snapshot.json`. `migrate` applies pending versions and records their checksums; `status` shows the ledger; `check` reports uncommitted schema,
malformed history, and optional live drift. See the [CLI overview](./cli-overview.html) for the complete command and exit contract.

Use the library sections below when an application owns snapshots or migration arrays in memory rather than files on disk.

## Standalone library usage

Install the library and the database package that owns the dialect:

```bash
yarn add @zmdb/migrations@1.0.0-beta.1 @zmdb/sqlite@1.0.0-beta.1
```

This complete example builds snapshots and a plan from schema data without connecting to a database:

```ts {"mode":"compile","id":"migration-snapshot-plan"}
import { diff, planMigration, snapshot } from '@zmdb/migrations';
import { sqlite, sqliteMigrations } from '@zmdb/sqlite';

const previous = snapshot([]);
const current = snapshot([
  {
    table: 'users',
    primaryKey: ['id'],
    columns: {
      id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
      email: { type: 'text', flags: { nullable: false } },
    },
  },
]);

const changes = diff(previous, current);
const plan = planMigration(previous, current, {
  dialect: sqlite,
  emitUp: sqliteMigrations.emitUp,
  emitDown: sqliteMigrations.emitDown,
});

console.log(changes.map(operation => operation.kind)); // ['create_table']
console.log(plan.up); // SQL to create users
console.log(plan.down); // SQL to drop users
```

`snapshot` also accepts the structural data in generated schemas. It captures table names, column types, nullability and ordered primary keys. `diff` compares two snapshots; `planMigration` uses the
selected dialect and its migration emitters to order SQL. The product's `zmdb/migrations` entry offers the curated lifecycle APIs, while the direct package provides the complete surface.

## Change operations

Change operations include:

- `create_extension` — extension required by a declared column type
- `create_table` — new table with all columns and its ordered primary key
- `drop_table` — removed table
- `add_column` — new column in existing table
- `drop_column` — removed column
- `alter_column_type` — type change
- `alter_primary_key` — ordered primary-key change; explicitly refused on SQLite and SQL Server (the latter needs the existing constraint name)

For one operation, `emitUp(operation, dialect)` and `emitDown(operation, dialect)` accept the selected dialect object or its migration interface. Dialect names as strings are not the emitter API.

> [!NOTE] Column renames are not detected — they're treated as drop + add. Track renames manually or use a naming convention.

## Execution and embedding

`@zmdb/migrations/runner` exports `up`, `down`, `status` and `driverMigrationConnection` for a caller-owned connection. `@zmdb/migrations/introspect` reads a live catalog through the selected dialect;
`@zmdb/migrations/declarations` turns a snapshot into TypeScript declarations.

For web or mobile SQLite, generate migration data with `zmdb embed` and import `runEmbedded` from `@zmdb/migrations/embedded`. That entry accepts precomputed records and a connection with `exec`,
`run` and `rows`; it does not import a filesystem API, a driver or compiler tooling. See [Web and Mobile Migrations](./migrations-web-mobile.html) for the connection boundary.

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
64-bit; other database packages own their corresponding ledger representation. New rows store SHA-256 over the exact `up` section.

> [!TIP] Always store migrations in version control. Pair with the CLI runner for local development.

---

See also: [Migrations CLI](./migrations-cli.html) · [Tooling Boundaries](./tooling-boundaries.html) · [Schema Declaration](./schema-declaration.html)
