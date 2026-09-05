import { createApplication } from '@zmdb/app';
import { Module } from '@zmdb/app/modules';
import { createQueue, createWorker, jobsExtension, type Clock, type RunReport, type Worker } from '@zmdb/jobs';
import { createMemoryJobStore } from '@zmdb/jobs/memory';
import type { Scheduler } from '@zmdb/jobs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';

const EMPTY_REPORT: RunReport = { claimed: 0, done: 0, retried: 0, dead: 0, skipped: 0 };

function workerParticipant(name: string, log: string[], stopped: (graceMs: number) => void | Promise<void>): Worker {
  return {
    start() {
      log.push(`start:${name}`);
    },
    async onShutdown(options) {
      const graceMs = options?.graceMs ?? -1;
      log.push(`stop:${name}:${String(graceMs)}`);
      await stopped(graceMs);
    },
    runOnce: () => Promise.resolve(EMPTY_REPORT),
    listDead: () => Promise.resolve([]),
    replay: () => Promise.resolve(false),
  };
}

function schedulerParticipant(
  name: string,
  log: string[],
  stopped: (graceMs: number) => void | Promise<void>,
): Scheduler {
  return {
    start() {
      log.push(`start:${name}`);
    },
    async onShutdown(options) {
      const graceMs = options?.graceMs ?? -1;
      log.push(`stop:${name}:${String(graceMs)}`);
      await stopped(graceMs);
    },
    tick: () => Promise.resolve(),
  };
}

class FakeClock implements Clock {
  readonly #pending = new Set<{
    readonly reject: (error: Error) => void;
    readonly signal: AbortSignal;
  }>();

  now(): number {
    return 0;
  }

  sleep(_ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((_resolve, reject) => {
      const pending = { reject, signal };
      this.#pending.add(pending);
      signal.addEventListener(
        'abort',
        () => {
          this.#pending.delete(pending);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('@zmdb/jobs application extension (#650)', () => {
  it('starts workers before schedulers and shares one app shutdown deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
    const log: string[] = [];
    const stop = (): void => {
      vi.advanceTimersByTime(10);
    };
    const firstWorker = workerParticipant('worker-a', log, stop);
    const secondWorker = workerParticipant('worker-b', log, stop);
    const firstScheduler = schedulerParticipant('scheduler-a', log, stop);
    const secondScheduler = schedulerParticipant('scheduler-b', log, stop);

    @Module({ controllers: [] })
    class Root {}

    const application = createApplication(Root, {
      graceMs: 100,
      extensions: [
        jobsExtension({
          workers: [firstWorker, secondWorker],
          schedulers: [firstScheduler, secondScheduler],
        }),
      ],
    });

    await application.init();
    expect(log).toEqual(['start:worker-a', 'start:worker-b', 'start:scheduler-a', 'start:scheduler-b']);

    await application[Symbol.asyncDispose]();
    expect(log.slice(4)).toEqual([
      'stop:scheduler-b:100',
      'stop:scheduler-a:90',
      'stop:worker-b:80',
      'stop:worker-a:70',
    ]);
  });

  it('attempts every participant and preserves shutdown failures in attempt order', async () => {
    const schedulerError = new Error('scheduler failed');
    const workerError = new Error('worker failed');
    const log: string[] = [];

    @Module({ controllers: [] })
    class Root {}

    const application = createApplication(Root, {
      extensions: [
        jobsExtension({
          workers: [
            workerParticipant('worker', log, () => {
              throw workerError;
            }),
          ],
          schedulers: [
            schedulerParticipant('scheduler', log, () => {
              throw schedulerError;
            }),
          ],
        }),
      ],
    });
    await application.init();

    const error = await application[Symbol.asyncDispose]().then(
      () => undefined,
      failure => failure,
    );
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error('jobs extension did not aggregate shutdown failures');
    expect(error.errors).toEqual([schedulerError, workerError]);
    expect(log.filter(entry => entry.startsWith('stop:'))).toEqual([
      expect.stringMatching(/^stop:scheduler:/),
      expect.stringMatching(/^stop:worker:/),
    ]);
  });

  it('starts and drains a real worker through the application lifecycle', async () => {
    const store = createMemoryJobStore();
    try {
      const clock = new FakeClock();
      const queue = createQueue<{ readonly deliver: { readonly id: number } }>({ store, clock });
      const delivered: number[] = [];
      const worker = createWorker({
        handlers: [
          {
            name: 'deliver',
            validate(raw) {
              if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
                throw new Error('deliver payload requires an id');
              }
              return { id: raw.id };
            },
            handle(payload) {
              delivered.push(payload.id);
              return Promise.resolve();
            },
          },
        ],
        store,
        clock,
        concurrency: 1,
        graceMs: 100,
        leaseMs: 30_000,
        timeoutMs: 5_000,
        onDead: () => undefined,
        onHandlerError: () => undefined,
      });
      await queue.enqueue('deliver', { id: 7 });

      @Module({ controllers: [] })
      class Root {}

      const application = createApplication(Root, { extensions: [jobsExtension({ workers: [worker] })] });
      expect(delivered).toEqual([]);
      await application.init();
      await flush();
      expect(delivered).toEqual([7]);
      await expect(application[Symbol.asyncDispose]()).resolves.toBeUndefined();
      await expect(worker.runOnce()).resolves.toEqual(EMPTY_REPORT);
    } finally {
      store.close();
    }
  });
});
