# zmdb

The zmdb umbrella package — one install that re-exports the whole ecosystem (schema-core, query-compiler, aot-validator, repository). Define your schema once; types, validation, CRUD and more derive at compile time.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add zmdb@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

`zmdb`, `zmdb/tags`, `zmdb/ir`, `zmdb/derive`, `zmdb/dto`, `zmdb/relations`, `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, `zmdb/web`, `zmdb/unplugin`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
