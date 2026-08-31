> **ToDo / feature gap.** There is no `zmdb push`. The DDL emitters are public
> API, so pushing the current schema straight at a database is a short script —
> and unlike `drizzle-kit push`, it never reads the database to work out what to
> change, because there is [no introspection](./cli-pull.html).

## What push means here, and what it cannot mean

`drizzle-kit push` diffs your schema against the _live_ database and applies the difference. zmdb cannot do that. What it can do is emit the full DDL for your schema objects and apply it to an empty database:

```ts
// scripts/push.ts — creates everything from scratch
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';
import * as schemas from '../src/schema.js';
import { driver } from '../src/config.js';

const all = Object.values(schemas).filter(s => typeof s === 'object' && s !== null && 'table' in s);

for (const op of diff({ tables: {} }, snapshot(all))) {
  const sql = emitUp(op, 'postgres');
  console.log(sql);
  await driver.execute({ text: sql, parameters: [] });
}
```

Diffing against an empty snapshot gives you "create all of it", which is exactly what you want against a fresh database.

> [!WARNING]
> This is create-only. Against a database that already has the tables, every
> statement fails on "already exists". It is not an incremental sync, and calling
> it `push` invites treating it like one.

## Where it is genuinely useful

**Tests.** The fastest way to a schema-shaped SQLite database, with no migration files involved:

```ts
import { DatabaseSync } from 'node:sqlite';

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const op of diff({ tables: {} }, snapshot(all))) db.exec(emitUp(op, 'sqlite'));
  return db;
}
```

Per-test isolation, sub-millisecond, and the schema is the one your application uses rather than a fixture that drifts. See [Testing](./testing.html).

**Local iteration.** Drop and recreate while a schema is still moving:

```bash
dropdb app_dev && createdb app_dev && node --experimental-strip-types scripts/push.ts
```

**Ephemeral preview environments**, where the database is created per branch and thrown away.

## Where it is not

Anywhere with data you care about. There is no `--force`, no diff to review, no `down`, and no record in the migrations table — so a database created by push is in an unknown state as far as [the runner](./cli-migrate.html) is concerned. If you push in development and migrate in production, the two schemas can differ and nothing will tell you. Pick one per environment and write down which.

The safer local workflow is `generate` then `up`: it is two commands instead of one, and it exercises the same path production will.

## Marking a pushed database as migrated

If you do push locally and want the runner to consider itself up to date:

```ts
for (const m of migrations) await conn.recordApplied(m.version, m.name);
```

This only works if the pushed schema really equals the migrated one. `diff(snapshot(all), snapshotAfterMigrations)` being empty is the check — which is what [check](./cli-check.html) does.

---

See also: [check](./cli-check.html) · [generate](./cli-generate.html) · [Testing](./testing.html)
