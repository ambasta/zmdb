import { createFakeClientTransport } from '@zmdb/client/testing';
import { describe, expect, it } from 'vitest';

const request = {
  method: 'GET',
  url: '/widgets/1',
  headers: {},
} as const;

describe('@zmdb/client deterministic fake transport', () => {
  it('holds and answers one request deterministically', async () => {
    const fake = createFakeClientTransport();
    const pending = fake.transport(request);
    const held = await fake.nextRequest();
    expect(held.request).toBe(request);
    expect(fake.requests).toEqual([request]);
    held.respond({ status: 204, headers: {}, body: null });
    await expect(pending).resolves.toEqual({ status: 204, headers: {}, body: null });
  });

  it('fails one held request with the exact reason', async () => {
    const fake = createFakeClientTransport();
    const reason = new Error('planned failure');
    const pending = fake.transport(request);
    const held = await fake.nextRequest();
    held.fail(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('observes cancellation through the request signal', async () => {
    const fake = createFakeClientTransport();
    const controller = new AbortController();
    const reason = new Error('cancel fake request');
    const pending = fake.transport({ ...request, signal: controller.signal });
    await fake.nextRequest();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
