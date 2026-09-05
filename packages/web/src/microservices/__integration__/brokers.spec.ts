import { encodeDelivery } from '@zmdb/app/messaging';
import { createClient } from 'redis';
import { describe, expect, it, vi } from 'vitest';

import { createRedisStrategy } from '../redis/index.js';

const REDIS_URL = process.env.ZMDB_REDIS_URL;

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
