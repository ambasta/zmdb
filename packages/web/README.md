# @zmdb/web

`@zmdb/web` is the HTTP framework for zmdb applications. It composes controllers, typed request contexts, middleware, OpenAPI, gateways, testing utilities, and runtime adapters over the
protocol-neutral `@zmdb/app` kernel. It does not use `reflect-metadata` or runtime type reflection.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/web@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

The package root contains the common HTTP APIs. Feature-specific entry points include `/routing`, `/versioning`, `/context`, `/contract`, `/contract/compiler`, `/pipeline`, `/middleware`, `/app`,
`/openapi`, `/health`, `/upload`, `/static`, `/compression`, `/gateways`, `/testing`, and `/devtools`.

`@zmdb/web/contract` contains inert HTTP declarations and serialisable `HttpContractIR`. The build-time `@zmdb/web/contract/compiler` entry compiles those declarations and emits deterministic typed
client modules whose runtime imports are limited to `@zmdb/client`. `zmdb client generate` projects the same compiled IR into sibling OpenAPI and client artifacts; it does not derive one from the
other.

During the server-package migration, the concrete Redis, NATS, and RabbitMQ adapters retain their named `/microservices/*` entry points. Typed gRPC servers and clients now ship from
`@zmdb/transport-grpc`. The transport-neutral strategy, dispatcher, decorators, and typed clients live at `@zmdb/app/messaging`; there is no `@zmdb/web/microservices` forwarding entry. Queues,
workers, scheduling, leases, and the SQLite memory backend live in `@zmdb/jobs`; the removed web paths do not forward.

Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state machines, health contracts, and dependency-free observability ports live in `@zmdb/app`. Install
`@zmdb/otel` separately to adapt caller-owned `@opentelemetry/api` tracers and meters; web has no OpenTelemetry peer or forwarding subpath.

`@zmdb/web/versioning` provides version decorators and the path, header, and media-type strategies used by the router and OpenAPI generator.

Redis, NATS and RabbitMQ clients are optional peers reached only through their named microservices subpaths. Install `@zmdb/transport-grpc` with its required grpc-js peer when the application selects
gRPC.

## Documentation

Generated-client journey: **https://ambasta.github.io/zmdb/docs/generated-client.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
