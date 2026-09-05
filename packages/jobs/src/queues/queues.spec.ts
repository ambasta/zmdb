import { createToken, Inject } from '@zmdb/app/di';
import { compileModule, Module } from '@zmdb/app/modules';
import { createQueue, createWorker, type Clock, type DeadJob, type JobHandler, type WorkerOptions } from '@zmdb/jobs';
import { createMemoryJobStore, type MemoryJobStore } from '@zmdb/jobs/memory';
// Runtime contract for #587/#588, against queues/SPEC.md. Every assertion reaches the
// shipped worker through the supported in-memory backend and fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type MemoryStore = MemoryJobStore;

const stores = new Set<MemoryStore>();
function memoryStore(): MemoryStore {
  const store = createMemoryJobStore();
  stores.add(store);
  return store;
}

function seed(
  store: MemoryStore,
  id: string,
  name: string,
  payload: string,
  options: { readonly attempts?: number; readonly key?: string; readonly status?: string } = {},
): void {
  store.database
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
  return store.database.prepare('SELECT * FROM zmdb_job WHERE id = ?').get(id) as Record<string, unknown>;
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
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores) store.close();
  stores.clear();
});

describe('queue worker (#587 tests freeze)', () => {
  it('enqueues one delayed row for a repeated dedupe key', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const queue = createQueue<Jobs>({ store, clock });
    const seen: number[] = [];
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(payload => Promise.resolve(void seen.push(payload.id))),
      ),
    );

    const [first, repeated] = await Promise.all([
      queue.enqueue('email.send', { id: 1 }, { delayMs: 100, dedupeKey: 'email:1' }),
      queue.enqueue('email.send', { id: 1 }, { delayMs: 100, dedupeKey: 'email:1' }),
    ]);

    expect(repeated).toBe(first);
    expect(store.database.prepare('SELECT COUNT(*) AS count FROM zmdb_job').get()).toMatchObject({ count: 1 });
    expect(await worker.runOnce()).toMatchObject({ claimed: 0 });
    clock.advance(101);
    expect(await worker.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    expect(seen).toEqual([1]);
  });

  it('validates a job payload at consume and dead-letters an invalid one', async () => {
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

  it('retries with jittered exponential backoff up to the ceiling', async () => {
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

  it('dead-letters after exhausted attempts, retaining the payload and the last error', async () => {
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

  it('replays a dead-lettered job', async () => {
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

  it('aborts a handler that exceeds its timeout', async () => {
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

  it('logs and requeues when a handler ignores its abort signal', async () => {
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
        handler(async (payload, ctx) => {
          started.push(payload.id);
          if (payload.id === 1) {
            await release.promise;
            store.database
              .prepare('INSERT INTO zmdb_job_done(key, completed_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
              .run(ctx.idempotencyKey, new Date(clock.now()).toISOString());
          }
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
    const retryAfter = Date.parse(String(row(store, 'first')['lease_until'])) - clock.now();
    release.resolve();
    await pending;
    clock.advance(retryAfter + 1);
    const reports = [await worker.runOnce(), await worker.runOnce()];
    expect(reports.reduce((total, report) => total + report.done, 0)).toBe(2);
    expect(reports.reduce((total, report) => total + report.skipped, 0)).toBe(1);
    expect(started.filter(id => id === 1)).toEqual([1]);
    expect(started.filter(id => id === 2)).toEqual([2]);
  });

  it('respects the concurrency limit', async () => {
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

  it('keeps the worker bound when runOnce is called concurrently', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, '1', 'email.send', '{"id":1}');
    seed(store, '2', 'email.send', '{"id":2}');
    const releases = [deferred(), deferred()];
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
        { concurrency: 1 },
      ),
    );

    const first = worker.runOnce();
    const samePass = worker.runOnce();
    await flush();
    expect(peak).toBe(1);
    releases[0]?.resolve();
    await Promise.all([first, samePass]);

    const second = worker.runOnce();
    await flush();
    expect(peak).toBe(1);
    releases[1]?.resolve();
    await second;
    expect(peak).toBe(1);
  });

  it('drains in-flight jobs on shutdown within the grace period', async () => {
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

  it('requeues an unfinished job rather than losing it when the grace period expires', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'stuck', 'email.send', '{"id":1}');
    const never = new Promise<void>(() => undefined);
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => never),
        { graceMs: 1000, leaseMs: 30_000 },
      ),
    );
    void worker.runOnce();
    await flush();
    const shutdown = worker.onShutdown({ graceMs: 100 });
    clock.advance(100);
    await shutdown;
    const stored = row(store, 'stuck');
    expect(stored['status']).toBe('pending');
    expect(stored['attempts']).toBe(0);
    expect(Date.parse(String(stored['lease_until']))).toBeLessThanOrEqual(clock.now());

    const recoveringWorker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => Promise.resolve()),
      ),
    );
    await expect(recoveringWorker.runOnce()).resolves.toMatchObject({ claimed: 1, done: 1 });
    expect(row(store, 'stuck')['status']).toBe('done');
  });

  it('deduplicates a job with a repeated idempotency key', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'delivery', 'email.send', '{"id":1}', { key: 'charge:1' });
    let effects = 0;
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(async (_payload, ctx) => {
          effects += 1;
          store.database
            .prepare('INSERT INTO zmdb_job_done(key, completed_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(ctx.idempotencyKey, new Date(clock.now()).toISOString());
          throw new Error('effect committed before acknowledgement');
        }),
        { retries: { attempts: 2, backoff: { kind: 'fixed', delayMs: 100 } } },
      ),
    );

    expect(await worker.runOnce()).toMatchObject({ retried: 1 });
    const retryAfter = Date.parse(String(row(store, 'delivery')['lease_until'])) - clock.now();
    clock.advance(retryAfter + 1);
    expect(await worker.runOnce()).toMatchObject({ done: 1, skipped: 1 });
    expect(effects).toBe(1);
  });

  it('reports a one-based attempt that follows the stored attempt count', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'attempts', 'email.send', '{"id":1}');
    const seen: { readonly context: number; readonly stored: unknown }[] = [];
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler((_payload, ctx) => {
          seen.push({ context: ctx.attempt, stored: row(store, ctx.jobId)['attempts'] });
          return Promise.reject(new Error('retry'));
        }),
        { retries: { attempts: 3, backoff: { kind: 'fixed', delayMs: 100 } } },
      ),
    );

    await worker.runOnce();
    clock.advance(126);
    await worker.runOnce();

    expect(seen).toEqual([
      { context: 1, stored: 0 },
      { context: 2, stored: 1 },
    ]);
  });

  it('retries an unknown name before exposing a filterable dead letter', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const payload = '{"message":"from-newer-deploy"}';
    seed(store, 'unknown', 'audit.write', payload);
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => Promise.resolve()),
        {
          retries: { attempts: 2, backoff: { kind: 'fixed', delayMs: 100 } },
        },
      ),
    );

    expect(await worker.runOnce()).toMatchObject({ retried: 1, dead: 0 });
    clock.advance(126);
    expect(await worker.runOnce()).toMatchObject({ retried: 0, dead: 1 });
    expect(await worker.listDead({ limit: 10, reason: 'unknown-name' })).toEqual([
      expect.objectContaining({
        jobId: 'unknown',
        payload,
        attempts: 2,
        reason: 'unknown-name',
      }),
    ]);
    expect(await worker.listDead({ limit: 10, reason: 'invalid-payload' })).toEqual([]);
  });

  it('replays a completed dead job as a marker-backed no-op', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    seed(store, 'completed', 'email.send', '{"id":1}', { attempts: 5, key: 'email:completed', status: 'dead' });
    store.database
      .prepare('INSERT INTO zmdb_job_done(key, completed_at) VALUES (?, ?)')
      .run('email:completed', new Date(clock.now()).toISOString());
    const run = vi.fn<JobHandler<Jobs, 'email.send'>['handle']>(() => Promise.resolve());
    const worker = createWorker(workerOptions(store, clock, handler(run)));

    expect(await worker.replay('completed')).toBe(true);
    expect(await worker.runOnce()).toMatchObject({ done: 1, skipped: 1 });
    expect(run).not.toHaveBeenCalled();
    expect(row(store, 'completed')['status']).toBe('done');
  });

  it('aborts the longest idle sleep when shutdown starts', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const worker = createWorker(
      workerOptions(
        store,
        clock,
        handler(() => Promise.resolve()),
        {
          idleMs: 30_000,
          maxIdleMs: 30_000,
        },
      ),
    );

    worker.start();
    await flush();
    expect(clock.sleeps).toContain(30_000);
    await expect(worker.onShutdown()).resolves.toBeUndefined();
  });

  it('lets two workers claim disjoint jobs from one store', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    for (let id = 1; id <= 4; id += 1) seed(store, String(id), 'email.send', `{"id":${id}}`);
    const seen: number[] = [];
    const makeWorker = () =>
      createWorker(
        workerOptions(
          store,
          clock,
          handler(payload => Promise.resolve(void seen.push(payload.id))),
          { concurrency: 2, batch: 2 },
        ),
      );

    const firstWorker = makeWorker();
    const secondWorker = makeWorker();
    const reports = [
      ...(await Promise.all([firstWorker.runOnce(), secondWorker.runOnce()])),
      ...(await Promise.all([firstWorker.runOnce(), secondWorker.runOnce()])),
    ];

    expect(reports.reduce((total, report) => total + report.claimed, 0)).toBe(4);
    expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(new Set(seen)).toHaveProperty('size', 4);
  });

  it('rejects leases that cannot cover timeouts and handler concurrency above the worker bound', () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const options = (overrides: Partial<WorkerOptions<Jobs>>) =>
      workerOptions(
        store,
        clock,
        handler(() => Promise.resolve()),
        overrides,
      );

    expect(() => createWorker(options({ timeoutMs: 0 }))).toThrow(/timeoutMs/);
    expect(() => createWorker(options({ timeoutMs: Number.POSITIVE_INFINITY }))).toThrow(/timeoutMs/);
    expect(() => createWorker(options({ leaseMs: 5000, timeoutMs: 5000 }))).toThrow(
      /leaseMs must be greater than timeoutMs/,
    );
    expect(() =>
      createWorker(options({ handlers: [handler(() => Promise.resolve(), { timeoutMs: 30_000 })] })),
    ).toThrow(/leaseMs must be greater than email\.send\.timeoutMs/);
    expect(() =>
      createWorker(options({ concurrency: 1, handlers: [handler(() => Promise.resolve(), { concurrency: 2 })] })),
    ).toThrow(/cannot exceed worker concurrency/);
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
