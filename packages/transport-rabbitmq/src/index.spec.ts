import { encodeDelivery, encodeReply, type Settlement } from '@zmdb/app/messaging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerFactory = vi.hoisted(() => ({
  connect: (_connection: unknown, _socketOptions?: unknown): unknown => {
    throw new Error('RabbitMQ test factory is not configured');
  },
}));

vi.mock('amqplib', () => ({
  connect: (connection: unknown, socketOptions?: unknown): unknown => brokerFactory.connect(connection, socketOptions),
}));

import { createRabbitMqStrategy } from './index.js';

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
  assertExchangeError: Error | undefined;
  closeCalls = 0;
  prefetchCount = 0;
  #nextConsumer = 1;

  on(): this {
    return this;
  }

  assertExchange(exchange: string, type: string): Promise<{ readonly exchange: string }> {
    if (this.assertExchangeError !== undefined) {
      return Promise.reject(this.assertExchangeError);
    }
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
    this.closeCalls += 1;
    return Promise.resolve();
  }

  deliver(queue: string, message: FakeRabbitMessage): void {
    this.consumers.get(queue)?.(message);
  }
}

class FakeRabbitPublisherChannel {
  readonly published: PublishedRabbitMessage[] = [];
  readonly listeners = new Map<string, (message: FakeRabbitMessage) => void>();
  closeCalls = 0;
  confirms = 0;

  on(event: string, listener: (message: FakeRabbitMessage) => void): this {
    this.listeners.set(event, listener);
    return this;
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Uint8Array,
    options: Readonly<Record<string, unknown>> = {},
  ): boolean {
    this.published.push({ exchange, routingKey, content, options });
    return true;
  }

  waitForConfirms(): Promise<void> {
    this.confirms += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class FakeRabbitModel {
  readonly consumer = new FakeRabbitConsumerChannel();
  readonly publisher = new FakeRabbitPublisherChannel();
  closeCalls = 0;
  confirmChannelError: Error | undefined;

  on(): this {
    return this;
  }

  createChannel(): Promise<FakeRabbitConsumerChannel> {
    return Promise.resolve(this.consumer);
  }

  createConfirmChannel(): Promise<FakeRabbitPublisherChannel> {
    return this.confirmChannelError === undefined
      ? Promise.resolve(this.publisher)
      : Promise.reject(this.confirmChannelError);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

function rabbitMessage(
  routingKey: string,
  payload: unknown,
  properties: FakeRabbitMessage['properties'] = {},
): FakeRabbitMessage {
  return rawRabbitMessage(routingKey, encodeDelivery(payload, undefined), properties);
}

function rawRabbitMessage(
  routingKey: string,
  payload: string,
  properties: FakeRabbitMessage['properties'] = {},
): FakeRabbitMessage {
  return {
    content: globalThis.Buffer.from(payload),
    fields: { redelivered: false, routingKey },
    properties,
  };
}

function strategyFor(model: FakeRabbitModel) {
  brokerFactory.connect = () => Promise.resolve(model);
  return createRabbitMqStrategy({
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
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('@zmdb/transport-rabbitmq', () => {
  it('rejects invalid topology before opening a connection', () => {
    expect(() =>
      createRabbitMqStrategy({
        connection: 'amqp://test',
        exchange: 'orders',
        queue: 'orders.worker',
        bindings: [],
        prefetch: 1,
        deadLetter: { exchange: 'orders.dead', queue: 'orders.dead.worker' },
        onError: () => undefined,
      }),
    ).toThrow('@zmdb/transport-rabbitmq: RabbitMQ requires at least one binding');

    expect(() =>
      createRabbitMqStrategy({
        connection: 'amqp://test',
        exchange: 'orders',
        queue: 'orders.worker',
        bindings: ['orders.*'],
        prefetch: 0,
        deadLetter: { exchange: 'orders.dead', queue: 'orders.dead.worker' },
        onError: () => undefined,
      }),
    ).toThrow('@zmdb/transport-rabbitmq: RabbitMQ prefetch must be a positive integer');
  });

  it('exposes prefetch and owns the retry and dead-letter topology', async () => {
    const model = new FakeRabbitModel();
    const strategy = strategyFor(model);
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    expect(strategy.capabilities).toEqual({
      redelivery: true,
      deadLetter: true,
      requestResponse: true,
    });
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
    const settlements: readonly Settlement[] = [
      { kind: 'ack' },
      { kind: 'retry', afterMs: 250 },
      { kind: 'dead', reason: 'invalid-payload' },
    ];
    let call = 0;
    const strategy = strategyFor(model);
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
    expect(model.publisher.confirms).toBe(1);
    expect(model.consumer.nacks).toEqual([{ message: dead, requeue: false }]);
    await strategy.close(100);
  });

  it('correlates request replies and confirms both request and handler reply publishes', async () => {
    const model = new FakeRabbitModel();
    const strategy = strategyFor(model);
    await strategy.listen(message =>
      Promise.resolve({
        settlement: { kind: 'ack' },
        ...(message.replyTo === undefined || message.correlationId === undefined
          ? {}
          : {
              reply: {
                kind: 'result' as const,
                correlationId: message.correlationId,
                payload: message.payload,
              },
            }),
      }),
    );

    const controller = new AbortController();
    const pending = strategy.send({
      pattern: 'orders.get',
      payload: { id: 7 },
      correlationId: 'request-7',
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(model.publisher.published).toHaveLength(1));
    expect(model.publisher.published[0]).toEqual(
      expect.objectContaining({
        exchange: 'orders',
        routingKey: 'orders.get',
        options: expect.objectContaining({
          correlationId: 'request-7',
          mandatory: true,
          replyTo: 'reply.test',
        }),
      }),
    );

    model.consumer.deliver(
      'reply.test',
      rawRabbitMessage('', encodeReply({ kind: 'result', correlationId: 'request-7', payload: { id: 7 } }), {
        correlationId: 'request-7',
      }),
    );
    await expect(pending).resolves.toEqual({
      kind: 'result',
      correlationId: 'request-7',
      payload: { id: 7 },
    });

    model.consumer.deliver(
      'orders.worker',
      rabbitMessage('orders.get', { id: 8 }, { correlationId: 'request-8', replyTo: 'caller.reply' }),
    );
    await vi.waitFor(() => expect(model.publisher.published).toHaveLength(2));
    expect(model.publisher.published[1]).toEqual(
      expect.objectContaining({
        exchange: '',
        routingKey: 'caller.reply',
        options: expect.objectContaining({ correlationId: 'request-8' }),
      }),
    );
    expect(model.publisher.confirms).toBe(2);
    await strategy.close(100);
  });

  it('rejects pending replies and closes both consumers during shutdown', async () => {
    const model = new FakeRabbitModel();
    const strategy = strategyFor(model);
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    const controller = new AbortController();
    const pending = strategy.send({
      pattern: 'orders.get',
      payload: { id: 7 },
      correlationId: 'request-7',
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow(
      '@zmdb/transport-rabbitmq: RabbitMQ strategy closed before receiving a reply',
    );
    await vi.waitFor(() => expect(model.publisher.published).toHaveLength(1));
    await strategy.close(100);
    await rejected;

    expect(model.consumer.cancelled).toEqual(['consumer-2', 'consumer-1']);
    expect(model.consumer.closeCalls).toBe(1);
    expect(model.publisher.closeCalls).toBe(1);
    expect(model.closeCalls).toBe(1);
  });

  it('closes every resource already opened when startup fails', async () => {
    const topologyFailure = new FakeRabbitModel();
    topologyFailure.consumer.assertExchangeError = new Error('topology refused');
    await expect(
      strategyFor(topologyFailure).listen(() => Promise.resolve({ settlement: { kind: 'ack' } })),
    ).rejects.toThrow('topology refused');
    expect({
      consumer: topologyFailure.consumer.closeCalls,
      publisher: topologyFailure.publisher.closeCalls,
      model: topologyFailure.closeCalls,
    }).toEqual({ consumer: 1, publisher: 1, model: 1 });

    const channelFailure = new FakeRabbitModel();
    channelFailure.confirmChannelError = new Error('confirm channel refused');
    await expect(
      strategyFor(channelFailure).listen(() => Promise.resolve({ settlement: { kind: 'ack' } })),
    ).rejects.toThrow('confirm channel refused');
    expect({
      consumer: channelFailure.consumer.closeCalls,
      publisher: channelFailure.publisher.closeCalls,
      model: channelFailure.closeCalls,
    }).toEqual({ consumer: 1, publisher: 0, model: 1 });
  });

  it('force-closes the connection when an accepted dispatch exceeds the grace bound', async () => {
    const model = new FakeRabbitModel();
    const entered = vi.fn();
    const strategy = strategyFor(model);
    await strategy.listen(() => {
      entered();
      return new Promise(() => undefined);
    });

    model.consumer.deliver('orders.worker', rabbitMessage('orders.created', { id: 1 }));
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    await expect(strategy.close(1)).rejects.toThrow(
      '@zmdb/transport-rabbitmq: RabbitMQ strategy did not drain within 1ms',
    );
    expect(model.consumer.cancelled).toEqual(['consumer-2', 'consumer-1']);
    expect(model.closeCalls).toBe(1);
  });
});
