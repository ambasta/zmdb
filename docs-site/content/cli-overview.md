> **ToDo / documentation gap.** The published `zmdb` executable exposes
> `generate`, `export`, `modules`, and `repl`. The remaining database commands
> and `studio` are still implementation gaps; the final full CLI reference and
> command transcript remain for the documentation slice.

`generate` and `export` are thin packaged wrappers over the public reflection,
snapshot, diff, and DDL APIs. The same library entry points remain available for
the commands whose executable dispatch has not landed.

## The pieces

| Function                        | Module                                   | Does                                     |
| ------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `snapshot(schemas)`             | `@zmdb/query-compiler/migrations`        | schema objects → a plain snapshot object |
| `diff(prev, next)`              | `@zmdb/query-compiler/migrations`        | two snapshots → operations               |
| `emitUp(op, dialect)`           | `@zmdb/query-compiler/migrations`        | one operation → SQL                      |
| `emitDown(op, dialect)`         | `@zmdb/query-compiler/migrations`        | the reverse                              |
| `createIntrospector(dialect)`   | `@zmdb/query-compiler/introspect`        | live catalog → normalized snapshot       |
| `runCli(cmd, conn, migrations)` | `@zmdb/query-compiler/migrations/runner` | applies / reverts, records versions      |

## The commands, and where each stands

| drizzle-kit / mikro-orm      | zmdb today                                         | Page                                                |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `generate`                   | `zmdb generate`                                    | [generate](./cli-generate.html)                     |
| `migrate` / `up`             | `migrate` is pending; `up` is deliberately refused | [migrate](./cli-migrate.html) · [up](./cli-up.html) |
| `push`                       | recognized, not implemented                        | [push](./cli-push.html)                             |
| `check`                      | recognized, not implemented                        | [check](./cli-check.html)                           |
| `export`                     | `zmdb export`                                      | [export](./cli-export.html)                         |
| `pull` / `generate-entities` | catalog reader API; emitter and CLI pending        | [pull](./cli-pull.html)                             |
| `studio`                     | **not possible** — no server, no UI                | [studio](./cli-studio.html)                         |

Two offline commands are packaged. The remaining database verbs are recognized
so their help, config errors, JSON envelope, and exit codes stay uniform while
their scoped implementations land. `pull` has its catalog-reader half as a
library API but still needs declaration emission and executable dispatch.

## A single entry point

The installed binary owns config discovery, help, JSON output, stream
separation, and exit codes:

```bash
npx zmdb generate --name add_slug
npx zmdb export > schema.sql
```

Both commands accept `--config <path>` and `--project <tsconfig>`. Add `--json`
when a script needs the stable `CliResult` envelope instead of human output.
Until the remaining dispatch lands, use the linked library APIs for migration
application and checks rather than creating a second argument parser.

## What the schema CLI still needs

The remaining gaps are command implementations rather than a second CLI shell:

- **Migration application, rollback, and status** wired to the shipped runner.
- **Push and check plans** with the command-specific result payloads.
- **A confirmation prompt** before a destructive operation. `diff()` happily emits `DROP COLUMN`; a CLI should make you type the table name.
- **Snapshot upgrade and declaration emission** for `upgrade` and `pull`.

The config loader, declaration reflection, migration generation, and full-schema
export have landed. The remaining database command set reuses the same parser,
output writer, and resolved config.

---

See also: [Migrations](./migrations.html) · [Config File](./config-file.html) · [generate](./cli-generate.html)
