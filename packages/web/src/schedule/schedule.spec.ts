// Runtime contract for schedule/SPEC.md. All time is explicit and all replicas
// share the same controllable LeaseStore.
import { describe, expect, it } from 'vitest';

import type { Clock } from '../queues/index.js';
import {
  Cron,
  Interval,
  createScheduler,
  schedulesOf,
  type LeaseStore,
  type SchedulerOptions,
  type SkippedRun,
  type TaskDecorator,
} from './index.js';

class FakeClock implements Clock {
  #now: number;
  readonly sleeps: number[] = [];
  readonly #pending: {
    readonly at: number;
    readonly signal: AbortSignal;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }[] = [];

  constructor(now: number) {
    this.#now = now;
  }

  now(): number {
    return this.#now;
  }

  set(now: number): void {
    this.#now = now;
  }

  sleep(ms: number, signal: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return new Promise<void>((resolve, reject) => {
      this.#pending.push({ at: this.#now + ms, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }

  advance(ms: number): void {
    this.#now += ms;
    for (const pending of this.#pending.splice(0)) {
      if (pending.signal.aborted) pending.reject(new Error('aborted'));
      else if (pending.at <= this.#now) pending.resolve();
      else this.#pending.push(pending);
    }
  }
}

interface HeldLease {
  readonly holder: string;
  readonly until: number;
}

class MemoryLeases implements LeaseStore {
  readonly held = new Map<string, HeldLease>();
  readonly releases: string[] = [];
  failRenewal = false;

  constructor(private readonly clock: FakeClock) {}

  acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
    const current = this.held.get(key);
    if (current !== undefined && current.until > this.clock.now() && current.holder !== holder) {
      return Promise.resolve(false);
    }
    this.held.set(key, { holder, until: this.clock.now() + ttlMs });
    return Promise.resolve(true);
  }

  renew(key: string, holder: string, ttlMs: number): Promise<boolean> {
    if (this.failRenewal) return Promise.resolve(false);
    const current = this.held.get(key);
    if (current?.holder !== holder || current.until <= this.clock.now()) return Promise.resolve(false);
    this.held.set(key, { holder, until: this.clock.now() + ttlMs });
    return Promise.resolve(true);
  }

  release(key: string, holder: string): Promise<void> {
    if (this.held.get(key)?.holder === holder) {
      this.held.delete(key);
      this.releases.push(key);
    }
    return Promise.resolve();
  }
}

function schedulerOptions(
  clock: FakeClock,
  tasks: readonly object[],
  overrides: {
    readonly leases?: LeaseStore;
    readonly skipped?: SkippedRun[];
    readonly errors?: unknown[];
    readonly leaseMs?: number;
    readonly graceMs?: number;
  } = {},
): SchedulerOptions {
  return {
    tasks,
    clock,
    onTaskError: (_task, _scheduledFor, error) => void overrides.errors?.push(error),
    onSkipped: skipped => void overrides.skipped?.push(skipped),
    ...(overrides.leases === undefined ? {} : { leases: overrides.leases }),
    ...(overrides.leaseMs === undefined ? {} : { leaseMs: overrides.leaseMs }),
    ...(overrides.graceMs === undefined ? {} : { graceMs: overrides.graceMs }),
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('task scheduler (#587 tests freeze)', () => {
  it('fires a cron task at the expected times', async () => {
    const calls: number[] = [];
    const start = Date.parse('2026-09-04T00:00:00.000Z');
    const clock = new FakeClock(start);
    class Tasks {
      @Cron('0 */15 * * * *', { runs: 'once-per-replica', timeZone: 'UTC' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));

    for (const instant of ['2026-09-04T00:15:00.000Z', '2026-09-04T00:30:00.000Z', '2026-09-04T00:45:00.000Z']) {
      clock.set(Date.parse(instant));
      await scheduler.tick(clock.now());
    }
    expect(calls).toEqual([
      Date.parse('2026-09-04T00:15:00.000Z'),
      Date.parse('2026-09-04T00:30:00.000Z'),
      Date.parse('2026-09-04T00:45:00.000Z'),
    ]);
  });

  it('handles a spring-forward cron time that does not exist', async () => {
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-03-28T23:00:00.000Z'));
    class Tasks {
      @Cron('0 30 2 * * *', { runs: 'once-per-replica', timeZone: 'Europe/Berlin' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(Date.parse('2026-03-29T01:30:00.000Z'));
    await scheduler.tick(clock.now());
    expect(calls).toEqual([Date.parse('2026-03-29T01:30:00.000Z')]);
  });

  it('handles a fall-back cron time that occurs twice', async () => {
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-10-24T23:00:00.000Z'));
    class Tasks {
      @Cron('0 30 2 * * *', { runs: 'once-per-replica', timeZone: 'Europe/Berlin' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));
    for (const instant of ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']) {
      clock.set(Date.parse(instant));
      await scheduler.tick(clock.now());
    }
    expect(calls).toEqual([Date.parse('2026-10-25T00:30:00.000Z')]);
  });

  it('honours the configured timezone rather than the host timezone', async () => {
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-09-03T23:59:00.000Z'));
    class Tasks {
      @Cron('0 0 9 * * *', { runs: 'once-per-replica', timeZone: 'Asia/Tokyo' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(Date.parse('2026-09-04T00:00:00.000Z'));
    await scheduler.tick(clock.now());
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Asia/Tokyo');
    expect(calls).toEqual([Date.parse('2026-09-04T00:00:00.000Z')]);
  });

  it('does not overlap a task that runs longer than its interval, and records the skip', async () => {
    const release = deferred();
    const skipped: SkippedRun[] = [];
    let active = 0;
    let peak = 0;
    const clock = new FakeClock(0);
    class Tasks {
      @Cron('*/10 * * * * *', { runs: 'once-per-replica', timeZone: 'UTC' })
      async run(): Promise<void> {
        active += 1;
        peak = Math.max(peak, active);
        await release.promise;
        active -= 1;
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()], { skipped }));
    const first = scheduler.tick(10_000);
    await Promise.resolve();
    await scheduler.tick(20_000);
    await scheduler.tick(30_000);
    release.resolve();
    await first;
    expect(peak).toBe(1);
    expect(skipped).toHaveLength(2);
    expect(skipped.every(item => item.reason === 'still-running')).toBe(true);
  });

  it('runs a scheduled task exactly once across three concurrent schedulers', async () => {
    const clock = new FakeClock(Date.parse('2026-09-04T00:00:00.000Z'));
    const leases = new MemoryLeases(clock);
    let runs = 0;
    class Tasks {
      @Cron('0 0 * * * *', { runs: 'once-per-cluster', timeZone: 'UTC', name: 'hourly' })
      run(): void {
        runs += 1;
      }
    }
    const schedulers = Array.from({ length: 3 }, () =>
      createScheduler(schedulerOptions(clock, [new Tasks()], { leases })),
    );
    clock.set(Date.parse('2026-09-04T01:00:00.000Z'));
    await Promise.all(schedulers.map(scheduler => scheduler.tick(clock.now())));
    expect(runs).toBe(1);
  });

  it('does not double-run when a lease expires mid-task', async () => {
    const clock = new FakeClock(10_000);
    const leases = new MemoryLeases(clock);
    const release = deferred();
    let runs = 0;
    class Tasks {
      @Cron('* * * * * *', { runs: 'once-per-cluster', timeZone: 'UTC', name: 'renewed' })
      async run(): Promise<void> {
        runs += 1;
        await release.promise;
      }
    }
    const first = createScheduler(schedulerOptions(clock, [new Tasks()], { leases, leaseMs: 3000 }));
    const second = createScheduler(schedulerOptions(clock, [new Tasks()], { leases, leaseMs: 3000 }));
    const running = first.tick(10_000);
    await Promise.resolve();
    const originalExpiry = leases.held.get('renewed')?.until;
    for (let step = 0; step < 4; step += 1) {
      clock.advance(1000);
      await Promise.resolve();
    }
    expect(leases.held.get('renewed')?.until).toBeGreaterThan(originalExpiry ?? 0);
    await second.tick(clock.now());
    release.resolve();
    await running;
    expect(runs).toBe(1);
  });

  it('does not share a scheduler registry between two apps in one process', async () => {
    const clock = new FakeClock(0);
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    class First {
      @Interval(1000, { runs: 'once-per-replica', name: 'same-name' })
      run(): void {
        firstCalls.push('first');
      }
    }
    class Second {
      @Interval(1000, { runs: 'once-per-replica', name: 'same-name' })
      run(): void {
        secondCalls.push('second');
      }
    }
    const first = createScheduler(schedulerOptions(clock, [new First()]));
    const second = createScheduler(schedulerOptions(clock, [new Second()]));
    await first.tick(1000);
    expect(firstCalls).toEqual(['first']);
    expect(secondCalls).toEqual([]);
    await second.tick(1000);
    expect(secondCalls).toEqual(['second']);
  });

  it('normalizes discovered cron and interval metadata', () => {
    class Tasks {
      @Cron('@daily', { runs: 'once-per-cluster' })
      daily(): void {}

      @Interval(5000, { runs: 'once-per-replica', name: 'poll', timeoutMs: 2000 })
      poll(): void {}
    }

    expect(schedulesOf(Tasks)).toEqual([
      {
        name: 'Tasks.daily',
        method: 'daily',
        trigger: { kind: 'cron', expression: '@daily' },
        runs: 'once-per-cluster',
        timeZone: 'UTC',
        timeoutMs: 300_000,
      },
      {
        name: 'poll',
        method: 'poll',
        trigger: { kind: 'interval', everyMs: 5000 },
        runs: 'once-per-replica',
        timeZone: 'UTC',
        timeoutMs: 2000,
      },
    ]);
  });

  it('accepts the frozen crontab dialect and refuses Quartz and malformed expressions', () => {
    const clock = new FakeClock(Date.parse('2026-09-04T12:34:56.000Z'));
    const accepted = [
      '* * * * *',
      '*/10 0-20/5 1,2 * JAN,MAR MON-FRI',
      '0 0 1 * MON',
      '0 0 * * 7',
      '@yearly',
      '@monthly',
      '@weekly',
      '@daily',
      '@hourly',
    ];
    for (const expression of accepted) {
      class Tasks {
        @Cron(expression, { runs: 'once-per-replica', name: `accepted:${expression}` })
        run(): void {}
      }
      expect(() => createScheduler(schedulerOptions(clock, [new Tasks()])), expression).not.toThrow();
    }

    const rejected = ['@reboot', '0 0 0 L * *', '0 0 0 ? * *', '0 0 0 * * MON#2', '0 0 0 1 1 * 2027'];
    for (const expression of rejected) {
      class Tasks {
        @Cron(expression, { runs: 'once-per-replica', name: 'dialect-refusal' })
        run(): void {}
      }
      expect(() => createScheduler(schedulerOptions(clock, [new Tasks()])), expression).toThrow(/dialect-refusal/);
    }
  });

  it('uses the POSIX day-of-month or day-of-week rule', async () => {
    const clock = new FakeClock(Date.parse('2026-08-31T23:59:59.000Z'));
    const calls: number[] = [];
    class Tasks {
      @Cron('0 0 1 * MON', { runs: 'once-per-replica', timeZone: 'UTC' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));
    for (const instant of ['2026-09-01T00:00:00.000Z', '2026-09-07T00:00:00.000Z']) {
      clock.set(Date.parse(instant));
      await scheduler.tick(clock.now());
    }
    expect(calls).toEqual([Date.parse('2026-09-01T00:00:00.000Z'), Date.parse('2026-09-07T00:00:00.000Z')]);
  });

  it('refuses invalid zones, interval ranges, duplicate names and missing cluster leases', () => {
    const clock = new FakeClock(0);
    class BadZone {
      @Cron('* * * * *', { runs: 'once-per-replica', timeZone: 'Europe/Berln' })
      run(): void {}
    }
    expect(() => createScheduler(schedulerOptions(clock, [new BadZone()]))).toThrow(/Europe\/Berln/);

    class TooLong {
      @Interval(2_147_483_648, { runs: 'once-per-replica', name: 'monthly-duration' })
      run(): void {}
    }
    expect(() => createScheduler(schedulerOptions(clock, [new TooLong()]))).toThrow(/monthly-duration.*@Cron/);

    class Duplicates {
      @Interval(1000, { runs: 'once-per-replica', name: 'duplicate' })
      first(): void {}

      @Interval(2000, { runs: 'once-per-replica', name: 'duplicate' })
      second(): void {}
    }
    expect(() => createScheduler(schedulerOptions(clock, [new Duplicates()]))).toThrow(
      /duplicate scheduled task name "duplicate"/,
    );

    class Clustered {
      @Cron('@hourly', { runs: 'once-per-cluster', name: 'billing' })
      run(): void {}
    }
    expect(() => createScheduler(schedulerOptions(clock, [new Clustered()]))).toThrow(/require leases: billing/);

    const runtimeInterval = Interval as unknown as (
      everyMs: number,
      options: { readonly runs: 'once-per-replica'; readonly timeZone: string },
    ) => TaskDecorator;
    expect(() => {
      class ZonedInterval {
        @runtimeInterval(1000, { runs: 'once-per-replica', timeZone: 'UTC' })
        run(): void {}
      }
      void ZonedInterval;
    }).toThrow(/interval schedule "run" cannot set timeZone/);
  });

  it('schedules intervals from completion rather than from their previous start', async () => {
    const clock = new FakeClock(0);
    const release = deferred();
    const calls: number[] = [];
    class Tasks {
      @Interval(10_000, { runs: 'once-per-replica' })
      async run(): Promise<void> {
        calls.push(clock.now());
        if (calls.length === 1) {
          await release.promise;
        }
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(10_000);
    const first = scheduler.tick(clock.now());
    await Promise.resolve();
    clock.set(12_000);
    release.resolve();
    await first;

    clock.set(20_000);
    await scheduler.tick(clock.now());
    clock.set(22_000);
    await scheduler.tick(clock.now());
    expect(calls).toEqual([10_000, 22_000]);
  });

  it('runs a once-per-replica task on both schedulers', async () => {
    const clock = new FakeClock(0);
    let runs = 0;
    class Tasks {
      @Interval(1000, { runs: 'once-per-replica' })
      run(): void {
        runs += 1;
      }
    }
    const first = createScheduler(schedulerOptions(clock, [new Tasks()]));
    const second = createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(1000);
    await Promise.all([first.tick(clock.now()), second.tick(clock.now())]);
    expect(runs).toBe(2);
  });

  it('stops future fires when lease renewal is lost', async () => {
    const clock = new FakeClock(10_000);
    const leases = new MemoryLeases(clock);
    const release = deferred();
    const errors: unknown[] = [];
    let runs = 0;
    class Tasks {
      @Cron('* * * * * *', { runs: 'once-per-cluster', name: 'lease-loss' })
      async run(): Promise<void> {
        runs += 1;
        await release.promise;
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()], { leases, leaseMs: 3000, errors }));
    const running = scheduler.tick(clock.now());
    await flushMicrotasks();
    expect(leases.held.has('lease-loss')).toBe(true);
    leases.failRenewal = true;
    clock.advance(1000);
    await flushMicrotasks();
    release.resolve();
    await running;
    await scheduler.tick(11_000);
    expect(runs).toBe(1);
    expect(errors.map(String)).toEqual([expect.stringMatching(/lease renewal.*refused/)]);
  });

  it('reports a missed instant without catching it up', async () => {
    const clock = new FakeClock(0);
    const skipped: SkippedRun[] = [];
    let runs = 0;
    class Tasks {
      @Cron('*/10 * * * * *', { runs: 'once-per-replica' })
      run(): void {
        runs += 1;
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()], { skipped }));
    clock.set(25_000);
    await scheduler.tick(clock.now());
    expect(runs).toBe(0);
    expect(skipped).toEqual([
      {
        task: 'Tasks.run',
        scheduledFor: new Date(10_000),
        reason: 'missed',
      },
    ]);
  });

  it('bounds shutdown and releases a held lease before its ttl', async () => {
    const clock = new FakeClock(10_000);
    const leases = new MemoryLeases(clock);
    const release = deferred();
    let secondRuns = 0;
    class First {
      @Cron('* * * * * *', { runs: 'once-per-cluster', name: 'drain' })
      async run(): Promise<void> {
        await release.promise;
      }
    }
    class Second {
      @Cron('* * * * * *', { runs: 'once-per-cluster', name: 'drain' })
      run(): void {
        secondRuns += 1;
      }
    }
    const first = createScheduler(schedulerOptions(clock, [new First()], { leases, leaseMs: 3000, graceMs: 100 }));
    const second = createScheduler(schedulerOptions(clock, [new Second()], { leases, leaseMs: 3000 }));
    const running = first.tick(clock.now());
    await flushMicrotasks();
    expect(leases.held.has('drain')).toBe(true);
    const shutdown = first.onShutdown();
    await flushMicrotasks();
    clock.advance(100);
    await shutdown;
    expect(leases.releases).toContain('drain');

    clock.set(11_000);
    await second.tick(clock.now());
    expect(secondRuns).toBe(1);
    release.resolve();
    await running;
  });

  it('reports a task error and still fires the following instant', async () => {
    const clock = new FakeClock(0);
    const errors: unknown[] = [];
    let runs = 0;
    class Tasks {
      @Cron('* * * * * *', { runs: 'once-per-replica' })
      run(): void {
        runs += 1;
        if (runs === 1) {
          throw new Error('first fire failed');
        }
      }
    }
    const scheduler = createScheduler(schedulerOptions(clock, [new Tasks()], { errors }));
    clock.set(1000);
    await scheduler.tick(clock.now());
    clock.set(2000);
    await scheduler.tick(clock.now());
    expect(runs).toBe(2);
    expect(errors.map(String)).toEqual(['Error: first fire failed']);
  });

  it('sleeps to the earliest next fire and clamps waits beyond the timer limit', async () => {
    const intervalClock = new FakeClock(0);
    let fastRuns = 0;
    class Intervals {
      @Interval(5000, { runs: 'once-per-replica' })
      slow(): void {}

      @Interval(1000, { runs: 'once-per-replica' })
      fast(): void {
        fastRuns += 1;
      }
    }
    const intervals = createScheduler(schedulerOptions(intervalClock, [new Intervals()]));
    intervals.start();
    await Promise.resolve();
    expect(intervalClock.sleeps[0]).toBe(1000);
    intervalClock.advance(1000);
    await flushMicrotasks();
    expect(fastRuns).toBe(1);
    await intervals.onShutdown();

    const monthlyClock = new FakeClock(Date.parse('2026-09-04T00:00:00.000Z'));
    class Monthly {
      @Cron('@monthly', { runs: 'once-per-replica' })
      run(): void {}
    }
    const monthly = createScheduler(schedulerOptions(monthlyClock, [new Monthly()]));
    monthly.start();
    await Promise.resolve();
    expect(monthlyClock.sleeps[0]).toBe(2_147_483_647);
    await monthly.onShutdown();
  });
});
