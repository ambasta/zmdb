# @zmdb/app

The protocol-neutral application kernel for zmdb. It owns Stage-3 metadata, dependency injection, modules, lifecycle, transport-neutral messaging, command applications, events, CQRS, state machines,
health contracts, and dependency-free observability ports.

For the cohesive server product, install `@zmdb/core` and use `@zmdb/core/app` for application concerns. The [server journey](https://ambasta.github.io/zmdb/docs/web-overview.html) combines HTTP and
selected jobs under this lifecycle.

## Advanced: install the kernel alone

```bash
yarn add @zmdb/app@1.0.0-beta.2
```

The package is ESM-only and requires Node.js 26 or later.

## Entry points

`@zmdb/app`, `@zmdb/app/commands`, `@zmdb/app/cqrs`, `@zmdb/app/data`, `@zmdb/app/di`, `@zmdb/app/events`, `@zmdb/app/health`, `@zmdb/app/lifecycle`, `@zmdb/app/messaging`, `@zmdb/app/modules`,
`@zmdb/app/observability`, `@zmdb/app/otel`, and `@zmdb/app/state`.

HTTP adapters live in `@zmdb/web`. Queues and scheduling live in `@zmdb/jobs`; concrete broker integrations live in `@zmdb/transport` and implement the public `@zmdb/app/messaging` strategy contract.

## OpenTelemetry

`@zmdb/app/otel` adapts caller-owned OpenTelemetry API tracers and meters to the dependency-free observability ports declared by `@zmdb/app/observability`. It creates no provider, exporter, sampler,
collector client, metrics endpoint, ambient active context, or global registration: the application owns every OpenTelemetry object and its shutdown.

`@opentelemetry/api@^1.9.1` is the sole external peer and it is **optional**, because only this entry point needs it. Neither the peer nor any SDK is installed by `yarn add @zmdb/app@1.0.0-beta.2` or
by `yarn add @zmdb/core@1.0.0-beta.2`. Install the peer when you import the adapter, and select the SDK and exporter separately:

```bash
yarn add @zmdb/app@1.0.0-beta.2 @opentelemetry/api@^1.9.1
```

```ts
import { metrics, trace } from '@opentelemetry/api';
import { fromOpenTelemetry } from '@zmdb/app/otel';

const observability = fromOpenTelemetry({
  tracer: trace.getTracer('checkout'),
  meter: metrics.getMeter('checkout'),
});
```

Tracer-only and meter-only configurations are supported. Parent and link contexts stay explicit; the adapter never consults ambient OpenTelemetry context, and the caller flushes and shuts down its own
providers after the application has stopped.

## License

Mozilla Public License 2.0 (MPL-2.0).
