`@zmdb/cli` owns the single installed `zmdb` executable. Its commands delegate reflection and AOT compilation to `@zmdb/compiler`, and schema snapshots, plans, files and ledger execution to
`@zmdb/migrations`. These libraries are independently usable; see [Tooling Boundaries](./tooling-boundaries.html).

## The pieces

| Function                                               | Module                          | Does                                                           |
| ------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| `compileProject`, `writeCompileResult`, `watchCodegen` | `@zmdb/compiler`                | project artifacts, freshness checks and retained-session watch |
| `snapshot(schemas)`                                    | `@zmdb/migrations`              | schema objects → a plain snapshot object                       |
| `diff(prev, next)`                                     | `@zmdb/migrations`              | two snapshots → operations                                     |
| `emitUp(op, dialect)`                                  | `@zmdb/migrations`              | one operation → SQL                                            |
| `emitDown(op, dialect)`                                | `@zmdb/migrations`              | the reverse                                                    |
| `sqliteIntrospector`                                   | `@zmdb/sqlite`                  | SQLite catalog → normalized snapshot                           |
| `database.introspector`                                | selected database package       | database-owned catalog reader                                  |
| `emitDeclarations(snapshot, …)`                        | `@zmdb/migrations/declarations` | snapshot → generated TypeScript files                          |
| `up`, `down`, `status`                                 | `@zmdb/migrations/runner`       | applies / reverts, records versions                            |
| `runEmbedded(conn, migrations)`                        | `@zmdb/migrations/embedded`     | applies bundle-resident SQLite migrations                      |

## The commands, and where each stands

| drizzle-kit / mikro-orm      | zmdb today                                              | Page                                                  |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `new`                        | project and application-component scaffolds             | [scaffolding](./web-cli.html)                         |
| `codegen`                    | `zmdb codegen`, `--check` and `--watch`                 | [code generation](./cli-codegen.html)                 |
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

Install the CLI and its required TypeScript peer, or install `@zmdb/core@1.0.0-beta.2` for the product that includes the same CLI. Command help comes from the installed version:

```bash
yarn add --dev @zmdb/cli@1.0.0-beta.2 typescript@^7.0.2
yarn zmdb --help
yarn zmdb codegen --help
```

The database workflow uses that one entry point:

```bash
yarn zmdb codegen --check
yarn zmdb generate --name add_slug
yarn zmdb embed
yarn zmdb migrate
yarn zmdb check --json
yarn zmdb export > schema.sql
yarn zmdb pull --dry-run
yarn zmdb client generate --check
yarn zmdb new controller posts
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
