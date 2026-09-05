import {
  appendComment,
  type CommentKey,
  type CommentPairs,
  type CompiledQuery,
  type Dialect,
} from '@zmdb/query-compiler';
import type { ExecuteOptions } from '@zmdb/repository';

import { fromTraceContext, toTraceparent } from './propagation.js';
import { SpanKind, type Attributes, type Observability, type Span, type TraceCarrier, type Tracer } from './types.js';

export { fromTraceContext, fromTraceparent, toTraceHeaders, toTraceparent } from './propagation.js';
export { SpanKind } from './types.js';
export type {
  Attributes,
  CommentKey,
  CommentKeys,
  CommentPairs,
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
  execute(query: CompiledQuery, options?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, options?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}

/**
 * Add database spans, metrics and optional sqlcommenter tags at execution.
 *
 * `commentValues` is request-scoped and supplies the low-cardinality values.
 * When selected, `traceparent` comes from the query span (or the supplied
 * parent when no tracer is configured), not from the callback.
 *
 * With no port configured, return the original object: no wrapper, marker,
 * closure or per-query branch is added to the off path.
 */
export function tracedDriver(
  driver: ExecutingDriver,
  observability: Observability,
  parent?: Span,
  commentValues?: () => CommentPairs,
): ExecutingDriver {
  const { tracer, meter, comments } = observability;
  if (tracer === undefined && meter === undefined && comments === undefined) {
    return driver;
  }

  const duration = meter?.histogram('db.client.operation.duration', 's');
  const execute = async (
    query: CompiledQuery,
    options?: ExecuteOptions,
  ): Promise<readonly Record<string, unknown>[]> => {
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
      const executed =
        comments === undefined ? query : queryWithComments(query, comments.keys, commentValues?.(), span ?? parent);
      return await driver.execute(executed, options);
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
  };

  const wrapped = { ...driver, execute };
  return tracer === undefined && meter === undefined ? wrapped : { ...wrapped, queryTelemetry: true };
}

/** Start the consumer side of one propagated message delivery. */
export function consumerSpan(
  observability: Observability,
  envelope: TraceCarrier,
  delivery: 'queued' | 'request-reply',
): Span {
  const tracer = observability.tracer;
  if (tracer === undefined) {
    throw new Error('@zmdb/app: consumerSpan requires a configured tracer');
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

function queryWithComments(
  query: CompiledQuery,
  keys: readonly CommentKey[],
  source: CommentPairs | undefined,
  span: Span | undefined,
): CompiledQuery {
  const pairs = selectedCommentPairs(keys, source, span);
  const text = appendComment(query.text, pairs);
  return text === query.text ? query : { ...query, text };
}

function selectedCommentPairs(
  keys: readonly CommentKey[],
  source: CommentPairs | undefined,
  span: Span | undefined,
): CommentPairs {
  const selected = new Map<CommentKey, string>();
  for (const key of keys) {
    const value = key === 'traceparent' && span !== undefined ? toTraceparent(span) : ownCommentValue(source, key);
    if (value !== undefined) {
      selected.set(key, value);
    }
  }

  const action = selected.get('action');
  const controller = selected.get('controller');
  const framework = selected.get('framework');
  const route = selected.get('route');
  const traceparent = selected.get('traceparent');
  return {
    ...(action === undefined ? {} : { action }),
    ...(controller === undefined ? {} : { controller }),
    ...(framework === undefined ? {} : { framework }),
    ...(route === undefined ? {} : { route }),
    ...(traceparent === undefined ? {} : { traceparent }),
  };
}

function ownCommentValue(source: CommentPairs | undefined, key: CommentKey): string | undefined {
  if (source === undefined || !Object.hasOwn(source, key)) {
    return undefined;
  }
  switch (key) {
    case 'action':
      return source.action;
    case 'controller':
      return source.controller;
    case 'framework':
      return source.framework;
    case 'route':
      return source.route;
    case 'traceparent':
      return source.traceparent;
  }
}
