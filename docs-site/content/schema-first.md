All six temporary dialect values have catalog readers that produce a normalized `CatalogSchemaSnapshot`. Cockroach layers its `SHOW INDEXES`/`SHOW CREATE` evidence and `unique_rowid()` normalization
over the public PostgreSQL-family reader; SingleStore still reuses the MySQL reader. `emitDeclarations()` turns the snapshot into deterministic TypeScript, and `detectDrift()` compares that live
snapshot with reviewed declarations in both directions. Those library APIs are the supported adoption path; `zmdb pull` packages the reader and emitter behind project configuration.

## What "schema first" means here

Two different workflows get called schema-first:

**Writing the SQL yourself and keeping declarations in step.** This works today. The DBA owns the DDL, while the application describes what it expects. The catalog reader removes hand-written catalog
SQL from the comparison, and the declaration emitter can create the initial checked-in interfaces. Later changes still need the declaration and SQL reviewed together.

**Generating declarations from an existing database.** Run `zmdb pull` to read the catalog through the configured driver and write protected staging files under `.zmdb/introspected`. The same reader
and emitter remain public library APIs when a caller needs a different destination. See [pull](./cli-pull.html).

## Adopting zmdb on an existing database

1. **Generate a reviewed starting point in a staging directory.**

   ```ts
   import { mkdir, writeFile } from 'node:fs/promises';
   import { dirname, join } from 'node:path';

   import { emitDeclarations } from '@zmdb/migrations/declarations';
   import { createIntrospector } from '@zmdb/migrations/introspect';

   const live = await createIntrospector('postgres').snapshot(driver, {
     schemas: ['public'],
   });
   const emitted = await emitDeclarations(live, { dialect: 'postgres' });

   for (const file of emitted.files) {
     const path = join('.zmdb/introspected', file.path);
     await mkdir(dirname(path), { recursive: true });
     await writeFile(path, file.source);
   }
   ```

   The emitter keeps physical table and column names in `Table<'…'>` and the properties, adds fixed-order tags, preserves database defaults as comments, and emits unambiguous to-one relations. It
   never falls back to `unknown`. Review every structural warning and matching `TODO` comment. Generated files are overwritten wholesale: copy the accepted declarations into your application-owned
   schema directory and make necessary hand edits there, rather than editing `.zmdb/introspected`.

2. **Take a baseline snapshot** so future diffs start from reality rather than from empty:

   ```ts
   await writeFile('migrations/snapshot.json', JSON.stringify(snapshot([schemaOf<LegacyUser>()]), null, 2));
   ```

   Commit it without a corresponding migration file. That is the "this already exists" marker.

3. **Compare the reviewed declaration with the catalog snapshot.** Everything downstream — DDL, DTOs, validators, and OpenAPI — inherits a declaration mistake, so check both directions:

   ```ts
   import { createIntrospector, detectDrift } from '@zmdb/migrations/introspect';
   import { snapshot } from 'zmdb/migrations';
   import { expect } from 'vitest';

   const live = await createIntrospector('postgres').snapshot(driver, {
     schemas: ['public'],
   });
   const declared = snapshot([schemaOf<LegacyUser>()]);
   const report = detectDrift(live, declared, { dialect: 'postgres' });

   expect(report.clean, JSON.stringify(report, null, 2)).toBe(true);
   ```

   Run this against a restored production dump in CI. The two typed finding lists contain migration `ChangeOp` values, so a failure names the table, column and type difference. Defaults and catalog
   aliases are normalized as evidence rather than drift; pass `{ dialect: 'mysql' }` to omit an InnoDB index whose sole purpose is supporting its foreign key.

   The report deliberately inherits the current migration `diff` coverage: table and column presence, normalized type changes, extensions, ordered primary keys, and foreign keys with referential
   actions. General indexes become reportable when their migration operation slice lands; drift does not maintain a second comparator.

4. **Generate forward from there.** Once the baseline is committed, [generate](./cli-generate.html) works normally: change the interface, diff against the snapshot, and review the SQL.

## Limits and drift noise

The three readers use `information_schema` plus `pg_catalog` for PostgreSQL, `information_schema` for MySQL, and bound table-valued PRAGMAs for SQLite. They retain catalog evidence even when no
declaration can express it. The emitter then omits unsafe mappings, returns warnings structurally, and puts the same warning in the generated file.

- Defaults and catalog type aliases are retained as evidence but normalized out of drift comparison; servers routinely rewrite their spelling.
- Pass `{ dialect: 'mysql' }` so the live-side normalization can omit a strict foreign-key support-index shape. Other indexes are preserved.
- A custom `exclude` list replaces the default, so include `_zmdb_migrations` yourself when adding project bookkeeping patterns.
- Catalog visibility follows the connecting role. An object the role cannot see looks absent, so run CI with a role whose visibility matches the scope you intend to check.
- Views, triggers, stored routine bodies, grants and policies are not emitted as table declarations. Keep their SQL and review process separate.
- `inet`, `bytea`, an arbitrary SQLite declaration, or an enum without recovered members cannot become a valid tagged property. The emitter warns instead of widening one silently. See
  [Database Extensions](./db-extensions.html).

The broader `check` executable remains CLI work, not missing library semantics. See [pull](./cli-pull.html) for the shipped generation and staging boundary.

---

See also: [pull (introspect)](./cli-pull.html) · [Migrations](./migrations.html) · [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html)
