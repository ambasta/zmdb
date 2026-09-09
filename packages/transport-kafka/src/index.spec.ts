// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { existsSync } from 'node:fs';

import { encodeDelivery, type DispatchOutcome, type RawMessage, type TransportStrategy } from '@zmdb/app/messaging';
import type { EachBatchPayload, Kafka } from 'kafkajs';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FrozenOptions {
  readonly client: Kafka;
  readonly groupId: string;
  readonly topics: readonly string[];
  readonly deadLetterTopic: string;
  readonly partitionsConsumedConcurrently: number;
  readonly onError: (error: unknown) => void;
  readonly name?: string;
  readonly fromBeginning?: boolean;
  readonly sessionTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly errorRetryMs?: number;
}

type Factory = (options: FrozenOptions) => TransportStrategy;
type BatchHandler = (payload: EachBatchPayload) => Promise<void>;

async function factory(): Promise<Factory> {
  expect(existsSync(new URL('./index.ts', import.meta.url)), 'the selected Kafka strategy must exist').toBe(true);
  const entry = './index.ts';
  const implementation: { createKafkaStrategy: Factory } = await import(entry);
  return implementation.createKafkaStrategy;
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function harness() {
  const calls: unknown[][] = [];
  const errors: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let handler: BatchHandler | undefined;
  const consumer = {
    events: { REBALANCING: 'rebalance', GROUP_JOIN: 'join', CRASH: 'crash' },
    on: vi.fn((event: string, listener: (event: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
    connect: vi.fn(async () => {
      calls.push(['consumer.connect']);
    }),
    disconnect: vi.fn(async () => {
      calls.push(['consumer.disconnect']);
    }),
    subscribe: vi.fn(async (options: unknown) => {
      calls.push(['subscribe', options]);
    }),
    run: vi.fn(async (options: { eachBatch: BatchHandler }) => {
      handler = options.eachBatch;
    }),
    stop: vi.fn(async () => {
      calls.push(['stop']);
    }),
    commitOffsets: vi.fn(async (offsets: unknown) => {
      calls.push(['commit', offsets]);
    }),
    seek: vi.fn((offset: unknown) => {
      calls.push(['seek', offset]);
    }),
    pause: vi.fn((partitions: unknown) => {
      calls.push(['pause', partitions]);
    }),
    resume: vi.fn((partitions: unknown) => {
      calls.push(['resume', partitions]);
    }),
  };
  const producer = {
    connect: vi.fn(async () => {
      calls.push(['producer.connect']);
    }),
    disconnect: vi.fn(async () => {
      calls.push(['producer.disconnect']);
    }),
    send: vi.fn(async (record: unknown) => {
      calls.push(['send', record]);
      return [];
    }),
  };
  const client = { consumer: vi.fn(() => consumer), producer: vi.fn(() => producer) };
  const options: FrozenOptions = {
    client: client as unknown as Kafka,
    groupId: 'orders.worker',
    topics: ['orders'],
    deadLetterTopic: 'orders.dead',
    partitionsConsumedConcurrently: 2,
    onError: error => errors.push(error),
    errorRetryMs: 20,
  };
  const batch = (offsets = ['0'], partition = 0) => {
    let stale = false;
    let running = true;
    const resume = vi.fn(() => {
      calls.push(['resume', [{ topic: 'orders', partitions: [partition] }]]);
    });
    const payload = {
      batch: {
        topic: 'orders',
        partition,
        highWatermark: '100',
        messages: offsets.map(offset => ({
          offset,
          key: globalThis.Buffer.from('customer-7'),
          value: globalThis.Buffer.from(encodeDelivery({ offset }, undefined)),
          timestamp: '0',
          attributes: 0,
          headers: { custom: globalThis.Buffer.from('kept') },
        })),
      },
      resolveOffset: vi.fn((offset: string) => {
        calls.push(['resolve', offset]);
      }),
      heartbeat: vi.fn(async () => undefined),
      pause: vi.fn(() => {
        calls.push(['pause', [{ topic: 'orders', partitions: [partition] }]]);
        return resume;
      }),
      commitOffsetsIfNecessary: vi.fn(async () => undefined),
      uncommittedOffsets: () => ({ topics: [] }),
      isRunning: () => running,
      isStale: () => stale,
    };
    return {
      payload: payload as unknown as EachBatchPayload,
      stale: () => {
        stale = true;
      },
      stopped: () => {
        running = false;
      },
      run: async () => {
        expect(handler).toBeTypeOf('function');
        await handler?.(payload as unknown as EachBatchPayload);
      },
    };
  };
  return { options, client, consumer, producer, errors, calls, listeners, batch };
}

afterEach(() => vi.useRealTimers());

describe('Kafka event strategy', () => {
  it('rejects invalid options before acquiring any broker resource', async () => {
    const create = await factory();
    const h = harness();
    const invalid = [
      { groupId: '' },
      { topics: [] },
      { topics: ['orders', 'orders'] },
      { topics: ['bad topic'] },
      { topics: ['.'] },
      { deadLetterTopic: 'orders' },
      { partitionsConsumedConcurrently: 0 },
      { partitionsConsumedConcurrently: 1.2 },
      { heartbeatIntervalMs: 30000 },
      { sessionTimeoutMs: Number.NaN },
      { errorRetryMs: -1 },
      { heartbeatIntervalMs: 0 },
    ];
    for (const value of invalid) expect(() => create({ ...h.options, ...value })).toThrow();
    expect(h.client.consumer).not.toHaveBeenCalled();
    expect(h.client.producer).not.toHaveBeenCalled();
  });

  it('opens an explicit event-only group with manual offsets and isolated partition concurrency', async () => {
    const h = harness();
    const create = await factory();
    const topics = ['orders'];
    const strategy = create({ ...h.options, topics, name: 'kafka.orders', fromBeginning: true });
    topics.push('changed-after-construction');
    expect(strategy.name).toBe('kafka.orders');
    expect(strategy.capabilities).toEqual({ redelivery: true, deadLetter: true, requestResponse: false });
    await expect(
      strategy.send({
        pattern: 'orders',
        payload: {},
        correlationId: 'x',
        timeoutMs: 20,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/request|response|support/i);
    expect(h.client.consumer).not.toHaveBeenCalled();
    await expect(strategy.emit('orders', {})).rejects.toThrow(/listen/i);
    await strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
    expect(h.client.consumer).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'orders.worker', allowAutoTopicCreation: false }),
    );
    expect(h.consumer.subscribe).toHaveBeenCalledWith({ topics: ['orders'], fromBeginning: true });
    expect(h.consumer.run).toHaveBeenCalledWith(
      expect.objectContaining({ autoCommit: false, eachBatchAutoResolve: false, partitionsConsumedConcurrently: 2 }),
    );
    const crash = new Error('consumer crashed');
    h.listeners.get('crash')?.({ payload: { error: crash } });
    expect(h.errors).toContain(crash);
    await expect(strategy.close(-1)).rejects.toThrow();
    await expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toThrow(/already/i);
    await strategy.close(100);
  });

  it('emits the canonical traced envelope and awaits the producer acknowledgement', async () => {
    const h = harness();
    const strategy = (await factory())(h.options);
    await strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
    const acknowledgement = deferred<never[]>();
    h.producer.send.mockReturnValueOnce(acknowledgement.promise);
    let done = false;
    const send = strategy.emit('orders', { id: 7 }, { traceparent: 'trace-7' }).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(h.producer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'orders',
        acks: -1,
        messages: [{ value: encodeDelivery({ id: 7 }, { traceparent: 'trace-7' }) }],
      }),
    );
    acknowledgement.resolve([]);
    await send;
    await expect(strategy.emit('bad topic', {})).rejects.toThrow();
    await expect(strategy.emit('orders', undefined)).rejects.toThrow();
    const error = new Error('broker acknowledgement failed');
    h.producer.send.mockRejectedValueOnce(error);
    await expect(strategy.emit('orders', {})).rejects.toBe(error);
    await strategy.close(100);
  });

  it('commits offset plus one only after dispatch and before the following record', async () => {
    const h = harness();
    const strategy = (await factory())(h.options);
    const pending = deferred<DispatchOutcome>();
    const seen: RawMessage[] = [];
    await strategy.listen(async message => {
      seen.push(message);
      return seen.length === 1 ? pending.promise : { settlement: { kind: 'ack' } };
    });
    const delivery = h.batch(['9007199254740993', '9007199254740994']);
    const running = delivery.run();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    const committed = deferred<void>();
    h.consumer.commitOffsets.mockReturnValueOnce(committed.promise);
    pending.resolve({ settlement: { kind: 'ack' } });
    await vi.waitFor(() => expect(h.consumer.commitOffsets).toHaveBeenCalledTimes(1));
    expect(seen).toHaveLength(1);
    committed.resolve();
    await running;
    expect(seen.map(message => message.deliveryAttempt)).toEqual([1, 1]);
    expect(h.consumer.commitOffsets.mock.calls).toEqual([
      [[{ topic: 'orders', partition: 0, offset: '9007199254740994' }]],
      [[{ topic: 'orders', partition: 0, offset: '9007199254740995' }]],
    ]);
    expect(h.calls.indexOf(h.calls.find(call => call[0] === 'commit') ?? [])).toBeGreaterThanOrEqual(0);
    await strategy.close(100);
  });

  it('pauses and rewinds only a retrying partition without advancing later offsets', async () => {
    vi.useFakeTimers();
    const h = harness();
    const strategy = (await factory())(h.options);
    const seen: RawMessage[] = [];
    await strategy.listen(async message => {
      seen.push(message);
      return {
        settlement:
          message.deliveryAttempt === 1 && message.payload && (message.payload as { offset: string }).offset === '4'
            ? { kind: 'retry', afterMs: 50 }
            : { kind: 'ack' },
      };
    });
    await h.batch(['4', '5']).run();
    expect(seen).toHaveLength(1);
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    expect(h.consumer.seek).toHaveBeenCalledWith({ topic: 'orders', partition: 0, offset: '4' });
    expect(h.calls).toContainEqual(['pause', [{ topic: 'orders', partitions: [0] }]]);
    await h.batch(['7'], 1).run();
    expect(h.consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'orders', partition: 1, offset: '8' }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.calls).toContainEqual(['resume', [{ topic: 'orders', partitions: [0] }]]);
    await h.batch(['4', '5']).run();
    expect(seen.map(message => message.deliveryAttempt)).toEqual([1, 1, 2, 1]);
    await strategy.close(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('confirms the original dead-letter record before committing its source offset', async () => {
    const h = harness();
    const strategy = (await factory())(h.options);
    const confirmed = deferred<never[]>();
    h.producer.send.mockReturnValueOnce(confirmed.promise);
    await strategy.listen(async () => ({ settlement: { kind: 'dead', reason: 'invalid payload' } }));
    const delivery = h.batch(['2']);
    const running = delivery.run();
    await vi.waitFor(() => expect(h.producer.send).toHaveBeenCalled());
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    expect(h.producer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'orders.dead',
        acks: -1,
        messages: [
          expect.objectContaining({
            value: delivery.payload.batch.messages[0]?.value,
            key: globalThis.Buffer.from('customer-7'),
            headers: {
              custom: globalThis.Buffer.from('kept'),
              'zmdb-source-topic': 'orders',
              'zmdb-source-partition': '0',
              'zmdb-source-offset': '2',
              'zmdb-delivery-attempt': '1',
              'zmdb-dead-reason': 'invalid payload',
            },
          }),
        ],
      }),
    );
    confirmed.resolve([]);
    await running;
    expect(h.consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'orders', partition: 0, offset: '3' }]);
    await strategy.close(100);
  });

  it.each(['dispatch', 'heartbeat', 'dead-letter', 'commit'] as const)(
    'leaves the record unsettled on %s failure',
    async fault => {
      vi.useFakeTimers();
      const h = harness();
      const strategy = (await factory())({
        ...h.options,
        onError: error => {
          h.errors.push(error);
          throw new Error('sink failure');
        },
      });
      const failure = new Error(`${fault} failed`);
      const seen: RawMessage[] = [];
      await strategy.listen(async message => {
        seen.push(message);
        if (fault === 'dispatch') throw failure;
        return { settlement: fault === 'dead-letter' ? { kind: 'dead', reason: 'bad' } : { kind: 'ack' } };
      });
      const delivery = h.batch(['8', '9']);
      if (fault === 'heartbeat') vi.mocked(delivery.payload.heartbeat).mockRejectedValueOnce(failure);
      if (fault === 'dead-letter') h.producer.send.mockRejectedValueOnce(failure);
      if (fault === 'commit') h.consumer.commitOffsets.mockRejectedValueOnce(failure);
      await delivery.run();
      expect(h.errors).toContain(failure);
      expect(seen.length).toBeLessThanOrEqual(1);
      expect(delivery.payload.resolveOffset).not.toHaveBeenCalled();
      if (fault !== 'commit') expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
      expect(h.consumer.seek).toHaveBeenCalledWith({ topic: 'orders', partition: 0, offset: '8' });
      await strategy.close(100);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('passes malformed and null wire values to the app as parse failures', async () => {
    const h = harness();
    const strategy = (await factory())(h.options);
    const seen: RawMessage[] = [];
    await strategy.listen(async message => {
      seen.push(message);
      return { settlement: { kind: 'dead', reason: 'invalid wire' } };
    });
    for (const value of [globalThis.Buffer.from('not json'), null]) {
      const delivery = h.batch();
      Object.assign(delivery.payload.batch.messages[0] ?? {}, { value });
      await delivery.run();
    }
    expect(seen).toHaveLength(2);
    for (const message of seen) expect(message.parseError).toBeDefined();
    await strategy.close(100);
  });

  it.each(['stale', 'stopped', 'rebalance'] as const)('fences a handler completion after %s ownership', async state => {
    const h = harness();
    const strategy = (await factory())(h.options);
    const pending = deferred<DispatchOutcome>();
    const dispatch = vi.fn(() => pending.promise);
    await strategy.listen(dispatch);
    const delivery = h.batch(['3', '4']);
    const running = delivery.run();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    if (state === 'stale') delivery.stale();
    else if (state === 'stopped') delivery.stopped();
    else h.listeners.get('rebalance')?.({ payload: { groupId: 'orders.worker' } });
    pending.resolve({ settlement: { kind: 'dead', reason: 'too late' } });
    await running;
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    expect(h.producer.send).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    await strategy.close(100);
  });

  it('heartbeats while a handler is pending and drains its acknowledgement during close', async () => {
    vi.useFakeTimers();
    const h = harness();
    const strategy = (await factory())({ ...h.options, heartbeatIntervalMs: 10 });
    const pending = deferred<DispatchOutcome>();
    await strategy.listen(() => pending.promise);
    const delivery = h.batch(['6', '7']);
    const running = delivery.run();
    await vi.advanceTimersByTimeAsync(25);
    expect(delivery.payload.heartbeat).toHaveBeenCalled();
    const closing = strategy.close(100);
    pending.resolve({ settlement: { kind: 'ack' } });
    await running;
    await closing;
    expect(h.consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'orders', partition: 0, offset: '7' }]);
    expect(h.consumer.commitOffsets).toHaveBeenCalledTimes(1);
    expect(h.consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(h.producer.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stuck handler, disconnects owned resources and ignores its late result', async () => {
    vi.useFakeTimers();
    const h = harness();
    const strategy = (await factory())(h.options);
    const pending = deferred<DispatchOutcome>();
    await strategy.listen(() => pending.promise);
    const running = h.batch().run();
    await vi.advanceTimersByTimeAsync(0);
    const closing = expect(strategy.close(30)).rejects.toThrow(/drain|grace|timeout/i);
    await vi.advanceTimersByTimeAsync(30);
    await closing;
    expect(h.consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(h.producer.disconnect).toHaveBeenCalledTimes(1);
    pending.resolve({ settlement: { kind: 'ack' } });
    await running;
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    await strategy.close(30);
    await expect(strategy.emit('orders', {})).rejects.toThrow(/closed/i);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans failed startup and preserves its original error', async () => {
    const h = harness();
    const failure = new Error('subscription denied');
    h.consumer.subscribe.mockRejectedValueOnce(failure);
    const strategy = (await factory())(h.options);
    await expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toBe(failure);
    expect(h.consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(h.producer.disconnect).toHaveBeenCalledTimes(1);
    await strategy.close(100);
    expect(h.consumer.run).not.toHaveBeenCalled();
  });

  it('fences close during startup and prevents retry timers after close', async () => {
    vi.useFakeTimers();
    const h = harness();
    const connecting = deferred<void>();
    h.producer.connect.mockReturnValueOnce(connecting.promise);
    const strategy = (await factory())(h.options);
    const listening = expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toThrow(/closed/i);
    const closing = strategy.close(100);
    connecting.resolve();
    await listening;
    await closing;
    expect(h.consumer.run).not.toHaveBeenCalled();
    expect(h.consumer.disconnect).toHaveBeenCalled();
    expect(h.producer.disconnect).toHaveBeenCalled();
    const second = harness();
    const retrying = (await factory())(second.options);
    await retrying.listen(async () => ({ settlement: { kind: 'retry', afterMs: 50 } }));
    await second.batch().run();
    await retrying.close(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(second.calls.filter(call => call[0] === 'resume')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
