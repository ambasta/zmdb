import type { CommentKey, CommentKeys, CommentPairs, QueryTelemetry } from '@zmdb/query-compiler';

/** Scalar attributes accepted by the framework's telemetry ports. */
export type Attributes = Readonly<Record<string, string | number | boolean>>;

/** Span roles understood by the framework's telemetry port. */
export const SpanKind = {
  INTERNAL: 'internal',
  SERVER: 'server',
  CLIENT: 'client',
  PRODUCER: 'producer',
  CONSUMER: 'consumer',
} as const;

export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind];

/** Trace identity carried explicitly between framework layers. */
export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly isRemote?: boolean;
  /** W3C tracestate serialized for transport without an SDK type dependency. */
  readonly traceState?: string;
}

/** The common W3C trace carrier used by HTTP and message transports. */
export interface TraceCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

/** The narrow span surface used by @zmdb/web. */
export interface Span {
  updateName(name: string): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
  setStatus(status: { readonly error: boolean }): void;
  end(): void;
  spanContext(): SpanContext;
}

/** Explicit span creation inputs; ambient context is deliberately absent. */
export interface SpanOptions {
  readonly parent?: SpanContext;
  readonly link?: SpanContext;
  readonly kind?: SpanKind;
}

/** The narrow tracer surface used by @zmdb/web. */
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
}

/** The narrow meter surface used by @zmdb/web. */
export interface Meter {
  counter(name: string): { add(value: number, attributes: Attributes): void };
  histogram(name: string, unit: 's'): { record(value: number, attributes: Attributes): void };
}

/** App-owned telemetry configuration. Presence means enabled. */
export interface Observability {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly comments?: { readonly keys: CommentKeys };
}

export type { CommentKey, CommentKeys, CommentPairs, QueryTelemetry };
