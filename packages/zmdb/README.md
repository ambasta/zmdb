# zmdb

The `zmdb` package re-exports the main schema, query, migration, validation, repository, application, web, configuration, and command-line APIs from one install.

Define a schema once and use it for TypeScript types, validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add zmdb@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Core APIs: `zmdb`, `zmdb/tags`, `zmdb/ir`, `zmdb/derive`, `zmdb/dto`, `zmdb/relations`
- Schema lifecycle: `zmdb/migrations`
- Database drivers: `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, `zmdb/drivers/mssql`
- Application tooling: `zmdb/web`, `zmdb/web/contract`, `zmdb/web/contract/compiler`, `zmdb/unplugin`, `zmdb/cli`, `zmdb/config`

`zmdb/drivers/pg` is a compatibility facade over the optional `@zmdb/postgres` peer. Install `@zmdb/postgres` and `pg` in applications that select PostgreSQL; neither is pulled into the default
umbrella dependency closure.

## Generate HTTP artifacts

Configure exported HTTP contracts and both output files in `zmdb.config.ts`, then run:

```bash
npx zmdb client generate
npx zmdb client generate --check
```

One contract load feeds the OpenAPI document and generated typed client as sibling outputs. `--check` writes nothing and fails when either committed output is stale; `--watch` regenerates when a
compiled contract input changes. Client generation never parses the OpenAPI file.

## Documentation

Generated-client journey: **https://ambasta.github.io/zmdb/docs/generated-client.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
