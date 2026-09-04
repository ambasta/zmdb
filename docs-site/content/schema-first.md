> **ToDo / feature gap.** PostgreSQL, MySQL and SQLite catalog readers now
> produce a normalized `CatalogSchemaSnapshot`, and `emitDeclarations()` turns
> it into deterministic TypeScript. `detectDrift()` compares that snapshot with
> declarations in both directions. The `zmdb pull`/`check` command wiring and
> complete adoption workflow remain, so this page stays TODO.

## What "schema first" means here

Two different workflows get called schema-first:

**Writing the SQL yourself and keeping declarations in step.** This works
today. The DBA owns the DDL, while the application describes what it expects.
The catalog reader removes hand-written catalog SQL from the comparison, and
the declaration emitter can create the initial checked-in interfaces. Later
changes still need the declaration and SQL reviewed together.

**Generating declarations from an existing database.** The library path now
exists: read the catalog, call `emitDeclarations()`, review its warnings, and
write the returned files. What does not exist is the `zmdb pull` command that
wires configuration, a driver, output policy, and reporting around those calls.
See [pull](./cli-pull.html).

## Adopting zmdb on an existing database

1. **Generate a reviewed starting point.**

   ```ts
   import { mkdir, writeFile } from 'node:fs/promises';
   import { dirname, join } from 'node:path';

   import { createIntrospector, emitDeclarations } from '@zmdb/query-compiler/introspect';

   const live = await createIntrospector('postgres').snapshot(driver, {
     schemas: ['public'],
   });
   const emitted = await emitDeclarations(live, { dialect: 'postgres' });

   for (const file of emitted.files) {
     const path = join('src/schema', file.path);
     await mkdir(dirname(path), { recursive: true });
     await writeFile(path, file.source);
   }
   ```

   The emitter keeps physical table and column names in `Table<'…'>` and the
   properties, adds fixed-order tags, preserves database defaults as comments,
   and emits unambiguous to-one relations. It never falls back to `unknown`.
   Review every structural warning and matching `TODO` comment before treating
   the declarations as application truth.

2. **Take a baseline snapshot** so future diffs start from reality rather than
   from empty:

   ```ts
   writeFileSync('migrations/snapshot.json', JSON.stringify(snapshot([schemaOf<LegacyUser>()]), null, 2));
   ```

   Commit it without a corresponding migration file. That is the "this already
   exists" marker.

3. **Compare the reviewed declaration with the catalog snapshot.** Everything
   downstream — DDL, DTOs, validators, and OpenAPI — inherits a declaration
   mistake, so check both directions:

   ```ts
   import { createIntrospector, detectDrift } from '@zmdb/query-compiler/introspect';
   import { snapshot } from '@zmdb/query-compiler/migrations';
   import { expect } from 'vitest';

   const live = await createIntrospector('postgres').snapshot(driver, {
     schemas: ['public'],
   });
   const declared = snapshot([schemaOf<LegacyUser>()]);
   const report = detectDrift(live, declared, { dialect: 'postgres' });

   expect(report.clean, JSON.stringify(report, null, 2)).toBe(true);
   ```

   Run this against a restored production dump in CI. The two typed finding
   lists contain migration `ChangeOp` values, so a failure names the table,
   column and type difference. Defaults and catalog aliases are normalized as
   evidence rather than drift; pass `{ dialect: 'mysql' }` to omit an InnoDB
   index whose sole purpose is supporting its foreign key.

   The report deliberately inherits the current migration `diff` coverage:
   table and column presence, normalized type changes, and extensions. Ordered
   keys, foreign keys and general indexes become reportable when their migration
   operation slices land; drift does not maintain a second comparator.

4. **Generate forward from there.** Once the baseline is committed,
   [generate](./cli-generate.html) works normally: change the interface, diff
   against the snapshot, and review the SQL.

## What remains

The three readers use `information_schema` plus `pg_catalog` for PostgreSQL,
`information_schema` for MySQL, and bound table-valued PRAGMAs for SQLite. They
retain catalog evidence even when no declaration can express it. The emitter
then omits unsafe mappings, returns warnings structurally, and puts the same
warning in the generated file.

The remaining work is the adoption CLI and its overwrite/output policy. The
mapping itself remains intentionally reviewable: `inet`, `bytea`, an arbitrary
SQLite declaration, or an enum without recovered members cannot become an
honest tagged property. See [Database Extensions](./db-extensions.html).

---

See also: [pull (introspect)](./cli-pull.html) · [Migrations](./migrations.html) · [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html)
