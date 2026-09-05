# zmdb

The `zmdb` package re-exports the main schema, validation, query, repository, web, configuration, and command-line APIs from one install.

Define a schema once and use it for TypeScript types, validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add zmdb@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Core APIs: `zmdb`, `zmdb/tags`, `zmdb/ir`, `zmdb/derive`, `zmdb/dto`, `zmdb/relations`
- Database drivers: `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, `zmdb/drivers/mssql`
- Application tooling: `zmdb/web`, `zmdb/unplugin`, `zmdb/cli`, `zmdb/config`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
