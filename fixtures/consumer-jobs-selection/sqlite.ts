import { DatabaseSync } from 'node:sqlite';

import { createApplication, Module } from '@zmdb/app';
import { createQueue, createWorker, jobsExtension, type Clock, type JobHandler, type WorkerOptions } from '@zmdb/jobs';
import { createMemoryJobStore, createSqliteJobStore, jobsSqliteMigrations, sqliteJobEnqueuer } from '@zmdb/jobs-sqlite';

type Jobs = {
  readonly deliver: { readonly id: number };
  readonly fail: { readonly id: number };
};

class FakeClock implements Clock {
  #now = Date.parse('2026-09-06T00:00:00.000Z');

  now(): number {
    return this.#now;
  }

  sleep(_ms: number, signal: AbortSignal): Promise<void> {
    return signal.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve();
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

function handler<K extends keyof Jobs & string>(name: K, run: JobHandler<Jobs, K>['handle']): JobHandler<Jobs, K> {
  return {
    name,
    validate(raw) {
      if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
        throw new TypeError(`${name} requires a numeric id`);
      }
      return { id: raw.id } as Jobs[K];
    },
    handle: run,
  };
}

const migrationIdentity = jobsSqliteMigrations.map(migration => [migration.version, migration.name]);
if (
  JSON.stringify(migrationIdentity) !==
  JSON.stringify([
    [20260906000100, 'jobs_queue'],
    [20260906000200, 'jobs_schedule_lease'],
  ])
) {
  throw new Error(`unexpected SQLite jobs migrations: ${JSON.stringify(migrationIdentity)}`);
}

const clock = new FakeClock();
const store = createMemoryJobStore();
const queue = createQueue<Jobs>({ store, clock });
const delivered: number[] = [];
const workerOptions: WorkerOptions<Jobs> = {
  handlers: [
    handler('deliver', payload => Promise.resolve(void delivered.push(payload.id))),
    handler('fail', () => Promise.reject(new Error('deliberate failure'))),
  ],
  store,
  clock,
  concurrency: 2,
  graceMs: 100,
  leaseMs: 1000,
  timeoutMs: 100,
  retries: { attempts: 2, backoff: { kind: 'fixed', delayMs: 10 } },
  onDead: () => undefined,
  onHandlerError: () => undefined,
};
const worker = createWorker(workerOptions);

const first = await queue.enqueue('deliver', { id: 1 }, { dedupeKey: 'deliver:1' });
const duplicate = await queue.enqueue('deliver', { id: 1 }, { dedupeKey: 'deliver:1' });
if (duplicate !== first) throw new Error('SQLite provider did not preserve dedupe identity');
const deliveredReport = await worker.runOnce();
if (deliveredReport.claimed !== 1 || deliveredReport.done !== 1 || delivered[0] !== 1) {
  throw new Error(`SQLite provider did not claim and complete the job: ${JSON.stringify(deliveredReport)}`);
}

await queue.enqueue('fail', { id: 2 });
const retried = await worker.runOnce();
clock.advance(20);
const dead = await worker.runOnce();
const deadRows = await worker.listDead({ limit: 10 });
if (retried.retried !== 1 || dead.dead !== 1 || deadRows.length !== 1) {
  throw new Error(
    `SQLite retry/dead-letter contract failed: ${JSON.stringify({ retried, dead, deadRows: deadRows.length })}`,
  );
}
if (!(await worker.replay(deadRows[0]?.jobId ?? ''))) throw new Error('SQLite provider refused dead-letter replay');

const beforeRollback = store.database.prepare('SELECT COUNT(*) AS count FROM zmdb_job').get() as {
  readonly count: number;
};
store.database.exec('BEGIN');
await queue.enqueueInTransaction(sqliteJobEnqueuer(store.database), 'deliver', { id: 3 });
store.database.exec('ROLLBACK');
const afterRollback = store.database.prepare('SELECT COUNT(*) AS count FROM zmdb_job').get() as {
  readonly count: number;
};
if (afterRollback.count !== beforeRollback.count) {
  throw new Error('sqliteJobEnqueuer did not share the caller transaction');
}

if (!(await store.acquire('nightly', 'holder-a', 1000))) throw new Error('SQLite lease acquisition failed');
if (await store.acquire('nightly', 'holder-b', 1000)) throw new Error('SQLite lease allowed two holders');
if (!(await store.renew('nightly', 'holder-a', 1000))) throw new Error('SQLite lease renewal failed');
await store.release('nightly', 'holder-a');
if (!(await store.acquire('nightly', 'holder-b', 1000))) throw new Error('SQLite lease release was not visible');

const borrowedDatabase = new DatabaseSync(':memory:');
const borrowedStore = createSqliteJobStore(borrowedDatabase);
borrowedStore.close();
borrowedStore.close();
borrowedDatabase.prepare('SELECT 1').get();
borrowedDatabase.close();

@Module({ controllers: [] })
class JobsApplication {}

const application = createApplication(JobsApplication, {
  graceMs: 100,
  extensions: [jobsExtension({ stores: [store] })],
});
await application.init();
await application[Symbol.asyncDispose]();
let ownedClosed = false;
try {
  store.database.prepare('SELECT 1').get();
} catch {
  ownedClosed = true;
}
if (!ownedClosed) throw new Error('jobsExtension did not close its owned SQLite store');

process.stdout.write(
  `${JSON.stringify({
    dead: deadRows.length,
    delivered,
    migrations: migrationIdentity,
    ownedClosed,
    rollbackRows: afterRollback.count,
  })}\n`,
);
