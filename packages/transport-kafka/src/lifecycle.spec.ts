import type { EachBatchPayload, Kafka } from 'kafkajs';
import { afterEach, expect, it, vi } from 'vitest';

import { createKafkaStrategy } from './index.js';

function lifecycle() {
  let batch: ((payload: EachBatchPayload) => Promise<void>) | undefined;
  const errors: unknown[] = [];
  const producer = { connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) };
  const consumer = {
    events: { REBALANCING: 'rebalance', GROUP_JOIN: 'join', CRASH: 'crash' },
    on: () => () => {},
    connect: async () => {},
    disconnect: vi.fn(async () => {}),
    subscribe: async () => {},
    run: async (options: { eachBatch: typeof batch }) => {
      batch = options.eachBatch;
    },
    pause: () => {},
    stop: async () => {},
    seek: () => {},
  };
  const strategy = createKafkaStrategy({
    client: { producer: () => producer, consumer: () => consumer } as unknown as Kafka,
    groupId: 'lifecycle',
    topics: ['orders'],
    deadLetterTopic: 'dead',
    partitionsConsumedConcurrently: 1,
    heartbeatIntervalMs: 1,
    onError: error => errors.push(error),
  });
  return { strategy, producer, errors, run: (payload: EachBatchPayload) => batch?.(payload) };
}

afterEach(() => vi.useRealTimers());

it('reports a periodic heartbeat failure while the initial heartbeat is pending', async () => {
  vi.useFakeTimers();
  const h = lifecycle();
  const initial = Promise.withResolvers<void>();
  const failure = new Error('periodic heartbeat failed');
  await h.strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
  const running = h.run({
    batch: { topic: 'orders', partition: 0, messages: [{ offset: '0' }] },
    heartbeat: vi.fn().mockReturnValueOnce(initial.promise).mockRejectedValue(failure),
    isRunning: () => true,
    isStale: () => false,
    pause: () => () => {},
  } as unknown as EachBatchPayload);
  try {
    await vi.advanceTimersByTimeAsync(2);
    expect(h.errors).toContain(failure);
  } finally {
    initial.resolve();
    await running;
    await h.strategy.close(100);
  }
});

it('rejects at the close deadline even when an owned SDK disconnect stalls', async () => {
  vi.useFakeTimers();
  const h = lifecycle();
  const disconnected = Promise.withResolvers<void>();
  h.producer.disconnect.mockReturnValue(disconnected.promise);
  await h.strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
  let result: unknown;
  const closing = h.strategy.close(5).catch(error => {
    result = error;
  });
  try {
    await vi.advanceTimersByTimeAsync(5);
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toMatch(/drain|grace|timeout/i);
    expect(h.producer.disconnect).toHaveBeenCalledTimes(1);
  } finally {
    disconnected.resolve();
    await closing;
  }
});
