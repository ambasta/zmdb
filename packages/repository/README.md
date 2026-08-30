# @zmdb/repository

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and framework adapters. No proxies, no identity map.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/repository@alpha
```

> **Prerelease** (`1.0.0-alpha.0`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

`@zmdb/repository`, `@zmdb/repository/transactions`, `@zmdb/repository/replicas`, `@zmdb/repository/integrations`, `@zmdb/repository/entity-modeling`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

MIT — see [LICENSE](./LICENSE).
