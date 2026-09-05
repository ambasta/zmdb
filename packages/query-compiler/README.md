# @zmdb/query-compiler

`@zmdb/query-compiler` turns typed query descriptions into SQL for each supported dialect. It covers reads and writes, joins, aggregates, full-text search, set operations, schema objects,
introspection, and migrations.

Built-in dialect names remain available during the database-package extraction. A third-party database can instead inject one frozen `SqlDialect` object containing its compiler traits, migration
implementation, introspector, and capabilities without editing this package.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/query-compiler@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Query compilation: `@zmdb/query-compiler`, `/joins`, `/aggregations`, `/fts`, `/set-ops`
- Database metadata: `/introspect`, `/naming`, `/schema-objects`, `/comments`
- Schema changes and messaging: `/migrations`, `/migrations/runner`, `/outbox`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
