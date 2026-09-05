# @zmdb/web

`@zmdb/web` is the web framework for zmdb applications. It provides controllers,
typed request contexts, compile-time dependency injection, middleware, OpenAPI,
transports, background jobs, and scheduling using standard Stage 3 decorators.
It does not depend on `reflect-metadata` or runtime reflection.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript
schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/web@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

The package root contains the common framework APIs. Feature-specific entry
points include `/routing`, `/versioning`, `/context`, `/di`, `/state`,
`/pipeline`, `/middleware`, `/app`, `/modules`, `/openapi`, `/health`, `/upload`,
`/static`, `/compression`, `/events`, `/cqrs`, `/queues`, `/schedule`,
`/observability`, `/microservices/grpc`, `/testing`, and `/devtools`.

The transport-neutral strategy and client contract lives at `/microservices`.
Dedicated Redis, NATS, and RabbitMQ adapters have their own entry points. Queue
backends are published under `/queues/backends`.

`@zmdb/web/observability` contains dependency-free instrumentation interfaces.
`@zmdb/web/otel` connects them to the optional `@opentelemetry/api` peer. It
does not bundle an SDK, exporter, backend, or metrics endpoint.

`@zmdb/web/versioning` provides version decorators and the path, header, and
media-type strategies used by the router and OpenAPI generator.

grpc-js, Redis, NATS, and RabbitMQ clients are optional peers reached only
through their named microservices subpaths. Install only the client used by the
adapter you import.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
