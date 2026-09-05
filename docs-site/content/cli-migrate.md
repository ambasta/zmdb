> **ToDo / documentation gap.** `migrate`, `rollback`, and `status` ship. The
> documentation slice still owes final packaged-command transcripts.

## Applying migrations

```bash
npx zmdb migrate
npx zmdb status
npx zmdb rollback
npx zmdb rollback --to 20260904010101
```

Each command loads `zmdb.config.ts`, opens its `driver` thunk, and reads the
single-file migrations in the configured output directory. A file carries both
directions:

```sql
-- zmdb:up
ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMPTZ;
-- zmdb:down
ALTER TABLE orders DROP COLUMN shipped_at;
```

The fourteen-digit filename prefix is the ledger version:

```text
migrations/20260904010101_add_shipped_at.sql
```

`migrate` prints the resolved config path and each pending migration's SQL
before executing it. A second run is a successful no-op.

## Ledger integrity

The runner stores the version, name, application time, and a SHA-256 checksum
of the exact `up` section. If an applied migration file changes, the next
`migrate`, `rollback`, or `status` refuses before applying new SQL and reports
both checksums.

Rows written by an older runner have a null checksum. They remain applied but
unverifiable; the runner adds the checksum column without pretending it knows
what those old files contained.

Versions use `BIGINT` on Postgres, MySQL and SQL Server. SQLite's `INTEGER` is
already 64-bit, so the timestamp-shaped version fits there without another
type.

## Transaction boundary

On Postgres, SQLite and SQL Server, each migration body and its ledger insert
run in one driver-pinned transaction. If the body fails, that migration is
rolled back and no ledger row is written. Migrations completed earlier in the
run stay committed.

MySQL DDL auto-commits. The command warns before the first pending migration;
after a failure, the absent ledger row is honest but the schema may need manual
repair.

## Deployment ordering

Run migrations in a release step before the new application version starts:

```toml
# fly.toml
[deploy]
  release_command = "npx zmdb migrate"
```

During a rolling deploy, old code runs briefly against the new schema. Additive
changes are the easy case. A column removal normally takes two releases: first
stop reading it, then drop it after the old version is gone.

The runner does not take a distributed lock. If two deploy processes can race,
take the database's advisory lock around the command or ensure the platform
runs one release task.

## Library use

The executable delegates to the public runner:

```ts
import { driverMigrationConnection, up } from '@zmdb/query-compiler/migrations/runner';

const connection = driverMigrationConnection(driver, 'postgres');
await up(connection, migrations);
```

Use the executable when migrations live on disk; use the library boundary when
the application already owns the migration array.

---

See also: [Migration Runner](./migrations-cli.html) · [up and upgrade](./cli-up.html) · [Working in a Team](./migrations-teams.html)
