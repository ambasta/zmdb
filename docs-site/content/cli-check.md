## Run it in CI

```bash
npx zmdb check
npx zmdb check --json
```

Exit codes keep invocation failures separate from findings:

- `0`: every check that ran is clean;
- `1`: the project or database has one or more findings;
- `2`: the invocation or config is invalid.

Under `--json`, stdout is one `CliResult` document. Finding kinds belong in the
payload rather than in additional exit codes.

The clean SQLite fixture produced:

```text
$ npx zmdb check
/workspace/shop/zmdb.config.ts
check passed
```

## Findings

The command currently reports:

- `uncommitted-schema`: declarations differ from `migrations/snapshot.json`;
- `duplicate-version`: two migration files have the same fourteen-digit version;
- `snapshot-version`: the stored snapshot is newer than this build;
- `missing-down`: a migration file has no `-- zmdb:down` section;
- `drift`: the live database differs from the stored snapshot.

The file and declaration checks need no database. Live drift runs only when the
config has a `driver`; otherwise the JSON result and human output report that
check as skipped rather than calling it clean.

After adding one database-only column, the same measured fixture returned one
JSON document and exit 1. The temporary directory is shortened here:

```text
$ npx zmdb check --json
/workspace/shop/zmdb.config.ts
{"ok":false,"command":"check","config":"/workspace/shop/zmdb.config.ts","result":{"findings":[{"kind":"drift","message":"live database differs from the stored snapshot: 1 database-only and 1 declaration-only operations","subject":"/workspace/shop/zmdb.config.ts"}],"skipped":[]}}
$ echo $?
1
```

```yaml
- run: npx zmdb check --json
```

## What it does not prove

`check` does not replay every migration into an empty database or execute every
`down` section. A project that wants that stronger deployment rehearsal can run
the public migration runner against a disposable SQLite or Postgres database:

```ts
await runCli('up', connection, migrations);
await runCli('down', connection, migrations);
await runCli('up', connection, migrations);
```

After `zmdb embed` creates the default `migrations/embedded.ts`, `check`
regenerates the expected bytes in memory and reports `stale-embedded` when the
SQL files, checksums, ordering, or `--with-down` content no longer match. A
project that has never opted into an embedded module is not required to create
one.

---

See also: [generate](./cli-generate.html) · [Working in a Team](./migrations-teams.html) · [pull](./cli-pull.html)
