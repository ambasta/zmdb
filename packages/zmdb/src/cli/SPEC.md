# The `zmdb` executable — Spec (epic "The zmdb executable")

> Part of `zmdb`, as a `bin` and as the build-time export `./cli` (§12). Config schema and loading are
> `../config/SPEC.md`.

## 1. Nine verbs, and `up` is not one of them

The issue proposing this asks for `up` to mean "upgrade a stored snapshot to the current format". `up`
already means the opposite kind of thing in this project, twice:

- `runCli('up' | 'down' | 'status', …)` in `@zmdb/query-compiler`'s migration runner **applies pending
  migrations**.
- `@zmdb/query-compiler`'s `src/migrations/SPEC.md` §4 documents "CLI verbs: `create`, `up`, `down`,
  `status`".

Two meanings of `up` in one product, one of which writes to a live database and one of which rewrites a
JSON file. The tool this verb list was borrowed from has exactly this wart; there is no reason to import
it. **`migrate` applies, `upgrade` rewrites the snapshot format, and `up` is not a command** — typing it
exits 2 with a message naming both, because a user who types `zmdb up` expecting to apply migrations must
not get a snapshot rewrite instead.

The issue's list also omits two verbs whose implementations already ship as library functions — `status`
and a rollback. A CLI that hides capability the library has is a worse CLI, so:

| Command    | Reads                         | Writes                     | Connects |
| ---------- | ----------------------------- | -------------------------- | -------- |
| `generate` | declarations, stored snapshot | a migration file, snapshot | no       |
| `migrate`  | migration files, ledger       | the database, ledger       | yes      |
| `rollback` | migration files, ledger       | the database, ledger       | yes      |
| `status`   | migration files, ledger       | nothing                    | yes      |
| `push`     | declarations, database        | the database               | yes      |
| `check`    | declarations, snapshot, files | nothing                    | no       |
| `upgrade`  | the stored snapshot           | the stored snapshot        | no       |
| `export`   | declarations                  | stdout                     | no       |
| `pull`     | the database                  | declaration files          | yes      |

`migrate`, `rollback` and `status` are thin dispatch over `up`, `down` and `status` in the shipped runner.
They are the only three commands that need no new engine work, and saying so here is what keeps them from
being redesigned.

## 2. Argument parsing and exit codes are already decided

`zmdb-codegen` ships in this repository and establishes the conventions. They are reused rather than
reinvented, because two executables from one project that disagree about exit codes is a worse outcome than
either convention being suboptimal.

| Code | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 0    | The command did what it was asked, including "there was nothing to do".             |
| 1    | The tree or the database is not in the state it should be. Nothing wrong with you.  |
| 2    | The invocation is wrong: unknown command, missing flag argument, unreadable config. |

That distinction is already load-bearing in `zmdb-codegen`, whose `--check` failure says in a full
sentence that it is "not an error in the code — an error in the tree", and it is what lets CI treat a 2 as
a pipeline bug and a 1 as a review comment. Parsing stays hand-rolled over `process.argv` with no
dependency, as it is there.

Global flags: `--config <path>`, `--project <tsconfig>` (overriding the config's `project`), `--json`,
`--yes`, `--force`, `--help`, `--version`. Two flags that ask for opposite things exit 2 with a sentence
saying so, following `zmdb-codegen: --check and --watch ask for opposite things`.

**`--force` and `--yes` are different questions and neither implies the other.** `--force` permits a
destructive operation; `--yes` declines to be asked. A scripted destructive push needs both, and that is
deliberate: a CI job that sets `--yes` once, for convenience, must not silently acquire permission to drop
a column two months later.

## 3. `--json` is an API, so stdout gets one document and nothing else

```ts
interface CliResult<T> {
  readonly ok: boolean;
  /** The verb, so a log line is self-describing. */
  readonly command: string;
  /** The resolved config path — `../config/SPEC.md` §2 requires every command to report it. */
  readonly config: string;
  readonly result?: T;
  readonly errors?: readonly { readonly message: string; readonly path?: string }[];
}
```

With `--json`, **stdout is exactly one JSON document** and every human-readable line — progress, the
config path, warnings — goes to stderr. Without `--json`, the human lines go to stdout. That rule is the
whole value of the flag: `zmdb check --json | jq -e .ok` has to work in a pipeline, and a single stray
progress line on stdout breaks it in a way that looks like malformed JSON rather than like a logging bug.

`ok` is `false` exactly when the exit code is non-zero. Per-command `result` payloads:

| Command    | `result`                                                                  |
| ---------- | ------------------------------------------------------------------------- |
| `generate` | `{ file, version, name, ops: ChangeOp[] }`, or `{ ops: [] }` with no file |
| `migrate`  | `{ applied: { version, name }[] }`                                        |
| `rollback` | `{ reverted: { version, name } \| null }`                                 |
| `status`   | `{ migrations: { version, name, applied }[] }`                            |
| `push`     | `{ ops: ChangeOp[], statements: string[], applied: boolean }`             |
| `check`    | `{ findings: { kind, message, subject }[] }`                              |
| `upgrade`  | `{ from: number, to: number, changed: boolean }`                          |
| `export`   | `{ statements: string[] }`                                                |
| `pull`     | `{ files: { path, tables: string[] }[], skipped: { path, reason }[] }`    |

`ops` is the shipped `ChangeOp` union, serialised as-is. That is deliberate: the CLI's machine-readable
output is the compiler's own vocabulary, so a consumer scripting against it and a contributor reading
`diff` are looking at the same names.

## 4. `generate`, and the ledger cannot hold a timestamp version

Read the declarations through the project, `snapshot()` them, `diff()` against `<out>/snapshot.json`, and
write a migration file plus the new snapshot. Nothing to generate exits **0** with a message and writes no
file — an empty migration is a version that gets recorded as applied and means nothing.

File name: `<YYYYMMDDHHMMSS>_<slug>.sql` in UTC, where the fourteen digits are the version and the slug
comes from `--name` or is derived from the ops. Sortable lexically and numerically at once, which is the
only property that matters.

**That version overflows the shipped ledger.** `_zmdb_migrations` is created with
`version INTEGER PRIMARY KEY`, and `20260903120000` is far above Postgres's `INTEGER` maximum of
2 147 483 647. SQLite's `INTEGER` is already 64-bit; Postgres and MySQL are not. So **the ledger column
becomes `BIGINT`** on those two dialects, which is a change to the `CREATE TABLE IF NOT EXISTS` template in
`@zmdb/query-compiler`'s runner and not to this package. Existing ledgers need no data migration — every
32-bit value still fits — but they do need the `ALTER`, and `migrate` must not be the thing that discovers
this at 3am against a production database.

One file, not a pair. It carries both directions, separated by a single sentinel line:

```sql
-- zmdb:up
ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMPTZ;
-- zmdb:down
ALTER TABLE orders DROP COLUMN shipped_at;
```

A pair of files can be half-committed, half-reverted or half-deleted, and the runner's `Migration` type
needs `up` and `down` at one version. A file with no `-- zmdb:down` section parses with an empty `down`,
and `rollback` refuses that version by name rather than guessing at an inverse.

## 5. `migrate`, `rollback`, `status`, and the dialect that has no transactional DDL

Each migration runs inside its own transaction, in version order, with its ledger row written in the same
transaction. One failure stops the run: the migrations already applied stay applied and recorded, the
failing one is rolled back and not recorded, and the message names the version and the failing statement.

**MySQL has no transactional DDL**, so that guarantee is only available on Postgres and SQLite. On MySQL an
interrupted migration leaves the ledger honest — the row is not written — and the schema half-applied,
which is worse than the reverse and cannot be fixed from here. So on MySQL the failure message additionally
lists the statements that already ran, because that list is the only way to hand-finish the migration, and
a spec that omitted this would be promising atomicity three times and delivering it twice.

`rollback` reverts exactly one version, the highest applied. `--to <version>` reverts down to and excluding
that version, one transaction per migration, stopping on the first failure.

`status` connects, reads the ledger, and prints the shipped `[x] <version> <name>` lines. It exits 0
whether or not anything is pending: "there are pending migrations" is information, not a failure. `check`
is the command whose job is to fail.

## 6. `push`, where every rename looks destructive and that is correct

`push` diffs declarations against the database and applies the DDL directly, with no migration file. It is
for development, it prints the statements it is about to run before running any of them, and it refuses
destructive operations without `--force` (§10).

The consequence that will be mistaken for a bug: **a column rename requires `--force`.** `diff` reports a
rename as a drop plus an add, and `src/migrations/SPEC.md` §1.4 already explains why it cannot do
otherwise — two snapshots either side of a rename differ byte-for-byte the way a real drop and a real add
do, and pairing them by shape would guess. So `push` sees a drop, refuses, and is right to: the operation
it is being asked to perform really does delete a column's data.

`push` never writes to the ledger, and a database built by `push` therefore has no history. Running
`migrate` against it afterwards will attempt migration 1 against a schema that already has the tables. That
is a development-only workflow and the spec says so rather than trying to reconcile the two.

## 7. `check` reports findings and exits 1 for any of them

| Finding              | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `uncommitted-schema` | `diff(stored, snapshot(declarations))` is non-empty — run `generate`. |
| `duplicate-version`  | Two migration files share a version. The branch-merge case.           |
| `snapshot-version`   | The stored snapshot's `version` is newer than this build understands. |
| `missing-down`       | A migration file has no `-- zmdb:down` section (§4).                  |
| `drift`              | The live database does not match the stored snapshot. Needs `pull`.   |

`drift` is the only one that connects, so it runs only when a driver is configured, and its absence is
reported as a skipped check rather than as a pass. A check that silently does not run is worse than one
that fails.

Any finding exits 1. The exit code does not encode _which_ finding — that is what `--json` is for, and
per-finding exit codes are how a CI script ends up asserting on a number nobody remembers the meaning of.

## 8. `upgrade` touches the format and never the schema

`SchemaSnapshot.version` is the literal `1` today. `upgrade` reads a stored snapshot at any version this
build knows, rewrites it at the current one, and is idempotent: run against a current snapshot it reports
`changed: false` and exits 0 without touching the file's mtime.

It must be provably schema-preserving, and the way to prove it is cheap: `diff(before, after)` after the
rewrite must be empty, and the command fails rather than writing if it is not. A snapshot at a version
_newer_ than this build is an exit-2 error saying so, not an attempted downgrade.

## 9. `export` writes to stdout

The full DDL for the schema set, in the phase order the extension and routine specs established — extensions
before the tables that use their types, tables before the objects that reference them. No connection, no
ledger, nothing written to disk, so it composes: `zmdb export | psql`.

## 10. Destructive operations, defined once

`ChangeOp` has five kinds today, and the classification covers all five rather than a subset, so a sixth
kind added later fails a test instead of defaulting to permitted:

| `ChangeOp`                   | Destructive | Why                                        |
| ---------------------------- | ----------- | ------------------------------------------ |
| `create_table`, `add_column` | no          | An added nullable column loses nothing.    |
| `drop_table`, `drop_column`  | yes         | Deletes rows or a column's values.         |
| `alter_column_type`          | sometimes   | Destructive when the new type is narrower. |

Narrowing is read off the `from`/`to` pair the op already carries — both are abstract types, so this is a
table lookup and not a guess: `varchar(n)` → `varchar(m)` with `m < n`, `text` → `varchar`,
`bigint` → `integer`, `numeric` → `integer`, `timestamp` → `date`. Anything else, **including a pair this
build does not recognise**, is destructive. `ddlType` passes an unknown abstract type through unchanged, so
an unrecognised pair is exactly the case where nobody has reasoned about the conversion, and the default
has to fall on the side that asks a question.

Every command that applies DDL uses this one classification. Destructive operations are listed
individually before anything runs, they require `--force`, and `--force` is per-invocation with no config
field and no environment variable, because a permission that can be set once in a file is a permission
that is set once and forgotten.

Two operations are safe by this definition and can still abort a migration against real data: an
`add_column` that is `NOT NULL` on a non-empty table, and any narrowing the server refuses. They do not
need `--force` — they destroy nothing — but they are named in the printed plan, because "this may fail" and
"this may delete" are different warnings and collapsing them into one flag would make `--force` mean
nothing.

## 11. Prompts require a TTY

No command prompts when `stdin` is not a TTY. It fails with the flag that would have answered the prompt,
which means a CI log says `--force is required to drop column orders.legacy_ref` instead of hanging until
the job times out. `--yes` answers every prompt in advance; on a TTY it is what turns an interactive
`push` into a scripted one.

`--json` implies non-interactive. A prompt written to stdout would corrupt the one document §3 promises.

## 12. Where the bin lives

The `zmdb` package is a re-export facade — `SPEC.md` there is mostly a "No-collision guarantee" — and a CLI
is not a re-export. It goes there anyway, for one reason that outweighs the tidiness argument:
`npx zmdb generate` is the command people will type, and the alternative is a second published package
whose only content is an executable. The facade already depends on all five packages, so it can reach the
compiler, the reflector and the runner without a new dependency edge.

`package.json` gains `"bin": { "zmdb": "./src/cli/bin.ts" }` and the export `"./cli": "./src/cli/index.ts"`,
and `./cli` joins `BUILD_TIME_ENTRIES` in `.github/scripts/verify-exports.mjs` beside the `zmdb#./unplugin`
entry that is already there. That gate is what keeps the config loader, the filesystem walk and the
compiler session out of an application bundle — the same reason the entry beside it exists.

The work is in `index.ts` and the bin is argument parsing and exit codes only, as
`packages/aot-validator/src/cli/bin.ts` already does. That split is what makes the commands testable
without spawning a process.

## 13. Non-goals (rejected)

- **`up` as a command.** §1 — it already means "apply" twice in this project.
- **Omitting `status` and a rollback.** §1 — both already ship as library functions.
- **A fourth exit code.** §2 — the detail belongs in `--json`.
- **`--force` implied by `--yes`.** §2 — they answer different questions.
- **Human output on stdout under `--json`.** §3.
- **Per-finding exit codes for `check`.** §7.
- **An interactive prompt without a TTY.** §11.
- **A separate package for the executable.** §12.
- **Reconciling a `push`-built database with the migration ledger.** §6 — `push` is a development
  workflow, and pretending it has a history would be a lie the ledger has to keep.
