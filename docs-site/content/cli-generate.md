> **ToDo / documentation gap.** `zmdb generate` ships in the published binary.
> The final full command reference and captured transcript remain for the CLI
> documentation slice.

## What generation does

Compare the committed snapshot against your schema objects, and write the SQL that closes the gap:

```
schema files ──reflect()──▶ snapshot() ──▶ next ──┐
                                                   ├──diff()──▶ ops ──emit()──▶ migration.sql
snapshot.json ───────────────────────────▶ prev ──┘
```

Note what is _not_ in that diagram: the database. Generation never connects, so it works offline, in CI, and on a machine that has no credentials.

## The command

```bash
npx zmdb generate --name add_slug
```

The command loads [the project config](./config-file.html), reflects every
exported tagged table in its concrete schema file set, then passes the resulting
schemas through the existing `snapshot()`, `diff()`, `emitUp()`, and
`emitDown()` libraries.

The generated name is `<YYYYMMDDHHMMSS>_<slug>.sql` in UTC. `--name` supplies
the slug; without it, the command derives one from a single operation or uses
`schema_change`. One file carries both directions:

```sql
-- zmdb:up
ALTER TABLE "users" ADD COLUMN "slug" TEXT NOT NULL;
-- zmdb:down
ALTER TABLE "users" DROP COLUMN "slug";
```

Down operations are emitted in reverse order. The migration and snapshot are
each written through a sibling temporary file followed by `rename`; a failed
migration rename leaves neither a partial target nor a temporary file. The
snapshot is updated only after the migration file is in place.

If the diff is empty, the command exits 0 and writes nothing. With `--json`,
stdout is one result document; human-readable errors stay on stderr.

## Review the output

The SQL is in your pull request, which is the point. Look for:

- **`DROP COLUMN`** you did not intend — a column missing from the schema object reads as a deletion. Common when [adopting an existing table](./schema-first.html).
- **A rename as drop-plus-add.** There is no rename detection; the snapshot matches by name. Replace it with `ALTER TABLE ... RENAME COLUMN` by hand and keep the generated snapshot.
- **`SET NOT NULL` on a populated table**, which takes an exclusive lock. Split it — see [Custom Migrations](./migrations-custom.html).

## The first migration

With no stored snapshot, the command diffs against `{ version: 1, tables: [] }`
and writes the initial migration plus `snapshot.json`.

For an existing database you are adopting, do the opposite: write the snapshot with no migration, so the baseline is "this already exists". See [Schema-first](./schema-first.html).

## Several dialects

The configured dialect selects the emitter. Use separate config files and
output directories when one declaration set targets several dialects:

```bash
npx zmdb generate --config zmdb.postgres.config.ts --name add_slug
npx zmdb generate --config zmdb.sqlite.config.ts --name add_slug
```

The snapshots remain dialect-independent; the generated SQL does not.

## What the command adds

The wrapper adds config and project resolution, exported-table discovery,
sortable names, one-file up/down output, atomic replacement, no-change
handling, JSON results, and uniform exit codes. The schema plan and SQL remain
the output of the existing migration libraries rather than a second
implementation in the CLI.

---

See also: [CLI Overview](./cli-overview.html) · [Migrations](./migrations.html) · [check](./cli-check.html)
