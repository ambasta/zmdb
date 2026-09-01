# @zmdb/query-compiler

SQL-first, dialect-aware query compiler: SELECT/INSERT/UPDATE/DELETE, joins, aggregations, full-text search, set operations, schema-object DDL, and migration diffing.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/query-compiler@alpha
```

> **Prerelease**, published under the `alpha` dist-tag. Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

`@zmdb/query-compiler`, `@zmdb/query-compiler/fts`, `@zmdb/query-compiler/joins`, `@zmdb/query-compiler/aggregations`, `@zmdb/query-compiler/migrations`, `@zmdb/query-compiler/set-ops`, `@zmdb/query-compiler/schema-objects`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
