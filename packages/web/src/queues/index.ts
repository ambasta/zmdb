// @zmdb/web/queues — typed SQL-backed jobs, retries, dead letters and bounded drain.
//
// The store is structural on purpose: a repository Driver or TransactionContext
// satisfies it directly. Supported backend adapters live on opt-in subpaths so
// the core queue entry does not load an external backend.
import { formatPlaceholder, quoteIdentifier, type Dialect } from '@zmdb/query-compiler';

export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export type JobDialect = Dialect;

export interface JobStore {
  readonly dialect?: JobDialect;
  execute(query: {
    readonly text: string;
    readonly parameters: readonly unknown[];
  }): Promise<readonly Record<string, unknown>[]>;
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
    tx: JobStore,
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
  onShutdown(): Promise<void>;
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

interface Candidate {
  readonly id: string;
  readonly name: string;
}

interface ClaimedJob extends Candidate {
  readonly payload: string;
  readonly attempts: number;
  readonly enqueuedAt: Date;
  readonly dedupeKey: string | undefined;
  readonly token: string;
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

function dialectOf(store: JobStore, fallback: JobDialect = 'sqlite'): JobDialect {
  return store.dialect ?? fallback;
}

function quote(name: string, dialect: JobDialect): string {
  return quoteIdentifier(dialect, name);
}

function placeholder(dialect: JobDialect, position: number): string {
  return formatPlaceholder(dialect, position);
}

function placeholders(dialect: JobDialect, count: number, start: number): string {
  return Array.from({ length: count }, (_, index) => placeholder(dialect, start + index)).join(', ');
}

function field(row: Record<string, unknown>, name: string): unknown {
  return row[name];
}

function stringField(row: Record<string, unknown>, name: string): string {
  const value = field(row, name);
  if (typeof value !== 'string') throw new TypeError(`zmdb_job.${name} must be a string`);
  return value;
}

function optionalStringField(row: Record<string, unknown>, name: string): string | undefined {
  const value = field(row, name);
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError(`zmdb_job.${name} must be a string or null`);
  return value;
}

function numberField(row: Record<string, unknown>, name: string): number {
  const value = field(row, name);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`zmdb_job.${name} must be a safe integer`);
  }
  return value;
}

function dateField(row: Record<string, unknown>, name: string): Date {
  const value = field(row, name);
  const date = value instanceof Date ? value : new Date(stringField(row, name));
  if (!Number.isFinite(date.getTime())) throw new TypeError(`zmdb_job.${name} must be a valid timestamp`);
  return date;
}

function deadReason(value: unknown): DeadReason {
  if (value === 'invalid-payload' || value === 'unknown-name' || value === 'attempts-exhausted') return value;
  throw new TypeError('zmdb_job.dead_reason must be a known dead-letter reason');
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

class SqlWorker<M> implements Worker {
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

  onShutdown(): Promise<void> {
    this.#shutdown ??= this.#drain();
    return this.#shutdown;
  }

  async listDead(opts: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]> {
    integer('limit', opts.limit, 1);
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    const reasonColumn = quote('dead_reason', dialect);
    const where =
      opts.reason === undefined
        ? `${quote('status', dialect)} = ${placeholder(dialect, 1)}`
        : `${quote('status', dialect)} = ${placeholder(dialect, 1)} AND ${reasonColumn} = ${placeholder(dialect, 2)}`;
    const limitPosition = opts.reason === undefined ? 2 : 3;
    const parameters: unknown[] = opts.reason === undefined ? ['dead', opts.limit] : ['dead', opts.reason, opts.limit];
    const rows = await this.#store.execute({
      text:
        `SELECT ${quote('id', dialect)}, ${quote('name', dialect)}, ${quote('payload', dialect)}, ` +
        `${quote('attempts', dialect)}, ${reasonColumn}, ${quote('dead_detail', dialect)}, ` +
        `${quote('enqueued_at', dialect)}, ${quote('dead_at', dialect)} FROM ${table} WHERE ${where} ` +
        `ORDER BY ${quote('dead_at', dialect)} DESC LIMIT ${placeholder(dialect, limitPosition)}`,
      parameters,
    });
    return rows.map(row => this.#deadJobFromRow(row));
  }

  async replay(jobId: string): Promise<boolean> {
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    const found = await this.#store.execute({
      text:
        `SELECT ${quote('id', dialect)} FROM ${table} WHERE ${quote('id', dialect)} = ` +
        `${placeholder(dialect, 1)} AND ${quote('status', dialect)} = ${placeholder(dialect, 2)} LIMIT 1`,
      parameters: [jobId, 'dead'],
    });
    if (found.length === 0) return false;

    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('status', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('attempts', dialect)} = ${placeholder(dialect, 2)}, ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 3)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 4)}, ` +
        `${quote('last_error', dialect)} = ${placeholder(dialect, 5)}, ` +
        `${quote('dead_reason', dialect)} = ${placeholder(dialect, 6)}, ` +
        `${quote('dead_detail', dialect)} = ${placeholder(dialect, 7)}, ` +
        `${quote('dead_at', dialect)} = ${placeholder(dialect, 8)} ` +
        `WHERE ${quote('id', dialect)} = ${placeholder(dialect, 9)} AND ` +
        `${quote('status', dialect)} = ${placeholder(dialect, 10)}`,
      parameters: ['pending', 0, '', new Date(0), null, null, null, null, jobId, 'dead'],
    });
    return true;
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

  async #drain(): Promise<void> {
    this.#stopping = true;
    this.#idleAbort?.abort();
    if (this.#claims.size > 0) {
      await Promise.allSettled(this.#claims);
      await Promise.resolve();
    }
    if (this.#claimRequeues.size > 0) await Promise.allSettled(this.#claimRequeues);
    const current = [...this.#inFlight.values()];
    if (current.length === 0) return;

    const graceAbort = new AbortController();
    const settled: Promise<'settled'> = Promise.allSettled(current).then(() => 'settled');
    const grace: Promise<'elapsed' | 'settled'> = wait(this.#clock, this.#graceMs, graceAbort.signal).then(result =>
      result === 'elapsed' ? 'elapsed' : 'settled',
    );
    const outcome = await Promise.race([settled, grace]);
    if (outcome === 'settled') {
      graceAbort.abort();
      return;
    }

    const unfinished = [...this.#active.values()];
    for (const active of unfinished) {
      active.abandoned = true;
      active.controller.abort();
    }
    await Promise.allSettled(unfinished.map(active => this.#requeueClaim(active.row)));
  }

  async #claim(limit: number): Promise<readonly ClaimedJob[]> {
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    const now = new Date(this.#clock.now());
    const candidates = await this.#store.execute({
      text:
        `SELECT ${quote('id', dialect)}, ${quote('name', dialect)} FROM ${table} ` +
        `WHERE ${quote('status', dialect)} = ${placeholder(dialect, 1)} AND ` +
        `${quote('lease_until', dialect)} <= ${placeholder(dialect, 2)} ` +
        `ORDER BY ${quote('enqueued_at', dialect)} ASC LIMIT ${placeholder(dialect, 3)}`,
      parameters: ['pending', now, this.#batch],
    });
    const selected = this.#selectCandidates(candidates, limit);
    if (selected.length === 0) return [];

    const token = globalThis.crypto.randomUUID();
    const ids = selected.map(candidate => candidate.id);
    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('lease_owner', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 2)} ` +
        `WHERE ${quote('status', dialect)} = ${placeholder(dialect, 3)} AND ` +
        `${quote('lease_until', dialect)} <= ${placeholder(dialect, 4)} AND ` +
        `${quote('id', dialect)} IN (${placeholders(dialect, ids.length, 5)})`,
      parameters: [token, new Date(this.#clock.now() + this.#leaseMs), 'pending', now, ...ids],
    });

    const rows = await this.#store.execute({
      text:
        `SELECT ${quote('id', dialect)}, ${quote('name', dialect)}, ${quote('payload', dialect)}, ` +
        `${quote('attempts', dialect)}, ${quote('enqueued_at', dialect)}, ${quote('dedupe_key', dialect)} ` +
        `FROM ${table} WHERE ${quote('lease_owner', dialect)} = ${placeholder(dialect, 1)} ` +
        `ORDER BY ${quote('enqueued_at', dialect)} ASC`,
      parameters: [token],
    });
    return rows.map(row => ({
      id: stringField(row, 'id'),
      name: stringField(row, 'name'),
      payload: stringField(row, 'payload'),
      attempts: numberField(row, 'attempts'),
      enqueuedAt: dateField(row, 'enqueued_at'),
      dedupeKey: optionalStringField(row, 'dedupe_key'),
      token,
    }));
  }

  #selectCandidates(rows: readonly Record<string, unknown>[], limit: number): readonly Candidate[] {
    const selected: Candidate[] = [];
    const reserved = new Map<string, number>();
    for (const row of rows) {
      if (selected.length >= limit) break;
      const id = stringField(row, 'id');
      const name = stringField(row, 'name');
      if (this.#active.has(id)) continue;
      const handler = this.#handlers.get(name);
      if (handler?.concurrency !== undefined) {
        const used = (this.#activeByHandler.get(name) ?? 0) + (reserved.get(name) ?? 0);
        if (used >= handler.concurrency) continue;
        reserved.set(name, (reserved.get(name) ?? 0) + 1);
      }
      selected.push({ id, name });
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
      if (await this.#markerExists(key)) {
        await this.#markDone(active);
        return { ...emptyReport(), done: 1, skipped: 1 };
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
      .then(() => prepared(ctx))
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
    await this.#markDone(active);
    return { ...emptyReport(), done: 1 };
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

    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    const afterMs = jitter(policy, attempt);
    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('status', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('attempts', dialect)} = ${placeholder(dialect, 2)}, ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 3)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 4)}, ` +
        `${quote('last_error', dialect)} = ${placeholder(dialect, 5)} ` +
        `WHERE ${quote('id', dialect)} = ${placeholder(dialect, 6)} AND ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 7)}`,
      parameters: [
        'pending',
        attempt,
        '',
        new Date(this.#clock.now() + afterMs),
        detail,
        active.row.id,
        active.row.token,
      ],
    });
    return { ...emptyReport(), retried: 1 };
  }

  async #markDone(active: ActiveJob): Promise<void> {
    if (active.abandoned) return;
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('status', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('attempts', dialect)} = ${placeholder(dialect, 2)}, ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 3)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 4)}, ` +
        `${quote('last_error', dialect)} = ${placeholder(dialect, 5)}, ` +
        `${quote('dead_reason', dialect)} = ${placeholder(dialect, 6)}, ` +
        `${quote('dead_detail', dialect)} = ${placeholder(dialect, 7)}, ` +
        `${quote('dead_at', dialect)} = ${placeholder(dialect, 8)} ` +
        `WHERE ${quote('id', dialect)} = ${placeholder(dialect, 9)} AND ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 10)}`,
      parameters: [
        'done',
        active.row.attempts + 1,
        '',
        new Date(this.#clock.now()),
        null,
        null,
        null,
        null,
        active.row.id,
        active.row.token,
      ],
    });
  }

  async #markDead(active: ActiveJob, reason: DeadReason, detail: string): Promise<RunReport> {
    if (active.abandoned) return emptyReport();
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    const deadAt = new Date(this.#clock.now());
    const attempts = active.row.attempts + 1;
    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('status', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('attempts', dialect)} = ${placeholder(dialect, 2)}, ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 3)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 4)}, ` +
        `${quote('last_error', dialect)} = ${placeholder(dialect, 5)}, ` +
        `${quote('dead_reason', dialect)} = ${placeholder(dialect, 6)}, ` +
        `${quote('dead_detail', dialect)} = ${placeholder(dialect, 7)}, ` +
        `${quote('dead_at', dialect)} = ${placeholder(dialect, 8)} ` +
        `WHERE ${quote('id', dialect)} = ${placeholder(dialect, 9)} AND ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 10)}`,
      parameters: ['dead', attempts, '', deadAt, detail, reason, detail, deadAt, active.row.id, active.row.token],
    });
    const job: DeadJob = {
      jobId: active.row.id,
      name: active.row.name,
      payload: active.row.payload,
      attempts,
      reason,
      detail,
      enqueuedAt: active.row.enqueuedAt,
      deadAt,
    };
    await this.#onDead(job);
    return { ...emptyReport(), dead: 1 };
  }

  async #markerExists(key: string): Promise<boolean> {
    const dialect = dialectOf(this.#store);
    const rows = await this.#store.execute({
      text:
        `SELECT ${quote('key', dialect)} FROM ${quote('zmdb_job_done', dialect)} WHERE ` +
        `${quote('key', dialect)} = ${placeholder(dialect, 1)} LIMIT 1`,
      parameters: [key],
    });
    return rows.length > 0;
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
    const dialect = dialectOf(this.#store);
    const table = quote('zmdb_job', dialect);
    await this.#store.execute({
      text:
        `UPDATE ${table} SET ${quote('status', dialect)} = ${placeholder(dialect, 1)}, ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 2)}, ` +
        `${quote('lease_until', dialect)} = ${placeholder(dialect, 3)} ` +
        `WHERE ${quote('id', dialect)} = ${placeholder(dialect, 4)} AND ` +
        `${quote('lease_owner', dialect)} = ${placeholder(dialect, 5)}`,
      parameters: ['pending', '', new Date(this.#clock.now()), row.id, row.token],
    });
  }

  #deadJobFromRow(row: Record<string, unknown>): DeadJob {
    return {
      jobId: stringField(row, 'id'),
      name: stringField(row, 'name'),
      payload: stringField(row, 'payload'),
      attempts: numberField(row, 'attempts'),
      reason: deadReason(field(row, 'dead_reason')),
      detail: stringField(row, 'dead_detail'),
      enqueuedAt: dateField(row, 'enqueued_at'),
      deadAt: dateField(row, 'dead_at'),
    };
  }
}

class SqlQueue<M> implements Queue<M> {
  readonly #store: JobStore;
  readonly #clock: Clock;

  constructor(opts: QueueOptions) {
    this.#store = opts.store;
    this.#clock = opts.clock;
  }

  enqueue<K extends keyof M & string>(name: K, payload: M[K], opts?: EnqueueOptions): Promise<string> {
    return this.#enqueue(this.#store, dialectOf(this.#store), name, payload, opts);
  }

  enqueueInTransaction<K extends keyof M & string>(
    tx: JobStore,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string> {
    return this.#enqueue(tx, dialectOf(tx, dialectOf(this.#store)), name, payload, opts);
  }

  async #enqueue<K extends keyof M & string>(
    store: JobStore,
    dialect: JobDialect,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string> {
    const delayMs = opts?.delayMs ?? 0;
    duration('delayMs', delayMs, true);
    if (opts?.dedupeKey !== undefined) {
      const existing = await this.#findDedupe(store, dialect, opts.dedupeKey);
      if (existing !== undefined) return existing;
    }

    const encoded = JSON.stringify(payload);
    if (encoded === undefined) throw new TypeError(`job ${name} payload is not JSON-serializable`);
    const id = globalThis.crypto.randomUUID();
    const table = quote('zmdb_job', dialect);
    const now = this.#clock.now();
    const columns = [
      'id',
      'name',
      'payload',
      'status',
      'attempts',
      'enqueued_at',
      'dedupe_key',
      'lease_owner',
      'lease_until',
      'last_error',
      'dead_reason',
      'dead_detail',
      'dead_at',
    ];
    const parameters: readonly unknown[] = [
      id,
      name,
      encoded,
      'pending',
      0,
      new Date(now),
      opts?.dedupeKey ?? null,
      '',
      delayMs === 0 ? new Date(0) : new Date(now + delayMs),
      null,
      null,
      null,
      null,
    ];
    try {
      await store.execute({
        text:
          `INSERT INTO ${table} (${columns.map(column => quote(column, dialect)).join(', ')}) ` +
          `VALUES (${placeholders(dialect, columns.length, 1)})`,
        parameters,
      });
      return id;
    } catch (error) {
      if (opts?.dedupeKey === undefined) throw error;
      const existing = await this.#findDedupe(store, dialect, opts.dedupeKey);
      if (existing === undefined) throw error;
      return existing;
    }
  }

  async #findDedupe(store: JobStore, dialect: JobDialect, key: string): Promise<string | undefined> {
    const rows = await store.execute({
      text:
        `SELECT ${quote('id', dialect)} FROM ${quote('zmdb_job', dialect)} WHERE ` +
        `${quote('dedupe_key', dialect)} = ${placeholder(dialect, 1)} LIMIT 1`,
      parameters: [key],
    });
    const first = rows[0];
    return first === undefined ? undefined : stringField(first, 'id');
  }
}

export function createQueue<M>(opts: QueueOptions): Queue<M> {
  return new SqlQueue<M>(opts);
}

export function createWorker<M>(opts: WorkerOptions<M>): Worker {
  return new SqlWorker(opts);
}
