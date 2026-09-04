import type { Span, SpanContext, TraceCarrier } from './types.js';

const LOWER_HEX = /^[0-9a-f]+$/;
const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';
const TRACE_STATE_KEY = /^(?:[a-z][_0-9a-z\-*/]{0,255}|[a-z0-9][_0-9a-z\-*/]{0,240}@[a-z][_0-9a-z\-*/]{0,13})$/;
const TRACE_STATE_VALUE = /^[ -~]{0,255}[!-~]$/;

/** Parse one W3C traceparent value, ignoring malformed input. */
export function fromTraceparent(header: string): SpanContext | undefined {
  return fromTraceContext(header);
}

/** Parse a W3C trace context, keeping a valid parent when tracestate is invalid. */
export function fromTraceContext(traceparent: string | undefined, tracestate?: string): SpanContext | undefined {
  if (traceparent === undefined) {
    return undefined;
  }
  const fields = traceparent.split('-');
  if (fields.length < 4) {
    return undefined;
  }
  const version = fields[0];
  const traceId = fields[1];
  const spanId = fields[2];
  const flags = fields[3];
  if (
    version === undefined ||
    traceId === undefined ||
    spanId === undefined ||
    flags === undefined ||
    version.length !== 2 ||
    traceId.length !== 32 ||
    spanId.length !== 16 ||
    flags.length !== 2 ||
    !LOWER_HEX.test(version) ||
    !LOWER_HEX.test(traceId) ||
    !LOWER_HEX.test(spanId) ||
    !LOWER_HEX.test(flags) ||
    version === 'ff' ||
    traceId === ZERO_TRACE_ID ||
    spanId === ZERO_SPAN_ID ||
    (version === '00' && fields.length !== 4)
  ) {
    return undefined;
  }
  const traceState = validatedTraceState(tracestate);
  return {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    isRemote: true,
    ...(traceState === undefined ? {} : { traceState }),
  };
}

/** Render the current span as a W3C traceparent value for an outbound carrier. */
export function toTraceparent(span: Span): string {
  return formatTraceparent(span.spanContext());
}

function formatTraceparent(context: SpanContext): string {
  const flags = (context.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${context.traceId.toLowerCase()}-${context.spanId.toLowerCase()}-${flags}`;
}

/** Render the current span as the common outbound W3C trace carrier. */
export function toTraceHeaders(span: Span): TraceCarrier {
  const context = span.spanContext();
  const traceState = validatedTraceState(context.traceState);
  return {
    traceparent: formatTraceparent(context),
    ...(traceState === undefined ? {} : { tracestate: traceState }),
  };
}

function validatedTraceState(header: string | undefined): string | undefined {
  if (header === undefined || header.length === 0 || header.length > 512) {
    return undefined;
  }
  const members = header.split(',');
  if (members.length > 32) {
    return undefined;
  }

  const keys = new Set<string>();
  const normalized: string[] = [];
  for (const rawMember of members) {
    const member = trimOptionalWhitespace(rawMember);
    const separator = member.indexOf('=');
    if (separator <= 0 || member.indexOf('=', separator + 1) !== -1) {
      return undefined;
    }
    const key = member.slice(0, separator);
    const value = member.slice(separator + 1);
    if (!TRACE_STATE_KEY.test(key) || !TRACE_STATE_VALUE.test(value) || value.includes(',') || keys.has(key)) {
      return undefined;
    }
    keys.add(key);
    normalized.push(member);
  }
  return normalized.join(',');
}

function trimOptionalWhitespace(value: string): string {
  return value.replace(/^[\t ]+|[\t ]+$/g, '');
}
