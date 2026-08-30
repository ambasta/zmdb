# @zmdb/repository

Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and framework adapters. No proxies, no identity map.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/repository
```

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. This package
> ships TypeScript source under `./src`; consume it from a TS7/ESM toolchain.

## Entry points

`@zmdb/repository`, `@zmdb/repository/transactions`, `@zmdb/repository/replicas`, `@zmdb/repository/integrations`, `@zmdb/repository/entity-modeling`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

MIT — see [LICENSE](./LICENSE).
