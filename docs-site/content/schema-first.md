> **ToDo / feature gap.** There is no introspection. Nothing reads a live
> database catalogue and produces a declaration, and nothing compares a declaration
> against what is actually deployed. Your declared types are the only source of
> truth zmdb can see.

## What "schema first" means here

Two different workflows get called schema-first, and only one of them is missing:

**Writing the SQL yourself and keeping the declarations in step.** This works today, and for some teams it is the right way round — the DBA owns the DDL, the application describes what it expects. You write the migration by hand and you write the matching interface by hand. Nothing generates either from the other, which means nothing catches a mismatch either. See below for how to close that gap with a test.

**Generating declarations from an existing database.** This does not exist. There is no `zmdb pull`. See [pull](./cli-pull.html).

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

3. **Prove the declaration matches the database.** This is the step that replaces introspection, and it is worth doing properly because everything downstream — DDL, DTOs, validators, OpenAPI — inherits the mistake if the declaration is wrong. Type-first makes that list longer, not shorter: one interface now feeds all four.

   ```ts
   import { expect, it } from 'vitest';

   it('schema matches the live table', async () => {
     const rows = await driver.execute({
       text: `SELECT column_name, data_type, is_nullable
              FROM information_schema.columns WHERE table_name = $1`,
       parameters: ['users'],
     });
     const declared = schemaOf<LegacyUser>();
     const actual = new Set(rows.map(r => r.column_name));
     for (const name of Object.keys(declared.columns)) {
       expect(actual).toContain(name);
     }
     expect(actual.size).toBe(Object.keys(declared.columns).length);
   });
   ```

   Run it against a restored production dump in CI. It is twenty lines and it catches the whole class of "the declaration says `Sql<'text'>`, the column is `varchar(50)`" problems.

4. **Generate forward from there.** Once the baseline is committed, [generate](./cli-generate.html) works normally: change the interface, diff against the snapshot, review the SQL.

## What introspection would need

Three dialect-specific catalogue readers (`information_schema` gets you most of Postgres and MySQL; SQLite needs `pragma table_info`), a mapping from database types back into the ten-member `SqlType` union, and a decision about what to do with types that do not map — a `varchar(50)` is `varchar(50)`, but `inet` or `tsvector` has no representation. See [Database Extensions](./db-extensions.html) for that half of the problem.

The mapping is lossy in one direction and closed in the other, which is why this is a real design task and not a scripting task.

---

See also: [pull (introspect)](./cli-pull.html) · [Migrations](./migrations.html) · [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html)
