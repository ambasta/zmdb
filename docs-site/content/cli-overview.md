The schema commands are thin packaged wrappers over the public reflection, snapshot, diff, introspection, DDL, migration-runner, catalog-reader, and declaration-emitter APIs.

## The pieces

| Function                        | Module                          | Does                                      |
| ------------------------------- | ------------------------------- | ----------------------------------------- |
| `snapshot(schemas)`             | `@zmdb/migrations`              | schema objects → a plain snapshot object  |
| `diff(prev, next)`              | `@zmdb/migrations`              | two snapshots → operations                |
| `emitUp(op, dialect)`           | `@zmdb/migrations`              | one operation → SQL                       |
| `emitDown(op, dialect)`         | `@zmdb/migrations`              | the reverse                               |
| `sqliteIntrospector`            | `@zmdb/sqlite`                  | SQLite catalog → normalized snapshot      |
| `createIntrospector(dialect)`   | `@zmdb/migrations/introspect`   | temporary non-SQLite built-in dispatch    |
| `emitDeclarations(snapshot, …)` | `@zmdb/migrations/declarations` | snapshot → generated TypeScript files     |
| `runCli(cmd, conn, migrations)` | `@zmdb/migrations/runner`       | applies / reverts, records versions       |
| `runEmbedded(conn, migrations)` | `@zmdb/migrations/embedded`     | applies bundle-resident SQLite migrations |

## The commands, and where each stands

| drizzle-kit / mikro-orm      | zmdb today                                              | Page                                                  |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `new`                        | project and application-component scaffolds             | [scaffolding](./web-cli.html)                         |
| `generate`                   | `zmdb generate`                                         | [generate](./cli-generate.html)                       |
| `embed`                      | bundle-resident SQLite migration module                 | [web/mobile migrations](./migrations-web-mobile.html) |
| `migrate` / `up`             | `zmdb migrate`; `up` is deliberately refused            | [migrate](./cli-migrate.html) · [up](./cli-up.html)   |
| `push`                       | live-catalog diff with a destructive SQL guard          | [push](./cli-push.html)                               |
| `check`                      | snapshot, file-history, and optional live-drift checks  | [check](./cli-check.html)                             |
| `export`                     | `zmdb export`                                           | [export](./cli-export.html)                           |
| `pull` / `generate-entities` | protected `zmdb pull` declaration staging               | [pull](./cli-pull.html)                               |
| `client generate`            | OpenAPI and typed client from configured HTTP contracts | [generated client](./generated-client.html)           |
| `studio`                     | installed read-only loopback browser                    | [studio](./cli-studio.html)                           |

The catalog-backed `pull` is packaged with overwrite protection, dry-run, and check modes. Studio's installed binary is parsed by plain Node and exercised against its loopback index by publish
verification.

## A single entry point

The installed binary owns config discovery, help, JSON output, stream separation, and exit codes. This help transcript was captured from the package bin against the repository's SQLite fixture:

```text
$ npx zmdb --help
zmdb — schema and application developer tools.

Usage:
  zmdb <command> [options]

Commands:
  generate   Create a migration and update the stored snapshot.
  embed      Compile SQLite migrations into a bundle-resident TypeScript module.
  migrate    Apply pending migrations.
  rollback   Revert the latest migration or roll back to a version.
  status     List migration versions and their applied state.
  push       Apply declaration changes directly to a development database.
  check      Report schema, migration and snapshot findings.
  upgrade    Upgrade the stored snapshot format without touching a database.
  export     Print the declaration set as dialect DDL.
  pull       Write declarations from a live database catalogue.
  client     Generate OpenAPI and a typed HTTP client from configured contracts.
  new        Create a formatter-clean project or application component.
  modules    Describe application declarations without constructing providers.
  repl       Boot an application into a local interactive session.
  studio     Browse configured tables through a read-only loopback server.

Run `zmdb <command> --help` for command-specific options.
```

The database workflow uses that one entry point:

```bash
npx zmdb generate --name add_slug
npx zmdb embed
npx zmdb migrate
npx zmdb check --json
npx zmdb export > schema.sql
npx zmdb pull --dry-run
npx zmdb client generate --check
npx zmdb new controller posts
```

The schema and HTTP-generation commands accept `--config <path>` and `--project <tsconfig>`. `client generate` writes both configured artifacts, `--check` reports stale output without writing, and
`--watch` regenerates from the compiled contract dependency set. Scaffolding instead accepts `--package <name-or-path>` and `--dry-run` and does not load database config. Add `--json` when a script
needs the stable `CliResult` envelope instead of human output; watch mode is deliberately not JSON.

## Exit codes and streams

| Exit | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | The command completed and found no requested check failure.               |
| `1`  | Work ran, but an operation failed or a check found drift.                 |
| `2`  | The invocation, config, safety confirmation, or command name was invalid. |

Human progress goes to stdout. Under `--json`, stdout is one `CliResult` document and progress or warnings move to stderr, so a caller can parse stdout without filtering log lines.

---

See also: [Generated HTTP Client](./generated-client.html) · [Migrations](./migrations.html) · [Config File](./config-file.html) · [generate](./cli-generate.html)
