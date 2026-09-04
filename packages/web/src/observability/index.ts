import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';

import { createRouter, type Router } from '../pipeline/index.js';
import { fromTraceContext } from './propagation.js';
import { SpanKind, type Attributes, type Observability, type Span, type TraceCarrier, type Tracer } from './types.js';

export { fromTraceContext, fromTraceparent, toTraceHeaders, toTraceparent } from './propagation.js';
export { SpanKind } from './types.js';
export type {
  Attributes,
  CommentKey,
  Meter,
  Observability,
  QueryTelemetry,
  Span,
  SpanContext,
  SpanOptions,
  TraceCarrier,
  Tracer,
} from './types.js';

/** Structural driver surface instrumented without importing a concrete driver. */
export interface ExecutingDriver {
  readonly dialect?: Dialect;
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

/** Compatibility name retained by the tests freeze; this is the real router. */
export function createTracedRouter(observability: Observability = {}): Router {
  return createRouter(observability);
}

/**
 * Add database spans and metrics at the execute boundary.
 *
 * With neither port configured, return the original object: no wrapper, marker,
 * closure or per-query branch is added to the off path.
 */
export function tracedDriver(driver: ExecutingDriver, observability: Observability, parent?: Span): ExecutingDriver {
  const { tracer, meter } = observability;
  if (tracer === undefined && meter === undefined) {
    return driver;
  }

  const duration = meter?.histogram('db.client.operation.duration', 's');
  return {
    ...(driver.dialect === undefined ? {} : { dialect: driver.dialect }),
    queryTelemetry: true,
    async execute(query): Promise<readonly Record<string, unknown>[]> {
      const telemetry = query.telemetry;
      const span = startQuerySpan(tracer, telemetry, parent);
      if (span !== undefined) {
        if (telemetry !== undefined) {
          span.setAttribute('db.system.name', telemetry.system);
          span.setAttribute('db.operation.name', telemetry.operation);
          span.setAttribute('db.collection.name', telemetry.collection);
        }
        // Compiled SQL contains placeholders; parameter values are deliberately
        // absent from every telemetry surface.
        span.setAttribute('db.query.text', query.text);
        span.setAttribute('zmdb.db.parameter_count', query.parameters.length);
      }

      const started = Date.now();
      try {
        return await driver.execute(query);
      } catch (error) {
        if (span !== undefined) {
          const recorded = errorValue(error);
          span.recordException(recorded);
          span.setStatus({ error: true });
          const code = errorCode(error);
          if (code !== undefined) {
            span.setAttribute('db.response.status_code', code);
          }
        }
        throw error;
      } finally {
        if (duration !== undefined && telemetry !== undefined) {
          const attributes: Attributes = {
            'db.system.name': telemetry.system,
            'db.operation.name': telemetry.operation,
            'db.collection.name': telemetry.collection,
          };
          duration.record((Date.now() - started) / 1000, attributes);
        }
        span?.end();
      }
    },
  };
}

/** Start the consumer side of one propagated message delivery. */
export function consumerSpan(
  observability: Observability,
  envelope: TraceCarrier,
  delivery: 'queued' | 'request-reply',
): Span {
  const tracer = observability.tracer;
  if (tracer === undefined) {
    throw new Error('@zmdb/web: consumerSpan requires a configured tracer');
  }
  const remote = fromTraceContext(envelope.traceparent, envelope.tracestate);
  if (remote === undefined) {
    return tracer.startSpan('zmdb.message', { kind: SpanKind.CONSUMER });
  }
  return delivery === 'queued'
    ? tracer.startSpan('zmdb.message', { kind: SpanKind.CONSUMER, link: remote })
    : tracer.startSpan('zmdb.message', { kind: SpanKind.CONSUMER, parent: remote });
}

function startQuerySpan(
  tracer: Tracer | undefined,
  telemetry: CompiledQuery['telemetry'],
  parent: Span | undefined,
): Span | undefined {
  if (tracer === undefined) {
    return undefined;
  }
  const name = telemetry === undefined ? 'db.query' : `${telemetry.operation} ${telemetry.collection}`;
  return parent === undefined
    ? tracer.startSpan(name, { kind: SpanKind.CLIENT })
    : tracer.startSpan(name, { kind: SpanKind.CLIENT, parent: parent.spanContext() });
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorCode(error: unknown): string | number | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code: unknown = error.code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}
