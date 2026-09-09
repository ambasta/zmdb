# @zmdb/otel

`@zmdb/otel` adapts caller-owned OpenTelemetry API tracers and meters to the observability ports from `@zmdb/app`.

It creates no provider, exporter, sampler, collector client, metrics endpoint, ambient active context, or global registration. The application owns every OpenTelemetry object and its shutdown.

## Install

```bash
yarn add @zmdb/otel@1.0.0-beta.2 @opentelemetry/api@^1.9.1
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole external peer is `@opentelemetry/api@^1.9.1`. Neither it nor this adapter is installed by `yarn add @zmdb/core@1.0.0-beta.2`.

Install the SDK and exporter selected by the application separately.

## Usage

```ts
import { metrics, trace } from '@opentelemetry/api';
import { fromOpenTelemetry } from '@zmdb/otel';

const observability = fromOpenTelemetry({
  tracer: trace.getTracer('checkout'),
  meter: metrics.getMeter('checkout'),
});

void observability;
```

Tracer-only and meter-only configurations are supported. Parent and link contexts remain explicit; the adapter never consults ambient OpenTelemetry context.

The adapter owns no provider, processor, exporter, collector client, global registration, or shutdown hook. The caller flushes and shuts down those objects after the application has stopped.

## Entry points

- `@zmdb/otel` — `fromOpenTelemetry` and `OpenTelemetryOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).
