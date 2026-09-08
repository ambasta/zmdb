# @zmdb/sql

`@zmdb/sql` turns typed query descriptions into SQL for each supported dialect. It covers reads and writes, joins, aggregates, full-text search, set operations, schema objects, and the vendor-neutral
dialect protocols consumed by higher layers.

Each database package owns a complete `SqlDialect` object with compiler traits, migration implementation, introspector and capabilities. Pass that object through the public SQL contract; built-in
string dialect selection is removed. A third-party database can provide the same contract without editing this package. Schema snapshots, migration execution, catalog introspection and declaration
emission are independently installable from `@zmdb/migrations`.

`@zmdb/sql` has no runtime dependencies or peers. Its [foundation guide](https://github.com/ambasta/zmdb/blob/main/docs-site/content/runtime-foundation.md) explains the inward package graph and the
separate database and tooling boundaries.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
yarn add @zmdb/sql@1.0.0-beta.1
```

> **Prerelease** (`1.0.0-beta.1`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Query compilation: `@zmdb/sql`, `/joins`, `/aggregations`, `/fts`, `/set-ops`
- SQL metadata and DDL: `/schema-objects`, `/comments`
- Naming and outbox composition are owned by `@zmdb/schema/naming` and `@zmdb/orm/outbox`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
