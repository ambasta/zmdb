// Renewable per-task leases for @zmdb/jobs/schedule.
import type { Clock } from '../queues/index.js';

/** A renewable lease over one scheduled task name. */
export interface LeaseStore {
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(key: string, holder: string, ttlMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

export interface LeaseSession {
  readonly signal: AbortSignal;
  acquire(): Promise<boolean>;
  startRenewing(onLost: (error: Error) => void): void;
  release(): Promise<void>;
}

interface LeaseSessionOptions {
  readonly store: LeaseStore;
  readonly clock: Clock;
  readonly key: string;
  readonly holder: string;
  readonly ttlMs: number;
}

/** One opaque holder id per scheduler instance, shared by its per-task leases. */
export function createLeaseHolder(): string {
  return globalThis.crypto.randomUUID();
}

/** Coordinate one task run without adding a backend dependency to @zmdb/jobs. */
export function createLeaseSession(options: LeaseSessionOptions): LeaseSession {
  const controller = new AbortController();
  let held = false;
  let released = false;
  let renewal: Promise<void> = Promise.resolve();

  const renew = async (onLost: (error: Error) => void): Promise<void> => {
    const delay = Math.max(1, Math.floor(options.ttlMs / 3));
    while (!controller.signal.aborted) {
      try {
        await options.clock.sleep(delay, controller.signal);
      } catch {
        return;
      }
      if (controller.signal.aborted) {
        return;
      }

      let renewed = false;
      try {
        renewed = await options.store.renew(options.key, options.holder, options.ttlMs);
      } catch (error) {
        held = false;
        controller.abort(error);
        onLost(
          error instanceof Error
            ? error
            : new Error(`@zmdb/jobs: lease renewal for "${options.key}" failed: ${String(error)}`),
        );
        return;
      }
      if (!renewed) {
        held = false;
        const error = new Error(`@zmdb/jobs: lease renewal for "${options.key}" was refused`);
        controller.abort(error);
        onLost(error);
        return;
      }
    }
  };

  return {
    signal: controller.signal,
    async acquire(): Promise<boolean> {
      if (released) {
        return false;
      }
      const acquired = await options.store.acquire(options.key, options.holder, options.ttlMs);
      if (released) {
        if (acquired) {
          try {
            await options.store.release(options.key, options.holder);
          } catch {
            // The lease still expires if a release after cancellation fails.
          }
        }
        return false;
      }
      held = acquired;
      return held;
    },
    startRenewing(onLost: (error: Error) => void): void {
      if (held && !released) {
        renewal = renew(onLost);
      }
    },
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      controller.abort();
      await renewal;
      if (!held) {
        return;
      }
      held = false;
      try {
        await options.store.release(options.key, options.holder);
      } catch {
        // Best effort. A failed release is bounded by the lease TTL.
      }
    },
  };
}
