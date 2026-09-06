## Applying migrations

Use the packaged command:

```bash
npx zmdb migrate
```

The public runner keeps `up` as its library verb:

```ts
import { driverMigrationConnection, up } from '@zmdb/migrations/runner';
import { sqlite } from '@zmdb/sqlite';

const connection = driverMigrationConnection(driver, sqlite);
await up(connection, migrations);
```

It reads the checksum-aware ledger, verifies every applied migration it can verify, and applies pending versions in ascending order. The driver adapter keeps each Postgres or SQLite migration body and
ledger write in one transaction.

`zmdb up` exits 2 and names both alternatives. Reusing the word for snapshot rewrites would make a typo choose between filesystem and database mutation.

## Rollback and status

The executable exposes the other two runner operations under explicit names:

```bash
npx zmdb status
npx zmdb rollback
npx zmdb rollback --to 20260904010101
```

`rollback` without `--to` reverts the highest applied version. With `--to`, it reverts every newer version and leaves the target applied.

## Upgrading a stored snapshot

```bash
npx zmdb upgrade
```

Snapshot format version 1 is the only format this build knows. Running `upgrade` against it returns `changed: false` and does not touch the file's mtime. A snapshot from a newer build is an invocation
error rather than an attempted downgrade. No older snapshot shape is frozen yet, so this build does not invent a conversion for one.

The current-format fixture and the deliberately refused alias produced:

```text
$ npx zmdb upgrade
/workspace/shop/zmdb.config.ts
snapshot is already at version 1

$ npx zmdb up
zmdb up: `up` is not a command; use `migrate` to apply migrations or `upgrade` to rewrite a stored snapshot
$ echo $?
2
```

---

See also: [migrate](./cli-migrate.html) · [Migration Runner](./migrations-cli.html) · [CLI Overview](./cli-overview.html)
