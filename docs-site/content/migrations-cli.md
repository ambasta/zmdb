The packaged migration commands and the public runner use the same ledger and ordering rules.

## Packaged commands

With migrations in the configured output directory:

```bash
npx zmdb migrate
npx zmdb status
npx zmdb rollback
```

The executable loads `zmdb.config.ts`, opens its `driver`, parses each `<YYYYMMDDHHMMSS>_<name>.sql` file, and delegates to the runner. It prints the resolved config and SQL before database mutation.

## Library runner

Applications that already have migration data can call the same boundary:

```ts
import { driverMigrationConnection, status, up, type Migration } from '@zmdb/migrations/runner';
import { sqlite } from '@zmdb/sqlite';

const migrations: readonly Migration[] = [
  {
    version: 20260904010101,
    name: 'create_users',
    up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
    down: 'DROP TABLE users',
  },
];

const connection = driverMigrationConnection(driver, sqlite);
await up(connection, migrations);
console.log(await status(connection, migrations));
```

`driverMigrationConnection` owns the ledger SQL. It creates or upgrades the table, stores a SHA-256 checksum for new rows, and refuses an edited applied migration before running pending SQL.

## Transaction guarantees

The Postgres family, SQLite and SQL Server run each migration body and its ledger insert in one driver-pinned transaction. The failing migration rolls back without a ledger row; migrations committed
earlier in the batch remain applied.

MySQL-family DDL is not transactional. The runner exposes a warning callback and the packaged command prints that warning before execution. Its ledger remains honest after a failure, but the schema
can be partially changed.

## Custom connections

`MigrationConnection` remains a structural boundary for runtimes that do not use a repository `Driver`. Its original four methods still work. Implement the optional `appliedMigrations`, `checksum`,
`ensureVersionTable`, and `transaction` members to provide checksum verification, custom ledger DDL, and atomic migration-plus-row behavior equivalent to the driver adapter.

Rows with a null checksum are intentionally accepted as legacy history. They cannot be verified retroactively, and the runner does not pretend otherwise.

---

See also: [Migrations](./migrations.html) · [migrate](./cli-migrate.html) · [Writing a Driver](./custom-driver.html)
