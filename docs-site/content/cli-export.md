> **ToDo / feature gap.** There is no `zmdb export`. `emitUp` over a diff from
> empty gives you the whole schema as SQL in six lines.

## Printing the full schema

```ts
// scripts/export.ts
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';
import * as schemas from '../src/schema.js';

const dialect = (process.argv[2] ?? 'postgres') as 'postgres' | 'mysql' | 'sqlite';
const all = Object.values(schemas).filter(s => typeof s === 'object' && s !== null && 'table' in s);

for (const op of diff({ version: 1, tables: [] }, snapshot(all))) {
  console.log(emitUp(op, dialect) + ';');
}
```

```bash
node --experimental-strip-types scripts/export.ts postgres > schema.sql
node --experimental-strip-types scripts/export.ts sqlite   > schema.sqlite.sql
```

No database and no credentials — it is a pure function over your schema objects.

## What it is for

**Handing SQL to someone who does not use zmdb.** A DBA reviewing a change, or a team that owns the database and wants DDL rather than TypeScript.

**Seeing what a dialect does differently.** Diffing the three outputs is the fastest way to understand `SERIAL` versus `INT AUTO_INCREMENT`, `JSONB` versus `TEXT`, `BOOLEAN` versus `TINYINT(1)`.

**Bootstrapping a container.** Postgres' official image runs `/docker-entrypoint-initdb.d/*.sql` on first start:

```dockerfile
COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql
```

**A reviewable artefact.** Committing `schema.sql` and regenerating it in CI makes every schema change show up as a SQL diff in the pull request, next to the TypeScript one. That is a cheap and surprisingly effective review aid.

```yaml
- run: node --experimental-strip-types scripts/export.ts postgres > schema.sql
- run: git diff --exit-code schema.sql # fails if it was not regenerated
```

## What it does not include

The export covers what `snapshot()` implements today — tables, columns, abstract types, nullability, primary keys and `varchar` lengths. It does **not** include:

- defaults, unique constraints or foreign keys
- indexes — those come from `createIndexDdl`, see [Indexes & Constraints](./indexes-constraints.html)
- views, materialized views, sequences, generated columns
- triggers, functions, extensions
- anything from a [hand-written migration](./migrations-custom.html)

So `schema.sql` is not a complete database definition once your project has any of the above. If you want a genuinely complete dump, that is `pg_dump --schema-only` against a migrated database — which is a different tool doing a different job, and the right one for a backup.

To include the schema objects that _are_ emitted by helpers, append them:

```ts
import { createIndexDdl, createViewDdl } from '@zmdb/query-compiler/schema-objects';
import { indexes, views } from '../src/schema-objects.js';

for (const i of indexes) console.log(createIndexDdl(i, dialect) + ';');
for (const v of views) console.log(createViewDdl(v, dialect) + ';');
```

Keeping those in an exported array rather than inline in a migration is what makes this possible, and it is a good habit for the same reason.

---

See also: [Indexes & Constraints](./indexes-constraints.html) · [push](./cli-push.html) · [Migrations](./migrations.html)
