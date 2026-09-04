> **ToDo / feature gap.** The library reads PostgreSQL, MySQL and SQLite
> catalogs, emits deterministic formatter-clean TypeScript declarations, and
> reports declaration drift in both directions. There is still no `pull` or
> `generate-entities` command. This page remains TODO because executable
> dispatch has not landed.

## Read the catalog and emit declarations today

The library workflow is one reader call followed by one emitter call:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createIntrospector, emitDeclarations } from '@zmdb/query-compiler/introspect';

const live = await createIntrospector('postgres').snapshot(driver, {
  schemas: ['public'],
  exclude: ['audit_*'],
});
const emitted = await emitDeclarations(live, { dialect: 'postgres' });

const output = 'src/schema';
for (const file of emitted.files) {
  const path = join(output, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.source);
}

for (const warning of emitted.warnings) console.warn(warning);
```

The result contains one file per physical table plus an `index.ts` barrel.
Tables and columns are sorted, the generated header has no timestamp, and every
file is passed through the repository's `oxfmt` configuration. Two runs over the
same snapshot are byte-identical.

Catalog queries use bound values, driver rows are validated before use, and the
snapshot retains source catalog types and default expressions. A representable
default becomes `HasDefault` plus a comment containing the original expression;
the expression is never evaluated.

## Warnings are part of the output

Reverse type mapping is necessarily partial. The emitter follows one rule:

- if the application type can preserve the stored value, emit the property and a
  warning where catalog semantics were widened;
- if it cannot, omit the property rather than emit `unknown`.

Every warning is returned structurally as `{ table, column?, reason }` and also
appears beside the generated interface as a `// TODO:` comment. For example,
`varchar(50)` retains `Length<50>`, while `bytea`, `BLOB`, arrays, and unsupported
extension types are omitted. A JSON column becomes `object & Sql<'json'>` with a
warning because the catalog does not contain its payload shape. An enum is
omitted when the reader has no member list; inventing a union would be worse.

Single-column foreign keys receive exact `References<'table.column'>` tags.
Where one target is unambiguous, the emitter also adds a `ManyToOne` or
`OneToOne` property. Multiple foreign keys to the same target, composite
relations, referential actions, and indexes that cannot be represented by one
`Unique` tag remain explicit warnings rather than guesses.

## Adopting an existing database

Generate the declarations, review every `TODO`, make any application-specific
edits, and then compare the reviewed declaration with the live catalog through
the drift front end:

```ts
import { createIntrospector, detectDrift } from '@zmdb/query-compiler/introspect';
import { snapshot } from '@zmdb/query-compiler/migrations';

it('declarations match the live database', async () => {
  const live = await createIntrospector('postgres').snapshot(driver, {
    schemas: ['public'],
  });
  const declared = snapshot([schemaOf<User>(), schemaOf<Order>()]);
  const report = detectDrift(live, declared, { dialect: 'postgres' });

  expect(report.clean, JSON.stringify(report, null, 2)).toBe(true);
});
```

Run this against a restored production dump in CI. `onlyInDatabase` and
`onlyInDeclarations` are typed migration operations. The report normalizes
catalog aliases and defaults, excludes `_zmdb_migrations` by default, accepts
custom exclusion globs, and can omit MySQL's generated foreign-key support
index. Its comparison coverage remains exactly the migration `diff` coverage;
it does not maintain a second comparator.

## Why the `pull` command is not shipped

The catalog-to-declaration library path has landed. The command still needs to
resolve a configured driver, choose and protect an output directory, report
warnings in human and JSON modes, define overwrite behavior, and distinguish
catalog failure from reviewable loss. The library report is ready for that
command to format and map to stable exit codes.

Until that executable wiring lands, keep the script above in the project so its
driver construction and output path are reviewable rather than hidden in a
second ad-hoc generator.

---

See also: [Schema-first](./schema-first.html) · [check](./cli-check.html) · [Database Extensions](./db-extensions.html)
