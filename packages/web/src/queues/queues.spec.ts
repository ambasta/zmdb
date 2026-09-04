// Tests freeze for #587, against queues/SPEC.md. The module does not exist yet, so every
// queue-runtime assertion is `it.fails`. `loadQueues` dynamically imports the real future
// subpath: there is no passing implementation hidden in this file. Once #588 lands, the import
// succeeds and each body reaches the controllable in-memory store and fake clock below.
import { DatabaseSync } from 'node:sqlite';

import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createToken, Inject } from '../di/index.js';
import { compileModule, Module } from '../modules/index.js';

interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

interface JobStore {
  execute(query: {
    readonly text: string;
    readonly parameters: readonly unknown[];
  }): Promise<readonly Record<string, unknown>[]>;
}

type Backoff =
  | { readonly kind: 'fixed'; readonly delayMs: number }
  | { readonly kind: 'exponential'; readonly baseMs: number; readonly ceilingMs: number };

interface JobContext {
  readonly jobId: string;
  readonly name: string;
  readonly attempt: number;
  readonly enqueuedAt: Date;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

interface JobHandler<M, K extends keyof M & string> {
  readonly name: K;
  readonly validate: (raw: unknown) => M[K];
  handle(payload: M[K], ctx: JobContext): Promise<void>;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly retries?: { readonly attempts: number; readonly backoff: Backoff };
}

type AnyJobHandler<M> = { readonly [K in keyof M & string]: JobHandler<M, K> }[keyof M & string];

interface DeadJob {
  readonly jobId: string;
  readonly name: string;
  readonly payload: string;
  readonly attempts: number;
  readonly reason: 'invalid-payload' | 'unknown-name' | 'attempts-exhausted';
  readonly detail: string;
  readonly enqueuedAt: Date;
  readonly deadAt: Date;
}

interface Worker {
  runOnce(): Promise<{
    readonly claimed: number;
    readonly done: number;
    readonly retried: number;
    readonly dead: number;
    readonly skipped: number;
  }>;
  start(): void;
  onShutdown(): Promise<void>;
  listDead(opts: { readonly limit: number; readonly reason?: DeadJob['reason'] }): Promise<readonly DeadJob[]>;
  replay(jobId: string): Promise<boolean>;
}

interface WorkerOptions<M> {
  readonly handlers: readonly AnyJobHandler<M>[];
  readonly store: JobStore;
  readonly clock: Clock;
  readonly concurrency: number;
  readonly graceMs: number;
  readonly leaseMs: number;
  readonly onDead: (job: DeadJob) => void | Promise<void>;
  readonly onHandlerError: (ctx: JobContext, error: unknown) => void;
  readonly timeoutMs?: number;
  readonly retries?: { readonly attempts: number; readonly backoff: Backoff };
  readonly batch?: number;
  readonly idleMs?: number;
  readonly maxIdleMs?: number;
}

interface QueuesModule {
  createWorker<M>(options: WorkerOptions<M>): Worker;
}

const QUEUES_MODULE = './index.js';

function isQueuesModule(value: unknown): value is QueuesModule {
  return (
    typeof value === 'object' && value !== null && 'createWorker' in value && typeof value.createWorker === 'function'
  );
}

async function loadQueues(): Promise<QueuesModule> {
  const loaded: unknown = await import(QUEUES_MODULE);
  if (!isQueuesModule(loaded)) throw new Error('@zmdb/web/queues does not export createWorker');
  return loaded;
}

type Jobs = {
  readonly 'email.send': { readonly id: number };
  readonly 'audit.write': { readonly message: string };
};

const START = Date.parse('2026-09-04T00:00:00.000Z');

interface PendingSleep {
  readonly at: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
}

class FakeClock implements Clock {
  #now = START;
  readonly sleeps: number[] = [];
  readonly #pending: PendingSleep[] = [];

  now(): number {
    return this.#now;
  }

  sleep(ms: number, signal: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return new Promise<void>((resolve, reject) => {
      const pending = { at: this.#now + ms, resolve, reject, signal };
      this.#pending.push(pending);
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

interface MemoryStore extends JobStore {
  readonly db: DatabaseSync;
}

function memoryStore(): MemoryStore {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE zmdb_job (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    enqueued_at TEXT NOT NULL,
    dedupe_key TEXT,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    last_error TEXT,
    dead_reason TEXT,
    dead_detail TEXT,
    dead_at TEXT
  )`);
  db.exec('CREATE TABLE zmdb_job_done (key TEXT PRIMARY KEY, completed_at TEXT NOT NULL)');
  const driver = sqliteDriver(db);
  return { db, execute: query => driver.execute(query) };
}

function seed(
  store: MemoryStore,
  id: string,
  name: string,
  payload: string,
  options: { readonly attempts?: number; readonly key?: string; readonly status?: string } = {},
): void {
  store.db
    .prepare(
      `INSERT INTO zmdb_job
       (id, name, payload, status, attempts, enqueued_at, dedupe_key, lease_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      payload,
      options.status ?? 'pending',
      options.attempts ?? 0,
      new Date(START).toISOString(),
      options.key ?? null,
      new Date(0).toISOString(),
    );
}

function row(store: MemoryStore, id: string): Record<string, unknown> {
  return store.db.prepare('SELECT * FROM zmdb_job WHERE id = ?').get(id) as Record<string, unknown>;
}

function validEmail(raw: unknown): Jobs['email.send'] {
  if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
    throw new Error('email.send payload requires a numeric id');
  }
  return { id: raw.id };
}

function handler(
  handle: JobHandler<Jobs, 'email.send'>['handle'],
  overrides: Partial<JobHandler<Jobs, 'email.send'>> = {},
): JobHandler<Jobs, 'email.send'> {
  return { name: 'email.send', validate: validEmail, handle, ...overrides };
}

function workerOptions(
  store: MemoryStore,
  clock: FakeClock,
  email: JobHandler<Jobs, 'email.send'>,
  overrides: Partial<WorkerOptions<Jobs>> = {},
): WorkerOptions<Jobs> {
  return {
    handlers: [email],
    store,
    clock,
    concurrency: 2,
    graceMs: 1000,
    leaseMs: 30_000,
    onDead: () => undefined,
    onHandlerError: () => undefined,
    timeoutMs: 5000,
    retries: { attempts: 5, backoff: { kind: 'exponential', baseMs: 1000, ceilingMs: 300_000 } },
    ...overrides,
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('queue worker (#587 tests freeze)', () => {
  it.fails('validates a job payload at consume and dead-letters an invalid one', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'bad', 'email.send', '{"id":"old-shape"}');
    const run = vi.fn<JobHandler<Jobs, 'email.send'>['handle']>(() => Promise.resolve());
    const dead: DeadJob[] = [];
    const worker = createWorker(workerOptions(store, clock, handler(run), { onDead: job => void dead.push(job) }));

    expect(await worker.runOnce()).toMatchObject({ claimed: 1, dead: 1 });
    expect(run).not.toHaveBeenCalled();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.reason).toBe('invalid-payload');
    expect(row(store, 'bad')['attempts']).toBe(1);
  });

  it.fails('retries with jittered exponential backoff up to the ceiling', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'a', 'email.send', '{"id":1}');
    seed(store, 'b', 'email.send', '{"id":2}');
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => Promise.reject(new Error('down'))),
        { retries: { attempts: 13, backoff: { kind: 'exponential', baseMs: 1000, ceilingMs: 300_000 } } },
      ),
    );

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      expect(await worker.runOnce()).toMatchObject({ retried: 2 });
      const nominal = Math.min(300_000, 1000 * 2 ** (attempt - 1));
      const delays = ['a', 'b'].map(id => Date.parse(String(row(store, id)['lease_until'])) - clock.now());
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(nominal * 0.75);
        expect(delay).toBeLessThan(nominal * 1.25);
      }
      expect(delays[0]).not.toBe(delays[1]);
      clock.advance(Math.max(...delays) + 1);
    }
  });

  it.fails('dead-letters after exhausted attempts, retaining the payload and the last error', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    const payload = '{"id":1,"source":"legacy"}';
    seed(store, 'poison', 'email.send', payload);
    const dead: DeadJob[] = [];
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => Promise.reject(new Error('smtp unavailable'))),
        {
          retries: { attempts: 2, backoff: { kind: 'fixed', delayMs: 1000 } },
          onDead: job => void dead.push(job),
        },
      ),
    );

    await worker.runOnce();
    clock.advance(1251);
    await worker.runOnce();
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      jobId: 'poison',
      payload,
      attempts: 2,
      reason: 'attempts-exhausted',
      detail: 'smtp unavailable',
    });
    expect(await worker.runOnce()).toMatchObject({ claimed: 0 });
  });

  it.fails('replays a dead-lettered job', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'replay', 'email.send', '{"id":1}', { attempts: 5, status: 'dead' });
    const seen: number[] = [];
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(payload => Promise.resolve(void seen.push(payload.id))),
      ),
    );

    expect(await worker.replay('replay')).toBe(true);
    expect(await worker.runOnce()).toMatchObject({ done: 1 });
    expect(seen).toEqual([1]);
    expect(row(store, 'replay')['attempts']).toBe(1);
  });

  it.fails('aborts a handler that exceeds its timeout', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'slow', 'email.send', '{"id":1}');
    let signal: AbortSignal | undefined;
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler((_payload, ctx) => {
          signal = ctx.signal;
          return new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        { timeoutMs: 100 },
      ),
    );

    const pending = worker.runOnce();
    await flush();
    clock.advance(100);
    await expect(pending).resolves.toMatchObject({ retried: 1 });
    expect(signal?.aborted).toBe(true);
  });

  it.fails('logs and requeues when a handler ignores its abort signal', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'first', 'email.send', '{"id":1}');
    seed(store, 'second', 'email.send', '{"id":2}');
    const release = deferred();
    const started: number[] = [];
    const errors: unknown[] = [];
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(async payload => {
          started.push(payload.id);
          if (payload.id === 1) await release.promise;
        }),
        { concurrency: 1, timeoutMs: 100, onHandlerError: (_ctx, error) => void errors.push(error) },
      ),
    );

    const pending = worker.runOnce();
    await flush();
    clock.advance(100);
    await flush();
    expect(started).toEqual([1]);
    expect(errors).toHaveLength(1);
    expect(row(store, 'first')['status']).toBe('pending');
    release.resolve();
    await pending;
  });

  it.fails('respects the concurrency limit', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    for (let id = 1; id <= 5; id += 1) seed(store, String(id), 'email.send', `{"id":${id}}`);
    const releases = Array.from({ length: 5 }, () => deferred());
    let active = 0;
    let peak = 0;
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(async payload => {
          active += 1;
          peak = Math.max(peak, active);
          await releases[payload.id - 1]?.promise;
          active -= 1;
        }),
        { concurrency: 2, batch: 5 },
      ),
    );

    const pending = worker.runOnce();
    await flush();
    expect(peak).toBe(2);
    releases.forEach(item => item.resolve());
    await pending;
    expect(peak).toBe(2);
  });

  it.fails('drains in-flight jobs on shutdown within the grace period', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'drain', 'email.send', '{"id":1}');
    const release = deferred();
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => release.promise),
        { graceMs: 1000 },
      ),
    );
    const run = worker.runOnce();
    await flush();
    const shutdown = worker.onShutdown();
    release.resolve();
    await expect(Promise.all([run, shutdown])).resolves.toBeDefined();
    expect(row(store, 'drain')['status']).toBe('done');
  });

  it.fails('requeues an unfinished job rather than losing it when the grace period expires', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'stuck', 'email.send', '{"id":1}');
    const never = new Promise<void>(() => undefined);
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => never),
        { graceMs: 100, leaseMs: 30_000 },
      ),
    );
    void worker.runOnce();
    await flush();
    const shutdown = worker.onShutdown();
    clock.advance(100);
    await shutdown;
    const stored = row(store, 'stuck');
    expect(stored['status']).toBe('pending');
    expect(stored['attempts']).toBe(0);
    expect(Date.parse(String(stored['lease_until']))).toBeLessThanOrEqual(clock.now());
  });

  it.fails('deduplicates a job with a repeated idempotency key', async () => {
    const { createWorker } = await loadQueues();
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'delivery-1', 'email.send', '{"id":1}', { key: 'charge:1' });
    seed(store, 'delivery-2', 'email.send', '{"id":1}', { key: 'charge:1' });
    let effects = 0;
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(async (_payload, ctx) => {
          effects += 1;
          store.db
            .prepare('INSERT INTO zmdb_job_done(key, completed_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(ctx.idempotencyKey, new Date(clock.now()).toISOString());
        }),
      ),
    );

    expect(await worker.runOnce()).toMatchObject({ done: 2, skipped: 1 });
    expect(effects).toBe(1);
  });

  it('resolves handler dependencies from the container in the specified scope', () => {
    const DEPENDENCY = createToken<{ readonly value: string }>('queue-test-dependency');
    @Module({ providers: [{ token: DEPENDENCY, useFactory: () => ({ value: 'resolved' }), scope: 'singleton' }] })
    class Dependencies {}

    class ContainerBuiltHandler {
      @Inject(DEPENDENCY) readonly dependency!: { readonly value: string };
    }

    const compiled = compileModule(Dependencies);
    const built = compiled.container.build(ContainerBuiltHandler);
    expect(built.dependency.value).toBe('resolved');
    expect(compiled.container.resolve(DEPENDENCY)).toBe(compiled.container.resolve(DEPENDENCY));
  });
});
