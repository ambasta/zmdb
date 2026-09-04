> **ToDo / feature gap.** PostgreSQL, MySQL and SQLite catalog readers now
> produce a normalized `CatalogSchemaSnapshot`. There is still no declaration emitter,
> complete drift report or `zmdb pull` command, so adopting an existing database
> still involves writing and reviewing the declaration yourself.

## What "schema first" means here

Two different workflows get called schema-first, and only one of them is missing:

**Writing the SQL yourself and keeping the declarations in step.** This works today, and for some teams it is the right way round — the DBA owns the DDL, the application describes what it expects. You write the migration by hand and you write the matching interface by hand. The catalog reader removes the hand-written catalog SQL from a comparison, but declaration emission and a complete drift report are still separate missing slices.

**Generating declarations from an existing database.** This still does not exist. The reader produces a snapshot, not TypeScript, and there is no `zmdb pull`. See [pull](./cli-pull.html).

## Adopting zmdb on an existing database

1. **Declare the type to match the table.** Every column, including the ones you never read — `snapshot()` / `diff()` compare schemas, so a column you omit looks like a column to drop if you ever generate a migration.

   ```ts
   import type { PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

   export interface LegacyUser extends Table<'users'> {
     id: number & Sql<'integer'> & Serial & PrimaryKey;
     email: string & Sql<'text'> & Unique;
     created_at: Date & Sql<'timestamp'>;
     legacy_flag: (number & Sql<'integer'>) | null; // unused, but it exists
   }
   ```

   Keep the database's column names verbatim — there is [no naming strategy](./naming-strategy.html) to translate them.

2. **Take a baseline snapshot** so future diffs start from reality rather than from empty:

   ```ts
   writeFileSync('migrations/snapshot.json', JSON.stringify(snapshot([schemaOf<LegacyUser>()]), null, 2));
   ```

   Commit it without a corresponding migration file. That is the "this already exists" marker.

3. **Compare the declaration with the catalog snapshot.** This is worth doing properly because everything downstream — DDL, DTOs, validators, OpenAPI — inherits the mistake if the declaration is wrong. Type-first makes that list longer, not shorter: one interface now feeds all four.

   ```ts
   import { createIntrospector } from '@zmdb/query-compiler/introspect';
   import { diff, snapshot } from '@zmdb/query-compiler/migrations';
   import { expect } from 'vitest';

   const live = await createIntrospector('postgres').snapshot(driver, {
     schemas: ['public'],
   });
   const declared = snapshot([schemaOf<LegacyUser>()]);

   expect(diff(live, declared)).toEqual([]);
   expect(diff(declared, live)).toEqual([]);
   ```

   Run it against a restored production dump in CI. This proves the normalized table/column/type snapshot is clean in both directions. The current `diff` does not yet compare every recovered primary key, foreign key or index fact; the dedicated drift-report slice owns that completeness claim.

4. **Generate forward from there.** Once the baseline is committed, [generate](./cli-generate.html) works normally: change the interface, diff against the snapshot, review the SQL.

## What remains

The three dialect-specific readers now use `information_schema` plus `pg_catalog` for PostgreSQL, `information_schema` for MySQL, and bound table-valued PRAGMAs for SQLite. They normalize representable types, retain catalog type evidence, preserve default expressions, and keep unrepresentable types visible rather than dropping the column.

What remains is turning that snapshot into deterministic TypeScript and reporting all drift fields in both directions. The mapping is still lossy when producing an application type — `inet`, `bytea` or an arbitrary SQLite declaration cannot become an honest tagged property without a warning. See [Database Extensions](./db-extensions.html).

---

See also: [pull (introspect)](./cli-pull.html) · [Migrations](./migrations.html) · [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html)
