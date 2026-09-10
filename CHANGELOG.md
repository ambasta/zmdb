# Changelog

## [Unreleased]

### Added

- **product:** Declare a support tier per package, `supported` or `provisional`, with the evidence that justifies it and, for a provisional package, the evidence no push runs. Twenty-one packages are
  supported and six are provisional.
- **product:** Refuse a stable version or release target for a package that is not supported, a supported package that depends on a provisional one, and a tier that names a path absent from the
  repository.

### Changed

- **product:** Fold sixteen single-purpose packages into entry points of four, taking the published set from 42 packages to 27.
- **product:** Publish the support tier and its evidence in the generated package reference and on a new support-tiers page, and record the versioning contract in `PUBLISHING.md`.
- **client:** Publish the Angular, React, React Native, Solid, Svelte and Vue bindings as `@zmdb/client` subpaths, each framework library an optional peer.
- **transport:** Add `@zmdb/transport`, one package with a subpath per gRPC and broker transport, no root export and every client library an optional peer.
- **ai:** Publish the Anthropic, LangChain and Vercel AI SDK adapters as `@zmdb/ai` subpaths with optional provider peers.
- **app:** Publish the OpenTelemetry adapter as `@zmdb/app/otel` with `@opentelemetry/api` as an optional peer.

### Removed

- **product:** Retire the sixteen replaced npm packages without a deprecation stub. The installation page maps every old name to its replacement.

## [ai@1.0.0-beta.2] - 2026-09-09

### Changed

- **ai:** Prepare `@zmdb/ai` for the coordinated scoped-package beta with updated package versions and installation examples.

## [ai-anthropic@1.0.0-beta.2] - 2026-09-09

### Changed

- **ai-anthropic:** Prepare `@zmdb/ai-anthropic` for the coordinated scoped-package beta with updated package versions and installation examples.

## [ai-langchain@1.0.0-beta.2] - 2026-09-09

### Changed

- **ai-langchain:** Prepare `@zmdb/ai-langchain` for the coordinated scoped-package beta with updated package versions and installation examples.

## [ai-vercel@1.0.0-beta.2] - 2026-09-09

### Changed

- **ai-vercel:** Prepare `@zmdb/ai-vercel` for the coordinated scoped-package beta with updated package versions and installation examples.

## [angular@1.0.0-beta.2] - 2026-09-09

### Changed

- **angular:** Prepare `@zmdb/angular` for the coordinated scoped-package beta with updated package versions and installation examples.

## [cli@1.0.0-beta.2] - 2026-09-09

### Changed

- **cli:** Generate project dependencies and imports using `@zmdb/core`, retaining the `zmdb` executable.

## [client@1.0.0-beta.2] - 2026-09-09

### Changed

- **client:** Prepare `@zmdb/client` for the coordinated scoped-package beta with updated package versions and installation examples.

## [cockroach@1.0.0-beta.2] - 2026-09-09

### Changed

- **cockroach:** Prepare `@zmdb/cockroach` for the coordinated scoped-package beta with updated package versions and installation examples.

## [compiler@1.0.0-beta.2] - 2026-09-09

### Changed

- **compiler:** Recognize `@zmdb/core` AOT imports and emit schema support types from `@zmdb/core/schema`.

## [core@1.0.0-beta.2] - 2026-09-09

### Changed

- **product:** Publish the umbrella package as `@zmdb/core`, keeping its existing API and concern subpaths.

## [jobs-postgres@1.0.0-beta.2] - 2026-09-09

### Changed

- **jobs-postgres:** Prepare `@zmdb/jobs-postgres` for the coordinated scoped-package beta with updated package versions and installation examples.

## [jobs-sqlite@1.0.0-beta.2] - 2026-09-09

### Changed

- **jobs-sqlite:** Prepare `@zmdb/jobs-sqlite` for the coordinated scoped-package beta with updated package versions and installation examples.

## [mcp@1.0.0-beta.2] - 2026-09-09

### Changed

- **mcp:** Prepare `@zmdb/mcp` for the coordinated scoped-package beta with updated package versions and installation examples.

## [migrations@1.0.0-beta.2] - 2026-09-09

### Changed

- **migrations:** Prepare `@zmdb/migrations` for the coordinated scoped-package beta with updated package versions and installation examples.

## [mssql@1.0.0-beta.2] - 2026-09-09

### Changed

- **mssql:** Prepare `@zmdb/mssql` for the coordinated scoped-package beta with updated package versions and installation examples.

## [mysql@1.0.0-beta.2] - 2026-09-09

### Changed

- **mysql:** Prepare `@zmdb/mysql` for the coordinated scoped-package beta with updated package versions and installation examples.

## [next@1.0.0-beta.2] - 2026-09-09

### Changed

- **next:** Prepare `@zmdb/next` for the coordinated scoped-package beta with updated package versions and installation examples.

## [nuxt@1.0.0-beta.2] - 2026-09-09

### Changed

- **nuxt:** Prepare `@zmdb/nuxt` for the coordinated scoped-package beta with updated package versions and installation examples.

## [otel@1.0.0-beta.2] - 2026-09-09

### Changed

- **otel:** Prepare `@zmdb/otel` for the coordinated scoped-package beta with updated package versions and installation examples.

## [postgres@1.0.0-beta.2] - 2026-09-09

### Changed

- **postgres:** Prepare `@zmdb/postgres` for the coordinated scoped-package beta with updated package versions and installation examples.

## [protobuf@1.0.0-beta.2] - 2026-09-09

### Changed

- **protobuf:** Prepare `@zmdb/protobuf` for the coordinated scoped-package beta with updated package versions and installation examples.

## [react@1.0.0-beta.2] - 2026-09-09

### Changed

- **react:** Prepare `@zmdb/react` for the coordinated scoped-package beta with updated package versions and installation examples.

## [react-native@1.0.0-beta.2] - 2026-09-09

### Changed

- **react-native:** Prepare `@zmdb/react-native` for the coordinated scoped-package beta with updated package versions and installation examples.

## [singlestore@1.0.0-beta.2] - 2026-09-09

### Changed

- **singlestore:** Prepare `@zmdb/singlestore` for the coordinated scoped-package beta with updated package versions and installation examples.

## [solid@1.0.0-beta.2] - 2026-09-09

### Changed

- **solid:** Prepare `@zmdb/solid` for the coordinated scoped-package beta with updated package versions and installation examples.

## [sqlite@1.0.0-beta.2] - 2026-09-09

### Changed

- **sqlite:** Prepare `@zmdb/sqlite` for the coordinated scoped-package beta with updated package versions and installation examples.

## [svelte@1.0.0-beta.2] - 2026-09-09

### Changed

- **svelte:** Prepare `@zmdb/svelte` for the coordinated scoped-package beta with updated package versions and installation examples.

## [sveltekit@1.0.0-beta.2] - 2026-09-09

### Changed

- **sveltekit:** Prepare `@zmdb/sveltekit` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-grpc@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-grpc:** Prepare `@zmdb/transport-grpc` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-kafka@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-kafka:** Prepare `@zmdb/transport-kafka` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-nats@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-nats:** Prepare `@zmdb/transport-nats` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-rabbitmq@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-rabbitmq:** Prepare `@zmdb/transport-rabbitmq` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-redis@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-redis:** Prepare `@zmdb/transport-redis` for the coordinated scoped-package beta with updated package versions and installation examples.

## [transport-sqs@1.0.0-beta.2] - 2026-09-09

### Changed

- **transport-sqs:** Prepare `@zmdb/transport-sqs` for the coordinated scoped-package beta with updated package versions and installation examples.

## [vue@1.0.0-beta.2] - 2026-09-09

### Changed

- **vue:** Prepare `@zmdb/vue` for the coordinated scoped-package beta with updated package versions and installation examples.

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
