import type { ApplicationExtension } from '@zmdb/app';

import type { Worker } from './queues/index.js';
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
}): ApplicationExtension {
  const workers = Object.freeze([...(options.workers ?? [])]);
  const schedulers = Object.freeze([...(options.schedulers ?? [])]);
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
      stopped ??= stopAll(enteredSchedulers, enteredWorkers, graceMs);
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

async function stopAll(schedulers: readonly Scheduler[], workers: readonly Worker[], graceMs: number): Promise<void> {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0) {
    throw new RangeError('@zmdb/jobs: graceMs must be a non-negative safe integer');
  }
  const deadline = Date.now() + graceMs;
  const errors: unknown[] = [];
  await stopGroup(schedulers, deadline, errors);
  await stopGroup(workers, deadline, errors);
  if (errors.length === 0) return;
  const first = errors[0];
  if (errors.length === 1 && first !== undefined) throw first;
  throw new AggregateError(errors, '@zmdb/jobs: background work shutdown failed');
}

async function stopGroup(participants: readonly JobsParticipant[], deadline: number, errors: unknown[]): Promise<void> {
  for (let index = participants.length - 1; index >= 0; index -= 1) {
    const participant = participants[index];
    if (participant === undefined) continue;
    try {
      await participant.onShutdown({ graceMs: Math.max(0, deadline - Date.now()) });
    } catch (error) {
      errors.push(error);
    }
  }
}
