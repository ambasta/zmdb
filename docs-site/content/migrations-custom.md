Generated migrations cover tables, columns, and installation of extensions
required by extension-backed columns. Everything else — views, triggers,
extension upgrades or removal, data backfills, index rebuilds — is a migration
you write. The runner does not care which kind it is.

## The shape

A migration is a plain object:

```ts
import type { Migration } from '@zmdb/query-compiler/migration-runner';

export const migrations: Migration[] = [
  {
    version: 4,
    name: 'add_search_view',
    up: `CREATE VIEW "post_search" AS SELECT id, title FROM posts WHERE published_at IS NOT NULL`,
    down: `DROP VIEW "post_search"`,
  },
];
```

`version` orders them and is what gets recorded as applied. Use a monotonic integer or a timestamp; either works, but pick one convention and keep it, because a mix sorts unintuitively.

## Mixing generated and hand-written

Interleave them in the same array. A common pattern is generate the DDL, then hand-write the data step that has to run between two structural changes:

```ts
const ops = diff(prev, next);

export const migrations: Migration[] = [
  { version: 5, name: 'add_slug_nullable', up: emitUp(ops[0], 'postgres'), down: emitDown(ops[0], 'postgres') },
  {
    version: 6,
    name: 'backfill_slug',
    up: `UPDATE "posts" SET "slug" = lower(replace("title", ' ', '-')) WHERE "slug" IS NULL`,
    down: `UPDATE "posts" SET "slug" = NULL`,
  },
  { version: 7, name: 'slug_not_null', up: `ALTER TABLE "posts" ALTER COLUMN "slug" SET NOT NULL`, down: '...' },
];
```

That three-step split — add nullable, backfill, tighten — is how you add a `NOT NULL` column to a populated table without a full-table exclusive lock and without a default you do not want. Doing it in one step is the most common cause of a migration that works on an empty test database and locks production.

## Multiple statements

`up` is a string handed to `MigrationConnection.exec`. Whether it can carry several statements depends on your connection:

```ts
up: [
  `ALTER TABLE "posts" ADD COLUMN "slug" TEXT`,
  `CREATE UNIQUE INDEX "posts_slug" ON "posts" ("slug")`,
].join(';\n'),
```

`node-postgres` accepts multi-statement strings and runs them in one implicit transaction. `mysql2` needs `multipleStatements: true`. If you would rather not depend on that, make each statement its own migration — more entries, no ambiguity.

## Data migrations

A backfill that cannot be expressed as one `UPDATE` is a script, not a migration. Migrations run inside a transaction and hold locks; a loop over a million rows should not. Do the structural change as a migration and the backfill as a separately-run, resumable job:

```ts
// scripts/backfill-slug.ts — run after migration 5, before 7
for (;;) {
  const batch = await repo.list({ where: { slug: { isNull: true } }, page: { limit: 1_000 } });
  if (batch.items.length === 0) break;
  for (const p of batch.items) await repo.update(p.id, { slug: slugify(p.title) });
}
```

Resumable, interruptible, and it does not hold a transaction open for an hour. See [Streaming](./streaming.html) for the batching pattern.

## Irreversible migrations

Write the `down`:

```ts
{
  version: 9,
  name: 'drop_legacy_column',
  up: `ALTER TABLE "users" DROP COLUMN "legacy_flag"`,
  down: `ALTER TABLE "users" ADD COLUMN "legacy_flag" INTEGER`,   // structure back, data gone
}
```

The `down` restores the shape, not the data. Say so in a comment. A `down` that throws is also legitimate — better than one that pretends.

## Dialect-specific migrations

`emitUp(op, dialect)` takes the dialect, so a generated migration is per-dialect. If you support more than one, generate per dialect and select at runtime:

```ts
const dialect = process.env.DB_DIALECT as Dialect;
export const migrations = dialect === 'postgres' ? pgMigrations : sqliteMigrations;
```

Hand-written migrations usually have to fork too — `ALTER COLUMN` alone differs across all three dialects.

## Testing them

Run the whole chain up, then down, against a real database in CI:

```ts
it('migrations round-trip', async () => {
  await runCli('up', conn, migrations);
  await runCli('down', conn, migrations);
  await runCli('up', conn, migrations);
});
```

This catches the two common defects: a `down` that does not undo, and an `up` that is not re-runnable after a `down`.

---

See also: [Migration Runner](./migrations-cli.html) · [Migrations](./migrations.html) · [Views](./views.html)
