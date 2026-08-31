> **ToDo / feature gap.** There is no `zmdb migrate` executable. The runner
> itself is public API and complete — `runCli(cmd, conn, migrations)` — so this is
> a five-line script.

## Applying migrations

```ts
// scripts/migrate.ts
import { runCli } from '@zmdb/query-compiler/migration-runner';
import { conn, migrations } from './db-config.js';

await runCli(process.argv[2] ?? 'up', conn, migrations);
```

```bash
node --experimental-strip-types scripts/migrate.ts up
node --experimental-strip-types scripts/migrate.ts down
```

The runner reads applied versions, applies the pending ones in order, and records each. Running it twice is a no-op. See [up](./cli-up.html) for what `up` does in detail and [Migration Runner](./migrations-cli.html) for the `MigrationConnection` you implement.

## Loading migrations from files

If [generate](./cli-generate.html) writes `.sql` files, assemble the array from the directory:

```ts
import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('migrations')
  .filter(f => f.endsWith('.up.sql'))
  .sort();

export const migrations = files.map(f => {
  const [version, ...rest] = f.replace('.up.sql', '').split('_');
  return {
    version: Number(version),
    name: rest.join('_'),
    up: readFileSync(`migrations/${f}`, 'utf8'),
    down: readFileSync(`migrations/${f.replace('.up.sql', '.down.sql')}`, 'utf8'),
  };
});
```

`.sort()` on the filename works because the version prefix is fixed-width and zero-padded — the reason to use `20260831142530` rather than `4`. See [Working in a Team](./migrations-teams.html).

## Where to run it

**A release step, before the new code starts.** The default answer, and the only one that gets the ordering right for a rolling deploy:

```yaml
# fly.toml
[deploy]
  release_command = "node --experimental-strip-types scripts/migrate.ts up"
```

**Not at application boot.** Two instances starting together both run the runner, and the second may apply a migration the first is midway through. If you have no release step, take a lock:

```ts
await driver.execute({ text: 'SELECT pg_advisory_lock($1)', parameters: [4711] });
try {
  await runCli('up', conn, migrations);
} finally {
  await driver.execute({ text: 'SELECT pg_advisory_unlock($1)', parameters: [4711] });
}
```

The second instance waits instead of racing. MySQL has `GET_LOCK`; SQLite is single-writer already.

## Backward compatibility for one deploy

During a rolling deploy the _old_ code runs against the _new_ schema. So:

- Adding a nullable column is safe.
- Adding a `NOT NULL` column with a default is safe.
- Dropping a column the running version still selects breaks it — deploy the code that stops selecting it first, then drop in the next release.
- Renaming is two releases: add, backfill and dual-write, then remove.

A correct migration deployed in the wrong order is the most common way to take down a service that has no bugs.

## Failure

The runner records a version only after the statement succeeds, so a failed migration leaves it unapplied and re-running retries it. What it does _not_ do is roll back a partially-applied multi-statement `up` unless your `MigrationConnection.exec` wraps the string in a transaction — which is worth doing:

```ts
async exec(sql) {
  await client.query('BEGIN');
  try { await client.query(sql); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
}
```

> [!NOTE]
> Postgres runs DDL transactionally, so this genuinely gives you all-or-nothing.
> MySQL does not — DDL there is auto-committing, and a two-statement `up` can
> leave the first applied. On MySQL, one statement per migration.

---

See also: [Migration Runner](./migrations-cli.html) · [up](./cli-up.html) · [Working in a Team](./migrations-teams.html)
