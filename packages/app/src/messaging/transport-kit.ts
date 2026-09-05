import type { TraceCarrier } from '../observability/index.js';
import type { MessageReply, RawMessage } from './index.js';

interface WireEnvelope extends TraceCarrier {
  readonly version: 1;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId?: string;
  readonly replyTo?: string;
}

export interface DeliveryMetadata {
  readonly correlationId?: string;
  readonly replyTo?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    result[key] = entry;
  }
  return result;
}

function optionalString(value: unknown): string | undefined | false {
  return value === undefined || typeof value === 'string' ? value : false;
}

function encode(value: unknown, description: string): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`@zmdb/app: ${description} is not JSON-serializable`, { cause: error });
  }
  if (encoded === undefined) {
    throw new TypeError(`@zmdb/app: ${description} is not JSON-serializable`);
  }
  return encoded;
}

export function encodeDelivery(
  payload: unknown,
  carrier: TraceCarrier | undefined,
  metadata: DeliveryMetadata = {},
): string {
  if (payload === undefined) {
    throw new TypeError('@zmdb/app: broker payloads cannot be undefined');
  }
  const envelope: WireEnvelope = {
    version: 1,
    payload,
    headers: {},
    ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
    ...(metadata.replyTo === undefined ? {} : { replyTo: metadata.replyTo }),
    ...(carrier?.traceparent === undefined ? {} : { traceparent: carrier.traceparent }),
    ...(carrier?.tracestate === undefined ? {} : { tracestate: carrier.tracestate }),
  };
  return encode(envelope, 'broker payload');
}

function invalidDelivery(
  pattern: string,
  payload: unknown,
  deliveryAttempt: number,
  error: unknown,
  metadata: DeliveryMetadata,
): RawMessage {
  return {
    pattern,
    payload,
    headers: {},
    correlationId: metadata.correlationId,
    replyTo: metadata.replyTo,
    deliveryAttempt,
    parseError: error,
  };
}

export function decodeDelivery(
  pattern: string,
  text: string,
  deliveryAttempt: number,
  metadata: DeliveryMetadata = {},
): RawMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return invalidDelivery(pattern, text, deliveryAttempt, error, metadata);
  }

  if (!isRecord(parsed)) {
    return invalidDelivery(
      pattern,
      parsed,
      deliveryAttempt,
      new TypeError('@zmdb/app: broker envelope must be an object'),
      metadata,
    );
  }

  const headers = stringRecord(parsed.headers);
  const correlationId = optionalString(parsed.correlationId);
  const replyTo = optionalString(parsed.replyTo);
  const traceparent = optionalString(parsed.traceparent);
  const tracestate = optionalString(parsed.tracestate);
  if (
    parsed.version !== 1 ||
    !Object.hasOwn(parsed, 'payload') ||
    headers === undefined ||
    correlationId === false ||
    replyTo === false ||
    traceparent === false ||
    tracestate === false
  ) {
    return invalidDelivery(
      pattern,
      Object.hasOwn(parsed, 'payload') ? parsed.payload : parsed,
      deliveryAttempt,
      new TypeError('@zmdb/app: invalid broker envelope'),
      metadata,
    );
  }

  return {
    pattern,
    payload: parsed.payload,
    headers,
    correlationId: metadata.correlationId ?? correlationId,
    replyTo: metadata.replyTo ?? replyTo,
    deliveryAttempt,
    ...(traceparent === undefined ? {} : { traceparent }),
    ...(tracestate === undefined ? {} : { tracestate }),
  };
}

export function encodeReply(reply: MessageReply): string {
  return encode(reply, 'broker reply');
}

export function decodeReply(text: string): MessageReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError('@zmdb/app: broker reply is not valid JSON', { cause: error });
  }
  if (!isRecord(parsed) || typeof parsed.correlationId !== 'string') {
    throw new TypeError('@zmdb/app: invalid broker reply envelope');
  }
  if (parsed.kind === 'result' && Object.hasOwn(parsed, 'payload')) {
    return { kind: 'result', correlationId: parsed.correlationId, payload: parsed.payload };
  }
  if (parsed.kind === 'error' && typeof parsed.message === 'string') {
    return { kind: 'error', correlationId: parsed.correlationId, message: parsed.message };
  }
  throw new TypeError('@zmdb/app: invalid broker reply envelope');
}

export type TransportErrorSink = (error: unknown) => void;

export function reportTransportError(sink: TransportErrorSink, error: unknown): void {
  try {
    sink(error);
  } catch {
    // A diagnostic sink cannot replace transport settlement or shutdown.
  }
}

export class InFlight {
  readonly #tasks = new Set<Promise<void>>();
  readonly #onError: TransportErrorSink;
  #accepting = true;

  constructor(onError: TransportErrorSink) {
    this.#onError = onError;
  }

  run(action: () => Promise<void>): Promise<void> {
    if (!this.#accepting) {
      return Promise.resolve();
    }
    let task: Promise<void>;
    task = Promise.resolve()
      .then(action)
      .catch(error => {
        reportTransportError(this.#onError, error);
      })
      .finally(() => {
        this.#tasks.delete(task);
      });
    this.#tasks.add(task);
    return task;
  }

  stop(): void {
    this.#accepting = false;
  }

  async settled(): Promise<void> {
    await Promise.all(this.#tasks);
  }
}

export async function withinGrace(action: Promise<void>, graceMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action.then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('@zmdb/app: broker request aborted');
}
