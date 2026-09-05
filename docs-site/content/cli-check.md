> **ToDo / documentation gap.** `check` ships. The documentation slice still
> owes the final CI transcript and the future embedded-migration check.

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

The frozen CLI contract also names a `stale-embedded` finding. The `embed`
command and its configured output path have not shipped, so there is no
embedded artefact for this command to compare yet.

---

See also: [generate](./cli-generate.html) · [Working in a Team](./migrations-teams.html) · [pull](./cli-pull.html)
