import {
  createTraceState,
  ROOT_CONTEXT,
  SpanKind as OpenTelemetrySpanKind,
  SpanStatusCode,
  trace,
  type Meter as OpenTelemetryMeter,
  type Span as OpenTelemetrySpan,
  type SpanContext as OpenTelemetrySpanContext,
  type Tracer as OpenTelemetryTracer,
} from '@opentelemetry/api';
import {
  SpanKind as FrameworkSpanKind,
  type Meter,
  type Observability,
  type Span,
  type SpanContext,
  type Tracer,
} from '@zmdb/app/observability';

const SPAN_KINDS: Readonly<Record<FrameworkSpanKind, OpenTelemetrySpanKind>> = {
  [FrameworkSpanKind.INTERNAL]: OpenTelemetrySpanKind.INTERNAL,
  [FrameworkSpanKind.SERVER]: OpenTelemetrySpanKind.SERVER,
  [FrameworkSpanKind.CLIENT]: OpenTelemetrySpanKind.CLIENT,
  [FrameworkSpanKind.PRODUCER]: OpenTelemetrySpanKind.PRODUCER,
  [FrameworkSpanKind.CONSUMER]: OpenTelemetrySpanKind.CONSUMER,
};

/** User-configured OpenTelemetry objects adapted to the framework's narrow ports. */
export interface OpenTelemetryOptions {
  readonly tracer?: OpenTelemetryTracer;
  readonly meter?: OpenTelemetryMeter;
}

/**
 * Adapt OpenTelemetry API objects without making them a dependency of the core
 * @zmdb/app or @zmdb/web entry points. Parent context stays explicit; ambient context is not
 * consulted by the adapter.
 */
export function fromOpenTelemetry(options: OpenTelemetryOptions): Observability {
  return {
    ...(options.tracer === undefined ? {} : { tracer: adaptTracer(options.tracer) }),
    ...(options.meter === undefined ? {} : { meter: adaptMeter(options.meter) }),
  };
}

function adaptTracer(source: OpenTelemetryTracer): Tracer {
  return {
    startSpan(name, options): Span {
      const parent =
        options?.parent === undefined
          ? ROOT_CONTEXT
          : trace.setSpanContext(ROOT_CONTEXT, toOpenTelemetryContext(options.parent));
      const kind = SPAN_KINDS[options?.kind ?? FrameworkSpanKind.INTERNAL];
      const span = source.startSpan(
        name,
        options?.link === undefined ? { kind } : { kind, links: [{ context: toOpenTelemetryContext(options.link) }] },
        parent,
      );
      return adaptSpan(span);
    },
  };
}

function adaptSpan(source: OpenTelemetrySpan): Span {
  return {
    updateName: name => {
      source.updateName(name);
    },
    setAttribute: (key, value) => {
      source.setAttribute(key, value);
    },
    recordException: error => {
      source.recordException(error);
    },
    setStatus: status => {
      source.setStatus({ code: status.error ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    },
    end: () => {
      source.end();
    },
    spanContext: () => fromOpenTelemetryContext(source.spanContext()),
  };
}

function toOpenTelemetryContext(context: SpanContext): OpenTelemetrySpanContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    ...(context.isRemote === undefined ? {} : { isRemote: context.isRemote }),
    ...(context.traceState === undefined ? {} : { traceState: createTraceState(context.traceState) }),
  };
}

function fromOpenTelemetryContext(context: OpenTelemetrySpanContext): SpanContext {
  const traceState = context.traceState?.serialize();
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    ...(context.isRemote === undefined ? {} : { isRemote: context.isRemote }),
    ...(traceState === undefined || traceState.length === 0 ? {} : { traceState }),
  };
}

function adaptMeter(source: OpenTelemetryMeter): Meter {
  return {
    counter(name) {
      const counter = source.createCounter(name);
      return {
        add: (value, attributes) => {
          counter.add(value, attributes);
        },
      };
    },
    histogram(name, unit) {
      const histogram = source.createHistogram(name, { unit });
      return {
        record: (value, attributes) => {
          histogram.record(value, attributes);
        },
      };
    },
  };
}
