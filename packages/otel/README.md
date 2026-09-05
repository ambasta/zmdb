# @zmdb/otel

`@zmdb/otel` adapts caller-owned OpenTelemetry API tracers and meters to the observability ports from `@zmdb/app`.

It creates no provider, exporter, sampler, collector client, metrics endpoint, ambient active context, or global registration. The application owns every OpenTelemetry object and its shutdown.

## Install

```bash
npm add @zmdb/otel@alpha @opentelemetry/api
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

Install the SDK and exporter selected by the application separately.

## Usage

```ts
import { metrics, trace } from '@opentelemetry/api';
import { fromOpenTelemetry } from '@zmdb/otel';

const observability = fromOpenTelemetry({
  tracer: trace.getTracer('checkout'),
  meter: metrics.getMeter('checkout'),
});
```

Tracer-only and meter-only configurations are supported. Parent and link contexts remain explicit; the adapter never consults ambient OpenTelemetry context.

## Entry points

- `@zmdb/otel` — `fromOpenTelemetry` and `OpenTelemetryOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
