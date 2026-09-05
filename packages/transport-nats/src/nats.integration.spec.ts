import { describe, expect, it, vi } from 'vitest';

import { createNatsStrategy } from './index.js';

const NATS_URL = process.env.ZMDB_NATS_URL;

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required for this gated integration suite`);
  }
  return value;
}

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
      const reply = await strategy.send({
        pattern: `${prefix}.request`,
        payload: { id: 2 },
        correlationId: 'request-2',
        timeoutMs: 3_000,
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(delivered).toEqual([`${prefix}.event`, `${prefix}.request`]));

      expect(reply).toEqual({ kind: 'result', correlationId: 'request-2', payload: { id: 2 } });
      expect(errors).toEqual([]);
    } finally {
      await strategy.close(1_000);
    }
  });
});
