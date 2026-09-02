# @zmdb/schema-core

Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, custom types, and an LLM tool harness — the single source of truth for a zmdb data layer.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/schema-core@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

`@zmdb/schema-core`, `@zmdb/schema-core/tags`, `@zmdb/schema-core/ir`, `@zmdb/schema-core/derive`, `@zmdb/schema-core/dto`, `@zmdb/schema-core/relations`, `@zmdb/schema-core/openapi`, `@zmdb/schema-core/custom-types`, `@zmdb/schema-core/llm`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
