import { encodeDelivery } from '@zmdb/app/messaging';
import { connect as connectRabbit } from 'amqplib';
import { createClient } from 'redis';
import { describe, expect, it, vi } from 'vitest';

import { createNatsStrategy } from '../nats/index.js';
import { createRabbitMqStrategy } from '../rabbitmq/index.js';
import { createRedisStrategy } from '../redis/index.js';

const REDIS_URL = process.env.ZMDB_REDIS_URL;
const NATS_URL = process.env.ZMDB_NATS_URL;
const RABBITMQ_URL = process.env.ZMDB_RABBITMQ_URL;

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required for this gated integration suite`);
  }
  return value;
}

describe.skipIf(REDIS_URL === undefined)('Redis Pub/Sub integration (#560)', () => {
  it('loses messages published with no connected consumer and delivers live messages', async () => {
    const url = required(REDIS_URL, 'ZMDB_REDIS_URL');
    const channel = `zmdb.test.${globalThis.crypto.randomUUID()}`;
    const raw = createClient({ url });
    const errors: unknown[] = [];
    await raw.connect();
    const subscribers = await raw.publish(channel, encodeDelivery({ id: 'before' }, undefined));
    const received: unknown[] = [];
    const strategy = createRedisStrategy({
      channels: [channel],
      connection: { url },
      onError: error => errors.push(error),
    });
    try {
      await strategy.listen(message => {
        received.push(message.payload);
        return Promise.resolve({ settlement: { kind: 'ack' } });
      });
      await strategy.emit(channel, { id: 'after' });
      await vi.waitFor(() => expect(received).toEqual([{ id: 'after' }]));

      expect(subscribers).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await strategy.close(1_000);
      await raw.close();
    }
  });
});

describe.skipIf(NATS_URL === undefined)('core NATS integration (#560)', () => {
  it('uses a wildcard queue group for concrete event and request subjects', async () => {
    const servers = required(NATS_URL, 'ZMDB_NATS_URL');
    const prefix = `zmdb.test.${globalThis.crypto.randomUUID()}`;
    const errors: unknown[] = [];
    const delivered: string[] = [];
    const strategy = createNatsStrategy({
      connection: { servers },
      subscriptions: [{ subject: `${prefix}.*`, queue: `${prefix}.workers` }],
      onError: error => errors.push(error),
    });
    try {
      await strategy.listen(message => {
        delivered.push(message.pattern);
        return Promise.resolve({
          settlement: { kind: 'ack' },
          ...(message.replyTo === undefined || message.correlationId === undefined
            ? {}
            : {
                reply: {
                  kind: 'result',
                  correlationId: message.correlationId,
                  payload: message.payload,
                },
              }),
        });
      });
      await strategy.emit(`${prefix}.event`, { id: 1 });
      const controller = new AbortController();
      const reply = await strategy.send({
        pattern: `${prefix}.request`,
        payload: { id: 2 },
        correlationId: 'request-2',
        timeoutMs: 1_000,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(delivered).toEqual([`${prefix}.event`, `${prefix}.request`]));

      expect(reply).toEqual({ kind: 'result', correlationId: 'request-2', payload: { id: 2 } });
      expect(errors).toEqual([]);
    } finally {
      await strategy.close(1_000);
    }
  });
});

describe.skipIf(RABBITMQ_URL === undefined)('RabbitMQ integration (#560)', () => {
  it('redelivers through the TTL retry queue and dead-letters invalid JSON', async () => {
    const connection = required(RABBITMQ_URL, 'ZMDB_RABBITMQ_URL');
    const suffix = globalThis.crypto.randomUUID();
    const exchange = `zmdb.test.${suffix}`;
    const queue = `${exchange}.worker`;
    const retryExchange = `${exchange}.retry`;
    const retryQueue = `${queue}.retry`;
    const deadExchange = `${exchange}.dead`;
    const deadQueue = `${queue}.dead`;
    const pattern = 'orders.created';
    const errors: unknown[] = [];
    const attempts: number[] = [];
    const strategy = createRabbitMqStrategy({
      connection,
      exchange,
      queue,
      bindings: ['orders.*'],
      prefetch: 1,
      retry: { exchange: retryExchange, queue: retryQueue },
      deadLetter: { exchange: deadExchange, queue: deadQueue },
      onError: error => errors.push(error),
    });
    const adminModel = await connectRabbit(connection);
    const admin = await adminModel.createConfirmChannel();
    try {
      await strategy.listen(message => {
        if (message.parseError !== undefined) {
          return Promise.resolve({ settlement: { kind: 'dead', reason: 'invalid-payload' } });
        }
        attempts.push(message.deliveryAttempt);
        return Promise.resolve(
          message.deliveryAttempt === 1
            ? { settlement: { kind: 'retry', afterMs: 25 } }
            : { settlement: { kind: 'ack' } },
        );
      });

      await strategy.emit(pattern, { id: 1 });
      await vi.waitFor(() => expect(attempts.length).toBe(2), { timeout: 5_000, interval: 25 });
      expect(attempts[0]).toBe(1);
      expect(attempts[1]).toBeGreaterThan(1);

      admin.publish(exchange, pattern, globalThis.Buffer.from('{not-json'), {
        contentType: 'application/json',
        persistent: false,
      });
      await admin.waitForConfirms();
      let dead = await admin.get(deadQueue, { noAck: true });
      await vi.waitFor(
        async () => {
          dead = dead || (await admin.get(deadQueue, { noAck: true }));
          expect(dead).not.toBe(false);
        },
        { timeout: 5_000, interval: 25 },
      );
      expect(dead === false ? '' : dead.content.toString('utf8')).toBe('{not-json');
      expect(errors).toEqual([]);
    } finally {
      await strategy.close(1_000);
      await admin.deleteQueue(queue).catch(() => undefined);
      await admin.deleteQueue(retryQueue).catch(() => undefined);
      await admin.deleteQueue(deadQueue).catch(() => undefined);
      await admin.deleteExchange(exchange).catch(() => undefined);
      await admin.deleteExchange(retryExchange).catch(() => undefined);
      await admin.deleteExchange(deadExchange).catch(() => undefined);
      await admin.close();
      await adminModel.close();
    }
  });
});
