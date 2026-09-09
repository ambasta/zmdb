# @zmdb/orm

`@zmdb/orm` provides typed CRUD over a zmdb schema. It includes transactions, relation loading, read replicas, result caching, streaming, seeding, lifecycle hooks, and a transactional outbox. Rows
stay plain objects; there are no proxies or identity map.

Every driver declares an imported `SqlDialect` object. Repositories derive compilation, parameter limits, retry codes, and returning behavior from that same injected object.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
yarn add @zmdb/orm@1.0.0-beta.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Repository APIs: `@zmdb/orm`
- Application features: `/dto`, `/relations`, `/outbox`, `/seeding`, `/transactions`, `/replicas`, `/entity-modeling`
- Complete database verticals: `@zmdb/sqlite`, `@zmdb/postgres`, `@zmdb/mysql`, `@zmdb/mssql`, `@zmdb/cockroach`, `@zmdb/singlestore`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).
