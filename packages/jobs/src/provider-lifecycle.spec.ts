import { setTimeout as delay } from 'node:timers/promises';

import { createApplication, Module } from '@zmdb/app';
import { jobsExtension, type JobStoreResource, type Scheduler, type Worker } from '@zmdb/jobs';
import { describe, expect, it, vi } from 'vitest';

@Module({ controllers: [] })
class Root {}

function worker(name: string, events: string[], stop: () => Promise<void> = async () => undefined): Worker {
  return {
    start: () => {
      events.push(`start:${name}`);
    },
    onShutdown: async () => {
      events.push(`stop:${name}`);
      await stop();
    },
    runOnce: async () => ({ claimed: 0, done: 0, retried: 0, dead: 0, skipped: 0 }),
    listDead: async () => [],
    replay: async () => false,
  };
}

function scheduler(name: string, events: string[], stop: () => Promise<void> = async () => undefined): Scheduler {
  return {
    start: () => {
      events.push(`start:${name}`);
    },
    onShutdown: async () => {
      events.push(`stop:${name}`);
      await stop();
    },
    tick: async () => undefined,
  };
}

describe('jobs provider resource lifecycle (#756)', () => {
  it('stops reverse scheduler worker and distinct store groups exactly once', async () => {
    const events: string[] = [];
    const budgets: number[] = [];
    const first: JobStoreResource = {
      close: options => {
        events.push('close:first');
        budgets.push(options?.graceMs ?? -1);
      },
    };
    const second: JobStoreResource = {
      close: options => {
        events.push('close:second');
        budgets.push(options?.graceMs ?? -1);
      },
    };
    const application = createApplication(Root, {
      graceMs: 100,
      extensions: [
        jobsExtension({
          workers: [worker('first-worker', events), worker('second-worker', events)],
          schedulers: [scheduler('first-scheduler', events), scheduler('second-scheduler', events)],
          stores: [first, second, first],
        }),
      ],
    });
    await application.init();
    await application[Symbol.asyncDispose]();
    await application[Symbol.asyncDispose]();
    expect(events).toEqual([
      'start:first-worker',
      'start:second-worker',
      'start:first-scheduler',
      'start:second-scheduler',
      'stop:second-scheduler',
      'stop:first-scheduler',
      'stop:second-worker',
      'stop:first-worker',
      'close:second',
      'close:first',
    ]);
    expect(budgets).toHaveLength(2);
    for (const budget of budgets) expect(budget).toBeGreaterThanOrEqual(0);
    expect(budgets[0]).toBeLessThanOrEqual(100);
    expect(budgets[1]).toBeLessThanOrEqual(budgets[0] ?? -1);
  });

  it('preserves every failure in scheduler worker and store attempt order', async () => {
    const events: string[] = [];
    const schedulerError = new Error('scheduler failure');
    const workerError = new Error('worker failure');
    const storeError = new Error('store failure');
    const extension = jobsExtension({
      workers: [
        worker('worker', events, async () => {
          throw workerError;
        }),
      ],
      schedulers: [
        scheduler('scheduler', events, async () => {
          throw schedulerError;
        }),
      ],
      stores: [
        {
          close: () => {
            events.push('close:store');
            throw storeError;
          },
        },
      ],
    });
    const application = createApplication(Root, { graceMs: 100, extensions: [extension] });
    await application.init();
    const result = await Promise.resolve(application[Symbol.asyncDispose]()).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) throw new Error('missing aggregate error');
    expect(result.errors).toEqual([schedulerError, workerError, storeError]);
    expect(events.slice(2)).toEqual(['stop:scheduler', 'stop:worker', 'close:store']);
  });

  it('bounds a hanging participant and still closes every following store with zero grace', async () => {
    const events: string[] = [];
    let finish: () => void = () => undefined;
    const hanging = new Promise<void>(resolve => {
      finish = resolve;
    });
    const budgets: number[] = [];
    const application = createApplication(Root, {
      graceMs: 10,
      extensions: [
        jobsExtension({
          workers: [worker('hung', events, () => hanging)],
          stores: [
            {
              close: options => {
                events.push('close:store');
                budgets.push(options?.graceMs ?? -1);
              },
            },
          ],
        }),
      ],
    });
    await application.init();
    const stopped = application[Symbol.asyncDispose]().then(
      () => undefined,
      (error: unknown) => error,
    );
    let result;
    try {
      result = await Promise.race([stopped, delay(150).then(() => 'overdue')]);
    } finally {
      finish();
      await stopped;
    }
    expect(result).toMatchObject({ name: 'TimeoutError', message: '@zmdb/jobs: shutdown deadline exceeded' });
    expect(events).toEqual(['start:hung', 'stop:hung', 'close:store']);
    expect(budgets).toEqual([0]);
  });

  it('closes registered stores after startup fails and refuses invalid shutdown budgets', async () => {
    const close = vi.fn();
    const events: string[] = [];
    const participant = worker('failure', events);
    participant.start = () => {
      throw new Error('startup failure');
    };
    const extension = jobsExtension({ workers: [participant], stores: [{ close }] });
    const application = createApplication(Root, { extensions: [extension] });
    await expect(application.init()).rejects.toThrow('startup failure');
    await application[Symbol.asyncDispose]();
    expect(close).toHaveBeenCalledTimes(1);
    const unused = jobsExtension({ stores: [{ close: () => undefined }] });
    await expect(async () => unused.stop({ graceMs: -1 })).rejects.toThrow(RangeError);
  });
});
