# The `zmdb` executable — Spec (epic "The zmdb executable")

> Part of `zmdb`, as a `bin` and as the build-time export `./cli` (§12). Config schema and loading are
> `../config/SPEC.md`.

## 1. The database verbs, and `up` is not one of them

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
| `new`      | nothing                       | new files only (§13)       | no       |
| `studio`   | declarations, the database    | nothing                    | yes      |

`migrate`, `rollback` and `status` are thin dispatch over `up`, `down` and `status` in the shipped runner.
They are the only three commands that need no new engine work, and saying so here is what keeps them from
being redesigned.

Two more verbs are frozen further down and are not about the schema at all: `new` writes files (§13) and
`studio` serves a page (§14). Eleven in total, and the count is not the interesting number — the division
is. The nine above read or write a database or the tree that describes it; the two below are a code
generator and a viewer, and neither is allowed to acquire an opinion about migrations.

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

## 13. `new`, the scaffold command — and it is not called `generate`

`zmdb generate` already means "generate a migration" (§4), and `docs-site/content/web-cli.md` reaches for
`zmdb generate resource posts` for scaffolding. Both cannot be true, and the migration meaning is the one
`generate` carries in every comparable tool, so **the scaffold verb is `new`**:
`zmdb new <kind> <name> [--package <pkg>]`.

### The docs page argues scaffolding is nearly worthless, and it is right about the part it measured

> Scaffolding is the least valuable, because the thing it would scaffold is already about eight lines.

That is accurate about the source file, and it is the reason the scaffolds are specified around what it
does not measure. A controller really is eight lines. Its **test** is not, the module entry that registers
it is in a file the scaffold did not create, and a repository provider is a factory whose three arguments
are the thing people get wrong. So every template writes a spec file, and the templates that need wiring
print the wiring rather than performing it (§13.3).

### 13.1 What each template writes, file by file

| `zmdb new …`        | Writes                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project <name>`    | `package.json`, `tsconfig.json`, `zmdb.config.ts`, `src/app.module.ts`, `src/main.ts`, `src/health.controller.ts`, `src/health.controller.spec.ts`, `.gitignore` |
| `schema <name>`     | `src/<name>.ts` (the `Table<'…'>` interface), `src/<name>.spec.ts`                                                                                               |
| `controller <name>` | `src/<name>.controller.ts`, `src/<name>.controller.spec.ts`                                                                                                      |
| `module <name>`     | `src/<name>.module.ts`, `src/<name>.module.spec.ts`                                                                                                              |
| `repository <name>` | `src/<name>.repository.ts` (the token and the provider factory), `src/<name>.repository.spec.ts`                                                                 |
| `command <name>`    | `src/<name>.command.ts`, `src/<name>.command.spec.ts` (see `@zmdb/web`'s `src/cli/SPEC.md`)                                                                      |

No template writes a barrel file, and no template appends to one. A generated `index.ts` re-export is the
first thing a scaffold does that the developer has to undo.

Every `.spec.ts` uses `createTestApp` from `@zmdb/web/testing` and asserts behaviour, not existence. A
generated test that asserts `expect(controller).toBeDefined()` is the habit this repository is built to
avoid, and it is worse than no test because it makes the coverage number lie.

The `project` template's `src/<name>.spec.ts` for `schema` carries the transformer canary that
`web-cli-monorepo.md` already recommends, because that page is right that it belongs in every package that
validates:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Worth being precise about what that canary catches, since the docs are not. Untransformed, `is<T>(value)`
does not quietly return `true`: `@zmdb/aot-validator`'s fallback `is` requires a runtime witness and throws
`runtime type witness required in test/fallback mode` without one. So the canary fails either way, and the
un-transformed build fails loudly rather than silently — which is the direction to want, and the opposite
of what `docs-site/content/web-cli-apps.md` currently claims (it says an `assert<T>()` in a stripped script
"is permissive"). §15 records the correction for the docs sub-issue.

### 13.2 Monorepo targeting is explicit, and a wrong guess is unrecoverable

Detection reads workspace globs from the nearest ancestor `package.json`'s `workspaces` field, or from
`pnpm-workspace.yaml` if that is the file present. That is detection of the _layout_, and it is all that is
inferred.

**Choosing the target package is not inferred.** In a workspace root, `zmdb new controller posts` without
`--package` is an exit-2 usage error listing the packages it found. Inside exactly one package it targets
that package, because there is nothing to choose. The asymmetry is deliberate: writing a file into the
wrong workspace is not a diagnostic you read, it is a file you find three days later in a package that
should not import the framework, and `--package` costs one flag.

`docs-site/content/web-cli-monorepo.md` reaches a conclusion this section agrees with and goes further
than:

> If a zmdb CLI ships, the monorepo-specific parts worth having are a schema registry check across
> workspaces and a migration command that knows which app owns which tables — not project scaffolding.

The registry check it wants is already `check`'s `uncommitted-schema` finding (§7) once `schema` globs are
read through a project, and "which app owns which tables" is answered by each package having its own
`zmdb.config.ts` and the discovery walk stopping at a package boundary. Neither needs a monorepo mode. So
there is no `zmdb new library`, no `zmdb.workspace.json`, and no build orchestration — the package manager
already does that, and doing it worse in one more place is how a CLI becomes the thing you fight.

### 13.3 A scaffold never edits a file it did not create

`zmdb new controller posts` prints the exact line to add and the file to add it to:

```
add to src/app.module.ts, in @Module({ controllers: [ … ] }):
  PostsController,
```

The alternative is an AST rewrite of a hand-written file, and the compiler is right there to do it (§4 of
`../config/SPEC.md` already opens a project). It is still refused. A generator that reformats a
developer's module — moving a comment, reordering an array, normalising quotes — loses the trust it needs
in order to be run a second time, and the operation it is being trusted with is worth one line of typing.

Refusals: a template never overwrites an existing file (exit 1, naming it, and `--force` does **not**
override this — §10's `--force` is about database destruction, and reusing it for files would mean one flag
guarding two unrelated kinds of loss). A `<name>` that is not a valid identifier after casing is exit 2.
`--dry-run` prints the file list and the contents to stdout and writes nothing.

## 14. `studio` — read-only, loopback, and it renders nothing it has no declaration for

`docs-site/content/cli-studio.md` is the most sceptical page in the documentation about its own subject,
and its scepticism is the specification:

> A studio is a tool that holds production credentials and executes arbitrary generated SQL. That is a
> reasonable thing to build and a serious thing to ship, and it is not the next most valuable feature.

Both halves of that are answered by narrowing, not by mitigation.

**It executes no SQL it was given.** Every query is built by the repository from a declared table, a
column name checked against that declaration, and bound parameters. There is no endpoint that accepts a
SQL string, no `?sql=`, and no free-text filter that reaches the compiler. The browser sends a table name,
a page cursor, and a column to sort by; anything not in the declaration is a 400 naming the column.

**It holds no credential the executable did not already hold.** The page's objection is about
credentials, and it predates the config file. `studio` opens the same `driver` thunk that `migrate` and
`push` use — and it is strictly _less_ privileged than either, because it never issues DDL and never
writes. A `studio` that made the credential question worse would have to be more privileged than the
`migrate` sitting next to it in the same binary, and it is not.

**Read-only, with no write mode behind a flag.** The page sketches "writes going through the
repositories", and that is where this spec stops short of it. A write path needs the destructive-operation
question of §10 asked per row instead of per statement, and a UI is the worst place to ask it. `studio` is
`SELECT` only; the tool for a write is a repository call in a `command` (§13.1) that a reviewer can read.

### 14.1 Which tables, and what "no declaration" means

The tables are the ones in the config's `schema` set (`../config/SPEC.md` §5) — which is what the config
file buys here, and the direct answer to the page's "nothing enumerates your tables, so the list is an
argument". Under the CLI there is a list, and it is the same list `generate` diffs.

A table that exists in the database and not in the declarations is **listed as unrenderable, not
rendered**. Not hidden: a studio that silently omits a table is a studio you cannot trust to tell you
what is in your database. It appears with the reason ("no declaration in the schema set — see `pull`"),
and clicking it does nothing. Rendering it would require reading its columns from the server, which is
introspection, which is a different epic and would make the studio the second thing in the project that
types a column.

### 14.2 The UI has no build step, because there is nowhere to put one

`cli-studio.md` names the obstacle exactly — "no browser bundle anywhere in the project", in a project
with zero runtime dependencies and no browser target. So there is no framework, no bundler, and no
`node_modules` shipped to the browser: the studio serves **server-rendered HTML** from a `@zmdb/web`
application, with the little interactivity it needs written as inline script and no build step. A form and
a link are enough for a list, a detail view and a page control.

This is a real constraint on how good the UI can be, and accepting it is the trade. The alternative is a
bundler in the dependency tree of a package whose entire pitch is not having one, to make a local table
viewer nicer.

Rows are rendered **through the property list of `toJsonSchema<T>()`, never off the row object.** That is
not a stylistic preference: `jsonSchemaFromShape` filters `column.sensitive` out of `properties`, so
rendering from the document means a `Sensitive` column cannot reach the page, while rendering the row
object means it appears the first time someone adds a column. Redaction that is structural does not need
to be remembered.

Pagination is `limit`/`offset` with a fixed page size, and this is the one place the project's own
cursor-pagination advice is deliberately not taken: a data browser needs "page 7" and a total, a keyset
cursor cannot provide either, and the cost of an offset scan on a local browsing session is a slow page
rather than a production incident. `orderBy` is a single declared column with a direction.

### 14.3 No authentication, and therefore no non-loopback flag

`studio` binds `127.0.0.1` on an ephemeral port, prints the URL, and has no login. That is coherent
exactly as long as the socket is unreachable from anywhere else, because the security boundary _is_ the
loopback bind.

So the decision the issue asks for: **there is no `--host` flag.** Not a flag that requires a token, not
a flag behind a warning. The reasoning is that any non-loopback bind turns a no-auth read-only view of
every table into an unauthenticated database viewer on a network, and the mitigation people would actually
reach for — a token in the URL — puts a credential in shell history, a proxy log and a browser history,
which is worse than the problem. A user who genuinely needs remote access has `ssh -L`, which
authenticates properly and is one flag on a command they already know.

`--port` exists, because a fixed port is sometimes needed for a browser bookmark and it does not change
the boundary. Binding fails rather than falling back to `0.0.0.0` if loopback is unavailable.

## 15. What the docs pages have to change

The four pages this section is written against are `status: 'todo'` and owned by their own `[Docs]`
sub-issue, so none is edited here. What that sub-issue has to carry:

- `web-cli-apps.md` says a stripped script's `assert<T>()` "is permissive". It is not — the fallback
  throws `runtime type witness required in test/fallback mode`. The page's advice (build it, do not strip
  it) is right; its stated reason is the wrong direction, and "your validation is decoration" is the one
  sentence in the docs that would make someone trust an unchecked input.
- The same page proposes `@Command`/`@Option` decorators; `@zmdb/web`'s `src/cli/SPEC.md` ships `@Command`
  and no `@Option`, because there are no parameter decorators in this project.
- `web-cli.md` uses `zmdb generate resource posts` for scaffolding. The verb is `new` (§13).
- `cli-studio.md` concludes the studio should ship "as an opt-in package rather than a CLI command" to keep
  the credentials question in the user's hands. §14 ships it as a command, and the reason is that the
  config file already answers the credentials question — the same `driver` thunk `migrate` uses, with less
  privilege.
- `web-cli-monorepo.md` needs no correction. Its conclusion is adopted in §13.2, including the two
  monorepo features it says are the ones worth having.

## 16. Non-goals (rejected)

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
- **`generate` as the scaffold verb.** §13 — it already means "generate a migration".
- **A generated barrel file, or appending to one.** §13.1.
- **A generated test that asserts the generated thing exists.** §13.1 — it makes coverage lie.
- **Inferring the target package in a workspace root.** §13.2 — `--package` costs one flag and a wrong
  guess costs a file in the wrong package.
- **`zmdb new library`, a workspace manifest, or build orchestration.** §13.2 — the package manager
  already does it.
- **A scaffold that edits an existing module.** §13.3 — and `--force` does not extend to overwriting a
  file, because §10's `--force` is about a database.
- **A studio write mode, behind any flag.** §14.
- **Rendering a table the schema set does not declare.** §14.1 — it is listed with its reason instead.
- **Hiding it instead.** §14.1 — a viewer that omits a table silently is not a viewer.
- **A bundler or UI framework for the studio.** §14.2.
- **Keyset pagination in the studio.** §14.2 — a browser needs a page number.
- **`studio --host`, with or without a token.** §14.3 — the loopback bind _is_ the boundary, and a token
  in a URL lands in shell history and a proxy log.
