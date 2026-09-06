## Generate staging declarations

`zmdb pull` writes the emitter's table files and barrel under `.zmdb/introspected`, relative to `zmdb.config.ts`. It overwrites a file only when the two-line zmdb introspection header is still
present. A hand-written file is left untouched, listed as skipped, and makes the command exit 1.

Use `zmdb pull --dry-run` to print every path and its complete generated source without writing. `zmdb pull --check` also writes nothing and exits 1 when a generated file is missing, differs from the
live database, or has lost its generated header. Both forms use the same catalog read and emitter as a normal run. Emitter warnings are printed as `WARNING` lines; with `--json`, the single result
document stays on stdout and warnings go to stderr.

The SQLite fixture produced this staging run and clean CI check. Only its temporary directory was shortened to `/workspace/shop`:

```text
$ npx zmdb pull
/workspace/shop/zmdb.config.ts
wrote .zmdb/introspected/users.ts
wrote .zmdb/introspected/index.ts

$ npx zmdb pull --check --json
{"ok":true,"command":"pull","config":"/workspace/shop/zmdb.config.ts","result":{"files":[{"path":".zmdb/introspected/users.ts","tables":["users"]}],"skipped":[]}}
```

## Read the catalog and emit declarations today

The library workflow is one reader call followed by one emitter call:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { emitDeclarations } from '@zmdb/migrations/declarations';
import { createIntrospector } from '@zmdb/migrations/introspect';
import { postgres } from '@zmdb/postgres';

const live = await createIntrospector(postgres).snapshot(driver, {
  schemas: ['public'],
  exclude: ['audit_*'],
});
const emitted = await emitDeclarations(live, { dialect: postgres });

const output = 'src/schema';
for (const file of emitted.files) {
  const path = join(output, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.source);
}

for (const warning of emitted.warnings) console.warn(warning);
```

The result contains one file per physical table plus an `index.ts` barrel. Tables and columns are sorted, the generated header has no timestamp, and every file is passed through the repository's
`oxfmt` configuration. Two runs over the same snapshot are byte-identical.

Catalog queries use bound values, driver rows are validated before use, and the snapshot retains source catalog types and default expressions. A representable default becomes `HasDefault` plus a
comment containing the original expression; the expression is never evaluated.

## Warnings are part of the output

Reverse type mapping is necessarily partial. The emitter follows one rule:

- if the application type can preserve the stored value, emit the property and a warning where catalog semantics were widened;
- if it cannot, omit the property rather than emit `unknown`.

Every warning is returned structurally as `{ table, column?, reason }` and also appears beside the generated interface as a `// TODO:` comment. For example, `varchar(50)` retains `Length<50>`, while
`bytea`, `BLOB`, arrays, and unsupported extension types are omitted. A JSON column becomes `object & Sql<'json'>` with a warning because the catalog does not contain its payload shape. An enum is
omitted when the reader has no member list; inventing a union would be worse.

Single-column foreign keys receive exact `References<'table.column'>` tags. Where one target is unambiguous, the emitter also adds a `ManyToOne` or `OneToOne` property. Multiple foreign keys to the
same target, composite relations, referential actions, and indexes that cannot be represented by one `Unique` tag remain explicit warnings rather than guesses.

## Adopting an existing database

Generate the declarations, review every `TODO`, make any application-specific edits, and then compare the reviewed declaration with the live catalog through the drift front end:

```ts
import { createIntrospector, detectDrift } from '@zmdb/migrations/introspect';
import { postgres } from '@zmdb/postgres';
import { snapshot } from 'zmdb/migrations';

it('declarations match the live database', async () => {
  const live = await createIntrospector(postgres).snapshot(driver, {
    schemas: ['public'],
  });
  const declared = snapshot([schemaOf<User>(), schemaOf<Order>()]);
  const report = detectDrift(live, declared, { dialect: postgres });

  expect(report.clean, JSON.stringify(report, null, 2)).toBe(true);
});
```

Run this against a restored production dump in CI. `onlyInDatabase` and `onlyInDeclarations` are typed migration operations. The report normalizes catalog aliases and defaults, excludes
`_zmdb_migrations` by default, accepts custom exclusion globs, and can omit MySQL's generated foreign-key support index. Its comparison coverage remains exactly the migration `diff` coverage; it does
not maintain a second comparator.

## Command and library boundaries

The command owns config loading, the configured driver, staging-path safety, warnings, `--dry-run`, `--check`, JSON output, and exit codes. The library owns catalog SQL, row validation, declaration
emission, and two-direction drift comparison. A caller that needs a different destination or wants the snapshot in memory can keep using the library workflow above without reimplementing
introspection.

---

See also: [Schema-first](./schema-first.html) · [check](./cli-check.html) · [Database Extensions](./db-extensions.html)
