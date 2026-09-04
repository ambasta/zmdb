import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createApp, type App } from '../app/index.js';
import { countMetadataReads } from '../bench/index.js';
import type { Ctx, QueryValues } from '../context/index.js';
import type { Guard } from '../middleware/index.js';
import { lazy, Module } from '../modules/index.js';
import { Controller, Get } from '../routing/index.js';
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
  TransportUnsupportedError,
  type DispatchOutcome,
  type DispatcherOptions,
  type MessageContext,
  type MessageReply,
  type RawMessage,
  type TransportCapabilities,
  type TransportRequest,
  type TransportStrategy,
  type WithHeaders,
} from './index.js';

const ALL_TRUE: TransportCapabilities = { redelivery: true, deadLetter: true, requestResponse: true };
const NO_REDELIVERY: TransportCapabilities = { redelivery: false, deadLetter: false, requestResponse: true };

interface FakeTransport extends TransportStrategy {
  dispatch: ((message: RawMessage) => Promise<DispatchOutcome>) | undefined;
  readonly sent: TransportRequest[];
  readonly emitted: { readonly pattern: string; readonly payload: unknown }[];
}

interface FakeOptions {
  readonly capabilities?: TransportCapabilities;
  readonly close?: Error;
  readonly listen?: 'resolve' | 'reject';
  readonly send?: (request: TransportRequest) => Promise<MessageReply>;
}

function fakeTransport(name: string, log: string[] = [], options: FakeOptions = {}): FakeTransport {
  const capabilities = options.capabilities ?? ALL_TRUE;
  const sent: TransportRequest[] = [];
  const emitted: { readonly pattern: string; readonly payload: unknown }[] = [];
  const transport: FakeTransport = {
    name,
    capabilities,
    dispatch: undefined,
    sent,
    emitted,
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
    emit(pattern, payload) {
      emitted.push({ pattern, payload });
      return Promise.resolve();
    },
    close(graceMs) {
      log.push(`close:${name}:${String(graceMs)}`);
      return options.close === undefined ? Promise.resolve() : Promise.reject(options.close);
    },
  };
  return transport;
}

interface DeliveryOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly correlationId?: string;
  readonly replyTo?: string;
  readonly deliveryAttempt?: number;
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
    ...(options.parseError === undefined ? {} : { parseError: options.parseError }),
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

async function outcomeOf(app: App): Promise<'init resolved' | 'init rejected'> {
  return app.init().then(
    () => 'init resolved' as const,
    () => 'init rejected' as const,
  );
}

describe('microservice hybrid lifecycle (#559)', () => {
  it('listen is called after onApplicationBootstrap', async () => {
    const log: string[] = [];

    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        return 'ok';
      }

      onModuleInit(): void {
        log.push('onModuleInit:Consumer');
      }

      onApplicationBootstrap(): void {
        log.push('onApplicationBootstrap:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log)],
      dispatcher: sinks(log),
    });
    await app.init();

    expect(log).toEqual(['onModuleInit:Consumer', 'onApplicationBootstrap:Consumer', 'listen:a']);
  });

  it('a rejecting listen rejects init and closes the transports already opened', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log, { listen: 'reject' })],
      dispatcher: sinks(log),
    });

    expect({ outcome: await outcomeOf(app), log }).toEqual({
      outcome: 'init rejected',
      log: ['listen:a', 'listen:b', 'close:a:5000'],
    });
  });

  it('dispose closes transports before running shutdown hooks', async () => {
    const log: string[] = [];

    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        return 'ok';
      }

      onShutdown(): void {
        log.push('onShutdown:Consumer');
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log)],
      dispatcher: sinks(log),
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();

    expect(log).toEqual(['close:b:5000', 'close:a:5000', 'onShutdown:Consumer']);
  });

  it('a close failure does not skip remaining transports or shutdown hooks', async () => {
    const log: string[] = [];
    const closeError = new Error('b could not close');
    const shutdownError = new Error('consumer could not shut down');

    @Controller('/consumer')
    class Consumer {
      onShutdown(): void {
        log.push('onShutdown:Consumer');
        throw shutdownError;
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log, { close: closeError })],
      dispatcher: sinks(log),
    });
    await app.init();
    log.length = 0;

    await expect(app[Symbol.asyncDispose]()).rejects.toBe(closeError);
    expect(log).toEqual(['close:b:5000', 'close:a:5000', 'onShutdown:Consumer']);
  });

  it('init after disposal rejects without opening a transport', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log)],
      dispatcher: sinks(log),
    });
    await app[Symbol.asyncDispose]();

    await expect(app.init()).rejects.toThrow('application is shutting down');
    expect(log).toEqual([]);
  });

  it('the app grace bound is the number passed to every close', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createApp(Root, {
      transports: [fakeTransport('a', log), fakeTransport('b', log)],
      dispatcher: sinks(log),
      graceMs: 250,
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();

    expect(log).toEqual(['close:b:250', 'close:a:250']);
  });

  it('App gains no connectMicroservice and no startAllMicroservices', () => {
    @Module({ controllers: [] })
    class Root {}

    const app = createApp(Root, { transports: [], dispatcher: sinks([]) });

    expect(Object.keys(app).toSorted()).toEqual(['container', 'fetch', 'handle', 'init', 'lazy']);
    expect(typeof app[Symbol.asyncDispose]).toBe('function');
  });

  it('serves HTTP and a transport from one process sharing one container', async () => {
    const seen: object[] = [];

    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        seen.push(this);
        return 'ok';
      }

      @MessagePattern('orders.get', orderRequest)
      get(ctx: MessageContext<OrderRequest>): { readonly id: number } {
        seen.push(this);
        return { id: ctx.payload.id };
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = fakeTransport('a');
    const app = createApp(Root, {
      transports: [transport],
      dispatcher: sinks([]),
    });
    await app.init();
    const response = await app.handle({ method: 'GET', path: '/orders', headers: {} });
    const result = await transport.dispatch?.(
      delivery('orders.get', { id: 7 }, { correlationId: 'c1', replyTo: 'reply:a' }),
    );

    expect({
      http: response.status,
      sameInstance: seen.length === 2 && seen[0] === seen[1],
      result,
    }).toEqual({
      http: 200,
      sameInstance: true,
      result: {
        settlement: { kind: 'ack' },
        reply: { kind: 'result', correlationId: 'c1', payload: { id: 7 } },
      },
    });
  });

  it('init is idempotent and opens each transport once', async () => {
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const app = createApp(Root, {
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

    const app = createApp(Root, {
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
    const app = createApp(Root, {
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
    const app = createApp(Root, {
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
  it('one authorisation function written against WithHeaders serves an HTTP guard and a message handler', async () => {
    const requiresApiKey = (ctx: WithHeaders): boolean => ctx.headers['x-api-key'] === 'secret';
    const httpGuard: Guard = { canActivate: ctx => requiresApiKey(ctx) };
    const messageChecks: boolean[] = [];

    class Consumer {
      @EventPattern('orders.secured', orderRequest)
      secured(ctx: MessageContext<OrderRequest>): void {
        messageChecks.push(requiresApiKey(ctx));
      }
    }

    const dispatcher = createMessageDispatcher([new Consumer()], sinks([]));
    const httpCtx: Ctx<Record<string, string>, unknown, QueryValues> = {
      params: {},
      body: undefined,
      query: {},
      headers: { 'x-api-key': 'secret' },
      method: 'GET',
      path: '/orders',
    };

    expect(await httpGuard.canActivate(httpCtx)).toBe(true);
    expect(await httpGuard.canActivate({ ...httpCtx, headers: {} })).toBe(false);
    await dispatcher.dispatch(delivery('orders.secured', { id: 1 }, { headers: { 'x-api-key': 'secret' } }), 'memory');
    await dispatcher.dispatch(delivery('orders.secured', { id: 2 }), 'memory');
    expect(messageChecks).toEqual([true, false]);
  });

  it('a third-party strategy written only against public exports dispatches messages', async () => {
    const pkg = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

    @Module({ controllers: [] })
    class Root {}

    const transport = fakeTransport('third-party');
    const app = createApp(Root, {
      transports: [transport],
      dispatcher: sinks([]),
    });
    await app.init();
    const outcome = await transport.dispatch?.(delivery('third.party'));

    expect({
      subpath: pkg.includes('"./microservices":') ? 'exported' : 'absent',
      outcome,
    }).toEqual({
      subpath: 'exported',
      outcome: { settlement: { kind: 'ack' } },
    });
  });
});
