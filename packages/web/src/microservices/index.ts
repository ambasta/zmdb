// @zmdb/web — transport-neutral message dispatch and hybrid-app lifecycle
// contracts. Strategies own broker framing and settlement; the framework owns
// validation, handler dispatch, request correlation and bounded client waits.

import '@zmdb/app';
import { consumerSpan, toTraceHeaders } from '@zmdb/app/observability';
import type { Observability, Span, TraceCarrier } from '@zmdb/app/observability';

import type { GrpcServerOptions } from './grpc/types.js';

/** A parsed delivery constructed by a transport strategy. */
export interface RawMessage extends TraceCarrier {
  readonly pattern: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
  /** Set when transport framing failed; `payload` then carries inspectable raw input. */
  readonly parseError?: unknown;
}

/** The broker action applied after dispatch. */
export type Settlement =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: string };

/** A correlated reply a strategy publishes to `RawMessage.replyTo`. */
export type MessageReply =
  | { readonly kind: 'result'; readonly correlationId: string; readonly payload: unknown }
  | { readonly kind: 'error'; readonly correlationId: string; readonly message: string };

/** Handler output and broker settlement are separate facts. */
export interface DispatchOutcome {
  readonly settlement: Settlement;
  readonly reply?: MessageReply;
}

/** What a strategy can truthfully do with a settlement. */
export interface TransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

/** One outbound request, including framework-owned correlation and cancellation. */
export interface TransportRequest extends TraceCarrier {
  readonly pattern: string;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** Public boundary implemented by broker adapters and custom transports. */
export interface TransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  /** Open intake and hand each decoded delivery to the application dispatcher. */
  listen(dispatch: (message: RawMessage) => Promise<DispatchOutcome>): Promise<void>;
  send(request: TransportRequest): Promise<MessageReply>;
  emit(pattern: string, payload: unknown, carrier?: TraceCarrier): Promise<void>;
  /** Stop intake, drain in-flight dispatches under `graceMs`, then close connections. */
  close(graceMs: number): Promise<void>;
}

/** The structural context portion HTTP and message authorisation can share. */
export type WithHeaders = { readonly headers: Readonly<Record<string, string>> };

/** Validated context supplied to one message handler. */
export interface MessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
  readonly span?: Span;
}

/** Public, validator-free description of one decorated handler. */
export interface ResolvedMessagePattern {
  readonly pattern: string;
  readonly handlerName: string;
  readonly semantics: 'request' | 'event';
}

/** Observation and retry policy for one app-owned dispatcher. */
export interface DispatcherOptions {
  readonly onUnhandled: (message: RawMessage) => void;
  readonly onInvalidPayload: (message: RawMessage, error: unknown) => void;
  readonly onHandlerError: (message: RawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: RawMessage, settlement: Settlement) => void;
  readonly maxAttempts?: number;
  readonly retryAfterMs?: (attempt: number) => number;
  readonly observability?: Observability;
}

/** Startup-built exact-pattern dispatcher. */
export interface MessageDispatcher {
  dispatch(message: RawMessage, transport: string): Promise<DispatchOutcome>;
  readonly patterns: readonly string[];
}

/** Hybrid application options consumed by `createApp`. */
export interface AppOptions {
  readonly transports?: readonly TransportStrategy[];
  readonly dispatcher?: DispatcherOptions;
  readonly graceMs?: number;
  readonly observability?: Observability;
  readonly grpc?: GrpcServerOptions;
}

/** Pattern map for a request/response client. Declare concrete maps as type aliases. */
export interface ClientPatterns {
  readonly [pattern: string]: { readonly request: unknown; readonly response: unknown };
}

/** One callable property per request pattern. */
export type MessageClient<P extends ClientPatterns> = {
  readonly [K in keyof P]: (payload: P[K]['request'], span?: Span) => Promise<P[K]['response']>;
};

/** Required timeout and total response-validation map. */
export interface MessageClientOptions<P extends ClientPatterns> {
  readonly timeoutMs: number;
  readonly validate: { readonly [K in keyof P]: (raw: unknown) => P[K]['response'] };
}

/** Pattern map for one-way events. */
export interface EventPatterns {
  readonly [pattern: string]: unknown;
}

/** One callable property per event pattern. */
export type EventPublisher<E extends EventPatterns> = {
  readonly [K in keyof E]: (payload: E[K], span?: Span) => Promise<void>;
};

/** A request was made against a strategy without request/reply support. */
export class TransportUnsupportedError extends Error {
  readonly transport: string;
  readonly operation: 'send';

  constructor(transport: string) {
    super(`transport "${transport}" does not support request/response`);
    this.name = 'TransportUnsupportedError';
    this.transport = transport;
    this.operation = 'send';
  }
}

/** A request did not settle before its required deadline. */
export class MessageTimeoutError extends Error {
  readonly pattern: string;
  readonly timeoutMs: number;
  readonly correlationId: string;

  constructor(pattern: string, timeoutMs: number, correlationId: string) {
    super(`message request "${pattern}" timed out after ${String(timeoutMs)}ms`);
    this.name = 'MessageTimeoutError';
    this.pattern = pattern;
    this.timeoutMs = timeoutMs;
    this.correlationId = correlationId;
  }
}

/** A remote handler failed without exposing its private error detail. */
export class MessageRemoteError extends Error {
  readonly pattern: string;
  readonly correlationId: string;

  constructor(pattern: string, correlationId: string, message: string) {
    super(message);
    this.name = 'MessageRemoteError';
    this.pattern = pattern;
    this.correlationId = correlationId;
  }
}

/** A transport returned a reply for a different outstanding request. */
export class MessageCorrelationError extends Error {
  readonly pattern: string;
  readonly expected: string;
  readonly received: string;

  constructor(pattern: string, expected: string, received: string) {
    super(`message request "${pattern}" received correlation "${received}", expected "${expected}"`);
    this.name = 'MessageCorrelationError';
    this.pattern = pattern;
    this.expected = expected;
    this.received = received;
  }
}

type MessageSemantics = ResolvedMessagePattern['semantics'];
type Validator = (raw: unknown) => unknown;

interface StoredMessagePattern extends ResolvedMessagePattern {
  readonly validate: Validator;
}

interface MessageMetadata {
  [MESSAGE_PATTERNS]?: StoredMessagePattern[];
}

interface BoundMessagePattern extends StoredMessagePattern {
  invoke(ctx: MessageContext<unknown>): Promise<unknown>;
}

const MESSAGE_PATTERNS = Symbol('zmdb.web.microservices.patterns');
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_RETRY_MS = 30_000;

// boundary: MessagePattern and EventPattern are the only writers of this
// private metadata slot, so the typed view is sound.
function messageMetadata(metadata: DecoratorMetadata): MessageMetadata {
  return metadata;
}

function pushPattern(metadata: DecoratorMetadata, pattern: StoredMessagePattern): void {
  const view = messageMetadata(metadata);
  const own = Object.hasOwn(metadata, MESSAGE_PATTERNS) ? view[MESSAGE_PATTERNS] : undefined;
  if (own === undefined) {
    view[MESSAGE_PATTERNS] = [pattern];
  } else {
    own.push(pattern);
  }
}

function ownPatterns(metadata: DecoratorMetadata): readonly StoredMessagePattern[] {
  if (!Object.hasOwn(metadata, MESSAGE_PATTERNS)) {
    return [];
  }
  return messageMetadata(metadata)[MESSAGE_PATTERNS] ?? [];
}

function storedPatterns(cls: Function): readonly StoredMessagePattern[] {
  const metadata = cls[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }

  const baseFirst: DecoratorMetadata[] = [];
  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    baseFirst.unshift(record);
  }

  let composed: readonly StoredMessagePattern[] = [];
  for (const record of baseFirst) {
    const own = ownPatterns(record);
    if (own.length === 0) {
      continue;
    }
    const overridden = new Set(own.map(pattern => pattern.handlerName));
    composed = [...composed.filter(pattern => !overridden.has(pattern.handlerName)), ...own];
  }
  return composed;
}

function patternDecorator<T, R>(
  pattern: string,
  validate: (raw: unknown) => T,
  semantics: MessageSemantics,
): (target: (ctx: MessageContext<T>) => R, context: ClassMethodDecoratorContext) => void {
  return function (_target: (ctx: MessageContext<T>) => R, context: ClassMethodDecoratorContext): void {
    const handlerName = String(context.name);
    pushPattern(context.metadata, { pattern, handlerName, semantics, validate });
  };
}

/** Declare a request/reply handler with its consume-boundary validator. */
export function MessagePattern<T, R>(
  pattern: string,
  validate: (raw: unknown) => T,
): (target: (ctx: MessageContext<T>) => R | Promise<R>, context: ClassMethodDecoratorContext) => void {
  return patternDecorator<T, R | Promise<R>>(pattern, validate, 'request');
}

/** Declare a one-way event handler. Returning a value is a compile error. */
export function EventPattern<T>(
  pattern: string,
  validate: (raw: unknown) => T,
): (target: (ctx: MessageContext<T>) => void | Promise<void>, context: ClassMethodDecoratorContext) => void {
  return patternDecorator<T, void | Promise<void>>(pattern, validate, 'event');
}

/** Read declarations from one class without constructing or discovering it. */
export function getMessagePatterns(cls: abstract new (...args: never[]) => unknown): readonly ResolvedMessagePattern[] {
  return storedPatterns(cls).map(({ pattern, handlerName, semantics }) => ({ pattern, handlerName, semantics }));
}

function constructorOf(instance: object): Function {
  const ctor = instance.constructor;
  if (typeof ctor !== 'function') {
    throw new Error('@zmdb/web: message consumer has no constructor');
  }
  return ctor;
}

function boundPatterns(instance: object): readonly BoundMessagePattern[] {
  return storedPatterns(constructorOf(instance)).map(pattern => {
    const value: unknown = Reflect.get(instance, pattern.handlerName);
    if (typeof value !== 'function') {
      throw new Error(`@zmdb/web: message handler "${pattern.handlerName}" is not callable`);
    }
    return {
      ...pattern,
      async invoke(ctx): Promise<unknown> {
        return Reflect.apply(value, instance, [ctx]);
      },
    };
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`@zmdb/web: ${name} must be a positive integer`);
  }
  return value;
}

function defaultRetryAfter(attempt: number): number {
  return Math.min(MAX_RETRY_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
}

function observe(action: () => void): void {
  try {
    void Promise.resolve(action()).catch(() => undefined);
  } catch {
    // Observation cannot replace dispatch or settlement.
  }
}

function withReply(settlement: Settlement, reply: MessageReply | undefined): DispatchOutcome {
  return reply === undefined ? { settlement } : { settlement, reply };
}

function errorReply(message: RawMessage, detail: string): MessageReply | undefined {
  if (message.replyTo === undefined || message.correlationId === undefined) {
    return undefined;
  }
  return { kind: 'error', correlationId: message.correlationId, message: detail };
}

function isRequestEnvelope(message: RawMessage): boolean {
  return message.replyTo !== undefined && message.correlationId !== undefined;
}

/** Build one exact-pattern map for the supplied application-owned consumers. */
export function createMessageDispatcher(consumers: readonly object[], options: DispatcherOptions): MessageDispatcher {
  const maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
  const byPattern = new Map<string, BoundMessagePattern>();

  for (const consumer of consumers) {
    for (const pattern of boundPatterns(consumer)) {
      if (pattern.pattern.length === 0) {
        throw new RangeError('@zmdb/web: a message pattern cannot be empty');
      }
      if (byPattern.has(pattern.pattern)) {
        throw new Error(`@zmdb/web: duplicate message pattern "${pattern.pattern}"`);
      }
      byPattern.set(pattern.pattern, pattern);
    }
  }

  const failureSettlement = (message: RawMessage, error: unknown): Settlement => {
    observe(() => options.onHandlerError(message, error));
    if (message.deliveryAttempt >= maxAttempts) {
      return { kind: 'dead', reason: 'attempts-exhausted' };
    }
    const retryAfter = options.retryAfterMs ?? defaultRetryAfter;
    let afterMs: number;
    try {
      afterMs = positiveInteger(retryAfter(message.deliveryAttempt), 'retryAfterMs result');
    } catch (policyError) {
      observe(() => options.onHandlerError(message, policyError));
      return { kind: 'dead', reason: 'invalid-retry-policy' };
    }
    return { kind: 'retry', afterMs };
  };

  return {
    patterns: [...byPattern.keys()],

    async dispatch(message, transport): Promise<DispatchOutcome> {
      const binding = byPattern.get(message.pattern);
      if (binding === undefined) {
        observe(() => options.onUnhandled(message));
        return withReply({ kind: 'ack' }, errorReply(message, 'message pattern is not handled'));
      }

      if (message.parseError !== undefined) {
        observe(() => options.onInvalidPayload(message, message.parseError));
        return withReply({ kind: 'dead', reason: 'invalid-payload' }, errorReply(message, 'invalid message payload'));
      }

      let payload: unknown;
      try {
        payload = binding.validate(message.payload);
      } catch (error) {
        observe(() => options.onInvalidPayload(message, error));
        return withReply({ kind: 'dead', reason: 'invalid-payload' }, errorReply(message, 'invalid message payload'));
      }

      if (binding.semantics === 'request' && !isRequestEnvelope(message)) {
        const error = new Error(`request pattern "${message.pattern}" requires correlationId and replyTo`);
        observe(() => options.onHandlerError(message, error));
        return { settlement: { kind: 'dead', reason: 'invalid-request-envelope' } };
      }

      const context: MessageContext<unknown> = {
        kind: 'message',
        pattern: message.pattern,
        payload,
        headers: message.headers,
        correlationId: message.correlationId ?? globalThis.crypto.randomUUID(),
        deliveryAttempt: message.deliveryAttempt,
        transport,
        ...(options.observability?.tracer === undefined
          ? {}
          : {
              span: consumerSpan(
                options.observability,
                message,
                binding.semantics === 'request' ? 'request-reply' : 'queued',
              ),
            }),
      };

      try {
        const result = await binding.invoke(context);
        if (binding.semantics === 'request' && message.correlationId !== undefined) {
          return {
            settlement: { kind: 'ack' },
            reply: { kind: 'result', correlationId: message.correlationId, payload: result },
          };
        }
        return { settlement: { kind: 'ack' } };
      } catch (error) {
        context.span?.recordException(error instanceof Error ? error : new Error(String(error)));
        context.span?.setStatus({ error: true });
        if (binding.semantics === 'request') {
          observe(() => options.onHandlerError(message, error));
          return withReply({ kind: 'ack' }, errorReply(message, 'message handler failed'));
        }
        return { settlement: failureSettlement(message, error) };
      } finally {
        context.span?.end();
      }
    },
  };
}

function requestMethod(
  transport: TransportStrategy,
  pattern: string,
  timeoutMs: number,
  validate: Function,
): (payload: unknown, span?: Span) => Promise<unknown> {
  return async (payload: unknown, span?: Span): Promise<unknown> => {
    if (!transport.capabilities.requestResponse) {
      throw new TransportUnsupportedError(transport.name);
    }

    const correlationId = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    const timeoutError = new MessageTimeoutError(pattern, timeoutMs, correlationId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    const request: TransportRequest = {
      pattern,
      payload,
      correlationId,
      timeoutMs,
      signal: controller.signal,
      ...(span === undefined ? {} : toTraceHeaders(span)),
    };

    try {
      const reply = await Promise.race([Promise.resolve().then(() => transport.send(request)), timeout]);
      if (reply.correlationId !== correlationId) {
        throw new MessageCorrelationError(pattern, correlationId, reply.correlationId);
      }
      if (reply.kind === 'error') {
        throw new MessageRemoteError(pattern, correlationId, reply.message);
      }
      return Reflect.apply(validate, undefined, [reply.payload]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };
}

/** Build a typed request client from a total response-validator map. */
export function createMessageClient<P extends ClientPatterns>(
  transport: TransportStrategy,
  options: MessageClientOptions<P>,
): MessageClient<P> {
  const timeoutMs = positiveInteger(options.timeoutMs, 'timeoutMs');
  // boundary: the mapped type and total validator map have the same key set;
  // every own validator key is installed before the client is returned.
  const client: MessageClient<P> = Object.create(null);
  for (const pattern of Object.keys(options.validate)) {
    const validator: unknown = Reflect.get(options.validate, pattern);
    if (typeof validator !== 'function') {
      throw new Error(`@zmdb/web: message pattern "${pattern}" has no response validator`);
    }
    const installed = Reflect.set(client, pattern, requestMethod(transport, pattern, timeoutMs, validator));
    if (!installed) {
      throw new Error(`@zmdb/web: could not install message client pattern "${pattern}"`);
    }
  }
  return client;
}

/** Build a typed one-way publisher. Methods are cached on first property access. */
export function createEventPublisher<E extends EventPatterns>(transport: TransportStrategy): EventPublisher<E> {
  const methods = new Map<string, (payload: unknown, span?: Span) => Promise<void>>();
  // boundary: the mapped return type limits consumer-visible properties to
  // keyof E; the proxy only turns those string properties into emit calls.
  const target: EventPublisher<E> = Object.create(null);
  return new Proxy(target, {
    get(_target, property, receiver): unknown {
      if (typeof property !== 'string') {
        return Reflect.get(target, property, receiver);
      }
      if (property === 'then') {
        // A synthesized `then` makes the publisher a never-settling thenable.
        return undefined;
      }
      const existing = methods.get(property);
      if (existing !== undefined) {
        return existing;
      }
      const method = (payload: unknown, span?: Span): Promise<void> => {
        if (span === undefined) {
          return transport.emit(property, payload);
        }
        return transport.emit(property, payload, toTraceHeaders(span));
      };
      methods.set(property, method);
      return method;
    },
  });
}
