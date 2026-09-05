# `@zmdb/otel` — OpenTelemetry API adapter

> Frozen by #654 for epic #653 and amended by #662 after `@zmdb/app` became the owner of the narrow observability ports. The adapter, its executable evidence and the sole public root entry belong to
> this package.

## 1. Boundary and exports

```ts
export interface OpenTelemetryOptions {
  readonly tracer?: import('@opentelemetry/api').Tracer;
  readonly meter?: import('@opentelemetry/api').Meter;
}

export function fromOpenTelemetry(options: OpenTelemetryOptions): Observability;
```

The root is the only export. It depends on `@zmdb/app` at `workspace:^` and declares one required external peer, `@opentelemetry/api@^1.9.0`. Evidence uses API `1.9.1` and
`@opentelemetry/sdk-trace-base@2.11.0` as dev dependencies.

The package adapts the app's narrow tracer/meter ports. It does not ship or own an SDK, provider, sampler, processor, exporter, collector client or metrics endpoint.

## 2. Context and lifecycle

Parent and link contexts remain explicit. The adapter starts spans against `ROOT_CONTEXT` plus the supplied parent/link; it does not consult or mutate ambient active context and installs no global
provider.

The caller owns every tracer, meter, provider and exporter and is responsible for flush/shutdown. `fromOpenTelemetry` performs pure adaptation, creates no provider and returns no disposable resource.
Supplying only a meter does not construct or require a tracer.

## 3. Migration and installation

`@zmdb/web/otel` is removed with no forwarding subpath. Generic `Observability`, `Tracer`, `Meter`, `Span` and propagation contracts belong to `@zmdb/app`; this package owns only the OpenTelemetry
conversion.

```sh
yarn add @zmdb/otel @opentelemetry/api
```

An SDK/exporter is selected and installed by the application.

## 4. Required evidence

1. Tests use real OpenTelemetry API objects and an in-memory SDK exporter to prove span-kind mapping, remote parents, tracestate, links, rename, driver spans, message spans and meter-only operation.
2. A negative dependency test proves the packed package contains no SDK or exporter dependency and core packages contain no OpenTelemetry peer.
3. A packed external app installs the API peer plus its chosen SDK, adapts a tracer/meter, exports a span and shuts its own provider down.
4. Import and adaptation perform no global registration, I/O or background work.
