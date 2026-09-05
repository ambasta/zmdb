> **ToDo / documentation gap.** `push` ships with live-catalog diffing and a
> destructive SQL guard. The documentation slice still owes the final command
> transcript.

## What push does

`zmdb push` reflects the configured declarations, introspects the live database,
diffs the two snapshots, and prints the actual SQL before executing any of it:

```bash
npx zmdb push
```

It is an incremental development workflow, not a full-schema create script.
When there is no difference it exits successfully and applies nothing.

## Destructive changes

Dropping a table or column and a known narrowing type change require explicit
permission:

```bash
npx zmdb push --force --yes
```

`--force` permits the destructive plan. `--yes` declines the confirmation
prompt. They are separate flags: in a non-TTY process, a destructive push with
only one of them refuses instead of hanging or guessing.

The refusal prints every destructive SQL statement. A rename is represented by
the migration diff as a drop plus an add, so it is destructive unless you write
the safer multi-step migration yourself.

Known widening conversions do not require `--force`. Unrecognised type pairs
do, because treating an unknown conversion as safe would be the guess this
guard exists to prevent.

## Transaction behavior

Postgres, SQLite and SQL Server execute the printed plan in a transaction
pinned by the migration connection adapter. MySQL warns before execution
because its DDL auto-commits and can leave a partial plan behind.

## Where to use it

`push` is useful for local databases, disposable test databases, and ephemeral
preview environments. It never writes the migration ledger. A database built
with `push` therefore has no migration history, and running `migrate` against it
later starts from migration one.

For an environment with data you care about, generate and review a migration,
then run `migrate`. That path records checksums and gives every change an
explicit rollback section.

One current migration-engine limit also applies here: a length-only
`varchar(n)` change does not yet produce a `ChangeOp`, so `push` cannot apply or
classify it.

---

See also: [check](./cli-check.html) · [generate](./cli-generate.html) · [Migrations](./migrations.html)
