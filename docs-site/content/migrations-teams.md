Migrations are ordered by `version`, and two people working in parallel will pick the same number. That is the whole problem, and it has a boring solution.

## Use timestamps, not counters

```ts
{ version: 20260831_1420, name: 'add_slug', up: '...', down: '...' }
```

Two developers branching on Monday cannot collide, because the number encodes when it was written. Sequential integers collide every time two branches are open, and the collision is silent until both
merge.

The trade-off: timestamps mean the _apply_ order is authoring order, not merge order. If branch A (Monday) and branch B (Tuesday) are merged in reverse, A still runs first even though B was on `main`
earlier. For structural migrations that is almost always fine. When it is not — B adds a column A backfills — that is not an ordering problem, it is a dependency, and it belongs in one migration.

## Keep the snapshot in the repository, and expect conflicts in it

`diff()` compares against a committed snapshot file, so `migrations/snapshot.json` is a shared artefact:

```
migrations/
  snapshot.json          <- current expected shape
  0001_init.ts
  20260831_1420_slug.ts
```

Two branches that both add a column both rewrite `snapshot.json`, and git will conflict on it. **Do not hand-merge it.** Resolve by regenerating:

```bash
git checkout --theirs migrations/snapshot.json   # take main's
node scripts/generate.mjs                        # re-diff your schema objects against it
```

That produces a fresh migration for whatever your branch adds, on top of theirs. Hand-merging JSON in a snapshot is how you get a snapshot that describes a database that never existed — and every
future diff inherits the error.

> [!NOTE] This is the practical argument for the snapshot being a reviewable file rather than state in the database: the conflict happens in the pull request, where two people can look at it, rather
> than at deploy time.

## Reviewing a migration

The generated SQL is in the diff, so review it as code. Three things to look for:

- **A `DROP COLUMN` you did not intend.** `diff()` emits a drop for any column absent from the schema object, so a column you forgot to declare when adopting an existing table looks like a deletion.
  See [Schema-first](./schema-first.html).
- **A rename emitted as drop-plus-add.** The snapshot compares by name; there is no rename detection. Renaming `title` to `heading` generates `DROP` + `ADD`, which loses the data. Hand-write the
  `ALTER TABLE ... RENAME COLUMN` and update the snapshot.
- **A lock you cannot afford.** `SET NOT NULL` and `ADD CONSTRAINT` take exclusive locks. See [Custom Migrations](./migrations-custom.html) for the three-step split.

## CI checks worth having

```yaml
- run: node scripts/check-migrations.mjs # snapshot matches schema objects
- run: node scripts/migrate-roundtrip.mjs # up, down, up against a real database
```

The first is `diff(snapshot, snapshot(schemas))` returning an empty array — it fails when someone changed a schema object without generating a migration, which is the single most common mistake. The
second catches a `down` that does not undo.

## Deploying

The runner records applied versions, so running it twice is safe and running it from two instances at once is not. Serialise it:

- **A release step**, before the new code rolls out — the usual answer.
- **An advisory lock**, if the migration has to run from the application. `SELECT pg_advisory_lock(...)` around the runner means the second instance waits rather than racing.

And keep migrations backward-compatible for one deploy: the old code runs against the new schema during a rolling deploy. Add a column, deploy code that writes it, then make it `NOT NULL` — three
deploys, no downtime. Dropping a column the currently-running version still selects is the way to break production with a correct migration.

---

See also: [Migrations](./migrations.html) · [Custom Migrations](./migrations-custom.html) · [Deployment](./deployment.html)
