import { createQueue, createWorker, type Clock, type JobHandler, type JobStore, type WorkerOptions } from '@zmdb/jobs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgJobStore } from './index.js';

const PG_CONN = process.env.ZMDB_PG;
const START = Date.parse('2026-09-05T00:00:00.000Z');

interface Jobs {
  readonly 'email.send': { readonly id: number };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

let postgres: Pool | undefined;

function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function validEmail(raw: unknown): Jobs['email.send'] {
  if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
    throw new TypeError('email.send requires a numeric id');
  }
  return { id: raw.id };
}

const clock: Clock = {
  now: () => START,
  sleep(_ms, signal) {
    return new Promise<void>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  },
};

function handler(seen: number[], claimed: Deferred, release: Promise<void>): JobHandler<Jobs, 'email.send'> {
  return {
    name: 'email.send',
    validate: validEmail,
    async handle(payload) {
      seen.push(payload.id);
      if (seen.length === 2) claimed.resolve();
      await release;
    },
  };
}

function workerOptions(store: JobStore, jobHandler: JobHandler<Jobs, 'email.send'>): WorkerOptions<Jobs> {
  return {
    handlers: [jobHandler],
    store,
    clock,
    concurrency: 2,
    graceMs: 1000,
    leaseMs: 30_000,
    timeoutMs: 5000,
    batch: 2,
    onDead: () => undefined,
    onHandlerError: () => undefined,
  };
}

beforeAll(async () => {
  if (PG_CONN === undefined || PG_CONN.trim() === '') {
    throw new Error('Set ZMDB_PG explicitly to run the PostgreSQL jobs integration tests.');
  }
  const candidate = new Pool({ connectionString: PG_CONN, connectionTimeoutMillis: 1000, max: 8 });
  try {
    await candidate.query('SELECT 1');
    postgres = candidate;
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error('The PostgreSQL jobs integration database is unreachable; check ZMDB_PG.');
  }
});

beforeEach(async () => {
  if (postgres === undefined) return;
  await postgres.query(`
    DROP TABLE IF EXISTS zmdb_job_done;
    DROP TABLE IF EXISTS zmdb_job;
    CREATE TABLE zmdb_job (
      id text PRIMARY KEY,
      name text NOT NULL,
      payload text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      enqueued_at timestamptz NOT NULL,
      dedupe_key text UNIQUE,
      lease_owner text NOT NULL DEFAULT '',
      lease_until timestamptz NOT NULL DEFAULT 'epoch',
      last_error text,
      dead_reason text,
      dead_detail text,
      dead_at timestamptz
    );
    CREATE TABLE zmdb_job_done (
      key text PRIMARY KEY,
      completed_at timestamptz NOT NULL
    );
    CREATE INDEX zmdb_job_pending
      ON zmdb_job (status, lease_until, enqueued_at)
      WHERE status = 'pending';
  `);
});

afterAll(async () => {
  await postgres?.end();
});

describe('@zmdb/jobs-postgres (#661)', () => {
  it('round-trips through a real pg Pool without taking ownership of it', async () => {
    if (postgres === undefined) return;
    const store = createPgJobStore(postgres);

    expect(store).not.toHaveProperty('dialect');
    expect(store).not.toHaveProperty('execute');
    await expect(store.completed('missing')).resolves.toBe(false);
    await store.close();
    await expect(postgres.query('SELECT 2::int AS answer')).resolves.toMatchObject({ rows: [{ answer: 2 }] });
  });

  it('preserves stable bounded prepared statements', async () => {
    if (postgres === undefined) return;
    const pool = new Pool({ connectionString: PG_CONN, connectionTimeoutMillis: 1000, max: 1 });
    try {
      const store = createPgJobStore(pool, { prepared: true, maxCacheSize: 1 });
      await store.completed('one');
      await store.completed('two');

      const first = await pool.query<{ readonly name: string; readonly statement: string }>(
        'SELECT name, statement FROM pg_prepared_statements',
      );
      expect(first.rows).toHaveLength(1);

      await store.listDead({ limit: 1 });
      const remaining = await pool.query<{ readonly name: string; readonly statement: string }>(
        'SELECT name, statement FROM pg_prepared_statements ORDER BY name',
      );
      expect(remaining.rows).toEqual([{ name: expect.any(String), statement: expect.stringContaining('dead') }]);
      await store.close();
      await expect(pool.query('SELECT 3::int AS answer')).resolves.toMatchObject({ rows: [{ answer: 3 }] });
    } finally {
      await pool.end();
    }
  });

  it('lets two workers claim disjoint jobs from one store', async () => {
    if (postgres === undefined) return;
    const store = createPgJobStore(postgres);
    const queue = createQueue<Jobs>({ store, clock });
    await Promise.all([1, 2, 3, 4].map(id => queue.enqueue('email.send', { id })));

    const firstSeen: number[] = [];
    const secondSeen: number[] = [];
    const firstClaimed = deferred();
    const secondClaimed = deferred();
    const release = deferred();
    const first = createWorker(workerOptions(store, handler(firstSeen, firstClaimed, release.promise)));
    const second = createWorker(workerOptions(store, handler(secondSeen, secondClaimed, release.promise)));

    const firstPass = first.runOnce();
    await firstClaimed.promise;
    const secondPass = second.runOnce();
    await secondClaimed.promise;
    release.resolve();

    const [firstReport, secondReport] = await Promise.all([firstPass, secondPass]);
    expect(firstReport).toMatchObject({ claimed: 2, done: 2 });
    expect(secondReport).toMatchObject({ claimed: 2, done: 2 });
    expect(firstSeen).toHaveLength(2);
    expect(secondSeen).toHaveLength(2);
    expect(firstSeen.filter(id => secondSeen.includes(id))).toEqual([]);
    expect([...firstSeen, ...secondSeen].toSorted()).toEqual([1, 2, 3, 4]);
  });
});
