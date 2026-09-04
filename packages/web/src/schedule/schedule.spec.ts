// Tests freeze for #587, against schedule/SPEC.md. The real module is dynamically imported;
// because it does not exist, every scheduler behavior is an expected failure rather than a local
// implementation passing in its place. All time is explicit and all replicas share the same
// controllable LeaseStore.
import { describe, expect, it } from 'vitest';

interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

type TaskDecorator = (target: () => void | Promise<void>, context: ClassMethodDecoratorContext) => void;

interface LeaseStore {
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(key: string, holder: string, ttlMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

interface SkippedRun {
  readonly task: string;
  readonly scheduledFor: Date;
  readonly reason: 'still-running' | 'lease-not-held' | 'missed';
}

interface Scheduler {
  start(): void;
  onShutdown(): Promise<void>;
  tick(now: number): Promise<void>;
}

interface ScheduleModule {
  Cron(
    expression: string,
    options: {
      readonly runs: 'once-per-replica' | 'once-per-cluster';
      readonly name?: string;
      readonly timeZone?: string;
      readonly timeoutMs?: number;
    },
  ): TaskDecorator;
  Interval(
    everyMs: number,
    options: {
      readonly runs: 'once-per-replica' | 'once-per-cluster';
      readonly name?: string;
      readonly timeoutMs?: number;
    },
  ): TaskDecorator;
  createScheduler(options: {
    readonly tasks: readonly object[];
    readonly clock: Clock;
    readonly onTaskError: (task: string, scheduledFor: Date, error: unknown) => void;
    readonly onSkipped: (skipped: SkippedRun) => void;
    readonly leases?: LeaseStore;
    readonly leaseMs?: number;
    readonly graceMs?: number;
  }): Scheduler;
}

const SCHEDULE_MODULE = './index.js';

function isScheduleModule(value: unknown): value is ScheduleModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Cron' in value &&
    typeof value.Cron === 'function' &&
    'Interval' in value &&
    typeof value.Interval === 'function' &&
    'createScheduler' in value &&
    typeof value.createScheduler === 'function'
  );
}

async function loadSchedule(): Promise<ScheduleModule> {
  const loaded: unknown = await import(SCHEDULE_MODULE);
  if (!isScheduleModule(loaded)) throw new Error('@zmdb/web/schedule does not export the frozen surface');
  return loaded;
}

class FakeClock implements Clock {
  #now: number;
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
    if (this.held.get(key)?.holder === holder) this.held.delete(key);
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
  } = {},
): Parameters<ScheduleModule['createScheduler']>[0] {
  return {
    tasks,
    clock,
    onTaskError: (_task, _scheduledFor, error) => void overrides.errors?.push(error),
    onSkipped: skipped => void overrides.skipped?.push(skipped),
    ...(overrides.leases === undefined ? {} : { leases: overrides.leases }),
    ...(overrides.leaseMs === undefined ? {} : { leaseMs: overrides.leaseMs }),
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('task scheduler (#587 tests freeze)', () => {
  it.fails('fires a cron task at the expected times', async () => {
    const api = await loadSchedule();
    const calls: number[] = [];
    const start = Date.parse('2026-09-04T00:00:00.000Z');
    const clock = new FakeClock(start);
    class Tasks {
      @api.Cron('0 */15 * * * *', { runs: 'once-per-replica', timeZone: 'UTC' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = api.createScheduler(schedulerOptions(clock, [new Tasks()]));

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

  it.fails('handles a spring-forward cron time that does not exist', async () => {
    const api = await loadSchedule();
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-03-28T23:00:00.000Z'));
    class Tasks {
      @api.Cron('0 30 2 * * *', { runs: 'once-per-replica', timeZone: 'Europe/Berlin' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = api.createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(Date.parse('2026-03-29T01:30:00.000Z'));
    await scheduler.tick(clock.now());
    expect(calls).toEqual([Date.parse('2026-03-29T01:30:00.000Z')]);
  });

  it.fails('handles a fall-back cron time that occurs twice', async () => {
    const api = await loadSchedule();
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-10-24T23:00:00.000Z'));
    class Tasks {
      @api.Cron('0 30 2 * * *', { runs: 'once-per-replica', timeZone: 'Europe/Berlin' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = api.createScheduler(schedulerOptions(clock, [new Tasks()]));
    for (const instant of ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']) {
      clock.set(Date.parse(instant));
      await scheduler.tick(clock.now());
    }
    expect(calls).toEqual([Date.parse('2026-10-25T00:30:00.000Z')]);
  });

  it.fails('honours the configured timezone rather than the host timezone', async () => {
    const api = await loadSchedule();
    const calls: number[] = [];
    const clock = new FakeClock(Date.parse('2026-09-03T23:59:00.000Z'));
    class Tasks {
      @api.Cron('0 0 9 * * *', { runs: 'once-per-replica', timeZone: 'Asia/Tokyo' })
      run(): void {
        calls.push(clock.now());
      }
    }
    const scheduler = api.createScheduler(schedulerOptions(clock, [new Tasks()]));
    clock.set(Date.parse('2026-09-04T00:00:00.000Z'));
    await scheduler.tick(clock.now());
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Asia/Tokyo');
    expect(calls).toEqual([Date.parse('2026-09-04T00:00:00.000Z')]);
  });

  it.fails('does not overlap a task that runs longer than its interval, and records the skip', async () => {
    const api = await loadSchedule();
    const release = deferred();
    const skipped: SkippedRun[] = [];
    let active = 0;
    let peak = 0;
    const clock = new FakeClock(0);
    class Tasks {
      @api.Cron('*/10 * * * * *', { runs: 'once-per-replica', timeZone: 'UTC' })
      async run(): Promise<void> {
        active += 1;
        peak = Math.max(peak, active);
        await release.promise;
        active -= 1;
      }
    }
    const scheduler = api.createScheduler(schedulerOptions(clock, [new Tasks()], { skipped }));
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

  it.fails('runs a scheduled task exactly once across three concurrent schedulers', async () => {
    const api = await loadSchedule();
    const clock = new FakeClock(Date.parse('2026-09-04T00:00:00.000Z'));
    const leases = new MemoryLeases(clock);
    let runs = 0;
    class Tasks {
      @api.Cron('0 0 * * * *', { runs: 'once-per-cluster', timeZone: 'UTC', name: 'hourly' })
      run(): void {
        runs += 1;
      }
    }
    const schedulers = Array.from({ length: 3 }, () =>
      api.createScheduler(schedulerOptions(clock, [new Tasks()], { leases })),
    );
    clock.set(Date.parse('2026-09-04T01:00:00.000Z'));
    await Promise.all(schedulers.map(scheduler => scheduler.tick(clock.now())));
    expect(runs).toBe(1);
  });

  it.fails('does not double-run when a lease expires mid-task', async () => {
    const api = await loadSchedule();
    const clock = new FakeClock(10_000);
    const leases = new MemoryLeases(clock);
    const release = deferred();
    let runs = 0;
    class Tasks {
      @api.Cron('* * * * * *', { runs: 'once-per-cluster', timeZone: 'UTC', name: 'renewed' })
      async run(): Promise<void> {
        runs += 1;
        await release.promise;
      }
    }
    const first = api.createScheduler(schedulerOptions(clock, [new Tasks()], { leases, leaseMs: 3000 }));
    const second = api.createScheduler(schedulerOptions(clock, [new Tasks()], { leases, leaseMs: 3000 }));
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

  it.fails('does not share a scheduler registry between two apps in one process', async () => {
    const api = await loadSchedule();
    const clock = new FakeClock(0);
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    class First {
      @api.Interval(1000, { runs: 'once-per-replica', name: 'same-name' })
      run(): void {
        firstCalls.push('first');
      }
    }
    class Second {
      @api.Interval(1000, { runs: 'once-per-replica', name: 'same-name' })
      run(): void {
        secondCalls.push('second');
      }
    }
    const first = api.createScheduler(schedulerOptions(clock, [new First()]));
    const second = api.createScheduler(schedulerOptions(clock, [new Second()]));
    await first.tick(1000);
    expect(firstCalls).toEqual(['first']);
    expect(secondCalls).toEqual([]);
    await second.tick(1000);
    expect(secondCalls).toEqual(['second']);
  });
});
