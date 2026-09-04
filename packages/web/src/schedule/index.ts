// @zmdb/web/schedule — app-owned cron and interval scheduling.
//
// Decorators record declarations only. createScheduler receives the instances
// one application constructed, parses every expression once, and owns all
// timers, run state and leases for that application.

import '../polyfill.js';
import type { Clock } from '../queues/index.js';
import { createCronPlan, type CronPlan } from './cron.js';
import { createLeaseHolder, createLeaseSession, type LeaseSession, type LeaseStore } from './lease.js';

export type { LeaseStore } from './lease.js';

type ScheduledMethod = () => void | Promise<void>;

export type TaskDecorator = (target: ScheduledMethod, context: ClassMethodDecoratorContext) => void;
export type TaskRuns = 'once-per-replica' | 'once-per-cluster';

export interface TaskOptions {
  readonly runs: TaskRuns;
  readonly name?: string;
  readonly timeZone?: string;
  readonly timeoutMs?: number;
}

export interface IntervalOptions {
  readonly runs: TaskRuns;
  readonly name?: string;
  readonly timeoutMs?: number;
}

export interface ScheduleDef {
  readonly name: string;
  readonly method: string;
  readonly trigger:
    | { readonly kind: 'cron'; readonly expression: string }
    | { readonly kind: 'interval'; readonly everyMs: number };
  readonly runs: TaskRuns;
  readonly timeZone: string;
  readonly timeoutMs: number;
}

export interface SkippedRun {
  readonly task: string;
  readonly scheduledFor: Date;
  readonly reason: 'still-running' | 'lease-not-held' | 'missed';
}

export interface SchedulerOptions {
  readonly tasks: readonly object[];
  readonly clock: Clock;
  readonly onTaskError: (task: string, scheduledFor: Date, error: unknown) => void;
  readonly onSkipped: (skipped: SkippedRun) => void;
  readonly leases?: LeaseStore;
  readonly leaseMs?: number;
  readonly graceMs?: number;
}

export interface Scheduler {
  start(): void;
  onShutdown(): Promise<void>;
  tick(now: number): Promise<void>;
}

type StoredTrigger =
  | { readonly kind: 'cron'; readonly expression: string }
  | { readonly kind: 'interval'; readonly everyMs: number };

interface StoredSchedule {
  readonly method: string;
  readonly trigger: StoredTrigger;
  readonly runs: TaskRuns;
  readonly name?: string;
  readonly timeZone?: string;
  readonly timeoutMs?: number;
}

interface ScheduleMetadata {
  [SCHEDULES]?: StoredSchedule[];
}

interface MetadataCarrier {
  readonly [Symbol.metadata]?: DecoratorMetadata | null;
}

type RuntimeTrigger =
  | { readonly kind: 'cron'; readonly plan: CronPlan }
  | { readonly kind: 'interval'; readonly everyMs: number };

interface RuntimeTask {
  readonly definition: ScheduleDef;
  readonly trigger: RuntimeTrigger;
  readonly invoke: () => Promise<void>;
  initialDue: number | undefined;
  firstTick: boolean;
  nextAt: number;
  running: ActiveRun | undefined;
  disabled: boolean;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly complete: () => void;
  lease: LeaseSession | undefined;
  timedOut: boolean;
}

type InvocationSettlement = { readonly kind: 'resolved' } | { readonly kind: 'rejected'; readonly error: unknown };

const SCHEDULES = Symbol('zmdb.web.schedules');
const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_GRACE_MS = 15_000;
const MAX_TIMER_MS = 2_147_483_647;

// boundary: Cron and Interval are the only writers of SCHEDULES, so this typed
// view of their private metadata slot is sound.
function scheduleMetadata(metadata: DecoratorMetadata): ScheduleMetadata {
  return metadata;
}

function pushSchedule(metadata: DecoratorMetadata, schedule: StoredSchedule): void {
  const view = scheduleMetadata(metadata);
  const own = Object.hasOwn(metadata, SCHEDULES) ? view[SCHEDULES] : undefined;
  if (own === undefined) {
    view[SCHEDULES] = [schedule];
  } else {
    own.push(schedule);
  }
}

function ownSchedules(metadata: DecoratorMetadata): readonly StoredSchedule[] {
  if (!Object.hasOwn(metadata, SCHEDULES)) {
    return [];
  }
  return scheduleMetadata(metadata)[SCHEDULES] ?? [];
}

function composedSchedules(metadata: DecoratorMetadata): readonly StoredSchedule[] {
  const baseFirst: DecoratorMetadata[] = [];
  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    baseFirst.unshift(record);
  }
  let composed: readonly StoredSchedule[] = [];
  for (const record of baseFirst) {
    const own = ownSchedules(record);
    if (own.length === 0) {
      continue;
    }
    const overridden = new Set(own.map(schedule => schedule.method));
    composed = [...composed.filter(schedule => !overridden.has(schedule.method)), ...own];
  }
  return composed;
}

/** Declare one cron-triggered method. The expression is parsed at scheduler construction. */
export function Cron(expression: string, options: TaskOptions): TaskDecorator {
  return function (_target: ScheduledMethod, context: ClassMethodDecoratorContext): void {
    const method = String(context.name);
    pushSchedule(context.metadata, {
      method,
      trigger: { kind: 'cron', expression },
      runs: options.runs,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  };
}

/** Declare one fixed-duration, completion-to-start method. */
export function Interval(everyMs: number, options: IntervalOptions): TaskDecorator {
  return function (_target: ScheduledMethod, context: ClassMethodDecoratorContext): void {
    const method = String(context.name);
    if ('timeZone' in options) {
      throw new RangeError(
        `@zmdb/web: interval schedule "${options.name ?? method}" cannot set timeZone; intervals are durations`,
      );
    }
    pushSchedule(context.metadata, {
      method,
      trigger: { kind: 'interval', everyMs },
      runs: options.runs,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  };
}

/** Read and normalize the schedules declared by one class. */
export function schedulesOf(controller: abstract new (...args: never[]) => unknown): readonly ScheduleDef[] {
  return schedulesFor(controller, controller.name);
}

/** Build one isolated scheduler for the supplied application-owned instances. */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const leaseMs = duration(options.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs');
  const graceMs = duration(options.graceMs ?? DEFAULT_GRACE_MS, 'graceMs');
  const tasks = runtimeTasks(options);
  const clusterTasks = tasks
    .filter(task => task.definition.runs === 'once-per-cluster')
    .map(task => task.definition.name);
  if (clusterTasks.length > 0 && options.leases === undefined) {
    throw new Error(`@zmdb/web: once-per-cluster schedules require leases: ${clusterTasks.join(', ')}`);
  }
  return new AppScheduler(options, tasks, leaseMs, graceMs);
}

function schedulesFor(controller: object, className: string): readonly ScheduleDef[] {
  const carrier: MetadataCarrier = controller;
  const metadata = carrier[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  return composedSchedules(metadata).map(schedule => normalizedSchedule(schedule, className));
}

function normalizedSchedule(schedule: StoredSchedule, className: string): ScheduleDef {
  const fallbackClass = className.length === 0 ? '<anonymous>' : className;
  const name = schedule.name ?? `${fallbackClass}.${schedule.method}`;
  if (name.length === 0) {
    throw new RangeError('@zmdb/web: a scheduled task name cannot be empty');
  }
  const timeoutMs = duration(schedule.timeoutMs ?? DEFAULT_TIMEOUT_MS, `${name}.timeoutMs`);
  if (schedule.trigger.kind === 'interval') {
    const everyMs = duration(schedule.trigger.everyMs, `${name}.everyMs`);
    if (everyMs > MAX_TIMER_MS) {
      throw new RangeError(
        `@zmdb/web: interval schedule "${name}" exceeds ${String(MAX_TIMER_MS)}ms; use @Cron for calendar time`,
      );
    }
    return {
      name,
      method: schedule.method,
      trigger: { kind: 'interval', everyMs },
      runs: taskRuns(schedule.runs, name),
      timeZone: DEFAULT_TIME_ZONE,
      timeoutMs,
    };
  }
  return {
    name,
    method: schedule.method,
    trigger: schedule.trigger,
    runs: taskRuns(schedule.runs, name),
    timeZone: schedule.timeZone ?? DEFAULT_TIME_ZONE,
    timeoutMs,
  };
}

function taskRuns(value: TaskRuns, name: string): TaskRuns {
  if (value !== 'once-per-replica' && value !== 'once-per-cluster') {
    throw new RangeError(`@zmdb/web: schedule "${name}" has invalid runs value "${String(value)}"`);
  }
  return value;
}

function duration(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`@zmdb/web: ${name} must be a positive integer`);
  }
  return value;
}

function runtimeTasks(options: SchedulerOptions): RuntimeTask[] {
  const result: RuntimeTask[] = [];
  const names = new Set<string>();
  const now = options.clock.now();

  for (const instance of options.tasks) {
    for (const definition of schedulesFor(instance.constructor, instance.constructor.name)) {
      if (names.has(definition.name)) {
        throw new Error(`@zmdb/web: duplicate scheduled task name "${definition.name}"`);
      }
      names.add(definition.name);
      const value: unknown = Reflect.get(instance, definition.method);
      if (typeof value !== 'function') {
        throw new Error(`@zmdb/web: scheduled method "${definition.name}" is not callable on its instance`);
      }
      const invoke = async (): Promise<void> => {
        await Reflect.apply(value, instance, []);
      };

      if (definition.trigger.kind === 'cron') {
        const plan = createCronPlan(definition.trigger.expression, definition.timeZone, definition.name);
        const initial = plan.nextAtOrAfter(now);
        const initialDue = initial === now ? now : undefined;
        result.push({
          definition,
          trigger: { kind: 'cron', plan },
          invoke,
          initialDue,
          firstTick: true,
          nextAt: initialDue === undefined ? initial : plan.nextAfter(now),
          running: undefined,
          disabled: false,
        });
      } else {
        result.push({
          definition,
          trigger: definition.trigger,
          invoke,
          initialDue: undefined,
          firstTick: true,
          nextAt: now + definition.trigger.everyMs,
          running: undefined,
          disabled: false,
        });
      }
    }
  }
  return result;
}

class AppScheduler implements Scheduler {
  readonly #options: SchedulerOptions;
  readonly #tasks: readonly RuntimeTask[];
  readonly #leaseMs: number;
  readonly #graceMs: number;
  readonly #holder = createLeaseHolder();
  #started = false;
  #stopped = false;
  #sleepController: AbortController | undefined;
  #loop: Promise<void> = Promise.resolve();
  #shutdown: Promise<void> | undefined;

  constructor(options: SchedulerOptions, tasks: readonly RuntimeTask[], leaseMs: number, graceMs: number) {
    this.#options = options;
    this.#tasks = tasks;
    this.#leaseMs = leaseMs;
    this.#graceMs = graceMs;
  }

  start(): void {
    if (this.#started || this.#stopped) {
      return;
    }
    this.#started = true;
    void this.tick(this.#options.clock.now()).catch(() => undefined);
    this.#loop = this.#runLoop();
  }

  async tick(now: number): Promise<void> {
    if (this.#stopped) {
      return;
    }
    await Promise.all(this.#tasks.map(task => this.#tickTask(task, now)));
  }

  onShutdown(): Promise<void> {
    if (this.#shutdown === undefined) {
      this.#shutdown = this.#stop();
    }
    return this.#shutdown;
  }

  async #tickTask(task: RuntimeTask, now: number): Promise<void> {
    if (task.disabled || !Number.isFinite(task.nextAt)) {
      return;
    }
    if (task.firstTick) {
      task.firstTick = false;
      if (task.initialDue === now) {
        task.initialDue = undefined;
        await this.#launch(task, now);
        return;
      }
      task.initialDue = undefined;
    }
    if (task.nextAt < now) {
      this.#skip(task, task.nextAt, task.running === undefined ? 'missed' : 'still-running');
      task.nextAt =
        task.trigger.kind === 'cron'
          ? task.trigger.plan.nextAtOrAfter(now)
          : task.running === undefined
            ? now + task.trigger.everyMs
            : Number.POSITIVE_INFINITY;
    }
    if (task.nextAt !== now) {
      return;
    }

    const scheduledFor = task.nextAt;
    task.nextAt = task.trigger.kind === 'cron' ? task.trigger.plan.nextAfter(scheduledFor) : Number.POSITIVE_INFINITY;
    if (task.running !== undefined) {
      this.#skip(task, scheduledFor, 'still-running');
      return;
    }
    await this.#launch(task, scheduledFor);
  }

  async #launch(task: RuntimeTask, scheduledFor: number): Promise<void> {
    let complete = (): void => undefined;
    const completion = new Promise<void>(resolve => {
      complete = resolve;
    });
    const active: ActiveRun = {
      controller: new AbortController(),
      completion,
      complete,
      lease: undefined,
      timedOut: false,
    };
    task.running = active;

    if (task.definition.runs === 'once-per-cluster') {
      const leases = this.#options.leases;
      if (leases === undefined) {
        this.#finishWithoutRun(task, active);
        return;
      }
      const session = createLeaseSession({
        store: leases,
        clock: this.#options.clock,
        key: task.definition.name,
        holder: this.#holder,
        ttlMs: this.#leaseMs,
      });
      active.lease = session;
      let acquired = false;
      try {
        acquired = await session.acquire();
      } catch (error) {
        this.#error(task, scheduledFor, error);
      }
      if (!acquired) {
        this.#skip(task, scheduledFor, 'lease-not-held');
        await session.release();
        this.#finishWithoutRun(task, active);
        return;
      }
      session.startRenewing(error => {
        task.disabled = true;
        active.controller.abort(error);
        this.#error(task, scheduledFor, error);
        this.#wake();
      });
    }

    const timerController = new AbortController();
    active.controller.signal.addEventListener('abort', () => timerController.abort(active.controller.signal.reason), {
      once: true,
    });
    const invocation = task.invoke().then<InvocationSettlement, InvocationSettlement>(
      () => ({ kind: 'resolved' }),
      error => ({ kind: 'rejected', error }),
    );
    const invocationCompletion = invocation.then(async settlement => {
      timerController.abort();
      if (settlement.kind === 'rejected' && !active.timedOut) {
        this.#error(task, scheduledFor, settlement.error);
      }
      await this.#finishRun(task, active);
    });

    const timeout = this.#options.clock.sleep(task.definition.timeoutMs, timerController.signal).then(
      () => {
        if (task.running === active) {
          active.timedOut = true;
          this.#error(
            task,
            scheduledFor,
            new Error(
              `@zmdb/web: scheduled task "${task.definition.name}" exceeded ${String(task.definition.timeoutMs)}ms`,
            ),
          );
        }
      },
      () => undefined,
    );
    await Promise.race([invocationCompletion, timeout]);
  }

  #finishWithoutRun(task: RuntimeTask, active: ActiveRun): void {
    if (task.running === active) {
      task.running = undefined;
      if (task.trigger.kind === 'interval') {
        task.nextAt = this.#options.clock.now() + task.trigger.everyMs;
      }
    }
    active.complete();
    this.#wake();
  }

  async #finishRun(task: RuntimeTask, active: ActiveRun): Promise<void> {
    await active.lease?.release();
    if (task.running === active) {
      task.running = undefined;
      if (task.trigger.kind === 'interval' && !task.disabled && !this.#stopped) {
        task.nextAt = this.#options.clock.now() + task.trigger.everyMs;
      }
    }
    active.complete();
    this.#wake();
  }

  #skip(task: RuntimeTask, scheduledFor: number, reason: SkippedRun['reason']): void {
    try {
      this.#options.onSkipped({
        task: task.definition.name,
        scheduledFor: new Date(scheduledFor),
        reason,
      });
    } catch {
      // Observation cannot stop the scheduler.
    }
  }

  #error(task: RuntimeTask, scheduledFor: number, error: unknown): void {
    try {
      this.#options.onTaskError(task.definition.name, new Date(scheduledFor), error);
    } catch {
      // Observation cannot replace the original task failure.
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      if (this.#tasks.length === 0) {
        return;
      }
      const nextAt = this.#tasks.reduce(
        (earliest, task) => (task.disabled ? earliest : Math.min(earliest, task.nextAt)),
        Number.POSITIVE_INFINITY,
      );
      const now = this.#options.clock.now();
      const delay = Number.isFinite(nextAt) ? Math.min(MAX_TIMER_MS, Math.max(0, nextAt - now)) : MAX_TIMER_MS;
      const controller = new AbortController();
      this.#sleepController = controller;
      try {
        await this.#options.clock.sleep(delay, controller.signal);
      } catch {
        if (this.#stopped) {
          return;
        }
      }
      if (this.#sleepController === controller) {
        this.#sleepController = undefined;
      }
      if (this.#stopped || controller.signal.aborted) {
        continue;
      }
      void this.tick(this.#options.clock.now()).catch(() => undefined);
      await Promise.resolve();
    }
  }

  #wake(): void {
    this.#sleepController?.abort();
  }

  async #stop(): Promise<void> {
    this.#stopped = true;
    this.#wake();
    await this.#loop;

    const active = this.#tasks.flatMap(task => (task.running === undefined ? [] : [task.running]));
    if (active.length === 0) {
      return;
    }

    const graceController = new AbortController();
    const settled = Promise.all(active.map(run => run.completion)).then(() => 'settled' as const);
    const grace = this.#options.clock.sleep(this.#graceMs, graceController.signal).then(
      () => 'expired' as const,
      () => 'cancelled' as const,
    );
    const outcome = await Promise.race([settled, grace]);
    if (outcome === 'settled') {
      graceController.abort();
      return;
    }

    for (const run of active) {
      run.controller.abort(new Error('@zmdb/web: scheduler shutdown grace expired'));
      await run.lease?.release();
    }
  }
}
