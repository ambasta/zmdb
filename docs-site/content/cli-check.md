> **ToDo / feature gap.** There is no `zmdb check`. `diff()` is public API, so
> the check is three lines — and it belongs in CI, where it catches the single
> most common migration mistake.

## The check

Someone changed a schema object and did not generate a migration. The snapshot is stale, and nothing else will notice until deploy:

```ts
// scripts/check.ts
import { readFileSync } from 'node:fs';
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';
import * as schemas from '../src/schema.js';

const all = Object.values(schemas).filter(s => typeof s === 'object' && s !== null && 'table' in s);
const ops = diff(JSON.parse(readFileSync('migrations/snapshot.json', 'utf8')), snapshot(all));

if (ops.length > 0) {
  console.error(`${ops.length} schema change(s) without a migration:`);
  for (const op of ops) console.error('  ' + emitUp(op, 'postgres'));
  console.error('\nRun: yarn db generate <name>');
  process.exit(1);
}
console.log('snapshot is current');
```

```yaml
- run: node --experimental-strip-types scripts/check.ts
```

No database, no credentials, milliseconds. There is no reason not to have this.

## Checking the migrations replay

The second check needs a database, and it catches a `down` that does not undo:

```ts
// scripts/check-roundtrip.ts
await runCli('up', conn, migrations);
await runCli('down', conn, migrations);
await runCli('up', conn, migrations);
```

Against SQLite in memory this is fast enough to run on every push. Against Postgres it wants a service container.

## Checking that migrations produce the snapshot

The strongest of the three, and the one that catches a hand-edited snapshot:
apply every migration to an empty database, read it with the shipped
introspector, and compare the result to the committed snapshot. The reader
exists, but the complete drift reporter and `zmdb check` wiring do not. Until
those land, the narrower approximation below compares the _generated_ DDL
against the migration files:

```ts
const fromSchema = diff({ version: 1, tables: [], extensions: [] }, snapshot(all)).map(o => emitUp(o, 'postgres'));
const fromMigrations = migrations.map(m => m.up);

// not a string comparison — the operation order differs. Compare statement sets.
expect(new Set(normalise(fromSchema))).toEqual(new Set(normalise(fromMigrations)));
```

This only holds if every migration was generated rather than hand-written, so it breaks the moment you add a view or a trigger. Useful early in a project; drop it once you have [custom migrations](./migrations-custom.html).

## What else a real `check` would verify

- **Destructive operations**, flagged rather than silently emitted. `diff()` produces `DROP COLUMN` for a column you forgot to declare — see [generate](./cli-generate.html).
- **Duplicate versions** across migration files, which is the [team](./migrations-teams.html) failure mode.
- **Missing `down`**, or a `down` that is empty.
- **Complete drift against the live database**, built over the shipped
  [introspection](./cli-pull.html) API and surfaced with stable exit codes.

The first three are lint rules over data you already have and would be the easy wins.

---

See also: [generate](./cli-generate.html) · [Working in a Team](./migrations-teams.html) · [pull](./cli-pull.html)
