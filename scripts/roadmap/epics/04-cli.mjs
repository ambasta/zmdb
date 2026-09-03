// The command line. Everything the migration engine can do is a library call today; these two epics
// give it an executable, a config file, scaffolding, and a data browser.

export const CLI_EPICS = [
  {
    key: 'cli',
    title: '[EPIC] The zmdb executable — config, generate, migrate, push, check, up, export, pull',
    labels: ['enhancement', 'area:cli', 'parity:drizzle', 'parity:mikro-orm'],
    pages: [
      'cli-overview',
      'config-file',
      'cli-generate',
      'cli-migrate',
      'cli-push',
      'cli-check',
      'cli-up',
      'cli-export',
      'cli-pull',
    ],
    packages: ['@zmdb/query-compiler', '@zmdb/aot-validator', 'zmdb'],
    motivation: `
The migration engine is complete and unreachable. \`snapshot\`, \`diff\`, \`ddlType\`, \`emitUp\`,
\`emitDown\` and the runner all exist and are tested, and using any of them means writing a script that
imports them, resolves the schema set by hand, and wires a driver. Nine docs pages describe commands
that do not exist — the CLI overview page says it plainly: "there is no zmdb executable; the snapshot /
diff / DDL engine is a library API you call from a script".

The one binary that does exist is \`zmdb-codegen\` (in \`@zmdb/aot-validator\`), which covers the AOT
transform for projects that cannot use a build plugin. So the packaging question is already half
answered, and the gap is a \`zmdb\` command with subcommands plus the thing every one of them needs
first: a \`zmdb.config.ts\` loader.

That loader is the keystone. It is what lets a command find the schema declarations, the driver, the
migrations directory and the naming strategy without nine flags — and the naming-strategy epic already
depends on it, because a build-time naming strategy has to be configured somewhere.

None of this is new engine work, which is what makes it high-value: it is the difference between a
library with a migration engine and a tool someone can use on a Tuesday.
`,
    dod: [
      '`zmdb.config.ts` is loaded, type-checked against a published type, validated, and resolved relative to the config file rather than the cwd.',
      'A `zmdb` executable with `generate`, `migrate`, `push`, `check`, `up`, `export` and `pull`, each a thin wrapper over the existing library call with no duplicated logic.',
      'Every command has `--help`, a non-zero exit on failure, machine-readable output behind `--json`, and no interactive prompt in a non-TTY.',
      '`push` and `migrate` refuse to run destructive DDL without an explicit confirmation flag, and say exactly what they would drop.',
      'The CLI is tested end to end against a real sqlite database in a temporary directory, not by unit-testing the argument parser.',
      'All nine pages flip to supported, with real transcripts of the commands.',
    ],
    invariants: [
      '§2.6 no over-abstraction: a command is argument parsing plus one library call. Business logic that appears in a command is logic the library is missing, and it belongs in the library.',
      '§2.4 explicit SQL: `export` and `generate` print the DDL the engine produces, unmodified. The CLI does not rewrite SQL.',
      'A destructive operation is never implicit. This is not an architecture invariant, it is the difference between a tool people trust and one they wrap in a script that always passes `--force`.',
      'The config file is TypeScript, so loading it means running TypeScript. Whatever mechanism does that must be documented and must not require the user to configure a second toolchain.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the config file and the command surface',
        labels: ['spec'],
        goal: `
Freeze the config schema, how it is discovered and loaded, and the full command surface: every
subcommand's flags, exit codes, output format and safety behaviour. No code.
`,
        why: `
A CLI's surface is the hardest thing in this roadmap to change later, because it ends up in people's
scripts and CI pipelines. A flag renamed after release breaks builds silently. So the whole surface
gets decided at once, including the boring parts — exit codes and \`--json\` shape — because those are
what automation depends on and what nobody thinks about until they are wrong.

The loading mechanism needs the same care. A TypeScript config file has to be executed, and the options
(a bundler, Node's own type stripping, a compile-to-temp step) differ in what they support: Node 26
strips types natively but does not resolve path aliases or \`.ts\` extensionless imports the way a
bundler does. Deciding this in the spec avoids a loader that works in this repo and not in a consumer's.
`,
        files: [
          '`packages/zmdb/src/cli/SPEC.md` (new) — the command surface.',
          '`packages/zmdb/src/config/SPEC.md` (new) — the config schema and resolution.',
        ],
        api: `
export interface ZmdbConfig {
  /** Globs, resolved relative to the config file. */
  readonly schema: string | readonly string[];
  readonly dialect: Dialect;
  /** Where migration files and the snapshot live. */
  readonly out?: string;
  readonly driver?: () => Driver | Promise<Driver>;
  readonly naming?: NamingStrategy | 'snake_case' | 'snake_case_plural';
  readonly migrations?: {
    readonly table?: string;      // the ledger table name
    readonly schema?: string;
  };
  readonly introspect?: IntrospectOptions;
}
export declare function defineConfig(config: ZmdbConfig): ZmdbConfig;
`,
        steps: [
          "Specify discovery: `zmdb.config.ts`, then `.js`/`.mjs`, walking up from the cwd, overridable with `--config`. State that every relative path in the config resolves against the config file's directory — the single most common source of confusion in tools like this.",
          'Decide the loading mechanism and write down what it costs. Node 26 native type stripping is the cheapest and cannot resolve tsconfig path aliases; a bundler-based load handles more and adds a dependency. Pick one, and specify the error message when a config fails to load — it must include the underlying error, not "failed to load config".',
          "Specify validation of the loaded object using the project's own validator, and say that this is deliberate dogfooding: the config is external data at a boundary.",
          'Specify each command: flags, what it reads, what it writes, exit codes, `--json` shape. Write the shapes out, because they are an API.',
          '`generate`: read declarations, snapshot, diff against the stored snapshot, write a migration file plus the new snapshot. Specify the file naming (timestamp prefix, stable and sortable) and what happens when there is nothing to generate (exit 0 with a message, not an empty file).',
          '`migrate`: apply pending migrations through the runner, in order, recording each in the ledger. Specify the ledger table, the transaction boundary per migration, and what happens when one fails halfway (stop, report, leave the ledger honest).',
          '`push`: apply the diff directly with no migration file. Specify that it is for development, that it refuses destructive ops without `--force`, and that it prints what it will do first.',
          '`check`: detect conflicts — a snapshot that does not match its migration history, two migrations generated from the same parent (the branch-merge case), drift if the introspection epic has landed. Specify each finding and its exit code.',
          '`up`: upgrade a stored snapshot to the current format. Specify that it is idempotent and that it never changes the schema, only the file format.',
          '`export`: print the full DDL for the schema set. Specify ordering (the phase list the extension/routine epics established) and that it writes to stdout so it composes with a pipe.',
          '`pull`: introspect a live database and write declarations. Specify that it depends on the introspection epic and that it never overwrites a hand-written file — only files carrying the generated header.',
          'Specify the destructive-operation policy once, for every command: what counts as destructive (drop table, drop column, narrow a type), how it is reported, and the flag that permits it.',
          'Specify TTY behaviour: no prompts when stdin is not a TTY, and `--yes` for scripted use.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Config schema, discovery, path resolution and the loading mechanism decided with trade-offs recorded.',
          'All nine commands specified with flags, exit codes and `--json` shapes.',
          'Destructive-operation and TTY policies written once and applied to every command.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] the CLI — end-to-end in a temporary directory',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests that run the real executable in a temporary project against a real sqlite database, asserting files written, SQL applied, exit codes and output — plus config-loading tests including the failure messages.',
        why: 'Unit-testing an argument parser proves the parser works. What breaks in CLIs is path resolution, file writing, exit codes and the interaction between commands — so the tests have to run the commands, in order, in a directory, and look at what happened. The repo already runs real `node:sqlite` E2E tests, so the machinery exists.',
        files: [
          '`packages/zmdb/src/cli/cli.e2e.spec.ts` (new)',
          '`packages/zmdb/src/config/config.spec.ts` (new)',
          '`packages/zmdb/src/cli/__fixtures__/project/` — a minimal consumer project.',
        ],
        tests: [
          '`loads a config file and resolves its paths against the config directory` — run from a different cwd, which is the case that catches a cwd-relative bug.',
          '`reports a config that fails to load, including the underlying error`.',
          '`rejects a config whose shape is wrong, naming the field`.',
          '`walks up to find a config file` and `honours --config`.',
          '`generates a migration and a snapshot from declarations` — assert both files exist and the SQL inside.',
          '`generates nothing and exits zero when the schema has not changed`.',
          '`applies migrations to a real sqlite database and records them in the ledger` — then asserts a second run applies nothing.',
          '`stops and reports when a migration fails, leaving the ledger honest` — a deliberately broken migration; assert the ledger does not claim it applied.',
          '`refuses a destructive push without --force, printing what it would drop`.',
          '`applies a destructive push with --force`.',
          '`detects a snapshot that does not match its migration history` — the `check` case.',
          '`detects two migrations generated from the same parent`.',
          '`upgrades a stored snapshot format idempotently`.',
          '`prints the full DDL to stdout in phase order`.',
          '`writes declarations from a live database and refuses to overwrite a hand-written file` — the `pull` safety case.',
          '`emits machine-readable output under --json for every command` — one test per command asserting the shape parses and has the specified keys.',
          '`exits non-zero on failure for every command`.',
          '`does not prompt when stdin is not a TTY`.',
        ],
        steps: [
          'Build a fixture project with declarations, a config file and a sqlite driver, and copy it into a temp directory per test so tests do not share state.',
          'Run the built executable as a child process rather than importing its main function — the exit code and stdout/stderr split are part of the contract and can only be observed that way.',
          'Assert on the ledger table contents directly with `node:sqlite`, not on the command output, for anything about what was applied.',
          'Add the `--json` shape assertions as a table over commands, so a new command without `--json` fails the suite.',
        ],
        dod: [
          'Every command has an end-to-end test running the real binary in a temp directory.',
          'Ledger honesty on failure, destructive refusal and `pull` overwrite safety all tested.',
          '`--json` and exit codes tested per command by a table-driven test.',
        ],
      },
      {
        key: 'config',
        title: 'The zmdb.config.ts loader',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship config discovery, loading, validation and path resolution as a library function every command and the AOT transformer can call.',
        why: "This is the keystone: nine commands and the naming-strategy epic all need it, and it is the piece most likely to be reimplemented three times if it is not built first. It is also where a bad error message costs the most — a user's first interaction with zmdb's CLI is often a config that does not load.",
        files: [
          '`packages/zmdb/src/config/index.ts` (new) — `defineConfig`, `loadConfig`, `resolveConfig`.',
          '`packages/zmdb/package.json` — a `./config` subpath.',
        ],
        api: `
export declare function defineConfig(config: ZmdbConfig): ZmdbConfig;
export declare function loadConfig(opts?: { readonly cwd?: string; readonly path?: string }): Promise<ResolvedConfig>;
export interface ResolvedConfig extends ZmdbConfig {
  /** Absolute, resolved against the config file. */
  readonly configPath: string;
  readonly schemaFiles: readonly string[];
  readonly outDir: string;
}
`,
        steps: [
          'Implement discovery walking up from the cwd, stopping at a filesystem root or a `package.json` boundary — and document which, because a monorepo makes the difference visible.',
          'Load with the mechanism the spec chose, and wrap any failure in an error that includes the underlying message and the resolved path. Do not swallow the cause.',
          'Validate the loaded object with the project validator and report the offending field. This is the dogfooding case: if the error message is bad here, it is bad for every user of the validator.',
          "Resolve every path against the config file's directory, and expand schema globs eagerly so a command gets a concrete file list.",
          'Export from a `./config` subpath so the AOT transformer can read a config without depending on the CLI, and add it to the export inventory.',
          'Cache within a process but not across, and make the cache key the resolved config path — a monorepo build may load two.',
        ],
        tests: [
          'All config tests go green.',
          '`resolves paths against the config directory when run from elsewhere`.',
          '`includes the underlying error when a config throws`.',
          '`loads two different configs in one process without cross-talk`.',
        ],
        dod: [
          'Discovery, loading, validation and resolution shipped behind `./config`.',
          'Errors include their cause and the resolved path.',
          '`yarn verify:exports` green.',
        ],
      },
      {
        key: 'core',
        title: 'The executable, plus generate and export',
        labels: ['enhancement'],
        blockedBy: ['config'],
        goal: 'Ship the `zmdb` binary with argument parsing, `--help`, `--json`, exit codes, and the two read-mostly commands: `generate` and `export`.',
        why: 'Starting with the two commands that do not touch a database gets the whole scaffolding — parser, help, output, error handling — proven before any command can damage anything.',
        files: [
          '`packages/zmdb/src/cli/index.ts` (new) — the entry and dispatch.',
          '`packages/zmdb/src/cli/commands/generate.ts`, `export.ts` (new)',
          '`packages/zmdb/package.json` — the `bin` entry.',
        ],
        steps: [
          "Use Node's own `util.parseArgs` rather than adding a CLI framework — the surface is nine commands with a handful of flags each, and §2.6 applies to dependencies as much as to code.",
          'Add the `bin` entry alongside the existing `zmdb-codegen`, and check `yarn verify:publish`, which inspects what the packages actually ship.',
          'Implement `--help` per command from a single source of truth so help and parsing cannot disagree.',
          'Route all output through one writer that knows about `--json`, so no command prints an ad-hoc line that breaks machine consumption.',
          'Implement `generate` as: load config → read declarations → snapshot → diff against the stored snapshot → write migration + snapshot. Every step is an existing library call; if any step needs new logic, that logic belongs in the library, not here.',
          'Name migration files with a sortable timestamp and a slug, and write the file atomically (temp file plus rename) so an interrupted run does not leave a half-written migration.',
          'Implement `export` writing to stdout in the phase order the emitter defines, so it pipes into `psql`.',
          'Make error output go to stderr and never to stdout, so `--json` output stays parseable when something fails.',
        ],
        tests: [
          'The generate, export, help, `--json` and exit-code tests go green.',
          '`writes a migration file atomically` — assert no partial file remains when the write is interrupted (inject a failure).',
          '`keeps stdout parseable under --json when the command fails`.',
        ],
        dod: [
          'Binary shipped and published-checked; `--help`, `--json` and exit codes uniform.',
          '`generate` and `export` are thin wrappers with no logic of their own.',
          'Atomic file writes; stderr/stdout separation.',
        ],
      },
      {
        key: 'migrate',
        title: 'migrate, push, check and up',
        labels: ['enhancement'],
        blockedBy: ['core'],
        goal: 'Ship the four commands that touch a database or the snapshot history, with the ledger, the transaction boundaries and the destructive-operation guard the spec fixed.',
        why: 'These are the commands that can lose data, so they come after the scaffolding is proven and they get the strictest tests. The ledger honesty property — that a failed migration is not recorded as applied — is the one that determines whether the tool is recoverable after a bad deploy.',
        files: [
          '`packages/zmdb/src/cli/commands/migrate.ts`, `push.ts`, `check.ts`, `up.ts` (new)',
          '`packages/query-compiler/src/migrations/runner.ts` — anything the runner is missing for the ledger.',
        ],
        steps: [
          'Implement the ledger through the runner, not in the command. If the runner does not own the ledger today, moving it there is part of this slice — a ledger implemented in the CLI is invisible to library users and will diverge.',
          'Wrap each migration in a transaction where the dialect supports transactional DDL (Postgres does; MySQL does not, and SQLite mostly does). Where it does not, say so in the output before running, because a half-applied migration on MySQL is a manual repair and the operator should know that in advance.',
          'Record each applied migration with its checksum, and refuse to run if a previously applied migration file has changed — a silently edited migration is a schema that no longer matches its history.',
          'Implement the destructive guard: classify each op, print the destructive ones, and refuse without `--force`. Print the actual SQL, not a summary.',
          'Implement `check` with the specified findings and distinct exit codes so CI can distinguish "drifted" from "broken history".',
          'Implement `up` as a pure snapshot-format transformation, idempotent, with a backup of the previous file.',
          'Make every one of these commands print what it is about to do before doing it, including `migrate`. A tool that applies DDL silently is one people run once.',
        ],
        tests: [
          'All migrate/push/check/up tests go green.',
          '`refuses to run when a previously applied migration file has changed` — checksum enforcement.',
          '`warns before running on a dialect without transactional DDL`.',
          '`leaves the ledger honest when a migration fails`.',
          '`distinguishes check findings by exit code`.',
        ],
        dod: [
          'Ledger owned by the runner with checksum enforcement; per-migration transactions where supported and a warning where not.',
          'Destructive ops printed as SQL and gated behind `--force`.',
          '`check` exit codes distinct; `up` idempotent with a backup.',
        ],
      },
      {
        key: 'pull',
        title: 'pull — write declarations from a live database',
        labels: ['enhancement'],
        blockedBy: ['core', 'introspect:emit'],
        goal: 'Wrap the introspection library in a command that writes declaration files safely, never overwriting anything a human wrote.',
        blockedByNote: 'Needs the introspection engine and the declaration emitter.',
        files: ['`packages/zmdb/src/cli/commands/pull.ts` (new)'],
        steps: [
          'Load config, connect the configured driver, introspect, emit declarations, write files.',
          'Refuse to overwrite a file that does not carry the generated header, and list what it skipped. This is the safety property that makes the command runnable more than once.',
          'Print the warnings from the emitter prominently — an unrepresentable column that scrolls past is a column someone will discover in production.',
          'Support `--dry-run` printing what would be written, because the first thing anyone does with this command is check it before trusting it.',
          'Include the drift check as a flag (`--check`) that exits non-zero on drift, so the same command works in CI.',
        ],
        tests: [
          '`writes declarations from a live database and refuses to overwrite a hand-written file`.',
          '`prints emitter warnings`.',
          '`--dry-run writes nothing`.',
          '`--check exits non-zero on drift`.',
        ],
        dod: ['Command shipped with overwrite safety, prominent warnings, `--dry-run` and a CI-usable `--check`.'],
      },
      {
        key: 'docs',
        title: '[Docs] the CLI — nine pages with real transcripts',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['config', 'core', 'migrate', 'pull'],
        goal: 'Flip all nine pages to supported, each with a real transcript of the command against a real project, plus the config reference.',
        files: [
          '`docs-site/pages.mjs` and the nine content files.',
          '`docs-site/content/migrations.md` — it currently describes the library path; it should lead with the CLI.',
          '`README.md` — the quick start can now show `npx zmdb generate`.',
        ],
        steps: [
          'Write the config-file page as a complete reference: every field, its default, and what paths it resolves against.',
          'For each command page, paste a real transcript — the actual output, including the destructive-operation warning where relevant. Invented output in CLI docs is how docs drift.',
          'Document the exit codes and `--json` shapes, because that is what people automate against.',
          'Document the operational realities: non-transactional DDL on MySQL, checksum enforcement, what `check` findings mean.',
          'Update the migrations page and the README quick start to lead with the CLI.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Nine pages supported with real transcripts; config reference complete; exit codes and `--json` documented; migrations page and README updated.',
        ],
      },
    ],
  },

  {
    key: 'scaffold',
    title: '[EPIC] Scaffolding, CLI applications and the data browser',
    labels: ['enhancement', 'area:cli', 'area:web', 'parity:nestjs'],
    pages: ['web-cli', 'web-cli-monorepo', 'web-cli-apps', 'cli-studio'],
    packages: ['zmdb', '@zmdb/web'],
    motivation: `
Three of these pages are about starting: there is no way to create a zmdb project, a controller, a
module or a monorepo layout, so the first hour with the framework is spent copying from the docs. The
\`web-cli-monorepo\` page's note is simply "depends on the CLI, which is not built".

The fourth is different in kind. \`web-cli-apps\` is about building a *CLI application* with zmdb —
command decorators and an argv parser bound to the compile-time container, so a batch job gets the same
DI, validation and typed repositories a controller gets. That is a genuinely good fit for this
framework: a command's arguments are a DTO, so they can be validated by the same emitted validator, and
the container is resolved at compile time so a CLI process has no startup reflection cost. It is the
same value proposition as the web layer, applied to the other half of most real systems.

And \`cli-studio\` — a data browser — is the one feature here that is a product rather than plumbing.
It is worth doing last and worth scoping tightly: read-only browsing of tables that zmdb already knows
about, served locally, with no new query surface. The failure mode is obvious and worth naming up front:
a studio that grows an editing UI becomes an admin panel with database credentials, and that is a
different project with different security requirements.
`,
    dod: [
      "`zmdb new`, `zmdb generate controller|module|repository` (or the equivalent) produce files that compile and pass the repo's own lint and format gates.",
      'Scaffolding understands a monorepo: it finds the right package, uses its tsconfig, and does not write into the wrong workspace.',
      'A command decorator plus argv parsing binds a CLI application to the compile-time container, with arguments validated as a DTO and no `reflect-metadata`.',
      'A read-only `zmdb studio` browses tables and rows locally, with pagination, and refuses to bind to a non-loopback interface without an explicit flag.',
      'All four pages flip to supported.',
    ],
    invariants: [
      "§2.2 no runtime reflection: a command decorator must resolve its container at compile time exactly as controllers do. If the web package's DI cannot be reused here, that is a signal to fix the DI, not to add a runtime container for CLIs.",
      '§2.3 validation at the boundary: argv is untrusted input. Command arguments are validated by an emitted validator, not parsed ad hoc.',
      'Generated code is code we are recommending: it must pass `yarn lint`, `yarn fmt:check` and typecheck as generated, with no post-editing required.',
      'The studio is read-only, loopback by default. Scope discipline here is a security property, not a preference.',
    ],
    nonGoals: [
      'Editing data in the studio.',
      'A plugin system for custom scaffolds.',
      "Scaffolding for frameworks other than zmdb's own web layer.",
    ],
    subs: [
      {
        key: 'spec',
        title: "[Spec Freeze] scaffold templates, the command-application surface, and the studio's boundaries",
        labels: ['spec'],
        goal: "Freeze what each scaffold generates, how monorepo detection works, the command-decorator surface and its container binding, and the studio's scope and security posture. No code.",
        why: 'Scaffolds are opinionated by nature, and the opinion should be written down rather than embedded in a template nobody dares change. The studio needs its boundaries fixed before any code exists, because every subsequent feature request will push on them — and "read-only, loopback" is much easier to hold as a written decision than as an implementation detail.',
        files: [
          '`packages/zmdb/src/cli/SPEC.md` — the scaffold and command sections.',
          '`packages/web/src/cli/SPEC.md` (new) — command applications.',
        ],
        api: `
@Command({ name: 'import-users', description: 'Load users from a CSV' })
class ImportUsers {
  constructor(private readonly users: UserRepository) {}
  async run(@Args() args: ImportArgs): Promise<number> { /* … */ }
}

interface ImportArgs {
  readonly file: string & MinLength<1>;
  readonly dryRun?: boolean;
}

export declare function createCommandApp(rootModule: unknown): CommandApp;
`,
        steps: [
          "Specify each scaffold's output file by file, including the test file it generates — a scaffold that produces code with no test teaches the wrong habit in a repo built on spec-then-tests.",
          'Specify monorepo detection: workspace globs from the root `package.json` (or `pnpm-workspace.yaml`), and the rule for choosing a target package when the cwd is ambiguous. Prefer requiring an explicit `--package` over guessing.',
          'Specify the command surface: `@Command`, `@Args`, how a subcommand is named, how `--help` is generated from the args type, and how the exit code is derived from the return value.',
          'Specify argv-to-DTO mapping precisely, because this is where it gets fiddly: `--dry-run` to `dryRun`, repeated flags to arrays, `--no-x` to `false`, positional arguments, and `--` passthrough. Each of these has a conventional meaning and getting one wrong makes the CLI feel broken.',
          "Specify container binding: a command application uses the same compile-time DI as `createApp`, so a command can inject a repository. Confirm against the web package's existing DI whether that is already possible, and record what has to change if not.",
          "Specify the studio: read-only, loopback-only by default, which tables it shows (those in the config's schema set), pagination, and the explicit refusal to show a table it does not have a declaration for. Specify that it never accepts a SQL string from the browser.",
          "Specify the studio's auth posture: none, because it is loopback and single-user — and therefore the non-loopback flag must require something more, or be refused outright. Decide, and write the reasoning.",
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          "Every scaffold's output specified file by file, including tests.",
          'Monorepo targeting rule decided (explicit over inferred).',
          'Command surface, argv-to-DTO conventions and container binding specified.',
          'Studio scope and security posture frozen, including the non-loopback decision.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] scaffolding, command applications and the studio',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: "Land failing tests: generated output that must compile and pass the repo gates, argv-to-DTO mapping across every convention, container injection in a command, and the studio's read-only and loopback guarantees.",
        files: [
          '`packages/zmdb/src/cli/scaffold.e2e.spec.ts` (new)',
          '`packages/web/src/cli/command.spec.ts` (new)',
          '`packages/zmdb/src/cli/studio.spec.ts` (new)',
        ],
        tests: [
          '`generates a project that typechecks, lints and formats clean` — run the real gates on the generated directory, which is the only assertion that matters for a scaffold.',
          '`generates a controller with a test file`.',
          '`writes into the package named by --package in a monorepo` and `refuses to guess when the package is ambiguous`.',
          '`maps every argv convention onto the args DTO` — table-driven over `--kebab-case`, `--no-flag`, repeated flags, positionals and `--`.',
          '`validates command arguments with the emitted validator and reports a usage error` — a missing required argument produces a usage message and a non-zero exit, not a stack trace.',
          '`injects a repository into a command through the compile-time container`.',
          '`derives --help from the args type`.',
          "`returns the command's exit code from its return value`.",
          '`serves table rows read-only and rejects any write verb` — POST/PUT/PATCH/DELETE all refused.',
          '`refuses a SQL string supplied by the client`.',
          '`binds to loopback by default and refuses a non-loopback bind without the flag`.',
          '`shows only tables in the configured schema set`.',
        ],
        steps: [
          "Make the scaffold test run the actual repo gates (`node scripts/typecheck.mjs`-equivalent, `oxlint`, `oxfmt --check`) against the generated directory. Anything weaker will let a scaffold ship code that the project's own standards reject.",
          'Write the argv convention table exhaustively — it is cheap and it is the part users notice.',
          'Write the studio security tests as tests, not as review notes: read-only and loopback-by-default are the two properties that keep this feature from being a liability.',
        ],
        dod: [
          'Scaffold output tested against the real gates; argv conventions table-driven; studio read-only and loopback properties tested.',
        ],
      },
      {
        key: 'generators',
        title: 'Project, controller, module and repository scaffolds, monorepo-aware',
        labels: ['enhancement'],
        blockedBy: ['tests', 'cli:core'],
        goal: "Ship the scaffolds, producing code that passes this repo's own gates, with explicit monorepo targeting.",
        files: [
          '`packages/zmdb/src/cli/commands/new.ts`, `scaffold.ts` (new)',
          '`packages/zmdb/src/cli/templates/` (new)',
        ],
        steps: [
          'Write templates as plain functions returning source strings, not as a template language. There are a handful of them and a template engine is a dependency plus a syntax to learn (§2.6).',
          'Format every generated file with the repo formatter before writing, so generated code cannot fail `fmt:check`.',
          'Generate a test file alongside every scaffold that produces logic, with a real (if trivial) assertion — a `it.todo` teaches nothing.',
          'Require `--package` in a workspace when the cwd is not inside exactly one package, and print the candidates when refusing.',
          'Never overwrite an existing file; refuse and name it.',
          'Generate a config file in `zmdb new`, using `defineConfig`, and a working sqlite setup so the new project runs immediately.',
        ],
        tests: [
          'All scaffold tests go green, including the gate run on generated output.',
          '`refuses to overwrite an existing file, naming it`.',
          '`generates a project that runs its own tests successfully` — the strongest possible scaffold assertion.',
        ],
        dod: [
          'Scaffolds ship, output passes typecheck/lint/format, tests are generated with real assertions.',
          'Monorepo targeting explicit; no file ever overwritten.',
        ],
      },
      {
        key: 'command-apps',
        title: 'Command applications: decorators, argv parsing and container binding',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship `@Command`/`@Args` and `createCommandApp`, binding a CLI to the compile-time container with argv validated as a DTO.',
        why: "This is the slice with real architectural leverage: it extends the web package's compile-time DI and boundary validation to the other half of a typical system, at no runtime cost, and it is the piece a batch job or a cron worker actually needs.",
        files: [
          '`packages/web/src/cli/index.ts` (new) — decorators, argv parsing, `createCommandApp`.',
          '`packages/web/src/app/index.ts` — reuse the existing bootstrap; do not fork it.',
        ],
        steps: [
          'Implement the decorators as stage-3 decorators with no `reflect-metadata`, exactly as the controller decorators do. Reuse their registration mechanism rather than adding a second registry.',
          'Reuse `createApp`\'s module resolution and DI so a command and a controller can share a provider. If that requires refactoring the bootstrap to separate "resolve the graph" from "serve HTTP", do that refactor — it is the right shape anyway.',
          'Parse argv into the args DTO per the specified conventions, then validate with the emitted validator. On a validation failure, print a usage message derived from the args type and exit with the conventional usage exit code, not a stack trace.',
          'Derive `--help` from the args type and the decorator metadata, so help cannot drift from the parser.',
          'Map the return value to an exit code, and map an uncaught error to a non-zero exit with a readable message. A CLI that exits 0 after failing is worse than one that crashes.',
          "Run lifecycle hooks (the app's `onInit`/`onShutdown`) around a command, so a command gets the same setup and teardown a server does — including closing the driver, or the process hangs.",
        ],
        tests: [
          'All command tests go green.',
          '`closes the driver after a command completes` — the hang bug, tested.',
          '`exits non-zero on an uncaught error with a readable message`.',
          '`shares a provider between a controller and a command`.',
        ],
        dod: [
          'Decorators, argv-to-DTO validation, help derivation, exit codes and lifecycle all shipped with no `reflect-metadata`.',
          'DI reused from the web bootstrap rather than forked.',
        ],
      },
      {
        key: 'studio',
        title: 'zmdb studio — a read-only local data browser',
        labels: ['enhancement'],
        blockedBy: ['tests', 'cli:core'],
        goal: 'Ship a loopback-only, read-only browser over the declared tables: list tables, page rows, view a row, follow a relation.',
        why: 'It is the last slice because it depends on everything else being reachable, and because it is the one with the most obvious path to scope creep. Shipping it read-only and loopback-only, with tests that enforce both, is what makes it safe to ship at all.',
        files: [
          '`packages/zmdb/src/cli/commands/studio.ts` (new)',
          '`packages/zmdb/src/studio/` (new) — the server and a minimal client.',
        ],
        steps: [
          "Serve with the project's own web package — dogfooding, and it means the studio benefits from the same validation and routing.",
          "Expose exactly three read operations: list tables, page a table, get a row (plus following a declared relation). Nothing accepts SQL. Nothing accepts a table name that is not in the config's schema set.",
          'Reject every non-GET verb at the router level, so read-only is structural rather than a matter of which handlers exist.',
          'Bind to `127.0.0.1` by default. If a non-loopback bind is permitted at all, require an explicit flag and print a warning naming the risk; if the spec chose to refuse it, refuse.',
          'Keep the client minimal and dependency-free — a single HTML page with fetch calls. A build step and a frontend framework for a local data browser is a maintenance cost with no user benefit.',
          "Paginate everything; a studio that reads a whole table is a memory bug waiting for a large table. Use the streaming epic's work if it has landed, otherwise `LIMIT`/`OFFSET` with a hard cap.",
          'Redact nothing automatically but document clearly that this shows raw data, so nobody points it at a production database expecting masking.',
        ],
        tests: [
          'All studio tests go green.',
          '`rejects every non-GET verb at the router level`.',
          '`caps the number of rows returned regardless of the requested page size`.',
          '`refuses a table name that is not in the configured schema set`.',
        ],
        dod: [
          'Read-only and loopback-only enforced structurally and tested.',
          'Three read operations, no SQL surface, hard row cap, no frontend build step.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] scaffolding, monorepos, CLI applications and studio',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['generators', 'command-apps', 'studio'],
        goal: 'Flip all four pages to supported, with real transcripts and — for the studio — an unambiguous statement of what it is not.',
        files: [
          '`docs-site/pages.mjs`',
          'the four content files',
          '`README.md` — the quick start can start with `zmdb new`.',
        ],
        steps: [
          'Show real transcripts and the actual generated file trees.',
          'Write the monorepo page around the explicit `--package` requirement and why guessing was rejected.',
          'Write the CLI-applications page as a peer of the controllers page: same DI, same validation, different transport. Include a realistic batch job with a repository injected.',
          'Write the studio page with its limits first: read-only, loopback, no masking, not an admin panel.',
          'Update the README quick start to begin with `zmdb new`.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: ['Four pages supported with real transcripts; studio limits stated first; README quick start updated.'],
      },
    ],
  },
];
