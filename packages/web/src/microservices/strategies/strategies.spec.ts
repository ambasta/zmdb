import { readFileSync } from 'node:fs';

import { encodeDelivery, encodeReply } from '@zmdb/app/messaging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerFactories = vi.hoisted(() => ({
  redis: (_options?: unknown): unknown => {
    throw new Error('Redis test factory is not configured');
  },
}));

vi.mock('redis', () => ({
  createClient: (options?: unknown): unknown => brokerFactories.redis(options),
}));

import { createRedisStrategy } from '../redis/index.js';

type RedisListener = (message: string, channel: string) => void;

class FakeRedisSubscriber {
  readonly exact = new Map<string, RedisListener>();
  readonly patterns = new Map<string, RedisListener>();
  closed = false;

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
    this.closed = true;
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
    this.closed = true;
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Redis Pub/Sub strategy (#560)', () => {
  it('states the Redis durability caveat in executable capabilities and dispatches concrete channels', async () => {
    const client = new FakeRedisPublisher();
    brokerFactories.redis = () => client;
    const deliveries: string[] = [];
    const strategy = createRedisStrategy({
      channels: ['orders.created'],
      channelPatterns: ['billing.*'],
      onError: error => {
        throw error;
      },
      replyPrefix: 'reply.test',
    });
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
  });

  it('correlates Redis request replies on a process-owned pub/sub channel', async () => {
    const client = new FakeRedisPublisher();
    brokerFactories.redis = () => client;
    const strategy = createRedisStrategy({
      channels: [],
      onError: error => {
        throw error;
      },
      replyPrefix: 'reply.test',
    });
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
});

it('a plain install pulls in no broker client', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const peers = ['redis'];

  expect(peers.map(peer => manifest.dependencies?.[peer])).toEqual([undefined]);
  expect(peers.map(peer => manifest.peerDependenciesMeta?.[peer]?.optional)).toEqual([true]);
  expect(peers.map(peer => manifest.devDependencies?.[peer])).toEqual(['6.2.1']);
  expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining(['./microservices/redis']));
});
