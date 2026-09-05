import {
  metrics,
  ROOT_CONTEXT,
  SpanKind as OpenTelemetrySpanKind,
  trace,
  type Context,
  type SpanOptions as OpenTelemetrySpanOptions,
} from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  consumerSpan,
  fromTraceContext,
  SpanKind,
  toTraceHeaders,
  tracedDriver,
  type Observability,
  type Span,
  type SpanContext,
} from '@zmdb/app/observability';
import { describe, expect, it } from 'vitest';

import { fromOpenTelemetry } from './otel.js';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACESTATE = 'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE';

describe('@zmdb/web/otel', () => {
  it('adapts a meter without constructing or requiring a tracer', () => {
    const observability = fromOpenTelemetry({
      meter: metrics.getMeter('@zmdb/web/meter-only-test'),
    });

    expect(observability.tracer).toBeUndefined();
    expect(observability.meter).toBeDefined();
    expect(observability.meter?.histogram('http.server.request.duration', 's')).toBeDefined();
  });

  it('maps every span kind, remote parent, tracestate and rename through the real SDK', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    try {
      const sdkTracer = provider.getTracer('@zmdb/web/otel-test');
      const receivedContexts: Context[] = [];
      const startSpan = sdkTracer.startSpan.bind(sdkTracer);
      const source = new Proxy(sdkTracer, {
        get(target, property, receiver) {
          if (property === 'startSpan') {
            return (name: string, options?: OpenTelemetrySpanOptions, context?: Context) => {
              receivedContexts.push(context ?? ROOT_CONTEXT);
              return startSpan(name, options, context);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const tracer = configuredTracer(fromOpenTelemetry({ tracer: source }));

      for (const kind of Object.values(SpanKind)) {
        const span = tracer.startSpan(kind, { kind });
        if (kind === SpanKind.SERVER) {
          span.updateName('GET /orders/:id');
        }
        span.end();
      }

      const remote = requiredContext(fromTraceContext(TRACEPARENT, TRACESTATE));
      const child = tracer.startSpan('remote child', {
        kind: SpanKind.SERVER,
        parent: remote,
      });
      expect(child.spanContext().traceId).toBe(remote.traceId);
      expect(child.spanContext().traceState).toBe(TRACESTATE);
      child.end();

      await provider.forceFlush();
      const exported = exporter.getFinishedSpans();
      expect(exported.slice(0, 5).map(span => span.kind)).toEqual([
        OpenTelemetrySpanKind.INTERNAL,
        OpenTelemetrySpanKind.SERVER,
        OpenTelemetrySpanKind.CLIENT,
        OpenTelemetrySpanKind.PRODUCER,
        OpenTelemetrySpanKind.CONSUMER,
      ]);
      expect(exported.find(span => span.name === 'GET /orders/:id')?.kind).toBe(OpenTelemetrySpanKind.SERVER);

      const remoteChild = exported.find(span => span.name === 'remote child');
      expect(remoteChild?.parentSpanContext).toMatchObject({
        traceId: remote.traceId,
        spanId: remote.spanId,
        traceFlags: remote.traceFlags,
        isRemote: true,
      });
      expect(remoteChild?.parentSpanContext?.traceState?.serialize()).toBe(TRACESTATE);

      expect(receivedContexts[0]).toBe(ROOT_CONTEXT);
      expect(trace.getSpanContext(receivedContexts.at(-1) ?? ROOT_CONTEXT)).toMatchObject({
        traceId: remote.traceId,
        spanId: remote.spanId,
        isRemote: true,
      });
    } finally {
      await provider.shutdown();
    }
  });

  it('exports driver spans as clients and message spans as consumers with both W3C headers', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    try {
      const observability = fromOpenTelemetry({ tracer: provider.getTracer('@zmdb/web/framework-test') });
      const driver = tracedDriver({ execute: () => Promise.resolve([]) }, observability);
      await driver.execute({
        text: 'SELECT "id" FROM "orders"',
        parameters: [],
        telemetry: {
          system: 'postgresql',
          operation: 'SELECT',
          collection: 'orders',
        },
      });

      const requestReply = consumerSpan(
        observability,
        { traceparent: TRACEPARENT, tracestate: TRACESTATE },
        'request-reply',
      );
      requestReply.end();
      const queued = consumerSpan(observability, { traceparent: TRACEPARENT, tracestate: TRACESTATE }, 'queued');
      queued.end();

      await provider.forceFlush();
      const exported = exporter.getFinishedSpans();
      expect(exported.find(span => span.name === 'SELECT orders')?.kind).toBe(OpenTelemetrySpanKind.CLIENT);

      const consumers = exported.filter(span => span.name === 'zmdb.message');
      expect(consumers).toHaveLength(2);
      expect(consumers.map(span => span.kind)).toEqual([
        OpenTelemetrySpanKind.CONSUMER,
        OpenTelemetrySpanKind.CONSUMER,
      ]);
      expect(consumers[0]?.parentSpanContext?.traceState?.serialize()).toBe(TRACESTATE);
      expect(consumers[1]?.parentSpanContext).toBeUndefined();
      expect(consumers[1]?.links[0]?.context.traceState?.serialize()).toBe(TRACESTATE);
      expect(consumers[1]?.links[0]?.context.isRemote).toBe(true);
    } finally {
      await provider.shutdown();
    }
  });
});

describe('W3C trace context propagation', () => {
  it('preserves a valid remote parent and serialized tracestate', () => {
    expect(fromTraceContext(TRACEPARENT, `rojo=one,\tcongo=two `)).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      isRemote: true,
      traceState: 'rojo=one,congo=two',
    });
  });

  it.each([
    ['empty', ''],
    ['empty member', 'rojo=one,,congo=two'],
    ['duplicate key', 'rojo=one,rojo=two'],
    ['uppercase key', 'Rojo=one'],
    ['digit-leading simple key', '1vendor=value'],
    ['extra equals', 'vendor=one=two'],
    ['comma in value', 'vendor=one,two'],
    ['tab in value', 'vendor=one\ttwo'],
    ['non-ASCII value', 'vendor=välue'],
    ['too many members', Array.from({ length: 33 }, (_, index) => `v${index}=x`).join(',')],
    ['too long value', `vendor=${'x'.repeat(257)}`],
    ['too long header', `vendor=${'x'.repeat(506)}`],
  ])('drops invalid tracestate (%s) without dropping the parent', (_label, invalidTraceState) => {
    const context = fromTraceContext(TRACEPARENT, invalidTraceState);
    expect(context).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      isRemote: true,
    });
    expect(context?.traceState).toBeUndefined();
  });

  it('emits the common carrier and omits invalid outbound tracestate', () => {
    const valid = toTraceHeaders(
      fixedSpan({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
        traceState: TRACESTATE,
      }),
    );
    expect(valid).toEqual({ traceparent: TRACEPARENT, tracestate: TRACESTATE });

    const invalid = toTraceHeaders(
      fixedSpan({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
        traceState: 'vendor=one=two',
      }),
    );
    expect(invalid).toEqual({ traceparent: TRACEPARENT });
  });
});

function configuredTracer(observability: Observability): NonNullable<Observability['tracer']> {
  if (observability.tracer === undefined) {
    throw new Error('test requires a configured tracer');
  }
  return observability.tracer;
}

function requiredContext(context: SpanContext | undefined): SpanContext {
  if (context === undefined) {
    throw new Error('test requires a valid trace context');
  }
  return context;
}

function fixedSpan(context: SpanContext): Span {
  return {
    updateName: () => undefined,
    setAttribute: () => undefined,
    recordException: () => undefined,
    setStatus: () => undefined,
    end: () => undefined,
    spanContext: () => context,
  };
}
