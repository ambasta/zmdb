import { connect as connectRabbit } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';

import { createRabbitMqStrategy } from '../index.js';

const RABBITMQ_URL = process.env.ZMDB_RABBITMQ_URL;

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required for this gated integration suite`);
  }
  return value;
}

describe.skipIf(RABBITMQ_URL === undefined)('RabbitMQ integration (#659)', () => {
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
