// Portable queue and worker state machines; providers own persistence.
export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface JobEnqueue {
  readonly id: string;
  readonly name: string;
  readonly payload: string;
  readonly enqueuedAt: Date;
  readonly availableAt: Date;
  readonly dedupeKey?: string;
}
export type JobEnqueueResult =
  | { readonly kind: 'inserted'; readonly jobId: string }
  | { readonly kind: 'duplicate'; readonly jobId: string };
export interface JobEnqueuer {
  enqueue(job: JobEnqueue): Promise<JobEnqueueResult>;
}
export interface JobCandidate {
  readonly id: string;
  readonly name: string;
  readonly enqueuedAt: Date;
}
export interface ClaimedJob extends JobCandidate {
  readonly payload: string;
  readonly attempts: number;
  readonly dedupeKey?: string;
  readonly holder: string;
}
export type JobSettlement =
  | {
      readonly kind: 'done';
      readonly jobId: string;
      readonly holder: string;
      readonly idempotencyKey: string;
      readonly completedAt: Date;
    }
  | {
      readonly kind: 'retry';
      readonly jobId: string;
      readonly holder: string;
      readonly attempts: number;
      readonly availableAt: Date;
      readonly detail: string;
    }
  | {
      readonly kind: 'dead';
      readonly jobId: string;
      readonly holder: string;
      readonly attempts: number;
      readonly reason: DeadReason;
      readonly detail: string;
      readonly deadAt: Date;
    }
  | { readonly kind: 'release'; readonly jobId: string; readonly holder: string; readonly availableAt: Date };
export interface JobStore extends JobEnqueuer {
  candidates(options: { readonly now: Date; readonly limit: number }): Promise<readonly JobCandidate[]>;
  claim(options: {
    readonly ids: readonly string[];
    readonly holder: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }): Promise<readonly ClaimedJob[]>;
  completed(key: string): Promise<boolean>;
  settle(settlement: JobSettlement): Promise<boolean>;
  listDead(options: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]>;
  replay(jobId: string, availableAt: Date): Promise<boolean>;
}
export interface JobStoreResource {
  close(options?: { readonly graceMs: number }): void | Promise<void>;
}
export interface JobStoreMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

export type Backoff =
  | { readonly kind: 'fixed'; readonly delayMs: number }
  | { readonly kind: 'exponential'; readonly baseMs: number; readonly ceilingMs: number };

export interface RetryPolicy {
  readonly attempts: number;
  readonly backoff: Backoff;
}

export type DeadReason = 'invalid-payload' | 'unknown-name' | 'attempts-exhausted';

export type JobOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: DeadReason; readonly detail: string };

export interface JobContext {
  readonly jobId: string;
  readonly name: string;
  readonly attempt: number;
  readonly enqueuedAt: Date;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

export interface JobHandler<M, K extends keyof M & string> {
  readonly name: K;
  readonly validate: (raw: unknown) => M[K];
  handle(payload: M[K], ctx: JobContext): Promise<void>;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly retries?: RetryPolicy;
}

export type AnyJobHandler<M> = { readonly [K in keyof M & string]: JobHandler<M, K> }[keyof M & string];

export interface EnqueueOptions {
  readonly delayMs?: number;
  readonly dedupeKey?: string;
}

export interface Queue<M> {
  enqueue<K extends keyof M & string>(name: K, payload: M[K], opts?: EnqueueOptions): Promise<string>;
  enqueueInTransaction<K extends keyof M & string>(
    tx: JobEnqueuer,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string>;
}

export interface QueueOptions {
  readonly store: JobStore;
  readonly clock: Clock;
}

export interface DeadJob {
  readonly jobId: string;
  readonly name: string;
  readonly payload: string;
  readonly attempts: number;
  readonly reason: DeadReason;
  readonly detail: string;
  readonly enqueuedAt: Date;
  readonly deadAt: Date;
}

export interface WorkerOptions<M> {
  readonly handlers: readonly AnyJobHandler<M>[];
  readonly store: JobStore;
  readonly clock: Clock;
  readonly concurrency: number;
  readonly graceMs: number;
  readonly leaseMs: number;
  readonly onDead: (job: DeadJob) => void | Promise<void>;
  readonly onHandlerError: (ctx: JobContext, error: unknown) => void;
  readonly timeoutMs?: number;
  readonly retries?: RetryPolicy;
  readonly batch?: number;
  readonly idleMs?: number;
  readonly maxIdleMs?: number;
}

export interface Worker {
  runOnce(): Promise<RunReport>;
  start(): void;
  onShutdown(options?: { readonly graceMs: number }): Promise<void>;
  listDead(opts: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]>;
  replay(jobId: string): Promise<boolean>;
}

export interface RunReport {
  readonly claimed: number;
  readonly done: number;
  readonly retried: number;
  readonly dead: number;
  readonly skipped: number;
}

interface MutableReport {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  skipped: number;
}

interface RuntimeHandler {
  readonly name: string;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly retries?: RetryPolicy;
  prepare(raw: unknown): (ctx: JobContext) => Promise<void>;
}

interface ActiveJob {
  readonly row: ClaimedJob;
  readonly controller: AbortController;
  abandoned: boolean;
}

type HandlerSettlement = { readonly kind: 'resolved' } | { readonly kind: 'rejected'; readonly error: unknown };

type TimeoutSettlement = { readonly kind: 'timeout' } | { readonly kind: 'cancelled' };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES: RetryPolicy = {
  attempts: 5,
  backoff: { kind: 'exponential', baseMs: 1000, ceilingMs: 300_000 },
};
const DEFAULT_BATCH = 100;
const DEFAULT_IDLE_MS = 1000;
const DEFAULT_MAX_IDLE_MS = 30_000;

function emptyReport(): MutableReport {
  return { claimed: 0, done: 0, retried: 0, dead: 0, skipped: 0 };
}

function addReport(target: MutableReport, source: RunReport): void {
  target.claimed += source.claimed;
  target.done += source.done;
  target.retried += source.retried;
  target.dead += source.dead;
  target.skipped += source.skipped;
}

function integer(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
}

function duration(name: string, value: number, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${name} must be ${allowZero ? 'non-negative' : 'positive'} and finite`);
  }
}

function validateRetryPolicy(name: string, policy: RetryPolicy): void {
  integer(`${name}.attempts`, policy.attempts, 1);
  if (policy.backoff.kind === 'fixed') {
    duration(`${name}.backoff.delayMs`, policy.backoff.delayMs);
    return;
  }
  duration(`${name}.backoff.baseMs`, policy.backoff.baseMs);
  duration(`${name}.backoff.ceilingMs`, policy.backoff.ceilingMs);
  if (policy.backoff.ceilingMs < policy.backoff.baseMs) {
    throw new RangeError(`${name}.backoff.ceilingMs must be greater than or equal to baseMs`);
  }
}

function runtimeHandler<M>(handler: AnyJobHandler<M>): RuntimeHandler {
  // A mapped-union member is safe to widen internally: its validator and method
  // came from the same member before this startup-built dispatch entry existed.
  const broad: JobHandler<M, keyof M & string> = handler;
  const runtime: RuntimeHandler = {
    name: broad.name,
    prepare(raw) {
      const payload = broad.validate(raw);
      return ctx => broad.handle(payload, ctx);
    },
  };
  if (broad.concurrency !== undefined) Object.assign(runtime, { concurrency: broad.concurrency });
  if (broad.timeoutMs !== undefined) Object.assign(runtime, { timeoutMs: broad.timeoutMs });
  if (broad.retries !== undefined) Object.assign(runtime, { retries: broad.retries });
  return runtime;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePayload(payload: string): unknown {
  return JSON.parse(payload);
}

function jitter(policy: RetryPolicy, attempt: number): number {
  const nominal =
    policy.backoff.kind === 'fixed'
      ? policy.backoff.delayMs
      : Math.min(policy.backoff.ceilingMs, policy.backoff.baseMs * 2 ** (attempt - 1));
  return nominal * (0.75 + Math.random() * 0.5);
}

async function wait(clock: Clock, ms: number, signal: AbortSignal): Promise<'elapsed' | 'aborted'> {
  try {
    await clock.sleep(ms, signal);
    return 'elapsed';
  } catch (error) {
    if (signal.aborted) return 'aborted';
    throw error;
  }
}

class JobWorker<M> implements Worker {
  readonly #handlers = new Map<string, RuntimeHandler>();
  readonly #activeByHandler = new Map<string, number>();
  readonly #active = new Map<string, ActiveJob>();
  readonly #inFlight = new Map<string, Promise<RunReport>>();
  readonly #claims = new Set<Promise<readonly ClaimedJob[]>>();
  readonly #claimRequeues = new Set<Promise<void>>();
  readonly #keyTails = new Map<string, Promise<void>>();
  readonly #store: JobStore;
  readonly #clock: Clock;
  readonly #concurrency: number;
  readonly #graceMs: number;
  readonly #leaseMs: number;
  readonly #onDead: WorkerOptions<M>['onDead'];
  readonly #onHandlerError: WorkerOptions<M>['onHandlerError'];
  readonly #timeoutMs: number;
  readonly #retries: RetryPolicy;
  readonly #batch: number;
  readonly #idleMs: number;
  readonly #maxIdleMs: number;
  #stopping = false;
  #started = false;
  #idleAbort: AbortController | undefined;
  #pass: Promise<RunReport> | undefined;
  #shutdown: Promise<void> | undefined;

  constructor(opts: WorkerOptions<M>) {
    integer('concurrency', opts.concurrency, 1);
    duration('graceMs', opts.graceMs, true);
    duration('leaseMs', opts.leaseMs);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const batch = opts.batch ?? DEFAULT_BATCH;
    const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    const maxIdleMs = opts.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
    duration('timeoutMs', timeoutMs);
    if (opts.leaseMs <= timeoutMs) {
      throw new RangeError('leaseMs must be greater than timeoutMs');
    }
    validateRetryPolicy('retries', retries);
    integer('batch', batch, 1);
    duration('idleMs', idleMs);
    duration('maxIdleMs', maxIdleMs);
    if (maxIdleMs < idleMs) throw new RangeError('maxIdleMs must be greater than or equal to idleMs');

    this.#store = opts.store;
    this.#clock = opts.clock;
    this.#concurrency = opts.concurrency;
    this.#graceMs = opts.graceMs;
    this.#leaseMs = opts.leaseMs;
    this.#onDead = opts.onDead;
    this.#onHandlerError = opts.onHandlerError;
    this.#timeoutMs = timeoutMs;
    this.#retries = retries;
    this.#batch = batch;
    this.#idleMs = idleMs;
    this.#maxIdleMs = maxIdleMs;

    for (const declared of opts.handlers) {
      const handler = runtimeHandler(declared);
      if (this.#handlers.has(handler.name)) throw new Error(`duplicate queue handler: ${handler.name}`);
      if (handler.concurrency !== undefined) {
        integer(`${handler.name}.concurrency`, handler.concurrency, 1);
        if (handler.concurrency > this.#concurrency) {
          throw new RangeError(`${handler.name}.concurrency cannot exceed worker concurrency`);
        }
      }
      if (handler.timeoutMs !== undefined) {
        duration(`${handler.name}.timeoutMs`, handler.timeoutMs);
        if (opts.leaseMs <= handler.timeoutMs) {
          throw new RangeError(`leaseMs must be greater than ${handler.name}.timeoutMs`);
        }
      }
      if (handler.retries !== undefined) validateRetryPolicy(`${handler.name}.retries`, handler.retries);
      this.#handlers.set(handler.name, handler);
    }
  }

  async runOnce(): Promise<RunReport> {
    if (this.#pass !== undefined) return this.#pass;
    const pass = this.#runPass();
    this.#pass = pass;
    try {
      return await pass;
    } finally {
      if (this.#pass === pass) this.#pass = undefined;
    }
  }

  async #runPass(): Promise<RunReport> {
    if (this.#stopping) return emptyReport();
    const capacity = this.#concurrency - this.#inFlight.size;
    if (capacity <= 0) return emptyReport();

    const claim = this.#claim(Math.min(this.#batch, capacity));
    this.#claims.add(claim);
    let rows: readonly ClaimedJob[];
    try {
      rows = await claim;
    } finally {
      this.#claims.delete(claim);
    }
    if (this.#stopping) {
      const requeue = Promise.allSettled(rows.map(row => this.#requeueClaim(row))).then(() => undefined);
      this.#claimRequeues.add(requeue);
      try {
        await requeue;
      } finally {
        this.#claimRequeues.delete(requeue);
      }
      return { ...emptyReport(), claimed: rows.length };
    }

    const report = emptyReport();
    report.claimed = rows.length;
    const settled = await Promise.all(rows.map(row => this.#startClaimed(row)));
    for (const outcome of settled) addReport(report, outcome);
    return report;
  }

  start(): void {
    if (this.#started || this.#stopping) return;
    this.#started = true;
    void this.#loop().catch(() => {
      this.#stopping = true;
    });
  }

  onShutdown(options?: { readonly graceMs: number }): Promise<void> {
    if (this.#shutdown !== undefined) return this.#shutdown;
    const cap = options?.graceMs;
    if (cap !== undefined) duration('graceMs', cap, true);
    const graceMs = Math.min(this.#graceMs, cap ?? this.#graceMs);
    this.#shutdown = this.#drain(graceMs);
    return this.#shutdown;
  }

  async listDead(opts: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]> {
    return this.#store.listDead(opts);
  }

  async replay(jobId: string): Promise<boolean> {
    return this.#store.replay(jobId, new Date(this.#clock.now()));
  }

  async #loop(): Promise<void> {
    let idleMs = this.#idleMs;
    while (!this.#stopping) {
      const report = await this.runOnce();
      if (this.#stopping) return;
      if (report.claimed > 0) {
        idleMs = this.#idleMs;
        continue;
      }
      const controller = new AbortController();
      this.#idleAbort = controller;
      await wait(this.#clock, idleMs, controller.signal);
      if (this.#idleAbort === controller) this.#idleAbort = undefined;
      idleMs = Math.min(this.#maxIdleMs, idleMs * 2);
    }
  }

  async #drain(graceMs: number): Promise<void> {
    this.#stopping = true;
    this.#idleAbort?.abort();
    const current = [this.#pass, ...this.#claims, ...this.#claimRequeues, ...this.#inFlight.values()];
    const graceAbort = new AbortController();
    const settled = Promise.allSettled(current).then(() => 'settled');
    const grace = graceMs === 0 ? Promise.resolve('elapsed') : wait(this.#clock, graceMs, graceAbort.signal);
    const outcome = await Promise.race([settled, grace]);
    graceAbort.abort();
    if (outcome === 'settled') return;
    const unfinished = [...this.#active.values()];
    for (const active of unfinished) {
      active.abandoned = true;
      active.controller.abort();
    }
    // Release is observed even when a provider cannot finish before this deadline.
    void Promise.allSettled(unfinished.map(active => this.#requeueClaim(active.row)));
  }

  async #claim(limit: number): Promise<readonly ClaimedJob[]> {
    const now = new Date(this.#clock.now());
    // A capped handler must not hide other names behind its queued candidates.
    const scanLimit = [...this.#handlers.values()].some(handler => handler.concurrency !== undefined)
      ? this.#batch
      : limit;
    const candidates = await this.#store.candidates({ now, limit: scanLimit });
    const selected = this.#selectCandidates(candidates, limit);
    if (selected.length === 0) return [];
    return this.#store.claim({
      ids: selected.map(candidate => candidate.id),
      holder: globalThis.crypto.randomUUID(),
      now,
      leaseUntil: new Date(now.getTime() + this.#leaseMs),
    });
  }

  #selectCandidates(rows: readonly JobCandidate[], limit: number): readonly JobCandidate[] {
    const selected: JobCandidate[] = [];
    const reserved = new Map<string, number>();
    for (const row of rows) {
      if (selected.length >= limit) break;
      const { id, name } = row;
      if (this.#active.has(id)) continue;
      const handler = this.#handlers.get(name);
      if (handler?.concurrency !== undefined) {
        const used = (this.#activeByHandler.get(name) ?? 0) + (reserved.get(name) ?? 0);
        if (used >= handler.concurrency) continue;
        reserved.set(name, (reserved.get(name) ?? 0) + 1);
      }
      selected.push(row);
    }
    return selected;
  }

  #startClaimed(row: ClaimedJob): Promise<RunReport> {
    const handler = this.#handlers.get(row.name);
    const active: ActiveJob = { row, controller: new AbortController(), abandoned: false };
    this.#active.set(row.id, active);
    if (handler !== undefined) {
      this.#activeByHandler.set(row.name, (this.#activeByHandler.get(row.name) ?? 0) + 1);
    }
    const work = this.#process(active, handler).finally(() => {
      this.#active.delete(row.id);
      this.#inFlight.delete(row.id);
      if (handler !== undefined) {
        const remaining = (this.#activeByHandler.get(row.name) ?? 1) - 1;
        if (remaining === 0) this.#activeByHandler.delete(row.name);
        else this.#activeByHandler.set(row.name, remaining);
      }
    });
    this.#inFlight.set(row.id, work);
    return work;
  }

  async #process(active: ActiveJob, handler: RuntimeHandler | undefined): Promise<RunReport> {
    const key = active.row.dedupeKey ?? active.row.id;
    const release = await this.#lockKey(key);
    try {
      if (active.abandoned) return emptyReport();
      const completed = await this.#markerExists(key);
      if (active.abandoned) return emptyReport();
      if (completed) {
        const done = await this.#markDone(active);
        return { ...emptyReport(), done: done ? 1 : 0, skipped: 1 };
      }

      let raw: unknown;
      try {
        raw = parsePayload(active.row.payload);
      } catch (error) {
        return this.#markDead(active, 'invalid-payload', `${errorDetail(error)}: ${active.row.payload.slice(0, 200)}`);
      }

      if (handler === undefined) {
        return this.#settleFailure(
          active,
          this.#retries,
          `no handler registered for ${active.row.name}`,
          'unknown-name',
        );
      }

      let prepared: (ctx: JobContext) => Promise<void>;
      try {
        prepared = handler.prepare(raw);
      } catch (error) {
        return this.#markDead(active, 'invalid-payload', errorDetail(error));
      }

      const ctx: JobContext = {
        jobId: active.row.id,
        name: active.row.name,
        attempt: active.row.attempts + 1,
        enqueuedAt: active.row.enqueuedAt,
        idempotencyKey: key,
        signal: active.controller.signal,
      };
      const timeoutMs = handler.timeoutMs ?? this.#timeoutMs;
      const policy = handler.retries ?? this.#retries;
      return this.#runHandler(active, prepared, ctx, timeoutMs, policy);
    } finally {
      release();
    }
  }

  async #runHandler(
    active: ActiveJob,
    prepared: (ctx: JobContext) => Promise<void>,
    ctx: JobContext,
    timeoutMs: number,
    policy: RetryPolicy,
  ): Promise<RunReport> {
    const timerAbort = new AbortController();
    const handler: Promise<HandlerSettlement> = Promise.resolve()
      .then(() => (active.abandoned ? undefined : prepared(ctx)))
      .then(
        () => ({ kind: 'resolved' }),
        (error): HandlerSettlement => ({ kind: 'rejected', error }),
      );
    const timeout: Promise<TimeoutSettlement> = wait(this.#clock, timeoutMs, timerAbort.signal).then(result =>
      result === 'elapsed' ? { kind: 'timeout' } : { kind: 'cancelled' },
    );
    const first = await Promise.race([handler, timeout]);

    if (first.kind === 'timeout') {
      active.controller.abort();
      const error = new Error(`job ${ctx.name} timed out after ${timeoutMs}ms`);
      this.#reportHandlerError(ctx, error);
      const outcome = await this.#settleFailure(active, policy, error.message);
      await handler;
      return outcome;
    }

    timerAbort.abort();
    if (active.abandoned) return emptyReport();
    if (first.kind === 'rejected') {
      this.#reportHandlerError(ctx, first.error);
      return this.#settleFailure(active, policy, errorDetail(first.error));
    }
    const done = await this.#markDone(active);
    return { ...emptyReport(), done: done ? 1 : 0, skipped: done ? 0 : 1 };
  }

  #reportHandlerError(ctx: JobContext, error: unknown): void {
    try {
      this.#onHandlerError(ctx, error);
    } catch {
      // The error sink is observational; it cannot change queue settlement.
    }
  }

  async #settleFailure(
    active: ActiveJob,
    policy: RetryPolicy,
    detail: string,
    terminalReason: DeadReason = 'attempts-exhausted',
  ): Promise<RunReport> {
    const attempt = active.row.attempts + 1;
    if (attempt >= policy.attempts) return this.#markDead(active, terminalReason, detail);
    if (active.abandoned) return emptyReport();

    const settled = await this.#store.settle({
      kind: 'retry',
      jobId: active.row.id,
      holder: active.row.holder,
      attempts: attempt,
      availableAt: new Date(this.#clock.now() + jitter(policy, attempt)),
      detail,
    });
    return { ...emptyReport(), retried: settled ? 1 : 0, skipped: settled ? 0 : 1 };
  }

  async #markDone(active: ActiveJob): Promise<boolean> {
    if (active.abandoned) return false;
    return this.#store.settle({
      kind: 'done',
      jobId: active.row.id,
      holder: active.row.holder,
      idempotencyKey: active.row.dedupeKey ?? active.row.id,
      completedAt: new Date(this.#clock.now()),
    });
  }

  async #markDead(active: ActiveJob, reason: DeadReason, detail: string): Promise<RunReport> {
    if (active.abandoned) return emptyReport();
    const deadAt = new Date(this.#clock.now());
    const attempts = active.row.attempts + 1;
    const settled = await this.#store.settle({
      kind: 'dead',
      jobId: active.row.id,
      holder: active.row.holder,
      attempts,
      reason,
      detail,
      deadAt,
    });
    if (!settled) return { ...emptyReport(), skipped: 1 };
    await this.#onDead({
      jobId: active.row.id,
      name: active.row.name,
      payload: active.row.payload,
      attempts,
      reason,
      detail,
      enqueuedAt: active.row.enqueuedAt,
      deadAt,
    });
    return { ...emptyReport(), dead: 1 };
  }

  async #markerExists(key: string): Promise<boolean> {
    return this.#store.completed(key);
  }

  async #lockKey(key: string): Promise<() => void> {
    let release = (): void => undefined;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    const previous = this.#keyTails.get(key);
    this.#keyTails.set(key, current);
    if (previous !== undefined) await previous;
    return () => {
      release();
      if (this.#keyTails.get(key) === current) this.#keyTails.delete(key);
    };
  }

  async #requeueClaim(row: ClaimedJob): Promise<void> {
    await this.#store.settle({
      kind: 'release',
      jobId: row.id,
      holder: row.holder,
      availableAt: new Date(this.#clock.now()),
    });
  }
}

class JobQueue<M> implements Queue<M> {
  readonly #store: JobStore;
  readonly #clock: Clock;
  constructor(opts: QueueOptions) {
    this.#store = opts.store;
    this.#clock = opts.clock;
  }
  enqueue<K extends keyof M & string>(name: K, payload: M[K], opts?: EnqueueOptions): Promise<string> {
    return this.#enqueue(this.#store, name, payload, opts);
  }
  enqueueInTransaction<K extends keyof M & string>(
    tx: JobEnqueuer,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string> {
    return this.#enqueue(tx, name, payload, opts);
  }
  async #enqueue<K extends keyof M & string>(
    store: JobEnqueuer,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string> {
    const delayMs = opts?.delayMs ?? 0;
    duration('delayMs', delayMs, true);
    const encoded = JSON.stringify(payload);
    if (encoded === undefined) throw new TypeError(`job ${name} payload is not JSON-serializable`);
    const now = this.#clock.now();
    const result = await store.enqueue({
      id: globalThis.crypto.randomUUID(),
      name,
      payload: encoded,
      enqueuedAt: new Date(now),
      availableAt: new Date(now + delayMs),
      ...(opts?.dedupeKey === undefined ? {} : { dedupeKey: opts.dedupeKey }),
    });
    return result.jobId;
  }
}

export function createQueue<M>(opts: QueueOptions): Queue<M> {
  if (opts?.store === undefined) throw new TypeError('@zmdb/jobs: a store is required');
  return new JobQueue<M>(opts);
}
export function createWorker<M>(opts: WorkerOptions<M>): Worker {
  if (opts?.store === undefined) throw new TypeError('@zmdb/jobs: a store is required');
  return new JobWorker(opts);
}
