The migration CLI runs migration scripts against your database. It wraps the core migration runner and provides a simple command-line interface for applying, rolling back, and checking migration status.

## Running Migrations

```ts
import { runCli, type Migration } from '@zmdb/query-compiler/migrations/runner';
import { MyMigrationConnection } from './connection';

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_users_table',
    up: `CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL)`,
    down: `DROP TABLE "users"`,
  },
  {
    version: 2,
    name: 'add_email_column',
    up: `ALTER TABLE "users" ADD COLUMN "email" TEXT`,
    down: `ALTER TABLE "users" DROP COLUMN "email"`,
  },
];

const conn = new MyMigrationConnection();

// Apply pending migrations
const output = runCli('up', conn, migrations);
// output => "applied: 1, 2"
```

## Rollback

Roll back the most recent migration:

```ts
const output = runCli('down', conn, migrations);
// output => "reverted: 2"
```

Each `down` migration is the inverse of `up` — manually authored to undo the change.

## Check Status

View the status of all migrations:

```ts
const output = runCli('status', conn, migrations);
// Output:
// [x] 1 create_users_table
// [x] 2 add_email_column
```

> [!NOTE]
> The CLI is a thin wrapper around the runner. You need to provide a `MigrationConnection` implementation that matches your database driver.

## MigrationConnection Interface

Implement this interface for your database:

```ts
export interface MigrationConnection {
  exec(sql: string): void;
  appliedVersions(): readonly number[];
  recordApplied(version: number, name: string): void;
  recordReverted(version: number): void;
}
```

For SQLite (node:sqlite):

```ts
class SqliteMigrationConnection implements MigrationConnection {
  constructor(private db: Database) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  appliedVersions(): readonly number[] {
    const rows = this.db.prepare('SELECT version FROM _zmdb_migrations').all();
    return rows.map(r => Number(r.version));
  }

  recordApplied(version: number, name: string): void {
    this.db
      .prepare('INSERT INTO _zmdb_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(version, name, Date.now());
  }

  recordReverted(version: number): void {
    this.db.prepare('DELETE FROM _zmdb_migrations WHERE version = ?').run(version);
  }
}
```

## CLI Usage

Use the runner in your npm scripts:

```json
{
  "scripts": {
    "migrate": "node -e \"require('./migrations/cli').run('up')\"",
    "rollback": "node -e \"require('./migrations/cli').run('down')\"",
    "status": "node -e \"require('./migrations/cli').run('status')\""
  }
}
```

> [!TIP]
> Keep migrations small and focused. One logical change per migration makes rollback safer.

---

See also: [Migrations](./migrations.html) · [Drivers](./drivers.html) · [Query Compiler](./select.html)
