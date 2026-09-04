> **ToDo / feature gap.** There is no `zmdb generate`. The diffing engine is
> public API, so the equivalent is a script — about twenty lines, shown below.

## What generation does

Compare the committed snapshot against your schema objects, and write the SQL that closes the gap:

```
schema.ts  ──snapshot()──▶  next  ──┐
                                     ├──diff()──▶ ops ──emitUp()──▶ 0004_add_slug.sql
snapshot.json ──────────────▶ prev ──┘
```

Note what is _not_ in that diagram: the database. Generation never connects, so it works offline, in CI, and on a machine that has no credentials.

## The script

```ts
// scripts/generate.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { snapshot, diff, emitUp, emitDown } from '@zmdb/query-compiler/migrations';
import * as schemas from '../src/schema.js';

const DIALECT = 'postgres';
const SNAP = 'migrations/snapshot.json';
const all = Object.values(schemas).filter(s => typeof s === 'object' && s !== null && 'table' in s);

const prev = JSON.parse(readFileSync(SNAP, 'utf8'));
const next = snapshot(all);
const ops = diff(prev, next);

if (ops.length === 0) {
  console.log('no changes');
  process.exit(0);
}

const name = process.argv[2] ?? 'migration';
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

mkdirSync('migrations', { recursive: true });
writeFileSync(`migrations/${version}_${name}.up.sql`, ops.map(o => emitUp(o, DIALECT)).join(';\n') + ';\n');
writeFileSync(
  `migrations/${version}_${name}.down.sql`,
  [...ops]
    .reverse()
    .map(o => emitDown(o, DIALECT))
    .join(';\n') + ';\n',
);
writeFileSync(SNAP, JSON.stringify(next, null, 2));

console.log(`${version}_${name}: ${ops.length} operations`);
for (const op of ops) console.log('  ' + emitUp(op, DIALECT));
```

```bash
node --experimental-strip-types scripts/generate.ts add_slug
```

Two details in there are not incidental:

- **The `down` operations are reversed.** Undoing "add table, add index" means dropping the index first. Emitting `down` in forward order produces SQL that fails.
- **The snapshot is written last.** If emitting throws, the snapshot still describes the last successfully generated state, so re-running does the same thing rather than half of it.

## Review the output

The SQL is in your pull request, which is the point. Look for:

- **`DROP COLUMN`** you did not intend — a column missing from the schema object reads as a deletion. Common when [adopting an existing table](./schema-first.html).
- **A rename as drop-plus-add.** There is no rename detection; the snapshot matches by name. Replace it with `ALTER TABLE ... RENAME COLUMN` by hand and keep the generated snapshot.
- **`SET NOT NULL` on a populated table**, which takes an exclusive lock. Split it — see [Custom Migrations](./migrations-custom.html).

## The first migration

With no snapshot yet, diff against empty:

```ts
const prev = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : { version: 1, tables: [] };
```

For an existing database you are adopting, do the opposite: write the snapshot with no migration, so the baseline is "this already exists". See [Schema-first](./schema-first.html).

## Several dialects

`emitUp` takes the dialect, so generate once per target:

```ts
for (const d of ['postgres', 'sqlite'] as const) {
  writeFileSync(`migrations/${d}/${version}_${name}.up.sql`, ops.map(o => emitUp(o, d)).join(';\n'));
}
```

One snapshot, several SQL directories. The snapshot is dialect-independent.

## What a real command would add

Config-driven [schema discovery](./config-file.html), a naming convention it enforces, a prompt before a destructive operation, and `--dry-run`. All ergonomics on top of the same three functions.

---

See also: [CLI Overview](./cli-overview.html) · [Migrations](./migrations.html) · [check](./cli-check.html)
