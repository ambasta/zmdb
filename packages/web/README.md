# @zmdb/web

Stage-3 decorator web framework for the zmdb ecosystem: controllers, typed request context, compile-time DI and domain state machines — zero reflect-metadata, zero runtime reflection.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/web@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

`@zmdb/web`, `@zmdb/web/routing`, `@zmdb/web/context`, `@zmdb/web/di`, `@zmdb/web/state`, `@zmdb/web/pipeline`, `@zmdb/web/static`, `@zmdb/web/compression`, `@zmdb/web/data`, `@zmdb/web/modules`, `@zmdb/web/middleware`, `@zmdb/web/app`, `@zmdb/web/dto-pipes`, `@zmdb/web/openapi`, `@zmdb/web/health`, `@zmdb/web/observability`, `@zmdb/web/otel`, `@zmdb/web/gateways`, `@zmdb/web/events`, `@zmdb/web/cqrs`, `@zmdb/web/microservices`, `@zmdb/web/microservices/redis`, `@zmdb/web/microservices/nats`, `@zmdb/web/microservices/rabbitmq`, `@zmdb/web/queues`, `@zmdb/web/queues/backends/memory`, `@zmdb/web/queues/backends/pg`, `@zmdb/web/schedule`, `@zmdb/web/testing`, `@zmdb/web/bench`, `@zmdb/web/devtools`

`@zmdb/web/observability` contains dependency-free ports and instrumentation.
`@zmdb/web/otel` adapts the optional `@opentelemetry/api` peer; it does not ship
an SDK, exporter, backend or metrics endpoint.

Redis, core NATS and RabbitMQ clients are optional peers reached only through
their named microservices subpaths. A plain `@zmdb/web` install includes none
of them; install only the client for the adapter you import.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
