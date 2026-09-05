> **ToDo / documentation gap.** The published `zmdb` executable exposes
> `generate`, `migrate`, `rollback`, `status`, `push`, `check`, `upgrade`,
> `export`, `modules`, `repl`, `studio`, and `new` scaffolding. `pull` and the
> final command transcripts remain.

The schema commands are thin packaged wrappers over the public reflection,
snapshot, diff, introspection, DDL, and migration-runner APIs.

## The pieces

| Function                        | Module                                   | Does                                     |
| ------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `snapshot(schemas)`             | `@zmdb/query-compiler/migrations`        | schema objects → a plain snapshot object |
| `diff(prev, next)`              | `@zmdb/query-compiler/migrations`        | two snapshots → operations               |
| `emitUp(op, dialect)`           | `@zmdb/query-compiler/migrations`        | one operation → SQL                      |
| `emitDown(op, dialect)`         | `@zmdb/query-compiler/migrations`        | the reverse                              |
| `createIntrospector(dialect)`   | `@zmdb/query-compiler/introspect`        | live catalog → normalized snapshot       |
| `emitDeclarations(snapshot, …)` | `@zmdb/query-compiler/introspect`        | snapshot → generated TypeScript files    |
| `runCli(cmd, conn, migrations)` | `@zmdb/query-compiler/migrations/runner` | applies / reverts, records versions      |

## The commands, and where each stands

| drizzle-kit / mikro-orm      | zmdb today                                             | Page                                                |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `new`                        | project and application-component scaffolds            | [scaffolding](./web-cli.html)                       |
| `generate`                   | `zmdb generate`                                        | [generate](./cli-generate.html)                     |
| `migrate` / `up`             | `zmdb migrate`; `up` is deliberately refused           | [migrate](./cli-migrate.html) · [up](./cli-up.html) |
| `push`                       | live-catalog diff with a destructive SQL guard         | [push](./cli-push.html)                             |
| `check`                      | snapshot, file-history, and optional live-drift checks | [check](./cli-check.html)                           |
| `export`                     | `zmdb export`                                          | [export](./cli-export.html)                         |
| `pull` / `generate-entities` | reader + declaration-emitter APIs; CLI pending         | [pull](./cli-pull.html)                             |
| `studio`                     | installed read-only loopback browser                   | [studio](./cli-studio.html)                         |

`pull` has its catalog reader and declaration emitter as library APIs but still
needs executable dispatch. Studio's installed binary is parsed by plain Node
and exercised against its loopback index by publish verification.

## A single entry point

The installed binary owns config discovery, help, JSON output, stream
separation, and exit codes:

```bash
npx zmdb generate --name add_slug
npx zmdb migrate
npx zmdb check --json
npx zmdb export > schema.sql
npx zmdb new controller posts
```

The schema commands accept `--config <path>` and `--project <tsconfig>`.
Scaffolding instead accepts `--package <name-or-path>` and `--dry-run` and does
not load database config. Add `--json` when a script needs the stable
`CliResult` envelope instead of human output.

## What remains

- **`pull` dispatch** over the shipped catalogue reader and declaration emitter.
- **The final documentation transcripts** for the commands that now ship.

---

See also: [Migrations](./migrations.html) · [Config File](./config-file.html) · [generate](./cli-generate.html)
