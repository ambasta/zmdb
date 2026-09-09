# @zmdb/web

`@zmdb/web` is the HTTP framework for zmdb applications. It composes controllers, typed request contexts, middleware, OpenAPI, gateways, testing utilities, and runtime adapters over the
protocol-neutral `@zmdb/app` kernel. It does not use `reflect-metadata` or runtime type reflection.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

Applications normally install `@zmdb/core` and use `@zmdb/core/web`; see the [server journey](https://ambasta.github.io/zmdb/docs/web-overview.html). Select this package directly when an advanced
dependency boundary needs HTTP without the full product facade.

## Advanced: install HTTP alone

```bash
yarn add @zmdb/web@1.0.0-beta.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

The package root contains the common HTTP APIs. Its complete feature entry set is `/app`, `/compression`, `/context`, `/contract`, `/contract/compiler`, `/csrf`, `/data`, `/devtools`, `/dto-pipes`,
`/gateways`, `/health`, `/integrations`, `/middleware`, `/openapi`, `/pipeline`, `/routing`, `/static`, `/testing`, `/upload`, and `/versioning`.

`@zmdb/web/contract` contains inert HTTP declarations and serialisable `HttpContractIR`. The build-time `@zmdb/web/contract/compiler` entry compiles those declarations and emits deterministic typed
client modules whose runtime imports are limited to `@zmdb/client`. `zmdb client generate` projects the same compiled IR into sibling OpenAPI and client artifacts; it does not derive one from the
other.

Typed gRPC servers and clients ship from `@zmdb/transport-grpc`, core NATS ships from `@zmdb/transport-nats`, RabbitMQ ships from `@zmdb/transport-rabbitmq`, and Redis Pub/Sub ships from
`@zmdb/transport-redis`; none of their old web subpaths forwards. The transport-neutral strategy, dispatcher, decorators, and typed clients live at `@zmdb/app/messaging`. Queues, workers, scheduling,
and leases live in `@zmdb/jobs`; SQLite durable and memory storage lives in the separately selected `@zmdb/jobs-sqlite`. The removed web paths do not forward. Install
`@zmdb/jobs-postgres@1.0.0-beta.2` with `pg@^8.23.0` when those jobs use a caller-owned PostgreSQL pool or client.

Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state machines, health contracts, and dependency-free observability ports live in `@zmdb/app`. Install
`@zmdb/otel@1.0.0-beta.2` with `@opentelemetry/api@^1.9.1` to adapt caller-owned tracers and meters; web has no OpenTelemetry peer or forwarding subpath.

`@zmdb/web/versioning` provides version decorators and the path, header, and media-type strategies used by the router and OpenAPI generator.

Install each selected transport package with its required peer: grpc-js `^1.14.4`, the Node NATS transport `^3.4.0`, amqplib `^2.0.1`, or redis `^6.2.1`. `@zmdb/web` declares no third-party runtime
peer and publishes no broker or benchmark-helper subpath. Its optional TypeScript peer is reached only by the build-time `/contract/compiler` entry.

## Documentation

Generated-client journey: **https://ambasta.github.io/zmdb/docs/generated-client.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).
