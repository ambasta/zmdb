import { setTimeout as delay } from 'node:timers/promises';

import { createQueue, createWorker, type Clock, type JobEnqueue, type JobSettlement, type JobStore } from '@zmdb/jobs';
import { describe, expect, it, vi } from 'vitest';

const START = Date.parse('2026-09-07T00:00:00.000Z');
const clock: Clock = {
  now: () => START,
  sleep: (duration, signal) => delay(duration, undefined, { signal }),
};

function domainStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    enqueue: async job => ({ kind: 'inserted', jobId: job.id }),
    candidates: async () => [{ id: 'job', name: 'deliver', enqueuedAt: new Date(START) }],
    claim: async options => [
      {
        id: 'job',
        name: 'deliver',
        enqueuedAt: new Date(START),
        payload: '{"id":17}',
        attempts: 0,
        holder: options.holder,
      },
    ],
    completed: async () => false,
    settle: async () => true,
    listDead: async () => [],
    replay: async () => false,
    ...overrides,
  };
}

function makeWorker(
  store: JobStore,
  overrides: { validate?: (raw: unknown) => { id: number }; handle?: () => Promise<void>; onDead?: () => void } = {},
) {
  return createWorker<{ deliver: { id: number } }>({
    store,
    clock,
    handlers: [
      {
        name: 'deliver',
        validate: overrides.validate ?? (() => ({ id: 17 })),
        handle: overrides.handle ?? (async () => undefined),
      },
    ],
    concurrency: 1,
    graceMs: 10,
    timeoutMs: 100,
    leaseMs: 1000,
    onDead: overrides.onDead ?? (() => undefined),
    onHandlerError: () => undefined,
  });
}

describe('provider-neutral domain ports (#756)', () => {
  it('enqueues encoded payloads and uses only the supplied transaction enqueuer', async () => {
    const enqueued: JobEnqueue[] = [];
    const store = domainStore({
      enqueue: async job => {
        enqueued.push(job);
        return { kind: 'inserted', jobId: job.id };
      },
    });
    const queue = createQueue<{ deliver: { id: number } }>({ store, clock });
    const id = await queue.enqueue('deliver', { id: 17 }, { dedupeKey: 'request', delayMs: 25 });
    expect(enqueued).toEqual([
      {
        id,
        name: 'deliver',
        payload: '{"id":17}',
        enqueuedAt: new Date(START),
        availableAt: new Date(START + 25),
        dedupeKey: 'request',
      },
    ]);
    const transactional: JobEnqueue[] = [];
    const transaction = {
      enqueue: async (job: JobEnqueue) => {
        transactional.push(job);
        return { kind: 'duplicate' as const, jobId: 'original' };
      },
    };
    await expect(queue.enqueueInTransaction(transaction, 'deliver', { id: 18 })).resolves.toBe('original');
    expect(enqueued).toHaveLength(1);
    expect(transactional[0]).toMatchObject({ name: 'deliver', payload: '{"id":18}', availableAt: new Date(START) });
  });

  it('hands the complete worker workflow through domain operations without raw SQL', async () => {
    const calls: string[] = [];
    const settlements: JobSettlement[] = [];
    const store = domainStore({
      candidates: async options => {
        calls.push('candidates');
        expect(options).toEqual({ now: new Date(START), limit: 1 });
        return [{ id: 'job', name: 'deliver', enqueuedAt: new Date(START) }];
      },
      claim: async options => {
        calls.push('claim');
        expect(options).toMatchObject({ ids: ['job'], now: new Date(START), leaseUntil: new Date(START + 1000) });
        expect(options.holder).not.toBe('');
        return [
          {
            id: 'job',
            name: 'deliver',
            enqueuedAt: new Date(START),
            payload: '{"id":17}',
            attempts: 0,
            holder: options.holder,
          },
        ];
      },
      completed: async key => {
        calls.push('completed');
        expect(key).toBe('job');
        return false;
      },
      settle: async settlement => {
        calls.push('settle');
        settlements.push(settlement);
        return true;
      },
    });
    const worker = makeWorker(store, {
      validate: raw => {
        calls.push('validate');
        expect(raw).toEqual({ id: 17 });
        return { id: 17 };
      },
      handle: async () => {
        calls.push('handle');
      },
    });
    try {
      expect(await worker.runOnce()).toEqual({ claimed: 1, done: 1, retried: 0, dead: 0, skipped: 0 });
      expect(calls).toEqual(['candidates', 'claim', 'completed', 'validate', 'handle', 'settle']);
      expect(settlements).toEqual([
        { kind: 'done', jobId: 'job', holder: expect.any(String), idempotencyKey: 'job', completedAt: new Date(START) },
      ]);
    } finally {
      await worker.onShutdown({ graceMs: 0 });
    }
  });

  it.each(['done', 'retry', 'dead'] as const)('does not report %s after settlement loses its holder', async kind => {
    const observed: JobSettlement[] = [];
    const onDead = vi.fn();
    const worker = makeWorker(
      domainStore({
        settle: async settlement => {
          observed.push(settlement);
          return false;
        },
      }),
      {
        ...(kind === 'dead'
          ? {
              validate: () => {
                throw new Error('invalid');
              },
            }
          : {}),
        ...(kind === 'retry'
          ? {
              handle: async () => {
                throw new Error('retry');
              },
            }
          : {}),
        onDead,
      },
    );
    try {
      expect(await worker.runOnce()).toEqual({ claimed: 1, done: 0, retried: 0, dead: 0, skipped: 1 });
      expect(observed[0]?.kind).toBe(kind);
      expect(onDead).not.toHaveBeenCalled();
    } finally {
      await worker.onShutdown({ graceMs: 0 });
    }
  });

  it('propagates a domain-store failure without converting it into an empty success', async () => {
    const error = new Error('store rejected candidates');
    const worker = makeWorker(
      domainStore({
        candidates: async () => {
          throw error;
        },
      }),
    );
    try {
      await expect(worker.runOnce()).rejects.toBe(error);
    } finally {
      await worker.onShutdown({ graceMs: 0 });
    }
  });

  it('bounds shutdown during a pending claim and releases a late claim without running it', async () => {
    let finishClaim: () => void = () => undefined;
    const claimPending = new Promise<void>(resolve => {
      finishClaim = resolve;
    });
    let enteredClaim: () => void = () => undefined;
    const entered = new Promise<void>(resolve => {
      enteredClaim = resolve;
    });
    const settlements: JobSettlement[] = [];
    const handle = vi.fn(async () => undefined);
    const worker = makeWorker(
      domainStore({
        claim: async options => {
          enteredClaim();
          await claimPending;
          return [
            {
              id: 'job',
              name: 'deliver',
              enqueuedAt: new Date(START),
              payload: '{"id":17}',
              attempts: 0,
              holder: options.holder,
            },
          ];
        },
        settle: async settlement => {
          settlements.push(settlement);
          return true;
        },
      }),
      { handle },
    );
    const running = worker.runOnce();
    const observedRunning = running.catch(error => error);
    let outcome;
    try {
      await Promise.race([
        entered,
        observedRunning.then(error => {
          throw error;
        }),
      ]);
      outcome = await Promise.race([
        worker.onShutdown({ graceMs: 10 }).then(() => 'bounded'),
        delay(150).then(() => 'overdue'),
      ]);
    } finally {
      finishClaim();
      await observedRunning;
      await worker.onShutdown({ graceMs: 0 });
    }
    expect(outcome).toBe('bounded');
    expect(handle).not.toHaveBeenCalled();
    expect(settlements).toEqual([
      { kind: 'release', jobId: 'job', holder: expect.any(String), availableAt: new Date(START) },
    ]);
  });
});
