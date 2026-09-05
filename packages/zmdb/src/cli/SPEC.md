# The `zmdb` executable — Spec (epic "The zmdb executable")

> Part of `zmdb`, as a `bin` and as the build-time export `./cli` (§12). Config schema and loading are `../config/SPEC.md`.

## 1. The database verbs, and `up` is not one of them

The issue proposing this asks for `up` to mean "upgrade a stored snapshot to the current format". `up` already means the opposite kind of thing in this project, twice:

- `runCli('up' | 'down' | 'status', …)` in `@zmdb/query-compiler`'s migration runner **applies pending migrations**.
- `@zmdb/query-compiler`'s `src/migrations/SPEC.md` §4 documents "CLI verbs: `create`, `up`, `down`, `status`".

Two meanings of `up` in one product, one of which writes to a live database and one of which rewrites a JSON file. The tool this verb list was borrowed from has exactly this wart; there is no reason
to import it. **`migrate` applies, `upgrade` rewrites the snapshot format, and `up` is not a command** — typing it exits 2 with a message naming both, because a user who types `zmdb up` expecting to
apply migrations must not get a snapshot rewrite instead.

The issue's list also omits two verbs whose implementations already ship as library functions — `status` and a rollback. A CLI that hides capability the library has is a worse CLI, so:

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
| `embed`    | migration files               | a TypeScript module (§4.1) | no       |
| `pull`     | the database                  | declaration files          | yes      |
| `new`      | nothing                       | new files only (§13)       | no       |
| `studio`   | declarations, the database    | nothing                    | yes      |

`migrate`, `rollback` and `status` are thin dispatch over `up`, `down` and `status` in the shipped runner. They are the only three commands that need no new engine work, and saying so here is what
keeps them from being redesigned.

Two more verbs are frozen further down and are not about the schema at all: `new` writes files (§13) and `studio` serves a page (§14). The amendments add `modules`, `repl`, and `client`, making
fifteen visible commands in three groups: ten read or write a database or the tree that describes it, three scaffold, generate, or view developer artifacts, and two describe or inhabit an
application's object graph.

`embed` belongs to the first group because it reads the migration files, though it is the only verb there that neither connects nor writes into the schema tree. Its output is a module an application
bundle imports, and the format belongs to `@zmdb/query-compiler` — see §4.1.

## 2. Argument parsing and exit codes are already decided

`zmdb-codegen` ships in this repository and establishes the conventions. They are reused rather than reinvented, because two executables from one project that disagree about exit codes is a worse
outcome than either convention being suboptimal.

| Code | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 0    | The command did what it was asked, including "there was nothing to do".             |
| 1    | The tree or the database is not in the state it should be. Nothing wrong with you.  |
| 2    | The invocation is wrong: unknown command, missing flag argument, unreadable config. |

That distinction is already load-bearing in `zmdb-codegen`, whose `--check` failure says in a full sentence that it is "not an error in the code — an error in the tree", and it is what lets CI treat a
2 as a pipeline bug and a 1 as a review comment. Parsing uses Node's `util.parseArgs`, with the command definitions also rendering global and per-command help. There is no CLI-framework dependency.

Global flags: `--config <path>`, `--project <tsconfig>` (overriding the config's `project`), `--json`, `--yes`, `--force`, `--help`, `--version`. Two flags that ask for opposite things exit 2 with a
sentence saying so, following `zmdb-codegen: --check and --watch ask for opposite things`.

**`--force` and `--yes` are different questions and neither implies the other.** `--force` permits a destructive operation; `--yes` declines to be asked. A scripted destructive push needs both, and
that is deliberate: a CI job that sets `--yes` once, for convenience, must not silently acquire permission to drop a column two months later.

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

With `--json`, **stdout is exactly one JSON document** and every human-readable line — progress, the config path, warnings — goes to stderr. Without `--json`, the human lines go to stdout. That rule
is the whole value of the flag: `zmdb check --json | jq -e .ok` has to work in a pipeline, and a single stray progress line on stdout breaks it in a way that looks like malformed JSON rather than like
a logging bug.

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

`ops` is the shipped `ChangeOp` union, serialised as-is. That is deliberate: the CLI's machine-readable output is the compiler's own vocabulary, so a consumer scripting against it and a contributor
reading `diff` are looking at the same names.

## 4. `generate`, and the ledger cannot hold a timestamp version

Read the declarations through the project, `snapshot()` them, `diff()` against `<out>/snapshot.json`, and write a migration file plus the new snapshot. Nothing to generate exits **0** with a message
and writes no file — an empty migration is a version that gets recorded as applied and means nothing.

File name: `<YYYYMMDDHHMMSS>_<slug>.sql` in UTC, where the fourteen digits are the version and the slug comes from `--name` or is derived from the ops. Sortable lexically and numerically at once,
which is the only property that matters.

The previous runner used `INTEGER`, but `20260903120000` is above Postgres's 32-bit limit. The driver adapter now creates `BIGINT` on Postgres and MySQL, widens an existing ledger before reading it,
and keeps SQLite's already-64-bit `INTEGER`.

One file, not a pair. It carries both directions, separated by a single sentinel line:

```sql
-- zmdb:up
ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMPTZ;
-- zmdb:down
ALTER TABLE orders DROP COLUMN shipped_at;
```

A pair of files can be half-committed, half-reverted or half-deleted, and the runner's `Migration` type needs `up` and `down` at one version. A file with no `-- zmdb:down` section parses with an empty
`down`, and `rollback` refuses that version by name rather than guessing at an inverse.

### 4.1 `embed`, for a bundle that cannot read a directory

`zmdb embed [--out <file>] [--with-down]` reads the migration directory, splits each file at the sentinels above, and writes a TypeScript module of `EmbeddedMigration` values — version, name, the `up`
text verbatim, and a SHA-256 digest of it.

React Native and the browser have no filesystem and Metro cannot resolve a `.sql` file, so a device gets its migrations as bundle data or not at all.

The format, the digest, the ledger and the runner are frozen in `@zmdb/query-compiler`'s `src/migrations/SPEC.md` §5; what belongs here is only that this is the command, and why it is not spelled
another way.

It is not `generate --embed`: `generate` diffs declarations against the stored snapshot and writes one migration file, and it never reads the directory. It is not `export --embed`: `export` writes DDL
for the schema set to stdout (§9), from declarations rather than from files, for a human or a `psql` pipe rather than for a bundler. Either spelling would give a verb a second meaning, which is the
thing §1 and §13 are both about.

The digest is computed here because this is the side that has Node: `globalThis.crypto.subtle` exists, and a device comparing two strings needs no crypto at all. It writes in version order and
byte-stably, so the module is committed and reviewed; `check` reports `stale-embedded` when it no longer matches the directory (§7), because a stale embedded module ships the wrong statements from a
build that succeeded.

One thing `embed` knows that the format cannot: which dialect the migration files were emitted for. A `SchemaSnapshot` records no dialect — deliberately, since the same snapshot is emitted for all of
them — so the answer comes from the configured dialect, the same place `generate` read it. The embedded runner executes SQLite and only SQLite, so `embed` **refuses a project configured for anything
else** and says which, rather than writing a module whose first statement is a syntax error on a user's phone.

## 5. `migrate`, `rollback`, `status`, and the dialect that has no transactional DDL

Each migration runs inside its own transaction, in version order, with its ledger row written in the same transaction. One failure stops the run: the migrations already applied stay applied and
recorded, the failing one is rolled back and not recorded, and the message names the version and the failing statement.

**The MySQL family has no transactional DDL**, so that guarantee is available on the Postgres family, SQLite and SQL Server. On MySQL/SingleStore an interrupted migration leaves the ledger honest —
the row is not written — and the schema half-applied, which is worse than the reverse and cannot be fixed from here. The failure message therefore lists the statements that already ran, because that
list is the only way to hand-finish the migration.

`rollback` reverts exactly one version, the highest applied. `--to <version>` reverts down to and excluding that version, one transaction per migration, stopping on the first failure.

`status` connects, reads the ledger, and prints the shipped `[x] <version> <name>` lines. It exits 0 whether or not anything is pending: "there are pending migrations" is information, not a failure.
`check` is the command whose job is to fail.

## 6. `push`, where every rename looks destructive and that is correct

`push` diffs declarations against the database and applies the DDL directly, with no migration file. It is for development, it prints the statements it is about to run before running any of them, and
it refuses destructive operations without `--force` (§10).

The consequence that will be mistaken for a bug: **a column rename requires `--force`.** `diff` reports a rename as a drop plus an add, and `src/migrations/SPEC.md` §1.4 already explains why it cannot
do otherwise — two snapshots either side of a rename differ byte-for-byte the way a real drop and a real add do, and pairing them by shape would guess.

So `push` sees a drop, refuses, and is right to: the operation it is being asked to perform really does delete a column's data.

`push` never writes to the ledger, and a database built by `push` therefore has no history. Running `migrate` against it afterwards will attempt migration 1 against a schema that already has the
tables. That is a development-only workflow and the spec says so rather than trying to reconcile the two.

## 7. `check` reports findings and exits 1 for any of them

| Finding              | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `uncommitted-schema` | `diff(stored, snapshot(declarations))` is non-empty — run `generate`. |
| `duplicate-version`  | Two migration files share a version. The branch-merge case.           |
| `snapshot-version`   | The stored snapshot's `version` is newer than this build understands. |
| `missing-down`       | A migration file has no `-- zmdb:down` section (§4).                  |
| `stale-embedded`     | The embedded module is out of date with the migration files (§4.1).   |
| `drift`              | The live database does not match the stored snapshot. Needs `pull`.   |

`drift` is the only one that connects, so it runs only when a driver is configured, and its absence is reported as a skipped check rather than as a pass. A check that silently does not run is worse
than one that fails.

Any finding exits 1. The exit code does not encode _which_ finding — that is what `--json` is for, and per-finding exit codes are how a CI script ends up asserting on a number nobody remembers the
meaning of.

## 8. `upgrade` touches the format and never the schema

`SchemaSnapshot.version` is the literal `1` today. `upgrade` reads a stored snapshot at any version this build knows, rewrites it at the current one, and is idempotent: run against a current snapshot
it reports `changed: false` and exits 0 without touching the file's mtime.

It must be provably schema-preserving, and the way to prove it is cheap: `diff(before, after)` after the rewrite must be empty, and the command fails rather than writing if it is not. A snapshot at a
version _newer_ than this build is an exit-2 error saying so, not an attempted downgrade.

## 9. `export` writes to stdout

The full DDL for the schema set, in the phase order the extension and routine specs established — extensions before the tables that use their types, tables before the objects that reference them. No
connection, no ledger, nothing written to disk, so it composes: `zmdb export | psql`.

## 10. Destructive operations, defined once

The classification covers every current `ChangeOp` kind rather than a subset, so a new kind fails a test instead of defaulting to permitted:

| `ChangeOp`                            | Destructive | Why                                                                     |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `create_extension`, `create_table`    | no          | Adds a capability or a new empty table.                                 |
| `add_column`                          | no          | An added nullable column loses nothing.                                 |
| `drop_table`, `drop_column`           | yes         | Deletes rows or a column's values.                                      |
| `alter_column_type`                   | sometimes   | Destructive when the new type is narrower.                              |
| `alter_primary_key`                   | no          | Reindexes existing rows; duplicates can fail it, but no row is deleted. |
| `add_foreign_key`, `drop_foreign_key` | no          | Changes enforcement without deleting an existing value.                 |

Narrowing is read off the `from`/`to` pair the op already carries — both are abstract types, so this is a table lookup rather than a database guess: `text` → `varchar`, `bigint` → `integer`, `numeric`
→ `integer`, and `timestamp` → `date`. Known widening pairs are permitted. A length-only `varchar(n)` change is not currently a `ChangeOp` at all, so the push planner cannot pretend to classify one;
the migration diff spec records that limitation.

Anything else, **including a pair this build does not recognise**, is destructive. `ddlType` passes an unknown abstract type through unchanged, so an unrecognised pair is exactly the case where nobody
has reasoned about the conversion, and the default has to fall on the side that asks a question.

Every command that applies DDL uses this one classification. Destructive operations are listed individually before anything runs, they require `--force`, and `--force` is per-invocation with no config
field and no environment variable, because a permission that can be set once in a file is a permission that is set once and forgotten.

Two operations are safe by this definition and can still abort a migration against real data: an `add_column` that is `NOT NULL` on a non-empty table, and any narrowing the server refuses. They do not
need `--force` — they destroy nothing — but they are named in the printed plan, because "this may fail" and "this may delete" are different warnings and collapsing them into one flag would make
`--force` mean nothing.

## 11. Prompts require a TTY

No command prompts when `stdin` is not a TTY. It fails with the flag that would have answered the prompt, which means a CI log says `--force is required to drop column orders.legacy_ref` instead of
hanging until the job times out. `--yes` answers every prompt in advance; on a TTY it is what turns an interactive `push` into a scripted one.

`--json` implies non-interactive. A prompt written to stdout would corrupt the one document §3 promises.

## 12. Where the bin lives

The `zmdb` package is a re-export facade — `SPEC.md` there is mostly a "No-collision guarantee" — and a CLI is not a re-export. It goes there anyway, for one reason that outweighs the tidiness
argument: `npx zmdb generate` is the command people will type, and the alternative is a second published package whose only content is an executable. The facade already depends on all five data/web
implementation packages, so it can reach the compiler, the reflector and the runner without a new dependency edge. `@zmdb/ai` is independently published and is not a facade export.

`package.json` declares the canonical single-bin shorthand `"bin": "./src/cli/bin.ts"` (equivalent to `{ "zmdb": "./src/cli/bin.ts" }`) and the export `"./cli": "./src/cli/index.ts"`, and `./cli` is
in `BUILD_TIME_ENTRIES` in `.github/scripts/verify-exports.mjs` beside the `zmdb#./unplugin` entry. That gate keeps the config loader, the filesystem walk and the compiler session out of an
application bundle — the same reason the entry beside it exists.

Dispatch, argument parsing, output and exit-code decisions live behind `index.ts`; `bin.ts` only passes `process.argv` into `runCli` and assigns the returned exit code. That split is what makes the
commands testable without spawning a process.

## 13. `new`, the scaffold command — and it is not called `generate`

`zmdb generate` already means "generate a migration" (§4), and `docs-site/content/web-cli.md` reaches for `zmdb generate resource posts` for scaffolding. Both cannot be true, and the migration meaning
is the one `generate` carries in every comparable tool, so **the scaffold verb is `new`**: `zmdb new <kind> <name> [--package <pkg>]`.

### The docs page argues scaffolding is nearly worthless, and it is right about the part it measured

> Scaffolding is the least valuable, because the thing it would scaffold is already about eight lines.

That is accurate about the source file, and it is the reason the scaffolds are specified around what it does not measure. A controller really is eight lines. Its **test** is not, the module entry that
registers it is in a file the scaffold did not create, and a repository provider is a factory whose three arguments are the thing people get wrong. So every template writes a spec file, and the
templates that need wiring print the wiring rather than performing it (§13.3).

### 13.1 What each template writes, file by file

| `zmdb new …`        | Writes                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project <name>`    | `package.json`, `tsconfig.json`, `vitest.config.ts`, `scripts/build.mjs`, `zmdb.config.ts`, `src/app.module.ts`, `src/main.ts`, `src/health.controller.ts`, `src/health.controller.spec.ts`, `.gitignore` |
| `schema <name>`     | `src/<name>.ts` (the `Table<'…'>` interface), `src/<name>.spec.ts`                                                                                                                                        |
| `controller <name>` | `src/<name>.controller.ts`, `src/<name>.controller.spec.ts`                                                                                                                                               |
| `module <name>`     | `src/<name>.module.ts`, `src/<name>.module.spec.ts`                                                                                                                                                       |
| `repository <name>` | `src/<name>.repository.ts` (the token and the provider factory), `src/<name>.repository.spec.ts`                                                                                                          |
| `command <name>`    | `src/<name>.command.ts`, `src/<name>.command.spec.ts` (see `@zmdb/app`'s `src/commands/SPEC.md`)                                                                                                          |

No template writes a barrel file, and no template appends to one. A generated `index.ts` re-export is the first thing a scaffold does that the developer has to undo.

Every `.spec.ts` uses `createTestApp` from `@zmdb/web/testing` and asserts behaviour, not existence. A generated test that asserts `expect(controller).toBeDefined()` is the habit this repository is
built to avoid, and it is worse than no test because it makes the coverage number lie.

The `project` template's `src/<name>.spec.ts` for `schema` carries the transformer canary that `web-cli-monorepo.md` already recommends, because that page is right that it belongs in every package
that validates:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Worth being precise about what that canary catches, since the docs are not. Untransformed, `is<T>(value)` does not quietly return `true`: `@zmdb/aot-validator`'s fallback `is` requires a runtime
witness and throws `runtime type witness required in test/fallback mode` without one.

So the canary fails either way, and the un-transformed build fails loudly rather than silently — which is the direction to want, and the opposite of what `docs-site/content/web-cli-apps.md` currently
claims (it says an `assert<T>()` in a stripped script "is permissive"). §15 records the correction for the docs sub-issue.

### 13.2 Monorepo targeting is explicit, and a wrong guess is unrecoverable

Detection reads workspace globs from the nearest ancestor `package.json`'s `workspaces` field, or from `pnpm-workspace.yaml` if that is the file present. That is detection of the _layout_, and it is
all that is inferred.

**Choosing the target package is not inferred.** In a workspace root, `zmdb new controller posts` without `--package` is an exit-2 usage error listing the packages it found. Inside exactly one package
it targets that package, because there is nothing to choose. The asymmetry is deliberate: writing a file into the wrong workspace is not a diagnostic you read, it is a file you find three days later
in a package that should not import the framework, and `--package` costs one flag.

`docs-site/content/web-cli-monorepo.md` reaches a conclusion this section agrees with and goes further than:

> If a zmdb CLI ships, the monorepo-specific parts worth having are a schema registry check across workspaces and a migration command that knows which app owns which tables — not project scaffolding.

The registry check it wants is already `check`'s `uncommitted-schema` finding (§7) once `schema` globs are read through a project, and "which app owns which tables" is answered by each package having
its own `zmdb.config.ts` and the discovery walk stopping at a package boundary. Neither needs a monorepo mode.

So there is no `zmdb new library`, no `zmdb.workspace.json`, and no build orchestration — the package manager already does that, and doing it worse in one more place is how a CLI becomes the thing you
fight.

### 13.3 A scaffold never edits a file it did not create

`zmdb new controller posts` prints the exact line to add and the file to add it to:

```
add to src/app.module.ts, in @Module({ controllers: [ … ] }):
  PostsController,
```

The alternative is an AST rewrite of a hand-written file, and the compiler is right there to do it (§4 of `../config/SPEC.md` already opens a project). It is still refused. A generator that reformats
a developer's module — moving a comment, reordering an array, normalising quotes — loses the trust it needs in order to be run a second time, and the operation it is being trusted with is worth one
line of typing.

Refusals: a template never overwrites an existing file (exit 1, naming it, and `--force` does **not** override this — §10's `--force` is about database destruction, and reusing it for files would mean
one flag guarding two unrelated kinds of loss). A `<name>` that is not a valid identifier after casing is exit 2. `--dry-run` prints the file list and the contents to stdout and writes nothing.

## 14. `studio` — read-only, loopback, and it renders nothing it has no declaration for

`docs-site/content/cli-studio.md` is the most sceptical page in the documentation about its own subject, and its scepticism is the specification:

> A studio is a tool that holds production credentials and executes arbitrary generated SQL. That is a reasonable thing to build and a serious thing to ship, and it is not the next most valuable
> feature.

Both halves of that are answered by narrowing, not by mitigation.

**It executes no SQL it was given.** Every query is built by the repository from a declared table, a column name checked against that declaration, and bound parameters. There is no endpoint that
accepts a SQL string, no `?sql=`, and no free-text filter that reaches the compiler. The browser sends a table name, a page cursor, and a column to sort by; anything not in the declaration is a 400
naming the column.

**It holds no credential the executable did not already hold.** The page's objection is about credentials, and it predates the config file. `studio` opens the same `driver` thunk that `migrate` and
`push` use — and it is strictly _less_ privileged than either, because it never issues DDL and never writes. A `studio` that made the credential question worse would have to be more privileged than
the `migrate` sitting next to it in the same binary, and it is not.

**Read-only, with no write mode behind a flag.** The page sketches "writes going through the repositories", and that is where this spec stops short of it. A write path needs the destructive-operation
question of §10 asked per row instead of per statement, and a UI is the worst place to ask it. `studio` is `SELECT` only; the tool for a write is a repository call in a `command` (§13.1) that a
reviewer can read.

### 14.1 Which tables, and what "no declaration" means

The tables are the ones in the config's `schema` set (`../config/SPEC.md` §5) — which is what the config file buys here, and the direct answer to the page's "nothing enumerates your tables, so the
list is an argument". Under the CLI there is a list, and it is the same list `generate` diffs.

The table index is **exactly that configured schema set**. A table that exists only in the database is neither listed nor rendered: `Driver` exposes query execution, not a catalogue operation, so
discovering even its name would be introspection owned by `pull`. A request that names a table outside the set is refused as undeclared. The page labels the index "declared tables"; it does not claim
to enumerate the whole database.

### 14.2 The UI has no build step, because there is nowhere to put one

`cli-studio.md` names the obstacle exactly — "no browser bundle anywhere in the project", in a project with zero runtime dependencies and no browser target. So there is no framework, no bundler, and
no `node_modules` shipped to the browser: the studio serves **server-rendered HTML** from a `@zmdb/web` application, with the little interactivity it needs written as inline script and no build step.
A form and a link are enough for a list, a detail view and a page control.

This is a real constraint on how good the UI can be, and accepting it is the trade. The alternative is a bundler in the dependency tree of a package whose entire pitch is not having one, to make a
local table viewer nicer.

Rows are rendered **through the property list of `toJsonSchema<T>()`, never off the row object.** That is not a stylistic preference: `jsonSchemaFromShape` filters `column.sensitive` out of
`properties`, so rendering from the document means a `Sensitive` column cannot reach the page, while rendering the row object means it appears the first time someone adds a column. Redaction that is
structural does not need to be remembered.

Pagination is `limit`/`offset` with a fixed page size, and this is the one place the project's own cursor-pagination advice is deliberately not taken: a data browser needs "page 7" and a total, a
keyset cursor cannot provide either, and the cost of an offset scan on a local browsing session is a slow page rather than a production incident. `orderBy` is a single declared column with a
direction.

### 14.3 No authentication, and therefore no non-loopback flag

`studio` binds `127.0.0.1` on an ephemeral port, prints the URL, and has no login. That is coherent exactly as long as the socket is unreachable from anywhere else, because the security boundary _is_
the loopback bind.

So the decision the issue asks for: **there is no `--host` flag.** Not a flag that requires a token, not a flag behind a warning.

The reasoning is that any non-loopback bind turns a no-auth read-only view of every table into an unauthenticated database viewer on a network, and the mitigation people would actually reach for — a
token in the URL — puts a credential in shell history, a proxy log and a browser history, which is worse than the problem.

A user who genuinely needs remote access has `ssh -L`, which authenticates properly and is one flag on a command they already know.

`--port` exists, because a fixed port is sometimes needed for a browser bookmark and it does not change the boundary. Binding fails rather than falling back to `0.0.0.0` if loopback is unavailable.

## 15. What the docs pages have to change

The four pages this section is written against are `status: 'todo'` and owned by their own `[Docs]` sub-issue, so none is edited here. What that sub-issue has to carry:

- `web-cli-apps.md` says a stripped script's `assert<T>()` "is permissive". It is not — the fallback throws `runtime type witness required in test/fallback mode`. The page's advice (build it, do not
  strip it) is right; its stated reason is the wrong direction, and "your validation is decoration" is the one sentence in the docs that would make someone trust an unchecked input.
- The same page proposes `@Command`/`@Option` decorators; `@zmdb/app`'s `src/commands/SPEC.md` ships `@Command` and no `@Option`, because there are no parameter decorators in this project.
- `web-cli.md` uses `zmdb generate resource posts` for scaffolding. The verb is `new` (§13).
- `cli-studio.md` concludes the studio should ship "as an opt-in package rather than a CLI command" to keep the credentials question in the user's hands. §14 ships it as a command, and the reason is
  that the config file already answers the credentials question — the same `driver` thunk `migrate` uses, with less privilege.
- `web-cli-monorepo.md` needs no correction. Its conclusion is adopted in §13.2, including the two monorepo features it says are the ones worth having.

## 16. Non-goals (rejected)

- **`up` as a command.** §1 — it already means "apply" twice in this project.
- **Omitting `status` and a rollback.** §1 — both already ship as library functions.
- **A fourth exit code.** §2 — the detail belongs in `--json`.
- **`--force` implied by `--yes`.** §2 — they answer different questions.
- **Human output on stdout under `--json`.** §3.
- **Per-finding exit codes for `check`.** §7.
- **An interactive prompt without a TTY.** §11.
- **A separate package for the executable.** §12.
- **Reconciling a `push`-built database with the migration ledger.** §6 — `push` is a development workflow, and pretending it has a history would be a lie the ledger has to keep.
- **`generate` as the scaffold verb.** §13 — it already means "generate a migration".
- **A generated barrel file, or appending to one.** §13.1.
- **A generated test that asserts the generated thing exists.** §13.1 — it makes coverage lie.
- **Inferring the target package in a workspace root.** §13.2 — `--package` costs one flag and a wrong guess costs a file in the wrong package.
- **`zmdb new library`, a workspace manifest, or build orchestration.** §13.2 — the package manager already does it.
- **A scaffold that edits an existing module.** §13.3 — and `--force` does not extend to overwriting a file, because §10's `--force` is about a database.
- **A studio write mode, behind any flag.** §14.
- **Discovering, listing or rendering a table the schema set does not declare.** §14.1 — even its name requires catalogue introspection, which belongs to `pull`.
- **A bundler or UI framework for the studio.** §14.2.
- **Keyset pagination in the studio.** §14.2 — a browser needs a page number.
- **`studio --host`, with or without a token.** §14.3 — the loopback bind _is_ the boundary, and a token in a URL lands in shell history and a proxy log.

## Amendments (the module inspector and the REPL, #599)

Two verbs — one that describes an application's module graph without constructing it, and one that boots an application into an interactive session — plus the four independent things that keep the
second one out of a server (epic #598, sub-issue #599). The description's shape and its provenance are `@zmdb/web`'s `src/devtools/SPEC.md`; lazy semantics are `@zmdb/app`'s `src/modules/SPEC.md`
§L1-L12. Frozen before code.

### R0. The edits this amendment makes to the sections above

§1's table gains two rows, at the end, in the second division rather than the first — neither verb reads the schema:

| Command   | Reads                    | Writes            | Connects  |
| --------- | ------------------------ | ----------------- | --------- |
| `modules` | application declarations | stdout            | no        |
| `repl`    | application declarations | whatever you type | yes (§R4) |

At this amendment, §1's "Twelve in total, and the count is not the interesting number — the division is" paragraph becomes fourteen, with a **third** division, and the new sentence is the load-bearing
part: ten verbs read or write a database or the tree that describes it, two are a code generator and a viewer, and two describe or inhabit an application's own object graph. The later generated-HTTP
amendment adds the fifteenth command.

The third division is the first thing in this CLI that reads the application packages — `@zmdb/app` plus the HTTP-aware `@zmdb/web/devtools` inspector — rather than the schema packages, and saying so
is what keeps a future contributor from adding `--migrate` to `zmdb modules`.

§3's per-command `result` table gains one row:

| Command   | `result`                                         |
| --------- | ------------------------------------------------ |
| `modules` | `GraphDescription` — the value, serialised as-is |

serialised as-is for the same reason `ops` is (`§3`): the CLI's machine-readable output is the library's type, so there is no second schema to keep in step. `repl` has no row because it has no
`--json` (§R3).

§16 gains the non-goals listed at the end of this amendment, and §15 gains two bullets — both about pages whose banners the `[Docs]` sub-issue owns, and one of which is wrong today rather than
wrong-after-this:

- `web-repl.md` repeats the `web-cli-apps.md` error §15 already records: it says `assert<T>()` "is permissive" under type stripping. It throws `runtime type witness required in test/fallback mode`
  (`../../../aot-validator/src/utilities/index.ts:568`). Because that sentence is false about the code as committed and would have somebody trust an unchecked input, it is corrected now rather than
  deferred; the banner, the new scope table and the `status` flip stay with the docs sub-issue.
- `web-repl.md`'s "What it would take" asks how to discover the tokens to expose and concludes an explicit map is needed either way. §R6 answers it — `tokens` from the description, and `get` accepting
  a description string — so that section becomes an answer rather than an open question.

### R1. The verb is `modules`, and `graph` is refused

#599 and the roadmap both call it `zmdb graph`. In this CLI that name is unavailable, under the rule §1 and §13 are both about: a verb must not acquire a second meaning.

Ten existing verbs are about a database or the tree that describes it. In that company `graph` reads as the table graph — the foreign-key graph a `pull` walks, the dependency order a `push` sorts DDL
into, the thing a schema visualiser would draw.

A developer typing `zmdb graph` in a project with thirty tables and four modules cannot know which one they are asking for, and the output tells them only after the fact. `zmdb modules` names the
thing it describes, matches `@zmdb/web`'s module vocabulary exactly, and leaves `graph` free for the schema graph if that is ever wanted — which is the same argument §12.1's `embed` makes against
`export --embed`.

The output is not only modules; it can include providers and controllers. That is a fair objection and it loses to the alternative, because `modules` is the graph's _granularity_ — the default
projection is the module graph, and providers appear under `--providers` (`@zmdb/web`'s `src/devtools/SPEC.md` §8). A name describing the default is more useful than one describing the maximum.

### R2. Naming the application, and there is no config field for it

```
zmdb modules [module-spec] [--format tree|dot] [--providers] [--module <name>] [--token <desc>] [--depth <n>]
zmdb repl [module-spec] [--no-history]
```

`module-spec` is `<path>#<export>`, defaulting to `./src/app.module.ts#AppModule` — which is exactly what §13.1's scaffold writes, so the default works in a project this CLI created and nowhere else
by accident. A missing file or a missing export exits 2 naming both halves, because `--project` and `--config` cannot help and guessing is worse: an inferred root module is a silently wrong graph, and
`zmdb modules` exists to be trusted about a graph.

In a workspace root the spec is required rather than resolved, which is §13.2's reasoning applied unchanged — "choosing the target package is not inferred" — and here the cost of a wrong guess is
higher than a file in the wrong package, because the output looks right.

**There is no `app` or `rootModule` field in `zmdb.config.ts`.** Every field that config carries describes the schema — `schema`, `out`, `driver`, `project`, `dialect` — and its own §7 is titled "The
application does not read this file". A root-module field would invert that: the config would start describing the application, and the first thing to ask for it after this would be a port. Two
commands taking one positional argument is cheaper than a config field that changes what the config is for.

Loading the spec cannot use Node's type stripping alone. Measured on the realistic fixture under Node 26.8.1, the import fails with `SyntaxError: Invalid or unexpected token`: type stripping does not
lower standard Stage-3 decorators. The CLI therefore installs a synchronous loader only for the application import and applies esbuild's standard-decorator transform, the same transform the Vitest
configuration uses.

Relative `.js` specifiers are mapped to their `.ts` siblings in that loader. `esbuild` is a dependency of the build-time-only `zmdb/cli` entry; no runtime package entry reaches it.

The cost that §4 names still applies, plus one that belongs here: **importing a root module evaluates that file and everything it imports.** Decorators run, which is the point, and any top-level side
effect in application code runs too. `zmdb modules` constructs no provider and calls no hook, so a pool declared in a `useFactory` stays closed; a pool opened at module scope was already opening on
every import and is out of the CLI's hands.

Naming it is the difference between a surprising connection and a documented one.

### R3. `zmdb modules`: flags, the `--json` collision, and exit codes

| flag          | effect                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| `--format`    | `tree` (default) or `dot`. Nothing else — a renderer is a pure function (§7). |
| `--providers` | include provider and controller nodes; refused unfiltered above the threshold |
| `--module`    | restrict to a module, its transitive imports and its own declarations         |
| `--token`     | restrict to one token, its dependencies and its dependents                    |
| `--depth`     | bound the transitive closure. Default 2                                       |

**`--json` and `--format` collide, and the resolution is that `--json` wins by being the same thing.** The global `--json` (§3) already promises exactly one JSON document on stdout, and that document
is `CliResult<GraphDescription>` — which _is_ the machine-readable form of this command, not a wrapper around a rendered string.

So `--format` takes only the two human-or-tool renderings, and `--json --format dot` exits 2 with a sentence saying they ask for opposite things, following §2's existing convention and its
`zmdb-codegen: --check and --watch ask for opposite things` precedent. Making `--format json` a third value would give the CLI two ways to ask for JSON that differ in whether the `CliResult` envelope
is present, which is the sort of divergence that gets discovered by a script.

Exit codes, under §2's three:

| code | when                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | described, with no `error`-severity finding — warnings included and printed                        |
| 1    | at least one `error` finding: a cycle, an unresolved token, a duplicate provider, a shadowed route |
| 2    | the module spec did not resolve, colliding flags, or `--providers` unfiltered above the threshold  |

A finding exits 1 for the reason §7 gives for `check`: the tree is not in the state it should be, and there is nothing wrong with the invocation.

And as there, it is **any** finding rather than a code per finding kind — §16 already rejects per-finding exit codes, and a graph description is where the temptation returns, because a cycle feels
more serious than a duplicated token description.

It is; that is what `severity` is for, and it is in the output rather than in the exit status. Warnings alone exit 0, so `zmdb modules` is usable as a CI gate without failing on a cosmetic finding.

This makes `zmdb modules` the second command after `check` that is worth running in CI, and the two do not overlap: `check` is about the schema tree, this is about the application graph. A shadowed
route or a cycle caught here is caught before a deploy rather than by a 404.

### R4. `zmdb repl` boots the real application

The session is built on **`createApp`**, not `createTestApp`. An earlier version of `docs-site/content/web-repl.md` proposed the opposite.

`createApp` already boots without a socket: it compiles the graph, registers routes and returns an object with `handle` and `fetch` (`@zmdb/web`'s `src/app/index.ts:26-40`). **An adapter binds a port;
the app does not.** So there is no listening socket to avoid, and nothing to strip. What the page reaches for `createTestApp` for is `request()`, and that is one function over `app.handle`, not a
reason to import a testing API.

Two reasons not to import it. `TestApp` exposes `request`, `get`, `init` and dispose — and **no `container`** (`@zmdb/web`'s `src/testing/index.ts`), which is the single object a REPL session is most
for. And `createTestApp` carries override semantics: a session built on it would be one option away from a graph that is not the application's, in a tool whose whole value is that it is the
application's.

The session calls `app.init()` before handing over the prompt, so `onModuleInit` and `onApplicationBootstrap` have run and a repository you resolve is usable rather than half-built.

That is what puts `yes` in the `Connects` column of §R0's table, and it is what the `exit` handler is for: the session is an `await using` scope, so leaving it runs `onShutdown` in reverse order.
`web-repl.md` is right that this is what stops the process hanging on an open pool, and it is better as a property of the command than as a snippet a reader must remember to copy.

`--json` is rejected for `repl` with exit 2. §3 promises one JSON document on stdout, and an interactive session's stdout is a conversation; there is no document to be. `--yes` and `--force` are
accepted and inert, as they are for every read-only verb.

### R5. Four barriers, and the TTY rule is the one that matters in production

DoD 6 of the epic asks that a REPL not be reachable from a running server, enforced rather than documented. Four independent things enforce it, and the design goal is that removing any one still
leaves the property true:

1. **No API starts a REPL.** `@zmdb/web` exports no such function, from any subpath, and `node:repl` appears nowhere under `packages/web/src`. The only entry point is this command.
2. **The entry is build-time only.** The command lives under `./src/cli/`, whose `./cli` export joins `BUILD_TIME_ENTRIES` in `.github/scripts/verify-exports.mjs` per §12 — the same gate that keeps
   the config loader and the compiler session out of an application bundle. A server bundle does not contain this code to reach.
3. **`zmdb repl` requires a TTY.** With `stdin` not a TTY it exits 2, naming the reason. This is §11's existing rule applied to a whole command rather than to a prompt, and it is the barrier that
   survives contact with reality: a process under systemd, in a container, or on Lambda has no TTY, so a REPL cannot be started inside it even by a shell escape that reaches the CLI. It also refuses
   the specific attack the rule exists for — piping a socket into stdin — because that is not a TTY either. The failure mode it prevents is a production process acquiring an interactive prompt on a
   stream somebody else controls.
4. **A gate.** `yarn verify:devtools-boundary` → `.github/scripts/verify-devtools-boundary.mjs`, which also asserts that neither `zmdb`'s `.` nor its `./web` re-exports the inspector (`@zmdb/web`'s
   `src/devtools/SPEC.md` §9). The facade enumerates every public symbol by habit (`packages/zmdb/src/web.ts:1-2`), so that file is where this rule breaks first, and a gate is the only thing that
   notices.

**There is no socket, no `--inspect`, no `--host` and no `--port`.** §14.3's argument for `studio` applies here in a stronger form: for the studio, the loopback bind _is_ the security boundary; for
the REPL there is no bind at all, so the boundary is satisfied vacuously.

A remote-attach protocol — which is how NestJS's REPL and every language's debug server get reached — is the one design that would make barrier 3 pointless, because a TTY on the operator's machine
plus a socket into the server is exactly the thing being refused.

### R6. The banner, the scope, and where history goes

The banner prints on stderr: the resolved config path, the root module, the available scope and the history location. The original freeze also required the application's dialect and database name.

Measuring the two real boundaries makes that claim impossible: `ZmdbConfig` has a dialect but no database-name field, §7 says the application does not read that config, and `Driver` exposes `dialect?`
plus `execute()` but no connection identity.

Invoking the config's separate driver thunk would open the wrong object graph, while scanning resolved provider values for a URL would execute factories and risk printing credentials.

The banner therefore prints `dialect: application-owned` and `database: application-owned`, with those reasons, rather than inventing assurance it cannot have. The root module and config path still
make the session's code boundary explicit; the application must put a safe database identity in its own provider or startup output if it wants one. There is no `--quiet`: the boundary statement and
scope inventory are part of starting an interactive shell against real data.

Scope exposed at the prompt:

| name                      | is                                                             |
| ------------------------- | -------------------------------------------------------------- |
| `app`                     | the `App` from `createApp`                                     |
| `container`               | `app.container`                                                |
| `get(tokenOrDescription)` | `container.resolve`, also accepting a token's description text |
| `tokens`                  | the token descriptions in the graph, from the description      |
| `describe()`              | `describeGraph` over the root module, pretty-printed           |
| `request(req)`            | `app.handle`, with a string shorthand for `GET`                |
| `load(name)`              | `load()` on a lazy module handle, by name                      |

`get` accepts a description string because the alternative is asking a user to import the token module by hand before they can resolve anything, and `web-repl.md` is right that discovering the tokens
is the only real design question. It is answered by `tokens` and by the description accepting text — and the ambiguity that creates is the reason `duplicate-token-description` is a finding: two tokens
with one description make `get('db')` undecidable, and the session says so rather than picking.

There is no `$()`. NestJS's `$(Controller)` is a class-keyed lookup, which is meaningful there because its container is keyed by class; here the container is keyed by `Token` (`@zmdb/app`'s
`src/di/index.ts`), and a class-keyed helper would have to be a second index over the graph description that resolves nothing the container knows about.

History goes to `~/.zmdb_repl_history`, mode `0600`, matching `node:repl`'s own `~/.node_repl_history` convention so the location is already where a user's tooling ignores it. `ZMDB_REPL_HISTORY`
relocates it; a relative value resolves under the home directory, never the cwd. `--no-history` disables it, and an explicit path inside the nearest package tree is refused.

That is the whole reason the path is frozen rather than left to the implementation: a history file in the working directory gets committed, gets copied into a Docker image, and contains whatever was
typed against production — which is the one artifact of this feature with a real chance of leaking a credential. `0600` because it is a transcript of statements, and a transcript is as sensitive as
the statements.

### R7. What #600 has to assert

1. `zmdb modules` on the scaffold fixture exits 0 and its stdout parses as one JSON document under `--json`, whose `result` deep-equals `describeGraph` of the same root module.
2. `zmdb modules` on a fixture with a cycle exits **1**, prints the cycle path, and still emits a complete description — the assertion that the inspector describes a graph that does not boot.
3. A fixture with a shadowed route and one with a duplicate provider each exit 1; a fixture whose only finding is a duplicate token description exits **0** and prints the warning.
4. `--json --format dot` exits 2 and says the flags ask for opposite things; an unresolvable module spec exits 2 naming the path and the export.
5. `--providers` with no filter on a fixture above the threshold exits 2 and lists the module names to filter by; with `--module` it exits 0.
6. `zmdb repl` with `stdin` not a TTY exits 2, asserted by spawning it with a piped stdin — the §R5 barrier asserted as a barrier, not as documentation.
7. `zmdb repl --json` exits 2.
8. The REPL's scope, tested against the session's evaluate function rather than a spawned process: `get` resolves by token and by description, `tokens` lists the descriptions, `request('/users')`
   returns the eager route's response, and `load(name)` loads a lazy module.
9. `get('db')` where two tokens share that description reports the ambiguity rather than resolving one of them.
10. The session banner names the config path and root module, inventories the scope, and states explicitly that dialect and database identity are application-owned rather than guessed.
11. History is written to the `ZMDB_REPL_HISTORY` path with mode `0600` and no file appears in the fixture's working directory; `--no-history` writes nothing at all.
12. `await using` semantics: leaving the session runs `onShutdown` on the fixture's provider, in reverse order.
13. `yarn verify:devtools-boundary` fails on a planted re-export of the inspector from `packages/zmdb/src/web.ts`, and passes on the tree as committed.
14. `mapping.mjs` deletes `NO_REPL`, rewrites `lazy-modules/e2e/*`, and moves the inspector, lazy-module and REPL rows from out-of-scope to covered with titles matching real `it()` text;
    `yarn verify:api-coverage` checks every title.

### Non-goals (rejected in this amendment)

- **`zmdb graph`** (§R1) — in a schema tool the name already means the table graph.
- **`--format json`, or any JSON that is not the global `--json`'s one document** (§R3).
- **Per-finding exit codes for `modules`** (§R3) — §16 already rejects them for `check`, and `severity` is in the output.
- **An `app` or `rootModule` field in `zmdb.config.ts`** (§R2) — §7 of this file says the application does not read that file, and this would make the file describe the application.
- **Inferring the root module in a workspace root** (§R2) — §13.2's reasoning, where a wrong guess produces output that looks right.
- **Building the session on `createTestApp`** (§R4) — no `container`, and override semantics in a tool whose value is that the graph is the application's.
- **A REPL socket, a remote attach, `--inspect`, `--host` or `--port`** (§R5) — §14.3's argument in its strongest form, since there is no bind to secure.
- **A REPL without a TTY, behind a flag** (§R5, §11) — the flag would be the whole vulnerability.
- **`--quiet` for the banner** (§R6).
- **A history file in the project directory, or history on by default without a mode** (§R6) — it gets committed and it gets baked into an image.
- **`$(Controller)`** (§R6) — the container is keyed by `Token`, not by class.
- **Any write verb inside the REPL beyond what the application's own providers expose** — the session is the application, and a CLI-level `--write` flag would be a second permission model on top of
  §10's.

## Amendment: generated HTTP client command (#679)

```text
zmdb client generate [--check] [--watch]
```

The command loads `http.contracts`, `http.openApi.out`, and `http.client.out`, opens the configured project once, compiles `HttpContractIR`, and renders one OpenAPI document plus one generated
TypeScript module. It neither boots the web application nor parses OpenAPI; generated relative imports use `.js`.

- The command requires `http.openApi.out` and `http.client.out`. One contract-module load and one `compileHttpContracts` call feed both `toOpenApi(compiled.ir)` and `generateHttpClient(compiled.ir)`.
- OpenAPI is written as deterministic, repository-formatter-clean JSON with one trailing newline. The client output is the generated TypeScript source; neither artifact contains a source or workspace
  path.
- Before materialising either artifact, the command compares the exact operation-ID list in OpenAPI with the generated client's operation metadata. A mismatch is an exit-1 generation failure and
  writes nothing.
- Normal mode atomically replaces only files whose bytes differ. A byte-identical run preserves both mtimes.
- `--check` writes nothing; current bytes exit 0 and any missing/stale artifact exits 1, naming each affected output.
- `--watch` retains one reflection session and regenerates only when a contract module or a transitive project source used by that contract changes. An unrelated project file does not trigger a
  generation.
- `--check --watch` and `--json --watch` exit 2.
- Missing HTTP config or invalid flags exit 2; contract/reflection diagnostics exit 1.

Finite `--json` output is `{ out: { openApi, client }, operations, changed, contractFormat, generatorVersion }` inside §3's `CliResult`, and its `command` is `"client generate"`. `changed` means at
least one output was missing or byte-different before the command. There is no base-URL, credential, authentication, timeout, retry, or framework flag. Both generated files are committed and CI runs
`zmdb client generate --check`.

## Amendment: package owner and lazy command graph (#626)

This CLI contract moves to [`../../../cli/SPEC.md`](../../../cli/SPEC.md). `@zmdb/cli` owns `runCli`, argument parsing, output, prompts, scaffolding and the one `zmdb` binary. The facade's own bin and
implementation are deleted, while `zmdb/cli` remains the stable identity product entry.

Database verbs delegate to `@zmdb/migrations`; `codegen` delegates to `@zmdb/compiler`. `new`, `modules`, `repl`, `studio` and `client generate` are selected through literal lazy loaders, so help and
database/compiler commands do not import web, application loaders, REPL, Studio or optional client-generation code. A missing optional command dependency is an exit-2 diagnostic naming the command and
package.

No command implementation is registered by import side effect, and no compatibility route invokes `zmdb-codegen`.
