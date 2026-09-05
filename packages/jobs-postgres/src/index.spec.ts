import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createQueue, createWorker, type Clock, type JobHandler, type JobStore, type WorkerOptions } from '@zmdb/jobs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgJobStore } from './index.js';

const PG_CONN = process.env.ZMDB_PG ?? 'postgres://postgres:postgres@localhost:55432/bench';
const REQUIRE_POSTGRES = process.env.ZMDB_REQUIRE_PG === '1';
const START = Date.parse('2026-09-05T00:00:00.000Z');

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
}

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

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
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
  const candidate = new Pool({ connectionString: PG_CONN, connectionTimeoutMillis: 1000, max: 8 });
  try {
    await candidate.query('SELECT 1');
    postgres = candidate;
  } catch (error) {
    await candidate.end().catch(() => undefined);
    if (REQUIRE_POSTGRES) {
      throw new Error(`PostgreSQL is required but not reachable at ${PG_CONN}`, { cause: error });
    }
    console.warn(`[skip] Postgres not reachable at ${PG_CONN}`);
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

    expect(store.dialect).toBe('postgres');
    await expect(store.execute({ text: 'SELECT $1::int AS answer', parameters: [42] })).resolves.toEqual([
      { answer: 42 },
    ]);
    await expect(postgres.query('SELECT 2::int AS answer')).resolves.toMatchObject({ rows: [{ answer: 2 }] });
  });

  it('preserves stable bounded prepared statements', async () => {
    if (postgres === undefined) return;
    const pool = new Pool({ connectionString: PG_CONN, connectionTimeoutMillis: 1000, max: 1 });
    try {
      const store = createPgJobStore(pool, { prepared: true, maxCacheSize: 1 });
      const firstSql = 'SELECT $1::int AS answer';
      await store.execute({ text: firstSql, parameters: [1] });
      await store.execute({ text: firstSql, parameters: [2] });

      const first = await pool.query<{ readonly name: string; readonly statement: string }>(
        'SELECT name, statement FROM pg_prepared_statements WHERE statement = $1',
        [firstSql],
      );
      expect(first.rows).toHaveLength(1);

      const secondSql = 'SELECT $1::text AS value';
      await store.execute({ text: secondSql, parameters: ['next'] });
      const remaining = await pool.query<{ readonly name: string; readonly statement: string }>(
        'SELECT name, statement FROM pg_prepared_statements ORDER BY name',
      );
      expect(remaining.rows).toEqual([{ name: expect.any(String), statement: secondSql }]);
      await expect(pool.query('SELECT 3::int AS answer')).resolves.toMatchObject({ rows: [{ answer: 3 }] });
    } finally {
      await pool.end();
    }
  });

  it('keeps pg on an adapter-only optional peer boundary', () => {
    const root = process.cwd();
    const adapter = readManifest(join(root, 'packages', 'jobs-postgres', 'package.json'));
    expect(adapter.dependencies).toEqual({
      '@zmdb/jobs': 'workspace:^',
      '@zmdb/repository': 'workspace:^',
    });
    expect(adapter.peerDependencies).toEqual({ pg: '^8.23.0' });
    expect(adapter.peerDependenciesMeta).toBeUndefined();

    for (const name of ['aot-validator', 'app', 'jobs', 'repository', 'web', 'zmdb']) {
      const manifest = readManifest(join(root, 'packages', name, 'package.json'));
      expect(manifest.peerDependencies ?? {}, name).not.toHaveProperty('pg');
    }
    expect(readManifest(join(root, 'packages', 'jobs', 'package.json')).exports).not.toHaveProperty('./postgres');
    expect(readManifest(join(root, 'packages', 'web', 'package.json')).exports).not.toHaveProperty(
      './queues/backends/pg',
    );
    expect(existsSync(join(root, 'packages', 'web', 'src', 'queues', 'backends', 'pg.ts'))).toBe(false);
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
