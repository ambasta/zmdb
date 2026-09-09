# Changelog

## [Unreleased]

### Changed

- **product:** publish the umbrella package as `@zmdb/core`, with its existing concern subpaths under the new scoped name.
- **compiler:** recognize `@zmdb/core` imports during ahead-of-time compilation and emit schema support types through `@zmdb/core/schema`.
- **cli:** generate project dependencies and source imports using `@zmdb/core` while retaining the `zmdb` command.

## [core@1.0.0-beta.1] - 2026-09-08

### Added

- **product:** prepare the first beta of the core framework and its public package entries.

### Changed

- **jobs:** make background work an explicitly selected `@zmdb/jobs` capability, keep it out of the default product graph, and direct alpha `zmdb/jobs*` imports to the package-owned entries.
- **product:** freeze cohesive core, independent integration and tooling releases, compatibility guarantees, and measured peer floors.
- **product:** update the tested Anthropic SDK, Vercel AI SDK, Rolldown, and Metro Babel toolchain versions.

## [ai@1.0.0-beta.1] - 2026-09-08

### Added

- **ai:** prepare the first beta of `@zmdb/ai`.

## [ai-anthropic@1.0.0-beta.1] - 2026-09-08

### Added

- **ai-anthropic:** prepare the first beta of `@zmdb/ai-anthropic`.

## [ai-langchain@1.0.0-beta.1] - 2026-09-08

### Added

- **ai-langchain:** prepare the first beta of `@zmdb/ai-langchain`.

## [ai-vercel@1.0.0-beta.1] - 2026-09-08

### Added

- **ai-vercel:** prepare the first beta of `@zmdb/ai-vercel`.

### Changed

- **ai-vercel:** make AI SDK 7.0.93 the supported peer floor and replace the workspace alias matrix with an exact packed-consumer proof.

## [angular@1.0.0-beta.1] - 2026-09-08

### Added

- **angular:** prepare the first beta of `@zmdb/angular`.

## [cli@1.0.0-beta.1] - 2026-09-08

### Added

- **cli:** prepare the first beta of `@zmdb/cli`.

## [client@1.0.0-beta.1] - 2026-09-08

### Added

- **client:** prepare the first beta of `@zmdb/client`.

## [cockroach@1.0.0-beta.1] - 2026-09-08

### Added

- **cockroach:** prepare the first beta of `@zmdb/cockroach`.
- **cockroach:** add the PostgreSQL-family CockroachDB package with immutable overrides, explicit retries, catalog normalization, and packed live acceptance.

## [compiler@1.0.0-beta.1] - 2026-09-08

### Added

- **compiler:** prepare the first beta of `@zmdb/compiler`.
- **compiler:** add the independently consumable TypeScript front end, AOT emitters, project config, and tool-host integrations.

## [jobs-postgres@1.0.0-beta.1] - 2026-09-08

### Added

- **jobs-postgres:** prepare the first beta of `@zmdb/jobs-postgres`.

## [jobs-sqlite@1.0.0-beta.1] - 2026-09-08

### Added

- **jobs-sqlite:** prepare the first beta of `@zmdb/jobs-sqlite`.

## [mcp@1.0.0-beta.1] - 2026-09-08

### Added

- **mcp:** prepare the first beta of `@zmdb/mcp`.

## [migrations@1.0.0-beta.1] - 2026-09-08

### Added

- **migrations:** prepare the first beta of `@zmdb/migrations`.

## [mssql@1.0.0-beta.1] - 2026-09-08

### Added

- **mssql:** prepare the first beta of `@zmdb/mssql`.

## [mysql@1.0.0-beta.1] - 2026-09-08

### Added

- **mysql:** prepare the first beta of `@zmdb/mysql`.
- **mysql:** add the complete MySQL compiler, migrations, introspection, and structural mysql2 driver vertical.

## [next@1.0.0-beta.1] - 2026-09-08

### Added

- **next:** prepare the first beta of `@zmdb/next`.

## [nuxt@1.0.0-beta.1] - 2026-09-08

### Added

- **nuxt:** prepare the first beta of `@zmdb/nuxt`.

## [otel@1.0.0-beta.1] - 2026-09-08

### Added

- **otel:** prepare the first beta of `@zmdb/otel`.

## [postgres@1.0.0-beta.1] - 2026-09-08

### Added

- **postgres:** prepare the first beta of `@zmdb/postgres`.
- **postgres:** add the complete PostgreSQL package with migrations, catalog introspection, streaming, cancellation, and packed live acceptance.

## [protobuf@1.0.0-beta.1] - 2026-09-08

### Added

- **protobuf:** prepare the first beta of `@zmdb/protobuf`.

## [react@1.0.0-beta.1] - 2026-09-08

### Added

- **react:** prepare the first beta of `@zmdb/react`.

## [react-native@1.0.0-beta.1] - 2026-09-08

### Added

- **react-native:** prepare the first beta of `@zmdb/react-native`.

## [singlestore@1.0.0-beta.1] - 2026-09-08

### Added

- **singlestore:** prepare the first beta of `@zmdb/singlestore`.

## [solid@1.0.0-beta.1] - 2026-09-08

### Added

- **solid:** prepare the first beta of `@zmdb/solid`.

## [sqlite@1.0.0-beta.1] - 2026-09-08

### Added

- **sqlite:** prepare the first beta of `@zmdb/sqlite`.

## [svelte@1.0.0-beta.1] - 2026-09-08

### Added

- **svelte:** prepare the first beta of `@zmdb/svelte`.

## [sveltekit@1.0.0-beta.1] - 2026-09-08

### Added

- **sveltekit:** prepare the first beta of `@zmdb/sveltekit`.

## [transport-grpc@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-grpc:** prepare the first beta of `@zmdb/transport-grpc`.

## [transport-kafka@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-kafka:** prepare the first beta of `@zmdb/transport-kafka`.

## [transport-nats@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-nats:** prepare the first beta of `@zmdb/transport-nats`.

## [transport-rabbitmq@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-rabbitmq:** prepare the first beta of `@zmdb/transport-rabbitmq`.

## [transport-redis@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-redis:** prepare the first beta of `@zmdb/transport-redis`.

## [transport-sqs@1.0.0-beta.1] - 2026-09-08

### Added

- **transport-sqs:** prepare the first beta of `@zmdb/transport-sqs`.

## [vue@1.0.0-beta.1] - 2026-09-08

### Added

- **vue:** prepare the first beta of `@zmdb/vue`.

## [core@1.0.0-alpha.4] - 2026-08-30

### Changed

- **product:** record the existing alpha.4 train as the baseline for lockstep release governance.
