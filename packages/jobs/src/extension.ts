import type { ApplicationExtension } from '@zmdb/app';

import type { JobStoreResource, Worker } from './queues/index.js';
import type { Scheduler } from './schedule/index.js';

interface JobsParticipant {
  start(): void;
  onShutdown(options?: { readonly graceMs: number }): Promise<void>;
}

/**
 * Start and stop one application's explicit background-work components.
 *
 * Workers start first so a scheduled enqueue always has a consumer. Shutdown
 * reverses that order so no scheduler can add work after worker drain begins.
 */
export function jobsExtension(options: {
  readonly workers?: readonly Worker[];
  readonly schedulers?: readonly Scheduler[];
  readonly stores?: readonly JobStoreResource[];
}): ApplicationExtension {
  const workers = Object.freeze([...(options.workers ?? [])]);
  const schedulers = Object.freeze([...(options.schedulers ?? [])]);
  const stores = [...new Set(options.stores ?? [])];
  const enteredWorkers: Worker[] = [];
  const enteredSchedulers: Scheduler[] = [];
  let started = false;
  let stopped: Promise<void> | undefined;

  return {
    name: '@zmdb/jobs',
    start() {
      if (started) return;
      started = true;
      startAll(workers, enteredWorkers);
      startAll(schedulers, enteredSchedulers);
    },
    stop({ graceMs }) {
      stopped ??= stopAll(enteredSchedulers, enteredWorkers, stores, graceMs);
      return stopped;
    },
  };
}

function startAll<T extends JobsParticipant>(participants: readonly T[], entered: T[]): void {
  for (const participant of participants) {
    entered.push(participant);
    participant.start();
  }
}

async function stopAll(
  schedulers: readonly Scheduler[],
  workers: readonly Worker[],
  stores: readonly JobStoreResource[],
  graceMs: number,
): Promise<void> {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 2_147_483_647) {
    throw new RangeError('@zmdb/jobs: graceMs must be a non-negative safe integer');
  }
  const deadline = Date.now() + graceMs;
  const errors: unknown[] = [];
  const stops = [
    ...schedulers
      .toReversed()
      .map(participant => (remaining: number) => participant.onShutdown({ graceMs: remaining })),
    ...workers.toReversed().map(participant => (remaining: number) => participant.onShutdown({ graceMs: remaining })),
    ...stores.toReversed().map(store => (remaining: number) => store.close({ graceMs: remaining })),
  ];
  let timedOut = false;
  for (const stop of stops) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = timedOut ? 0 : Math.max(0, deadline - Date.now());
      const work = Promise.resolve(stop(remaining));
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new DOMException('@zmdb/jobs: shutdown deadline exceeded', 'TimeoutError'));
          }, remaining);
        }),
      ]);
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timer);
    }
  }
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, '@zmdb/jobs: background work shutdown failed');
}
