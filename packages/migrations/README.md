# @zmdb/migrations

Schema snapshots, deterministic migration plans, ledger runners, embedded execution, catalog introspection, and declaration emission for zmdb.

Part of **[zmdb](https://github.com/ambasta/zmdb)**.

Applications that install the product package can import the curated lifecycle surface from `zmdb/migrations`. Direct package consumers and advanced tooling use the entry points below.

## Install

```bash
npm add @zmdb/migrations@1.0.0-beta.1
```

Install the selected database package separately when planning dialect-specific SQL or connecting to a database, for example `@zmdb/sqlite@1.0.0-beta.1`. The application supplies the driver or
connection.

## Library and command workflows

The root's `snapshot`, `diff` and `planMigration` APIs operate on schema data. A migration plan receives the selected dialect and its `emitUp` and `emitDown` functions. `@zmdb/migrations/runner`
applies or rolls back migrations through a caller-supplied connection and records them in the ledger. Introspection and declaration emission have their own entries below.

For a command workflow, install `@zmdb/cli@1.0.0-beta.1` with `typescript@^7.0.2` and use its `zmdb generate`, `migrate`, `rollback`, `status`, `pull` and `embed` commands. The CLI loads project
configuration through `@zmdb/compiler/config`; the migrations library does not load a TypeScript project or depend on the CLI or compiler.

`@zmdb/migrations/embedded` exports `runEmbedded(connection, migrations)` for bundle-resident SQLite migrations. It consumes precomputed migration records and the connection's `exec`, `run` and `rows`
methods, without importing filesystem APIs, a database driver or compiler tooling. Use the CLI's `embed` command to produce those records during the build.

## Entry points

`@zmdb/migrations`, `@zmdb/migrations/declarations`, `@zmdb/migrations/embedded`, `@zmdb/migrations/files`, `@zmdb/migrations/introspect`, `@zmdb/migrations/introspect/runtime`,
`@zmdb/migrations/runner`, `@zmdb/migrations/testing`

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
