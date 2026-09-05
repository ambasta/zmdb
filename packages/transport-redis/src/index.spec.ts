import { createApplication, Module } from '@zmdb/app';
import { encodeDelivery, encodeReply, MessageTimeoutError, transportExtension } from '@zmdb/app/messaging';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisFactory = vi.hoisted(() => ({
  create: (_options?: unknown): unknown => {
    throw new Error('Redis test factory is not configured');
  },
}));

vi.mock('redis', () => ({
  createClient: (options?: unknown): unknown => redisFactory.create(options),
}));

import { createRedisStrategy } from './index.js';

type RedisListener = (message: string, channel: string) => void;

class FakeRedisSubscriber {
  readonly exact = new Map<string, RedisListener>();
  readonly patterns = new Map<string, RedisListener>();
  closed = false;
  destroyed = false;

  on(): this {
    return this;
  }

  connect(): Promise<this> {
    return Promise.resolve(this);
  }

  subscribe(channel: string, listener: RedisListener): Promise<void> {
    this.exact.set(channel, listener);
    return Promise.resolve();
  }

  pSubscribe(pattern: string, listener: RedisListener): Promise<void> {
    this.patterns.set(pattern, listener);
    return Promise.resolve();
  }

  unsubscribe(channel: string): Promise<void> {
    this.exact.delete(channel);
    return Promise.resolve();
  }

  pUnsubscribe(pattern: string): Promise<void> {
    this.patterns.delete(pattern);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  destroy(): void {
    this.destroyed = true;
  }

  deliver(channel: string, message: string): void {
    this.exact.get(channel)?.(message, channel);
    for (const [pattern, listener] of this.patterns) {
      const wildcard = pattern.indexOf('*');
      const matches =
        wildcard === -1
          ? pattern === channel
          : channel.startsWith(pattern.slice(0, wildcard)) && channel.endsWith(pattern.slice(wildcard + 1));
      if (matches) {
        listener(message, channel);
      }
    }
  }
}

class FakeRedisPublisher {
  readonly published: { readonly channel: string; readonly message: string }[] = [];
  readonly subscriber = new FakeRedisSubscriber();
  closed = false;
  destroyed = false;

  on(): this {
    return this;
  }

  connect(): Promise<this> {
    return Promise.resolve(this);
  }

  duplicate(): FakeRedisSubscriber {
    return this.subscriber;
  }

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function fakeStrategy(
  options: {
    readonly channels?: readonly string[];
    readonly channelPatterns?: readonly string[];
    readonly onError?: (error: unknown) => void;
    readonly replyPrefix?: string;
  } = {},
) {
  const client = new FakeRedisPublisher();
  redisFactory.create = () => client;
  const strategy = createRedisStrategy({
    channels: options.channels ?? [],
    channelPatterns: options.channelPatterns ?? [],
    onError:
      options.onError ??
      (error => {
        throw error;
      }),
    replyPrefix: options.replyPrefix ?? 'reply.test',
  });
  return { client, strategy };
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(release => {
    resolve = release;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('@zmdb/transport-redis', () => {
  it('states the Redis durability caveat in executable capabilities and dispatches concrete channels', async () => {
    const { client, strategy } = fakeStrategy({
      channels: ['orders.created'],
      channelPatterns: ['billing.*'],
    });
    const deliveries: string[] = [];
    await strategy.listen(message => {
      deliveries.push(message.pattern);
      return Promise.resolve({ settlement: { kind: 'ack' } });
    });

    client.subscriber.deliver('orders.created', encodeDelivery({ id: 1 }, undefined));
    client.subscriber.deliver('billing.eu', encodeDelivery({ id: 2 }, undefined));
    await vi.waitFor(() => expect(deliveries).toEqual(['orders.created', 'billing.eu']));

    expect(strategy.capabilities).toEqual({
      redelivery: false,
      deadLetter: false,
      requestResponse: true,
    });
    await strategy.close(100);
    expect({ publisher: client.closed, subscriber: client.subscriber.closed }).toEqual({
      publisher: true,
      subscriber: true,
    });
  });

  it('correlates Redis request replies on a process-owned pub/sub channel', async () => {
    const { client, strategy } = fakeStrategy();
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));
    const controller = new AbortController();
    const reply = strategy.send({
      pattern: 'orders.get',
      payload: { id: 7 },
      correlationId: 'request-7',
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.published).toHaveLength(1));
    expect(client.published[0]?.channel).toBe('orders.get');
    expect(JSON.parse(client.published[0]?.message ?? '{}')).toMatchObject({
      correlationId: 'request-7',
      replyTo: 'reply.test:request-7',
    });

    client.subscriber.deliver(
      'reply.test:request-7',
      encodeReply({ kind: 'result', correlationId: 'request-7', payload: { id: 7 } }),
    );

    await expect(reply).resolves.toEqual({
      kind: 'result',
      correlationId: 'request-7',
      payload: { id: 7 },
    });
    await strategy.close(100);
  });

  it('reports malformed replies without settling the outstanding request', async () => {
    const errors: unknown[] = [];
    const { client, strategy } = fakeStrategy({ onError: error => errors.push(error) });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));
    const reply = strategy.send({
      pattern: 'orders.get',
      payload: { id: 1 },
      correlationId: 'request-1',
      timeoutMs: 1_000,
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(client.published).toHaveLength(1));

    client.subscriber.deliver('reply.test:request-1', '{not-json');
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    client.subscriber.deliver(
      'reply.test:request-1',
      encodeReply({ kind: 'result', correlationId: 'request-1', payload: 'ok' }),
    );

    await expect(reply).resolves.toEqual({
      kind: 'result',
      correlationId: 'request-1',
      payload: 'ok',
    });
    expect(errors[0]).toBeInstanceOf(TypeError);
    await strategy.close(100);
  });

  it('removes a pending reply when its explicit deadline expires', async () => {
    vi.useFakeTimers();
    const { strategy } = fakeStrategy();
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));
    const reply = strategy.send({
      pattern: 'orders.get',
      payload: { id: 1 },
      correlationId: 'request-timeout',
      timeoutMs: 25,
      signal: new AbortController().signal,
    });
    const timedOut = expect(reply).rejects.toBeInstanceOf(MessageTimeoutError);

    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    await strategy.close(100);
  });

  it('preserves an AbortSignal reason and removes the pending reply', async () => {
    const { strategy } = fakeStrategy();
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));
    const controller = new AbortController();
    const reason = new Error('caller stopped waiting');
    const reply = strategy.send({
      pattern: 'orders.get',
      payload: { id: 1 },
      correlationId: 'request-abort',
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    controller.abort(reason);
    await expect(reply).rejects.toBe(reason);
    await strategy.close(100);
  });

  it('forces both clients closed when accepted dispatch work exceeds the grace period', async () => {
    const blocked = deferred();
    const entered = deferred();
    const { client, strategy } = fakeStrategy({ channels: ['orders.created'] });
    await strategy.listen(async () => {
      entered.resolve();
      await blocked.promise;
      return { settlement: { kind: 'ack' } };
    });

    client.subscriber.deliver('orders.created', encodeDelivery({ id: 1 }, undefined));
    await entered.promise;
    await expect(strategy.close(1)).rejects.toThrow('@zmdb/transport-redis: Redis strategy did not drain within 1ms');
    expect({ publisher: client.destroyed, subscriber: client.subscriber.destroyed }).toEqual({
      publisher: true,
      subscriber: true,
    });
    blocked.resolve();
  });

  it('rejects empty and duplicate subscription names before opening a client', () => {
    expect(() =>
      createRedisStrategy({
        channels: [''],
        onError: () => undefined,
      }),
    ).toThrow('@zmdb/transport-redis: Redis channel cannot be empty');
    expect(() =>
      createRedisStrategy({
        channelPatterns: ['orders.*', 'orders.*'],
        onError: () => undefined,
      }),
    ).toThrow('@zmdb/transport-redis: duplicate Redis channel pattern "orders.*"');
    expect(() =>
      createRedisStrategy({
        onError: () => undefined,
        replyPrefix: '',
      }),
    ).toThrow('@zmdb/transport-redis: Redis replyPrefix cannot be empty');
  });

  it('keeps onUndeliverable mandatory through the public app extension', async () => {
    @Module({})
    class Root {}

    const { strategy } = fakeStrategy();
    const app = createApplication(Root, {
      extensions: [
        transportExtension({
          transports: [strategy],
          dispatcher: {
            onUnhandled: () => undefined,
            onInvalidPayload: () => undefined,
            onHandlerError: () => undefined,
          },
        }),
      ],
    });

    await expect(app.init()).rejects.toThrow('@zmdb/app: transport "redis" requires onUndeliverable');
    await app[Symbol.asyncDispose]();
  });
});
