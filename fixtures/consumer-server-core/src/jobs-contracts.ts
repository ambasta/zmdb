import type { ApplicationExtension } from '@zmdb/app';
import {
  createQueue,
  createWorker,
  jobsExtension,
  type Clock,
  type JobHandler,
  type Queue,
  type Worker,
} from '@zmdb/jobs';
import { createMemoryJobStore, type MemoryJobStore } from '@zmdb/jobs/memory';
import { Cron, Interval, createScheduler, type LeaseStore, type Scheduler } from '@zmdb/jobs/schedule';

type Jobs = {
  readonly 'email.send': { readonly userId: number };
};

const clock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  },
};

using store: MemoryJobStore = createMemoryJobStore();

const handler: JobHandler<Jobs, 'email.send'> = {
  name: 'email.send',
  validate(raw) {
    if (typeof raw !== 'object' || raw === null || !('userId' in raw) || typeof raw.userId !== 'number') {
      throw new Error('email.send requires a numeric userId');
    }
    return { userId: raw.userId };
  },
  handle() {
    return Promise.resolve();
  },
};

const queue: Queue<Jobs> = createQueue<Jobs>({ store, clock });
const worker: Worker = createWorker<Jobs>({
  handlers: [handler],
  store,
  clock,
  concurrency: 1,
  graceMs: 1_000,
  leaseMs: 60_000,
  onDead: () => undefined,
  onHandlerError: () => undefined,
});

class Tasks {
  @Cron('@hourly', { runs: 'once-per-replica' })
  hourly(): void {}

  @Interval(60_000, { runs: 'once-per-replica' })
  refresh(): void {}
}

const scheduler: Scheduler = createScheduler({
  tasks: [new Tasks()],
  clock,
  onTaskError: () => undefined,
  onSkipped: () => undefined,
});
const extension: ApplicationExtension = jobsExtension({ workers: [worker], schedulers: [scheduler] });

const leases: LeaseStore = {
  acquire: () => Promise.resolve(true),
  renew: () => Promise.resolve(true),
  release: () => Promise.resolve(),
};

void queue.enqueue('email.send', { userId: 42 });
void [extension, leases];
