import type { Observability, Span, TraceCarrier } from '@zmdb/app/observability';
import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';

import type { createApp, WebApplicationOptions } from '../app/index.js';
import type { Ctx, QueryValues } from '../context/index.js';
import type { Guard } from '../middleware/index.js';
import type { GrpcServerOptions } from './grpc/index.js';
import {
  EventPattern,
  MessagePattern,
  type createEventPublisher,
  type createMessageClient,
  type createMessageDispatcher,
  type getMessagePatterns,
  type AppOptions,
  type ClientPatterns,
  type DispatchOutcome,
  type DispatcherOptions,
  type EventPatterns,
  type EventPublisher,
  type MessageClient,
  type MessageClientOptions,
  type MessageContext,
  type MessageDispatcher,
  type MessageReply,
  type RawMessage,
  type ResolvedMessagePattern,
  type Settlement,
  type TransportCapabilities,
  type TransportRequest,
  type TransportStrategy,
  type WithHeaders,
} from './index.js';

type FrozenSettlement =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: string };

interface FrozenTraceCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

interface FrozenRawMessage extends FrozenTraceCarrier {
  readonly pattern: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
  readonly parseError?: unknown;
}

type FrozenMessageReply =
  | { readonly kind: 'result'; readonly correlationId: string; readonly payload: unknown }
  | { readonly kind: 'error'; readonly correlationId: string; readonly message: string };

interface FrozenDispatchOutcome {
  readonly settlement: Settlement;
  readonly reply?: MessageReply;
}

interface FrozenTransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

interface FrozenTransportRequest extends FrozenTraceCarrier {
  readonly pattern: string;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

interface FrozenTransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<DispatchOutcome>): Promise<void>;
  send(request: TransportRequest): Promise<MessageReply>;
  emit(pattern: string, payload: unknown, carrier?: TraceCarrier): Promise<void>;
  close(graceMs: number): Promise<void>;
}

interface FrozenMessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
  readonly span?: Span;
}

type FrozenWithHeaders = { readonly headers: Readonly<Record<string, string>> };

interface FrozenResolvedMessagePattern {
  readonly pattern: string;
  readonly handlerName: string;
  readonly semantics: 'request' | 'event';
}

interface FrozenDispatcherOptions {
  readonly onUnhandled: (message: RawMessage) => void;
  readonly onInvalidPayload: (message: RawMessage, error: unknown) => void;
  readonly onHandlerError: (message: RawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: RawMessage, settlement: Settlement) => void;
  readonly maxAttempts?: number;
  readonly retryAfterMs?: (attempt: number) => number;
  readonly observability?: Observability;
}

interface FrozenMessageDispatcher {
  dispatch(message: RawMessage, transport: string): Promise<DispatchOutcome>;
  readonly patterns: readonly string[];
}

interface Sku {
  readonly sku: string;
}

interface Placed {
  readonly id: string;
  readonly sku: string;
}

function sku(raw: unknown): Sku {
  if (typeof raw !== 'object' || raw === null || !('sku' in raw) || typeof raw.sku !== 'string') {
    throw new Error('sku required');
  }
  return { sku: raw.sku };
}

export type SettlementShape = Expect<Equal<Settlement, FrozenSettlement>>;
export type TraceCarrierShape = Expect<Equal<TraceCarrier, FrozenTraceCarrier>>;
export type RawMessageShape = Expect<Equal<RawMessage, FrozenRawMessage>>;
export type MessageReplyShape = Expect<Equal<MessageReply, FrozenMessageReply>>;
export type DispatchOutcomeShape = Expect<Equal<DispatchOutcome, FrozenDispatchOutcome>>;
export type CapabilitiesShape = Expect<Equal<TransportCapabilities, FrozenTransportCapabilities>>;
export type TransportRequestShape = Expect<Equal<TransportRequest, FrozenTransportRequest>>;
export type StrategyShape = Expect<Equal<TransportStrategy, FrozenTransportStrategy>>;
export type MessageContextShape = Expect<Equal<MessageContext<number>, FrozenMessageContext<number>>>;
export type WithHeadersShape = Expect<Equal<WithHeaders, FrozenWithHeaders>>;
export type ResolvedPatternShape = Expect<Equal<ResolvedMessagePattern, FrozenResolvedMessagePattern>>;
export type DispatcherOptionsShape = Expect<Equal<DispatcherOptions, FrozenDispatcherOptions>>;
export type DispatcherShape = Expect<Equal<MessageDispatcher, FrozenMessageDispatcher>>;

type HttpContext = Ctx<Record<string, string>, unknown, QueryValues>;
type GuardContext = Parameters<Guard['canActivate']>[0];

export type GuardStillTakesHttpContext = Expect<Equal<GuardContext, HttpContext>>;
export type HttpContextSharesHeaders = Expect<Extends<HttpContext, WithHeaders>>;
export type MessageContextSharesHeaders = Expect<Extends<MessageContext<unknown>, WithHeaders>>;
export type MessageContextIsNotHttpContext = ExpectNot<Extends<MessageContext<unknown>, HttpContext>>;
export type HttpContextIsNotMessageContext = ExpectNot<Extends<HttpContext, MessageContext<unknown>>>;

type FrozenMessagePattern = <T, R>(
  pattern: string,
  validate: (raw: unknown) => T,
) => (target: (ctx: MessageContext<T>) => R | Promise<R>, context: ClassMethodDecoratorContext) => void;

type FrozenEventPattern = <T>(
  pattern: string,
  validate: (raw: unknown) => T,
) => (target: (ctx: MessageContext<T>) => void | Promise<void>, context: ClassMethodDecoratorContext) => void;

export type MessagePatternSignature = Expect<Equal<typeof MessagePattern, FrozenMessagePattern>>;
export type EventPatternSignature = Expect<Equal<typeof EventPattern, FrozenEventPattern>>;

class ValidHandlers {
  @MessagePattern('sku.get', sku)
  get(ctx: MessageContext<Sku>): Placed {
    return { id: '1', sku: ctx.payload.sku };
  }

  @EventPattern('sku.seen', sku)
  seen(_ctx: MessageContext<Sku>): void {}
}

class InvalidHandlers {
  // @ts-expect-error - a synchronous event handler cannot return a value.
  @EventPattern('sku.sync', sku)
  sync(_ctx: MessageContext<Sku>): number {
    return 1;
  }

  // @ts-expect-error - an asynchronous event handler cannot return a value.
  @EventPattern('sku.async', sku)
  async asyncValue(_ctx: MessageContext<Sku>): Promise<number> {
    return 1;
  }

  // @ts-expect-error - the validator output fixes the handler payload type.
  @MessagePattern('sku.mismatch', sku)
  mismatch(_ctx: MessageContext<Placed>): void {}
}

void ValidHandlers;
void InvalidHandlers;

type FrozenGetMessagePatterns = (cls: abstract new (...args: never[]) => unknown) => readonly ResolvedMessagePattern[];
type FrozenCreateMessageDispatcher = (consumers: readonly object[], options: DispatcherOptions) => MessageDispatcher;

export type GetMessagePatternsSignature = Expect<Equal<typeof getMessagePatterns, FrozenGetMessagePatterns>>;
export type CreateDispatcherSignature = Expect<Equal<typeof createMessageDispatcher, FrozenCreateMessageDispatcher>>;

type Calls = {
  readonly 'sku.get': { readonly request: Sku; readonly response: Placed };
};

type FrozenClientPatterns = {
  readonly [pattern: string]: { readonly request: unknown; readonly response: unknown };
};

type FrozenCallsClient = {
  readonly 'sku.get': (payload: Sku, span?: Span) => Promise<Placed>;
};

interface FrozenCallsOptions {
  readonly timeoutMs: number;
  readonly validate: {
    readonly 'sku.get': (raw: unknown) => Placed;
  };
}

export type ClientPatternsShape = Expect<Equal<ClientPatterns, FrozenClientPatterns>>;
export type ClientShape = Expect<Equal<MessageClient<Calls>, FrozenCallsClient>>;
export type ClientOptionsShape = Expect<Equal<MessageClientOptions<Calls>, FrozenCallsOptions>>;
export type ClientOptionsHaveNoCorrelationId = Expect<
  Equal<keyof MessageClientOptions<Calls>, 'timeoutMs' | 'validate'>
>;

type FrozenCreateMessageClient = <P extends ClientPatterns>(
  transport: TransportStrategy,
  options: MessageClientOptions<P>,
) => MessageClient<P>;

export type CreateClientSignature = Expect<Equal<typeof createMessageClient, FrozenCreateMessageClient>>;

declare const client: MessageClient<Calls>;
declare const span: Span;
client['sku.get']({ sku: 'A' });
client['sku.get']({ sku: 'A' }, span);
// @ts-expect-error - request payloads are checked by pattern.
client['sku.get']({ id: '1' });

interface CallsInterface {
  readonly 'sku.get': { readonly request: Sku; readonly response: Placed };
}

// @ts-expect-error - concrete pattern maps must be type aliases, not interfaces.
export type InterfaceClient = MessageClient<CallsInterface>;

type Events = {
  readonly 'sku.seen': Sku;
};

type FrozenEvents = { readonly [pattern: string]: unknown };
type FrozenEventPublisher = { readonly 'sku.seen': (payload: Sku, span?: Span) => Promise<void> };

export type EventPatternsShape = Expect<Equal<EventPatterns, FrozenEvents>>;
export type EventPublisherShape = Expect<Equal<EventPublisher<Events>, FrozenEventPublisher>>;

type FrozenCreateEventPublisher = <E extends EventPatterns>(transport: TransportStrategy) => EventPublisher<E>;

export type CreateEventPublisherSignature = Expect<Equal<typeof createEventPublisher, FrozenCreateEventPublisher>>;

declare const publisher: EventPublisher<Events>;
publisher['sku.seen']({ sku: 'A' });
publisher['sku.seen']({ sku: 'A' }, span);
// @ts-expect-error - event payloads are checked by pattern.
publisher['sku.seen']({ id: '1' });

interface FrozenAppOptions {
  readonly transports?: readonly TransportStrategy[];
  readonly dispatcher?: DispatcherOptions;
  readonly graceMs?: number;
  readonly observability?: Observability;
  readonly grpc?: GrpcServerOptions;
}

export type AppOptionsShape = Expect<Equal<AppOptions, FrozenAppOptions>>;
export type CreateAppTakesOptions = Expect<Equal<Parameters<typeof createApp>[1], WebApplicationOptions | undefined>>;
