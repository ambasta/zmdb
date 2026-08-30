# @zmdb/query-compiler

SQL-first, dialect-aware query compiler: SELECT/INSERT/UPDATE/DELETE, joins, aggregations, full-text search, set operations, schema-object DDL, and migration diffing.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/query-compiler
```

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. This package
> ships TypeScript source under `./src`; consume it from a TS7/ESM toolchain.

## Entry points

`@zmdb/query-compiler`, `@zmdb/query-compiler/fts`, `@zmdb/query-compiler/joins`, `@zmdb/query-compiler/aggregations`, `@zmdb/query-compiler/migrations`, `@zmdb/query-compiler/set-ops`, `@zmdb/query-compiler/schema-objects`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

MIT — see [LICENSE](./LICENSE).
