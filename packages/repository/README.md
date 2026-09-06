# @zmdb/repository

`@zmdb/repository` provides typed CRUD over a zmdb schema. It includes transactions, relation loading, read replicas, result caching, streaming, seeding, lifecycle hooks, and a transactional outbox.
Rows stay plain objects; there are no proxies or identity map.

When a driver declares its dialect, repositories derive compilation, parameter limits, retry codes, and returning behavior from that same injected object. Temporary built-in string dialects remain
accepted while the database packages are extracted.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/repository@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Repository APIs: `@zmdb/repository`
- Application features: `/outbox`, `/jobs`, `/seeding`, `/transactions`, `/replicas`, `/integrations`, `/entity-modeling`
- Complete database verticals: `@zmdb/sqlite`, `@zmdb/postgres`, `@zmdb/mssql`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
