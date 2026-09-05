import { describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_CLIENT_ERRORS,
  PublicCustomTransport,
  settlementKind,
} from '../../../../fixtures/app-custom-transport.js';
import { createApplication, type Application } from '../application.js';
import { lazy, Module, type ModuleClass } from '../modules/index.js';
import { toTraceHeaders, type Span, type SpanContext, type TraceCarrier, type Tracer } from '../observability/index.js';
import {
  createEventPublisher,
  createMessageClient,
  createMessageDispatcher,
  EventPattern,
  getMessagePatterns,
  MessageCorrelationError,
  MessagePattern,
  MessageRemoteError,
  MessageTimeoutError,
  transportExtension,
  TransportUnsupportedError,
  type DispatchOutcome,
  type DispatcherOptions,
  type MessageContext,
  type MessageReply,
  type RawMessage,
  type TransportCapabilities,
  type TransportRequest,
  type TransportStrategy,
} from './index.js';

const ALL_TRUE: TransportCapabilities = { redelivery: true, deadLetter: true, requestResponse: true };
const NO_REDELIVERY: TransportCapabilities = { redelivery: false, deadLetter: false, requestResponse: true };

interface FakeTransport extends TransportStrategy {
  dispatch: ((message: RawMessage) => Promise<DispatchOutcome>) | undefined;
  readonly sent: TransportRequest[];
  readonly emitted: {
    readonly pattern: string;
    readonly payload: unknown;
    readonly carrier?: TraceCarrier;
  }[];
  readonly emitArgumentCounts: number[];
}

interface FakeOptions {
  readonly capabilities?: TransportCapabilities;
  readonly close?: Error | ((graceMs: number) => Promise<void>);
  readonly listen?: 'resolve' | 'reject';
  readonly send?: (request: TransportRequest) => Promise<MessageReply>;
}

function fakeTransport(name: string, log: string[] = [], options: FakeOptions = {}): FakeTransport {
  const capabilities = options.capabilities ?? ALL_TRUE;
  const sent: TransportRequest[] = [];
  const emitted: {
    readonly pattern: string;
    readonly payload: unknown;
    readonly carrier?: TraceCarrier;
  }[] = [];
  const emitArgumentCounts: number[] = [];
  const transport: FakeTransport = {
    name,
    capabilities,
    dispatch: undefined,
    sent,
    emitted,
    emitArgumentCounts,
    listen(dispatch) {
      log.push(`listen:${name}`);
      if (options.listen === 'reject') {
        return Promise.reject(new Error(`${name} refused the connection`));
      }
      transport.dispatch = dispatch;
      return Promise.resolve();
    },
    send(request) {
      sent.push(request);
      if (options.send !== undefined) {
        return options.send(request);
      }
      return Promise.resolve({ kind: 'result', correlationId: request.correlationId, payload: request.payload });
    },
    emit(...args: [pattern: string, payload: unknown, carrier?: TraceCarrier]) {
      const [pattern, payload, carrier] = args;
      emitArgumentCounts.push(args.length);
      emitted.push({ pattern, payload, ...(carrier === undefined ? {} : { carrier }) });
      return Promise.resolve();
    },
    close(graceMs) {
      log.push(`close:${name}:${String(graceMs)}`);
      if (options.close === undefined) {
        return Promise.resolve();
      }
      if (options.close instanceof Error) {
        return Promise.reject(options.close);
      }
      return options.close(graceMs);
    },
  };
  return transport;
}

function normalizedLifecycleLog(log: readonly string[]): readonly string[] {
  return log.map(entry => entry.replace(/^(close:[^:]+|stop:intake):\d+$/, '$1:<grace>'));
}

function lifecycleGraceValues(log: readonly string[]): readonly number[] {
  return log.flatMap(entry => {
    const match = /^(?:close:[^:]+|stop:intake):(\d+)$/.exec(entry);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
}

interface DeliveryOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly correlationId?: string;
  readonly replyTo?: string;
  readonly deliveryAttempt?: number;
  readonly carrier?: TraceCarrier;
  readonly parseError?: unknown;
}

function delivery(pattern: string, payload: unknown = { id: 1 }, options: DeliveryOptions = {}): RawMessage {
  return {
    pattern,
    payload,
    headers: options.headers ?? {},
    correlationId: options.correlationId,
    replyTo: options.replyTo,
    deliveryAttempt: options.deliveryAttempt ?? 1,
    ...options.carrier,
    ...(options.parseError === undefined ? {} : { parseError: options.parseError }),
  };
}

const TRACE_STATE = 'vendor=state';
const PARENT_CONTEXT = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: 1,
  traceState: TRACE_STATE,
} satisfies SpanContext;

function fixedSpan(context: SpanContext = PARENT_CONTEXT): Span {
  return {
    updateName: () => undefined,
    setAttribute: () => undefined,
    recordException: () => undefined,
    setStatus: () => undefined,
    end: () => undefined,
    spanContext: () => context,
  };
}

function traceStateHeader(context: SpanContext | undefined): string | undefined {
  return context?.traceState;
}

interface StartedSpan {
  readonly name: string;
  readonly parent?: SpanContext;
  readonly link?: SpanContext;
  ended: boolean;
}

function recordingTracer(): { readonly tracer: Tracer; readonly starts: StartedSpan[] } {
  const starts: StartedSpan[] = [];
  let nextId = 1;
  return {
    starts,
    tracer: {
      startSpan(name, options) {
        nextId += 1;
        const started: StartedSpan = {
          name,
          ...(options?.parent === undefined ? {} : { parent: options.parent }),
          ...(options?.link === undefined ? {} : { link: options.link }),
          ended: false,
        };
        starts.push(started);
        const context: SpanContext = {
          traceId: options?.parent?.traceId ?? nextId.toString(16).padStart(32, '0'),
          spanId: nextId.toString(16).padStart(16, '0'),
          traceFlags: 1,
        };
        return {
          updateName: () => undefined,
          setAttribute: () => undefined,
          recordException: () => undefined,
          setStatus: () => undefined,
          end: () => {
            started.ended = true;
          },
          spanContext: () => context,
        };
      },
    },
  };
}

function sinks(log: string[]): DispatcherOptions {
  return {
    onUnhandled: message => log.push(`unhandled:${message.pattern}`),
    onInvalidPayload: message => log.push(`invalid:${message.pattern}`),
    onHandlerError: message => log.push(`handler-error:${message.pattern}`),
  };
}

interface OrderRequest {
  readonly id: number;
}

function orderRequest(raw: unknown): OrderRequest {
  if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
    throw new Error('order request requires a numeric id');
  }
  return { id: raw.id };
}

function textReply(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('reply must be text');
  }
  return raw;
}

function orderId(raw: unknown): number {
  return orderRequest(raw).id;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function createMessagingApplication(
  root: ModuleClass,
  options: {
    readonly transports: readonly TransportStrategy[];
    readonly dispatcher: DispatcherOptions;
    readonly graceMs?: number;
  },
): Application {
  return createApplication(root, {
    extensions: [
      transportExtension({
        transports: options.transports,
        dispatcher: options.dispatcher,
      }),
    ],
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
  });
}

function countMetadataReads(target: object): {
  readonly count: () => number;
  readonly restore: () => void;
} {
  const original = Object.getOwnPropertyDescriptor(target, Symbol.metadata);
  const stored = original?.value;
  let reads = 0;
  Object.defineProperty(target, Symbol.metadata, {
    configurable: true,
    enumerable: original?.enumerable ?? false,
    get(): unknown {
      reads += 1;
      return stored;
    },
  });
  return {
    count: () => reads,
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(target, Symbol.metadata);
      } else {
        Object.defineProperty(target, Symbol.metadata, original);
      }
    },
  };
}

async function outcomeOf(app: Application): Promise<'init resolved' | 'init rejected'> {
  return app.init().then(
    () => 'init resolved' as const,
    () => 'init rejected' as const,
  );
}

describe('application messaging lifecycle (#648)', () => {
  it('listen is called after onApplicationBootstrap', async () => {
    const log: string[] = [];

    class Consumer {
      onModuleInit(): void {
        log.push('onModuleInit:Consumer');
      }

      onApplicationBootstrap(): void {
        log.push('onApplicationBootstrap:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log)],
      dispatcher: sinks(log),
    });
    await app.init();

    expect(log).toEqual(['onModuleInit:Consumer', 'onApplicationBootstrap:Consumer', 'listen:a']);
  });

  it('behaves as specified when the broker connection fails at startup', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log, { listen: 'reject' })],
      dispatcher: sinks(log),
    });

    await expect(app.init()).rejects.toThrow('b refused the connection');
    expect(normalizedLifecycleLog(log)).toEqual(['listen:a', 'listen:b', 'close:b:<grace>', 'close:a:<grace>']);
    expect(lifecycleGraceValues(log).every(value => value >= 0 && value <= 5_000)).toBe(true);
  });

  it('dispose closes transports before running shutdown hooks', async () => {
    const log: string[] = [];

    class Consumer {
      onShutdown(): void {
        log.push('onShutdown:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log)],
      dispatcher: sinks(log),
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();

    expect(normalizedLifecycleLog(log)).toEqual(['close:b:<grace>', 'close:a:<grace>', 'onShutdown:Consumer']);
    expect(lifecycleGraceValues(log).every(value => value >= 0 && value <= 5_000)).toBe(true);
  });

  it('a close failure does not skip remaining transports or shutdown hooks', async () => {
    const log: string[] = [];
    const closeError = new Error('b could not close');
    const shutdownError = new Error('consumer could not shut down');

    class Consumer {
      onShutdown(): void {
        log.push('onShutdown:Consumer');
        throw shutdownError;
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log, { close: closeError })],
      dispatcher: sinks(log),
    });
    await app.init();
    log.length = 0;

    let disposalError: unknown;
    try {
      await app[Symbol.asyncDispose]();
    } catch (error) {
      disposalError = error;
    }
    expect(disposalError).toBeInstanceOf(AggregateError);
    if (!(disposalError instanceof AggregateError)) {
      throw new Error('application shutdown did not aggregate transport and lifecycle failures');
    }
    expect(disposalError.errors).toEqual([closeError, shutdownError]);
    expect(normalizedLifecycleLog(log)).toEqual(['close:b:<grace>', 'close:a:<grace>', 'onShutdown:Consumer']);
    expect(lifecycleGraceValues(log).every(value => value >= 0 && value <= 5_000)).toBe(true);
  });

  it('init after disposal rejects without opening a transport', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log)],
      dispatcher: sinks(log),
    });
    await app[Symbol.asyncDispose]();

    await expect(app.init()).rejects.toThrow('application is shutting down');
    expect(log).toEqual([]);
  });

  it('all transport closes consume one application grace budget', async () => {
    const log: string[] = [];
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);

    @Module({ controllers: [] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [
        fakeTransport('a', log),
        fakeTransport('b', log, {
          close: () => {
            now += 50;
            return Promise.resolve();
          },
        }),
      ],
      dispatcher: sinks(log),
      graceMs: 250,
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();

    expect(log).toEqual(['close:b:250', 'close:a:200']);
    clock.mockRestore();
  });

  it('Application gains no connectMicroservice and no startAllMicroservices', () => {
    @Module({ controllers: [] })
    class Root {}

    const app = createMessagingApplication(Root, { transports: [], dispatcher: sinks([]) });

    expect(Object.keys(app).toSorted()).toEqual(['container', 'init', 'lazy']);
    expect(typeof app[Symbol.asyncDispose]).toBe('function');
  });

  it('drains in-flight handlers within the grace period and then closes connections', async () => {
    const log: string[] = [];
    const started = deferred<void>();
    const release = deferred<void>();

    class Consumer {
      @EventPattern('orders.drain', orderRequest)
      async drain(_ctx: MessageContext<OrderRequest>): Promise<void> {
        log.push('handler:start');
        started.resolve();
        await release.promise;
        log.push('handler:finish');
      }

      onShutdown(): void {
        log.push('onShutdown:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = new PublicCustomTransport(log);
    const app = createMessagingApplication(Root, {
      transports: [transport],
      dispatcher: sinks(log),
      graceMs: 5_000,
    });
    await app.init();
    const dispatch = transport.deliver(delivery('orders.drain'));
    await started.promise;

    const disposal = app[Symbol.asyncDispose]();
    await vi.waitFor(() => expect(transport.accepting).toBe(false));
    expect(transport.connectionOpen).toBe(true);
    await expect(transport.deliver(delivery('orders.drain'))).rejects.toThrow('not accepting deliveries');

    release.resolve();
    await dispatch;
    await disposal;

    expect(normalizedLifecycleLog(log)).toEqual([
      'listen:public-custom',
      'handler:start',
      'stop:intake:<grace>',
      'handler:finish',
      'close:connection',
      'onShutdown:Consumer',
    ]);
    expect(lifecycleGraceValues(log).every(value => value >= 0 && value <= 5_000)).toBe(true);
  });

  it('closes a custom transport when its bounded drain expires', async () => {
    const log: string[] = [];
    const started = deferred<void>();
    const release = deferred<void>();

    class Consumer {
      @EventPattern('orders.hung', orderRequest)
      async hung(_ctx: MessageContext<OrderRequest>): Promise<void> {
        log.push('handler:start');
        started.resolve();
        await release.promise;
        log.push('handler:finish');
      }

      onShutdown(): void {
        log.push('onShutdown:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = new PublicCustomTransport(log);
    const app = createMessagingApplication(Root, {
      transports: [transport],
      dispatcher: sinks(log),
      graceMs: 5,
    });
    await app.init();
    const dispatch = transport.deliver(delivery('orders.hung'));
    await started.promise;

    await expect(app[Symbol.asyncDispose]()).rejects.toThrow(/did not drain within \d+ms/);
    expect(transport.connectionOpen).toBe(false);
    expect(normalizedLifecycleLog(log)).toEqual([
      'listen:public-custom',
      'handler:start',
      'stop:intake:<grace>',
      'close:connection',
      'onShutdown:Consumer',
    ]);
    expect(lifecycleGraceValues(log).every(value => value >= 0 && value <= 5)).toBe(true);

    release.resolve();
    await dispatch;
  });

  it('init is idempotent and opens each transport once', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a', log)],
      dispatcher: sinks(log),
    });
    await Promise.all([app.init(), app.init()]);

    expect(log).toEqual(['listen:a']);
  });

  it('refuses message handlers in lazy modules because the startup map is closed', async () => {
    class LazyConsumer {
      @EventPattern('lazy.event', orderRequest)
      consume(_ctx: MessageContext<OrderRequest>): void {}
    }

    @Module({ controllers: [LazyConsumer] })
    class LazyModule {}

    @Module({ imports: [lazy(LazyModule)] })
    class Root {}

    const app = createMessagingApplication(Root, {
      transports: [fakeTransport('a')],
      dispatcher: sinks([]),
    });

    await expect(app.init()).rejects.toThrow(/LazyConsumer.*must be eager/);
  });
});

describe('message dispatcher (#559)', () => {
  it('an unknown pattern acks and reaches onUnhandled', async () => {
    const log: string[] = [];
    const dispatcher = createMessageDispatcher([], sinks(log));

    await expect(dispatcher.dispatch(delivery('orders.nobody'), 'memory')).resolves.toEqual({
      settlement: { kind: 'ack' },
    });
    expect(log).toEqual(['unhandled:orders.nobody']);
  });

  it('an async observation failure cannot replace the settlement', async () => {
    const observed = vi.fn();
    const dispatcher = createMessageDispatcher([], {
      ...sinks([]),
      onUnhandled: async () => {
        observed();
        throw new Error('observation failed');
      },
    });

    await expect(dispatcher.dispatch(delivery('orders.nobody'), 'memory')).resolves.toEqual({
      settlement: { kind: 'ack' },
    });
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(observed).toHaveBeenCalledOnce();
  });

  it('an unknown request receives a generic correlated error instead of hanging', async () => {
    const dispatcher = createMessageDispatcher([], sinks([]));

    await expect(
      dispatcher.dispatch(delivery('orders.nobody', {}, { correlationId: 'c1', replyTo: 'reply:a' }), 'memory'),
    ).resolves.toEqual({
      settlement: { kind: 'ack' },
      reply: { kind: 'error', correlationId: 'c1', message: 'message pattern is not handled' },
    });
  });

  it('constructing a dispatcher over a strategy with redelivery false and no onUndeliverable throws', async () => {
    @Module({ controllers: [] })
    class Root {}

    const transport = fakeTransport('redis-pubsub', [], { capabilities: NO_REDELIVERY });
    const app = createMessagingApplication(Root, {
      transports: [transport],
      dispatcher: sinks([]),
    });

    expect({ outcome: await outcomeOf(app), listenCalled: transport.dispatch !== undefined }).toEqual({
      outcome: 'init rejected',
      listenCalled: false,
    });
  });

  it('resolves the handler through a structure built at startup', async () => {
    const seen: number[] = [];

    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(ctx: MessageContext<OrderRequest>): void {
        seen.push(ctx.payload.id);
      }
    }

    const dispatcher = createMessageDispatcher([new Consumer()], sinks([]));

    expect(dispatcher.patterns).toEqual(['orders.placed']);
    await expect(dispatcher.dispatch(delivery('orders.placed', { id: 9 }), 'nats')).resolves.toEqual({
      settlement: { kind: 'ack' },
    });
    expect(seen).toEqual([9]);
  });

  it('the pattern map is built once', async () => {
    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {}
    }

    const counter = countMetadataReads(Consumer);
    const dispatcher = createMessageDispatcher([new Consumer()], sinks([]));
    const afterConstruction = counter.count();
    for (let index = 0; index < 5; index += 1) {
      await dispatcher.dispatch(delivery('orders.placed', { id: index }), 'memory');
    }
    const readsDuringDispatch = counter.count() - afterConstruction;
    counter.restore();

    expect({ readsDuringDispatch, dispatches: 5 }).toEqual({ readsDuringDispatch: 0, dispatches: 5 });
  });

  it('a handler never sees an unvalidated payload', async () => {
    let calls = 0;

    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {
        calls += 1;
      }
    }

    const log: string[] = [];
    const dispatcher = createMessageDispatcher([new Consumer()], sinks(log));
    const outcome = await dispatcher.dispatch(delivery('orders.placed', { id: 'wrong' }), 'memory');

    expect(outcome).toEqual({ settlement: { kind: 'dead', reason: 'invalid-payload' } });
    expect(calls).toBe(0);
    expect(log).toEqual(['invalid:orders.placed']);
  });

  it('an unparseable message reaches onInvalidPayload with the raw text', async () => {
    const invalid: { readonly payload: unknown; readonly error: unknown }[] = [];

    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {}
    }

    const dispatcher = createMessageDispatcher([new Consumer()], {
      ...sinks([]),
      onInvalidPayload: (message, error) => invalid.push({ payload: message.payload, error }),
    });
    const parseError = new SyntaxError('invalid JSON');
    const outcome = await dispatcher.dispatch(delivery('orders.placed', '{"id":', { parseError }), 'memory');

    expect(outcome).toEqual({ settlement: { kind: 'dead', reason: 'invalid-payload' } });
    expect(invalid).toEqual([{ payload: '{"id":', error: parseError }]);
  });

  it('a thrown event handler settles retry until maxAttempts and then dead', async () => {
    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {
        throw new Error('database unavailable');
      }
    }

    const log: string[] = [];
    const dispatcher = createMessageDispatcher([new Consumer()], {
      ...sinks(log),
      maxAttempts: 3,
      retryAfterMs: attempt => attempt * 250,
    });

    const outcomes = await Promise.all(
      [1, 2, 3].map(deliveryAttempt =>
        dispatcher.dispatch(delivery('orders.placed', { id: 1 }, { deliveryAttempt }), 'rabbit'),
      ),
    );

    expect(outcomes).toEqual([
      { settlement: { kind: 'retry', afterMs: 250 } },
      { settlement: { kind: 'retry', afterMs: 500 } },
      { settlement: { kind: 'dead', reason: 'attempts-exhausted' } },
    ]);
    expect(log).toEqual(['handler-error:orders.placed', 'handler-error:orders.placed', 'handler-error:orders.placed']);
  });

  it('request handlers return a correlated result reply', async () => {
    const seen: MessageContext<OrderRequest>[] = [];

    class Consumer {
      @MessagePattern('orders.get', orderRequest)
      get(ctx: MessageContext<OrderRequest>): { readonly id: number; readonly transport: string } {
        seen.push(ctx);
        return { id: ctx.payload.id, transport: ctx.transport };
      }
    }

    const dispatcher = createMessageDispatcher([new Consumer()], sinks([]));
    const outcome = await dispatcher.dispatch(
      delivery(
        'orders.get',
        { id: 7 },
        {
          correlationId: 'request-7',
          replyTo: 'reply:caller',
          headers: { authorization: 'Bearer token' },
        },
      ),
      'nats',
    );

    expect(outcome).toEqual({
      settlement: { kind: 'ack' },
      reply: {
        kind: 'result',
        correlationId: 'request-7',
        payload: { id: 7, transport: 'nats' },
      },
    });
    expect(seen[0]).toMatchObject({
      kind: 'message',
      correlationId: 'request-7',
      headers: { authorization: 'Bearer token' },
      transport: 'nats',
    });
  });

  it('a throwing request handler returns a generic remote error and acks', async () => {
    class Consumer {
      @MessagePattern('orders.get', orderRequest)
      get(_ctx: MessageContext<OrderRequest>): never {
        throw new Error('select * from secret_orders failed');
      }
    }

    const log: string[] = [];
    const dispatcher = createMessageDispatcher([new Consumer()], sinks(log));
    const outcome = await dispatcher.dispatch(
      delivery('orders.get', { id: 7 }, { correlationId: 'c7', replyTo: 'reply:caller' }),
      'rabbit',
    );

    expect(outcome).toEqual({
      settlement: { kind: 'ack' },
      reply: { kind: 'error', correlationId: 'c7', message: 'message handler failed' },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret_orders');
    expect(log).toEqual(['handler-error:orders.get']);
  });

  it('a request declaration without a reply envelope is dead before the handler runs', async () => {
    let calls = 0;

    class Consumer {
      @MessagePattern('orders.get', orderRequest)
      get(_ctx: MessageContext<OrderRequest>): void {
        calls += 1;
      }
    }

    const log: string[] = [];
    const dispatcher = createMessageDispatcher([new Consumer()], sinks(log));
    const outcome = await dispatcher.dispatch(delivery('orders.get', { id: 1 }), 'memory');

    expect(outcome).toEqual({ settlement: { kind: 'dead', reason: 'invalid-request-envelope' } });
    expect(calls).toBe(0);
    expect(log).toEqual(['handler-error:orders.get']);
  });

  it('an event without an inbound correlation id receives one for logging', async () => {
    const correlations: string[] = [];

    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(ctx: MessageContext<OrderRequest>): void {
        correlations.push(ctx.correlationId);
      }
    }

    const dispatcher = createMessageDispatcher([new Consumer()], sinks([]));
    await dispatcher.dispatch(delivery('orders.placed', { id: 1 }), 'memory');
    await dispatcher.dispatch(delivery('orders.placed', { id: 2 }), 'memory');

    expect(correlations).toHaveLength(2);
    expect(correlations[0]).not.toBe(correlations[1]);
    expect(correlations.every(value => value.length > 0)).toBe(true);
  });

  it('duplicate exact patterns are a construction error', () => {
    class First {
      @EventPattern('orders.placed', orderRequest)
      first(_ctx: MessageContext<OrderRequest>): void {}
    }

    class Second {
      @EventPattern('orders.placed', orderRequest)
      second(_ctx: MessageContext<OrderRequest>): void {}
    }

    expect(() => createMessageDispatcher([new First(), new Second()], sinks([]))).toThrow(
      /duplicate message pattern "orders\.placed"/,
    );
  });

  it('an undeliverable settlement reaches the required sink', async () => {
    class Consumer {
      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {
        throw new Error('not yet');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const log: string[] = [];
    const transport = fakeTransport('redis', log, { capabilities: NO_REDELIVERY });
    const app = createMessagingApplication(Root, {
      transports: [transport],
      dispatcher: {
        ...sinks(log),
        onUndeliverable: async (message, settlement) => {
          log.push(`undeliverable:${message.pattern}:${settlement.kind}`);
          throw new Error('observation failed');
        },
      },
    });
    await app.init();
    await transport.dispatch?.(delivery('orders.placed', { id: 1 }));
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(log).toContain('undeliverable:orders.placed:retry');
  });

  it('getMessagePatterns reads declarations without constructing the class', () => {
    let constructions = 0;

    class Consumer {
      constructor() {
        constructions += 1;
      }

      @MessagePattern('orders.get', orderRequest)
      get(_ctx: MessageContext<OrderRequest>): void {}

      @EventPattern('orders.placed', orderRequest)
      placed(_ctx: MessageContext<OrderRequest>): void {}
    }

    expect(getMessagePatterns(Consumer)).toEqual([
      { pattern: 'orders.get', handlerName: 'get', semantics: 'request' },
      { pattern: 'orders.placed', handlerName: 'placed', semantics: 'event' },
    ]);
    expect(constructions).toBe(0);
  });
});

describe('typed message clients (#559)', () => {
  type Calls = {
    readonly 'orders.get': {
      readonly request: { readonly id: number; readonly correlationId?: string };
      readonly response: string;
    };
  };

  it('a correlation id is generated per call and is not read from the payload', async () => {
    const transport = fakeTransport('memory', [], {
      send: request =>
        Promise.resolve({
          kind: 'result',
          correlationId: request.correlationId,
          payload: `order:${String(orderId(request.payload))}`,
        }),
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 1_000,
      validate: { 'orders.get': textReply },
    });

    await client['orders.get']({ id: 1, correlationId: 'caller-controlled' });
    await client['orders.get']({ id: 2 });

    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[0]?.correlationId).not.toBe('caller-controlled');
    expect(transport.sent[0]?.correlationId).not.toBe(transport.sent[1]?.correlationId);
  });

  it('propagates request and event trace carriers through a loopback transport and ends consumer spans', async () => {
    const recorded = recordingTracer();
    const requestContexts: MessageContext<OrderRequest>[] = [];
    const eventContexts: MessageContext<OrderRequest>[] = [];

    class Consumer {
      @MessagePattern('orders.get', orderRequest)
      get(ctx: MessageContext<OrderRequest>): string {
        requestContexts.push(ctx);
        return `order:${String(ctx.payload.id)}`;
      }

      @EventPattern('orders.placed', orderRequest)
      placed(ctx: MessageContext<OrderRequest>): void {
        eventContexts.push(ctx);
      }
    }

    const dispatcher = createMessageDispatcher([new Consumer()], {
      ...sinks([]),
      observability: { tracer: recorded.tracer },
    });
    const sent: TransportRequest[] = [];
    const emitted: (TraceCarrier | undefined)[] = [];
    const delivered: RawMessage[] = [];
    let dispatch: ((message: RawMessage) => Promise<DispatchOutcome>) | undefined;
    const transport: TransportStrategy = {
      name: 'loopback',
      capabilities: ALL_TRUE,
      listen(handler) {
        dispatch = handler;
        return Promise.resolve();
      },
      async send(request) {
        sent.push(request);
        if (dispatch === undefined) {
          throw new Error('loopback transport is not listening');
        }
        const message: RawMessage = {
          pattern: request.pattern,
          payload: request.payload,
          headers: {},
          correlationId: request.correlationId,
          replyTo: `loopback:${request.correlationId}`,
          deliveryAttempt: 1,
          ...(request.traceparent === undefined ? {} : { traceparent: request.traceparent }),
          ...(request.tracestate === undefined ? {} : { tracestate: request.tracestate }),
        };
        delivered.push(message);
        const outcome = await dispatch(message);
        if (outcome.reply === undefined) {
          throw new Error('loopback request produced no reply');
        }
        return outcome.reply;
      },
      async emit(pattern, payload, carrier) {
        emitted.push(carrier);
        if (dispatch === undefined) {
          throw new Error('loopback transport is not listening');
        }
        const message: RawMessage = {
          pattern,
          payload,
          headers: {},
          correlationId: undefined,
          replyTo: undefined,
          deliveryAttempt: 1,
          ...carrier,
        };
        delivered.push(message);
        await dispatch(message);
      },
      close() {
        return Promise.resolve();
      },
    };
    await transport.listen(message => dispatcher.dispatch(message, transport.name));

    const span = fixedSpan();
    const carrier = toTraceHeaders(span);
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 1_000,
      validate: { 'orders.get': textReply },
    });
    const publisher = createEventPublisher<{ readonly 'orders.placed': OrderRequest }>(transport);

    await expect(client['orders.get']({ id: 1 }, span)).resolves.toBe('order:1');
    await publisher['orders.placed']({ id: 2 }, span);

    expect(carrier).toEqual({
      traceparent: `00-${PARENT_CONTEXT.traceId}-${PARENT_CONTEXT.spanId}-01`,
      tracestate: TRACE_STATE,
    });
    expect(sent[0]).toMatchObject(carrier);
    expect(emitted).toEqual([carrier]);
    expect(
      delivered.map(message => ({
        traceparent: message.traceparent,
        tracestate: message.tracestate,
      })),
    ).toEqual([carrier, carrier]);

    expect(recorded.starts).toHaveLength(2);
    expect(recorded.starts[0]).toMatchObject({
      name: 'zmdb.message',
      parent: {
        traceId: PARENT_CONTEXT.traceId,
        spanId: PARENT_CONTEXT.spanId,
      },
      ended: true,
    });
    expect(recorded.starts[0]?.link).toBeUndefined();
    expect(traceStateHeader(recorded.starts[0]?.parent)).toBe(TRACE_STATE);
    expect(recorded.starts[1]).toMatchObject({
      name: 'zmdb.message',
      link: {
        traceId: PARENT_CONTEXT.traceId,
        spanId: PARENT_CONTEXT.spanId,
      },
      ended: true,
    });
    expect(recorded.starts[1]?.parent).toBeUndefined();
    expect(traceStateHeader(recorded.starts[1]?.link)).toBe(TRACE_STATE);
    expect(requestContexts[0]?.span).toBeDefined();
    expect(eventContexts[0]?.span).toBeDefined();
  });

  it('two concurrent calls resolve their own replies when responses arrive out of order', async () => {
    const pending = new Map<
      number,
      { readonly request: TransportRequest; readonly result: ReturnType<typeof deferred<MessageReply>> }
    >();
    const transport = fakeTransport('memory', [], {
      send: request => {
        const id =
          typeof request.payload === 'object' &&
          request.payload !== null &&
          'id' in request.payload &&
          typeof request.payload.id === 'number'
            ? request.payload.id
            : -1;
        const result = deferred<MessageReply>();
        pending.set(id, { request, result });
        return result.promise;
      },
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 1_000,
      validate: { 'orders.get': textReply },
    });

    const first = client['orders.get']({ id: 1 });
    const second = client['orders.get']({ id: 2 });
    await vi.waitFor(() => expect(pending.size).toBe(2));

    const secondCall = pending.get(2);
    const firstCall = pending.get(1);
    secondCall?.result.resolve({
      kind: 'result',
      correlationId: secondCall.request.correlationId,
      payload: 'second',
    });
    firstCall?.result.resolve({
      kind: 'result',
      correlationId: firstCall.request.correlationId,
      payload: 'first',
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
  });

  it('send rejects with MessageTimeoutError and aborts the transport request', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const transport = fakeTransport('memory', [], {
        send: request => {
          signal = request.signal;
          return new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
          });
        },
      });
      const client = createMessageClient<Calls>(transport, {
        timeoutMs: 50,
        validate: { 'orders.get': textReply },
      });

      const result = client['orders.get']({ id: 1 });
      const assertion = expect(result).rejects.toBeInstanceOf(MessageTimeoutError);
      await vi.advanceTimersByTimeAsync(50);

      await assertion;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('requestResponse false rejects with TransportUnsupportedError without calling send', async () => {
    const transport = fakeTransport('events-only', [], {
      capabilities: { redelivery: true, deadLetter: true, requestResponse: false },
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 100,
      validate: { 'orders.get': textReply },
    });

    await expect(client['orders.get']({ id: 1 })).rejects.toBeInstanceOf(TransportUnsupportedError);
    expect(transport.sent).toEqual([]);
  });

  it('a mismatched reply correlation is rejected', async () => {
    const transport = fakeTransport('memory', [], {
      send: () => Promise.resolve({ kind: 'result', correlationId: 'somebody-else', payload: 'wrong' }),
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 100,
      validate: { 'orders.get': textReply },
    });

    await expect(client['orders.get']({ id: 1 })).rejects.toBeInstanceOf(MessageCorrelationError);
  });

  it('a remote error becomes MessageRemoteError without local detail', async () => {
    const transport = fakeTransport('memory', [], {
      send: request =>
        Promise.resolve({
          kind: 'error',
          correlationId: request.correlationId,
          message: 'message handler failed',
        }),
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 100,
      validate: { 'orders.get': textReply },
    });

    await expect(client['orders.get']({ id: 1 })).rejects.toEqual(
      expect.objectContaining({
        name: MessageRemoteError.name,
        message: 'message handler failed',
      }),
    );
  });

  it('every reply crosses the configured response validator', async () => {
    const transport = fakeTransport('memory', [], {
      send: request => Promise.resolve({ kind: 'result', correlationId: request.correlationId, payload: 42 }),
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 100,
      validate: { 'orders.get': textReply },
    });

    await expect(client['orders.get']({ id: 1 })).rejects.toThrow('reply must be text');
  });

  it('a transport send failure reaches the caller', async () => {
    const disconnected = new Error('transport disconnected');
    const transport = fakeTransport('memory', [], {
      send: () => Promise.reject(disconnected),
    });
    const client = createMessageClient<Calls>(transport, {
      timeoutMs: 100,
      validate: { 'orders.get': textReply },
    });

    await expect(client['orders.get']({ id: 1 })).rejects.toBe(disconnected);
  });

  it('the event publisher exposes typed one-way emit methods', async () => {
    type Events = {
      readonly 'orders.placed': { readonly id: number };
      readonly 'orders.cancelled': { readonly id: number };
    };

    const transport = fakeTransport('memory');
    const publisher = createEventPublisher<Events>(transport);
    const firstMethod = publisher['orders.placed'];

    await publisher['orders.placed']({ id: 1 });
    await publisher['orders.cancelled']({ id: 2 });

    expect(publisher['orders.placed']).toBe(firstMethod);
    expect(transport.emitted).toEqual([
      { pattern: 'orders.placed', payload: { id: 1 } },
      { pattern: 'orders.cancelled', payload: { id: 2 } },
    ]);
    expect(transport.emitArgumentCounts).toEqual([2, 2]);
  });

  it('the event publisher is not assimilated as a thenable', async () => {
    type Events = {
      readonly 'orders.placed': { readonly id: number };
    };

    const transport = fakeTransport('memory');
    const publisher = createEventPublisher<Events>(transport);

    await expect(Promise.resolve(publisher)).resolves.toBe(publisher);
    expect(transport.emitted).toEqual([]);
  });
});

describe('shared context and custom transport seam (#559)', () => {
  it('a third-party strategy written only against public exports dispatches messages', async () => {
    const seen: number[] = [];

    class Consumer {
      @EventPattern('third.party', orderRequest)
      consume(ctx: MessageContext<OrderRequest>): void {
        seen.push(ctx.payload.id);
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = new PublicCustomTransport();
    const app = createMessagingApplication(Root, {
      transports: [transport],
      dispatcher: sinks([]),
    });
    await app.init();
    const outcome = await transport.deliver(delivery('third.party', { id: 9 }));
    await app[Symbol.asyncDispose]();

    expect({
      errors: PUBLIC_CLIENT_ERRORS.map(error => error.name),
      settlement: settlementKind(outcome.settlement),
      seen,
    }).toEqual({
      errors: ['MessageCorrelationError', 'MessageRemoteError', 'MessageTimeoutError', 'TransportUnsupportedError'],
      settlement: 'ack',
      seen: [9],
    });
  });
});
