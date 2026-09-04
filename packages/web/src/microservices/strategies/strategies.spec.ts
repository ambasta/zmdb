import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerFactories = vi.hoisted(() => ({
  amqp: (_connection: unknown, _socketOptions?: unknown): unknown => {
    throw new Error('RabbitMQ test factory is not configured');
  },
  nats: (_options?: unknown): unknown => {
    throw new Error('NATS test factory is not configured');
  },
  redis: (_options?: unknown): unknown => {
    throw new Error('Redis test factory is not configured');
  },
}));

vi.mock('redis', () => ({
  createClient: (options?: unknown): unknown => brokerFactories.redis(options),
}));

vi.mock('@nats-io/transport-node', () => ({
  connect: (options?: unknown): unknown => brokerFactories.nats(options),
  createInbox: (): string => '_INBOX.test',
}));

vi.mock('amqplib', () => ({
  connect: (connection: unknown, socketOptions?: unknown): unknown => brokerFactories.amqp(connection, socketOptions),
}));

import type { Settlement } from '../index.js';
import { createNatsStrategy } from '../nats/index.js';
import { createRabbitMqStrategy } from '../rabbitmq/index.js';
import { createRedisStrategy } from '../redis/index.js';
import { encodeDelivery, encodeReply } from './codec.js';
import { createNatsSubjectMatcher } from './nats-matcher.js';

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

interface FakeNatsMessage {
  readonly subject: string;
  readonly reply?: string;
  readonly responded: string[];
  respond(data: Uint8Array): boolean;
  string(): string;
}

type NatsCallback = (error: Error | null, message: FakeNatsMessage) => void;

class FakeNatsSubscription {
  readonly subject: string;
  readonly queue: string | undefined;
  readonly callback: NatsCallback | undefined;
  closed = false;

  constructor(subject: string, options: { readonly queue?: string; readonly callback?: NatsCallback } = {}) {
    this.subject = subject;
    this.queue = options.queue;
    this.callback = options.callback;
  }

  unsubscribe(): void {
    this.closed = true;
  }

  drain(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeNatsConnection {
  readonly subscriptions: FakeNatsSubscription[] = [];
  readonly published: {
    readonly subject: string;
    readonly data: Uint8Array;
    readonly reply?: string;
  }[] = [];
  drained = false;

  subscribe(subject: string, options: { readonly queue?: string; readonly callback?: NatsCallback } = {}) {
    const subscription = new FakeNatsSubscription(subject, options);
    this.subscriptions.push(subscription);
    return subscription;
  }

  publish(subject: string, data: Uint8Array, options: { readonly reply?: string } = {}): void {
    this.published.push({
      subject,
      data,
      ...(options.reply === undefined ? {} : { reply: options.reply }),
    });
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  closed(): Promise<void | Error> {
    return new Promise(() => undefined);
  }

  drain(): Promise<void> {
    this.drained = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.drained = true;
    return Promise.resolve();
  }

  deliver(subject: string, payload: string, reply?: string): FakeNatsMessage {
    const message: FakeNatsMessage = {
      subject,
      ...(reply === undefined ? {} : { reply }),
      responded: [],
      respond(data): boolean {
        message.responded.push(new TextDecoder().decode(data));
        return reply !== undefined;
      },
      string: () => payload,
    };
    for (const subscription of this.subscriptions) {
      subscription.callback?.(null, message);
    }
    return message;
  }
}

interface PublishedRabbitMessage {
  readonly exchange: string;
  readonly routingKey: string;
  readonly content: Uint8Array;
  readonly options: Readonly<Record<string, unknown>>;
}

type RabbitConsumer = (message: FakeRabbitMessage | null) => void;

interface FakeRabbitMessage {
  readonly content: Uint8Array;
  readonly fields: FakeRabbitFields;
  readonly properties: {
    readonly correlationId?: string;
    readonly headers?: Readonly<Record<string, unknown>>;
    readonly replyTo?: string;
  };
}

interface FakeRabbitFields {
  readonly redelivered: boolean;
  readonly routingKey: string;
}

class FakeRabbitConsumerChannel {
  readonly exchanges: { readonly exchange: string; readonly type: string }[] = [];
  readonly queues: { readonly queue: string; readonly options: Readonly<Record<string, unknown>> }[] = [];
  readonly bindings: { readonly queue: string; readonly exchange: string; readonly pattern: string }[] = [];
  readonly consumers = new Map<string, RabbitConsumer>();
  readonly acks: FakeRabbitMessage[] = [];
  readonly nacks: { readonly message: FakeRabbitMessage; readonly requeue: boolean | undefined }[] = [];
  readonly cancelled: string[] = [];
  prefetchCount = 0;
  #nextConsumer = 1;

  on(): this {
    return this;
  }

  assertExchange(exchange: string, type: string): Promise<{ readonly exchange: string }> {
    this.exchanges.push({ exchange, type });
    return Promise.resolve({ exchange });
  }

  assertQueue(queue: string, options: Readonly<Record<string, unknown>> = {}) {
    const resolved = queue.length === 0 ? 'reply.test' : queue;
    this.queues.push({ queue: resolved, options });
    return Promise.resolve({ queue: resolved, messageCount: 0, consumerCount: 0 });
  }

  bindQueue(queue: string, exchange: string, pattern: string): Promise<Record<string, never>> {
    this.bindings.push({ queue, exchange, pattern });
    return Promise.resolve({});
  }

  prefetch(count: number): Promise<Record<string, never>> {
    this.prefetchCount = count;
    return Promise.resolve({});
  }

  consume(queue: string, consumer: RabbitConsumer): Promise<{ readonly consumerTag: string }> {
    const tag = `consumer-${String(this.#nextConsumer)}`;
    this.#nextConsumer += 1;
    this.consumers.set(queue, consumer);
    return Promise.resolve({ consumerTag: tag });
  }

  ack(message: FakeRabbitMessage): void {
    this.acks.push(message);
  }

  nack(message: FakeRabbitMessage, _allUpTo?: boolean, requeue?: boolean): void {
    this.nacks.push({ message, requeue });
  }

  cancel(consumerTag: string): Promise<Record<string, never>> {
    this.cancelled.push(consumerTag);
    return Promise.resolve({});
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  deliver(queue: string, message: FakeRabbitMessage): void {
    this.consumers.get(queue)?.(message);
  }
}

class FakeRabbitPublisherChannel {
  readonly published: PublishedRabbitMessage[] = [];
  readonly listeners = new Map<string, (message: FakeRabbitMessage) => void>();

  on(event: string, listener: (message: FakeRabbitMessage) => void): this {
    this.listeners.set(event, listener);
    return this;
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Readonly<Record<string, unknown>> = {},
  ): boolean {
    this.published.push({ exchange, routingKey, content, options });
    return true;
  }

  waitForConfirms(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeRabbitModel {
  readonly consumer = new FakeRabbitConsumerChannel();
  readonly publisher = new FakeRabbitPublisherChannel();
  closed = false;

  on(): this {
    return this;
  }

  createChannel(): Promise<FakeRabbitConsumerChannel> {
    return Promise.resolve(this.consumer);
  }

  createConfirmChannel(): Promise<FakeRabbitPublisherChannel> {
    return Promise.resolve(this.publisher);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function rabbitMessage(
  routingKey: string,
  payload: unknown,
  properties: FakeRabbitMessage['properties'] = {},
): FakeRabbitMessage {
  const fields: FakeRabbitFields = { redelivered: false, routingKey };
  return {
    content: globalThis.Buffer.from(encodeDelivery(payload, undefined)),
    fields,
    properties,
  };
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

describe('core NATS strategy (#560)', () => {
  it('matches NATS wildcards through a startup trie with native token semantics', () => {
    const matcher = createNatsSubjectMatcher(['orders.*.created', 'audit.>']);

    expect({
      oneToken: matcher.matches('orders.eu.created'),
      noToken: matcher.matches('orders.created'),
      tooMany: matcher.matches('orders.eu.priority.created'),
      tail: matcher.matches('audit.eu.security'),
      emptyTail: matcher.matches('audit'),
    }).toEqual({
      oneToken: true,
      noToken: false,
      tooMany: false,
      tail: true,
      emptyTail: false,
    });
  });

  it('passes queue groups to NATS and dispatches the concrete subject behind a wildcard', async () => {
    const connection = new FakeNatsConnection();
    brokerFactories.nats = () => Promise.resolve(connection);
    const patterns: string[] = [];
    const strategy = createNatsStrategy({
      subscriptions: [{ subject: 'orders.*', queue: 'orders-workers' }],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(message => {
      patterns.push(message.pattern);
      return Promise.resolve({ settlement: { kind: 'ack' } });
    });

    connection.deliver('orders.created', encodeDelivery({ id: 1 }, undefined));
    await vi.waitFor(() => expect(patterns).toEqual(['orders.created']));
    expect(connection.subscriptions.map(subscription => [subscription.subject, subscription.queue])).toEqual([
      ['orders.*', 'orders-workers'],
    ]);
    expect(strategy.capabilities).toEqual({
      redelivery: false,
      deadLetter: false,
      requestResponse: true,
    });
    await strategy.close(100);
  });
});

describe('RabbitMQ strategy (#560)', () => {
  it('exposes prefetch and owns the retry and dead-letter topology', async () => {
    const model = new FakeRabbitModel();
    brokerFactories.amqp = () => Promise.resolve(model);
    const strategy = createRabbitMqStrategy({
      connection: 'amqp://test',
      exchange: 'orders',
      queue: 'orders.worker',
      bindings: ['orders.*'],
      prefetch: 17,
      deadLetter: { exchange: 'orders.dead', queue: 'orders.dead.worker' },
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    expect(model.consumer.prefetchCount).toBe(17);
    expect(model.consumer.exchanges).toEqual([
      { exchange: 'orders', type: 'topic' },
      { exchange: 'orders.retry', type: 'topic' },
      { exchange: 'orders.dead', type: 'topic' },
    ]);
    expect(model.consumer.queues).toEqual(
      expect.arrayContaining([
        {
          queue: 'orders.worker',
          options: { durable: true, deadLetterExchange: 'orders.dead' },
        },
        {
          queue: 'orders.worker.retry',
          options: { durable: true, deadLetterExchange: 'orders' },
        },
        { queue: 'orders.dead.worker', options: { durable: true } },
      ]),
    );
    await strategy.close(100);
  });

  it('acks success, confirm-publishes delayed retry, and nacks dead without requeue', async () => {
    const model = new FakeRabbitModel();
    brokerFactories.amqp = () => Promise.resolve(model);
    const settlements: readonly Settlement[] = [
      { kind: 'ack' },
      { kind: 'retry', afterMs: 250 },
      { kind: 'dead', reason: 'invalid-payload' },
    ];
    let call = 0;
    const strategy = createRabbitMqStrategy({
      connection: 'amqp://test',
      exchange: 'orders',
      queue: 'orders.worker',
      bindings: ['orders.*'],
      prefetch: 1,
      deadLetter: { exchange: 'orders.dead', queue: 'orders.dead.worker' },
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => {
      const settlement = settlements[call];
      call += 1;
      if (settlement === undefined) {
        throw new Error('unexpected dispatch');
      }
      return Promise.resolve({ settlement });
    });

    const ack = rabbitMessage('orders.created', { id: 1 });
    const retry = rabbitMessage('orders.created', { id: 2 });
    const dead = rabbitMessage('orders.created', { id: 3 });
    model.consumer.deliver('orders.worker', ack);
    model.consumer.deliver('orders.worker', retry);
    model.consumer.deliver('orders.worker', dead);
    await vi.waitFor(() => {
      expect(model.consumer.acks).toHaveLength(2);
      expect(model.consumer.nacks).toHaveLength(1);
    });

    expect(model.publisher.published).toEqual([
      expect.objectContaining({
        exchange: 'orders.retry',
        routingKey: 'orders.created',
        options: expect.objectContaining({ expiration: 250, persistent: true }),
      }),
    ]);
    expect(model.consumer.nacks).toEqual([{ message: dead, requeue: false }]);
    await strategy.close(100);
  });
});

it('a plain install pulls in no broker client', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const peers = ['@nats-io/transport-node', 'amqplib', 'redis'];

  expect(peers.map(peer => manifest.dependencies?.[peer])).toEqual([undefined, undefined, undefined]);
  expect(peers.map(peer => manifest.peerDependenciesMeta?.[peer]?.optional)).toEqual([true, true, true]);
  expect(peers.map(peer => manifest.devDependencies?.[peer])).toEqual(['3.4.0', '2.0.1', '6.2.1']);
  expect(Object.keys(manifest.exports)).toEqual(
    expect.arrayContaining(['./microservices/redis', './microservices/nats', './microservices/rabbitmq']),
  );
});
