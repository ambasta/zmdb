# @zmdb/schema-core

Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, seeding, custom types, and an LLM tool harness — the single source of truth for a zmdb data layer.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/schema-core
```

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. This package
> ships TypeScript source under `./src`; consume it from a TS7/ESM toolchain.

## Entry points

`@zmdb/schema-core`, `@zmdb/schema-core/dto`, `@zmdb/schema-core/custom-types`, `@zmdb/schema-core/seeding`, `@zmdb/schema-core/llm`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

MIT — see [LICENSE](./LICENSE).
