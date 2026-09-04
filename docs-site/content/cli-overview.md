> **ToDo / feature gap.** The `zmdb` executable exists and currently exposes
> `modules` and `repl`. The schema commands and `studio` described below still
> have no executable wrappers.

The schema and migration engine these commands need is public API, so each command below remains a short script you own. That is the honest position for this page: the capability exists, but these wrappers do not.

## The pieces

| Function                        | Module                                  | Does                                     |
| ------------------------------- | --------------------------------------- | ---------------------------------------- |
| `snapshot(schemas)`             | `@zmdb/query-compiler/migrations`       | schema objects → a plain snapshot object |
| `diff(prev, next)`              | `@zmdb/query-compiler/migrations`       | two snapshots → operations               |
| `emitUp(op, dialect)`           | `@zmdb/query-compiler/migrations`       | one operation → SQL                      |
| `emitDown(op, dialect)`         | `@zmdb/query-compiler/migrations`       | the reverse                              |
| `runCli(cmd, conn, migrations)` | `@zmdb/query-compiler/migration-runner` | applies / reverts, records versions      |

## The commands, and where each stands

| drizzle-kit / mikro-orm      | zmdb today                          | Page                                                |
| ---------------------------- | ----------------------------------- | --------------------------------------------------- |
| `generate`                   | a ~20-line script                   | [generate](./cli-generate.html)                     |
| `migrate` / `up`             | `runCli('up', …)`                   | [migrate](./cli-migrate.html) · [up](./cli-up.html) |
| `push`                       | a script over `emitUp`              | [push](./cli-push.html)                             |
| `check`                      | `diff()` returning `[]`             | [check](./cli-check.html)                           |
| `export`                     | `emitUp` to stdout                  | [export](./cli-export.html)                         |
| `pull` / `generate-entities` | **not possible** — no introspection | [pull](./cli-pull.html)                             |
| `studio`                     | **not possible** — no server, no UI | [studio](./cli-studio.html)                         |

The first five are packaging. The last two need features that do not exist.

## A single entry point

Rather than seven scripts, one dispatcher covers the lot:

```ts
// scripts/db.ts — run with `node --experimental-strip-types scripts/db.ts <cmd>`
import { snapshot, diff, emitUp, emitDown } from '@zmdb/query-compiler/migrations';
import { runCli } from '@zmdb/query-compiler/migration-runner';
import { readFileSync, writeFileSync } from 'node:fs';
import * as schemas from '../src/schema.js';
import { conn, migrations } from './db-config.js';

const DIALECT = 'postgres';
const SNAP = 'migrations/snapshot.json';
const all = Object.values(schemas).filter(s => typeof s === 'object' && 'table' in s);

const cmd = process.argv[2];

switch (cmd) {
  case 'generate': {
    const prev = JSON.parse(readFileSync(SNAP, 'utf8'));
    const next = snapshot(all);
    const ops = diff(prev, next);
    if (ops.length === 0) {
      console.log('no changes');
      break;
    }
    const version = Date.now();
    writeFileSync(`migrations/${version}.sql`, ops.map(o => emitUp(o, DIALECT)).join(';\n') + ';\n');
    writeFileSync(SNAP, JSON.stringify(next, null, 2));
    console.log(`wrote migrations/${version}.sql (${ops.length} operations)`);
    break;
  }
  case 'check': {
    const ops = diff(JSON.parse(readFileSync(SNAP, 'utf8')), snapshot(all));
    if (ops.length > 0) {
      console.error(`${ops.length} un-generated changes`);
      process.exit(1);
    }
    console.log('snapshot is current');
    break;
  }
  case 'up':
  case 'down':
    await runCli(cmd, conn, migrations);
    break;
  case 'export': {
    for (const op of diff({ tables: {} }, snapshot(all))) console.log(emitUp(op, DIALECT) + ';');
    break;
  }
  default:
    console.error('usage: db <generate|check|up|down|export>');
    process.exit(1);
}
```

Add it to `package.json`:

```json
{ "scripts": { "db": "node --experimental-strip-types scripts/db.ts" } }
```

That is `yarn db generate`, `yarn db check`, `yarn db up`. Roughly forty lines for the five commands that are possible.

## What the schema CLI still needs

Not capability — ergonomics and a few things a script cannot easily do well:

- **Schema discovery.** The script above imports `../src/schema.js` and filters. A CLI would need a [config file](./config-file.html) to find them, which is the first thing to build.
- **Migration file naming and ordering**, consistently, with the [team conventions](./migrations-teams.html) baked in.
- **A confirmation prompt** before a destructive operation. `diff()` happily emits `DROP COLUMN`; a CLI should make you type the table name.
- **Multi-dialect output** in one invocation.

The config file is the prerequisite for all of it, which is why it is the [next page](./config-file.html) and the first thing that would land.

---

See also: [Migrations](./migrations.html) · [Config File](./config-file.html) · [generate](./cli-generate.html)
